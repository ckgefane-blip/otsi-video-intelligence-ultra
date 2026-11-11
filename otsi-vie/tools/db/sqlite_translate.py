"""Translate the MySQL migrations (database/migrations/NNNN_*.sql) into SQLite.

GENERATED OUTPUT — do not hand-edit the generated files. Fix this translator (or
tools/db/sqlite_triggers.sql, the hand-written trigger overlay) and re-run:

  python otsi-vie/tools/db/sqlite_translate.py [--check]

Outputs (all generated, all checked in):
  database/migrations-sqlite/NNNN_name.sqlite.sql  one file per MySQL migration,
      applying that migration's net change to a SQLite database
  database/sqlite-bootstrap.sql                   the whole local schema from
      scratch, for a fresh desktop install (same end state as running every
      per-migration file in order)
  database/sqlite-column-collations.csv           the per-column
      case-sensitivity decision (COLLATE NOCASE or binary, and why)
  database/sqlite-translation-report.json         inventory: what was translated,
      what was warned about, what was deliberately not translated

Translation rules (plan v4 §1d, safeguard 3; full record in
database/sqlite-schema-mapping.md):
  * STRICT tables: every column is INTEGER, REAL, TEXT or BLOB. CHAR/VARCHAR
    become TEXT (+ a length CHECK), ENUM becomes TEXT (+ an IN CHECK), JSON
    becomes TEXT (+ json_valid CHECK), DECIMAL/NUMERIC becomes REAL (recorded:
    exact-decimal semantics are lost; the columns hold scores and ratios),
    DATETIME/TIMESTAMP/DATE become INTEGER epoch milliseconds, BOOLEAN/BIT
    become INTEGER 0/1, AUTO_INCREMENT becomes INTEGER PRIMARY KEY
    AUTOINCREMENT, ON UPDATE CURRENT_TIMESTAMP becomes an AFTER UPDATE
    touch trigger.
  * Foreign keys are declared in the DDL and enforced with PRAGMA
    foreign_keys=ON (the runner does this on every connection).
  * MySQL stored procedures have no SQLite equivalent: sp_issue_canonical_
    player_id and sp_merge_players move into application code (named in the
    mapping note). MySQL triggers become equivalent SQLite triggers, except
    the retention-account DELETE exception, which SQLite cannot express
    (USER() does not exist): those triggers refuse every DELETE, and the
    retention path deletes through the adapter's retention bypass instead.
  * SQLite cannot ADD/DROP a constraint or MODIFY a column on an existing
    table, so a per-migration file that does so rebuilds the table
    (CREATE new, INSERT SELECT, DROP old, RENAME) and recreates its indexes
    and triggers. The runner runs each migration in one transaction with
    foreign keys off and re-checks them afterwards.
"""
from __future__ import annotations

import csv
import hashlib
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import migrate  # noqa: E402  (lazy pymysql: importing migrate never needs MySQL here)

ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS = ROOT / "database" / "migrations"
OUT_DIR = ROOT / "database" / "migrations-sqlite"
BOOTSTRAP_FILE = ROOT / "database" / "sqlite-bootstrap.sql"
COLLATIONS_FILE = ROOT / "database" / "sqlite-column-collations.csv"
REPORT_FILE = ROOT / "database" / "sqlite-translation-report.json"
TRIGGERS_OVERLAY = Path(__file__).resolve().parent / "sqlite_triggers.sql"

MS_NOW = "(CAST(unixepoch('subsec')*1000 AS INTEGER))"
UUID_EXPR = ("lower(substr(hex(randomblob(4)),1,8) || '-' || substr(hex(randomblob(2)),1,4) "
             "|| '-4' || substr(hex(randomblob(2)),2,3) || '-' || substr('ab89', 1 + abs(random()) % 4, 1) "
             "|| substr(hex(randomblob(2)),2,3) || '-' || substr(hex(randomblob(6)),1,12))")


class TranslateError(RuntimeError):
    pass


# ------------------------------------------------------------------ #
# small scanner helpers (quote/backtick/paren aware)
# ------------------------------------------------------------------ #

def strip_comments(sql: str) -> str:
    out, i, n = [], 0, len(sql)
    while i < n:
        c = sql[i]
        if c in ("'", '"', "`"):
            j = i + 1
            while j < n:
                if sql[j] == "\\" and c != "`":
                    j += 2
                    continue
                if sql[j] == c:
                    if j + 1 < n and sql[j + 1] == c:
                        j += 2
                        continue
                    break
                j += 1
            out.append(sql[i:j + 1])
            i = j + 1
        elif sql.startswith("--", i) and (i + 2 >= n or sql[i + 2] in " \t\r\n"):
            j = sql.find("\n", i)
            i = n if j < 0 else j
        elif sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
        elif c == "#":
            j = sql.find("\n", i)
            i = n if j < 0 else j
        else:
            out.append(c)
            i += 1
    return "".join(out)


def split_top_commas(s: str) -> list[str]:
    parts, buf, depth, i, n = [], [], 0, 0, len(s)
    while i < n:
        c = s[i]
        if c in ("'", '"', "`"):
            j = i + 1
            while j < n:
                if s[j] == "\\" and c != "`":
                    j += 2
                    continue
                if s[j] == c:
                    if j + 1 < n and s[j + 1] == c:
                        j += 2
                        continue
                    break
                j += 1
            buf.append(s[i:j + 1])
            i = j + 1
        elif c == "(":
            depth += 1
            buf.append(c)
            i += 1
        elif c == ")":
            depth -= 1
            buf.append(c)
            i += 1
        elif c == "," and depth == 0:
            parts.append("".join(buf))
            buf = []
            i += 1
        else:
            buf.append(c)
            i += 1
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return [p.strip() for p in parts if p.strip()]


def matching_paren(s: str, i: int) -> int:
    """Index of the ')' matching the '(' at i (quote aware)."""
    depth, j, n = 0, i, len(s)
    while j < n:
        c = s[j]
        if c in ("'", '"', "`"):
            k = j + 1
            while k < n:
                if s[k] == "\\" and c != "`":
                    k += 2
                    continue
                if s[k] == c:
                    if k + 1 < n and s[k + 1] == c:
                        k += 2
                        continue
                    break
                k += 1
            j = k + 1
        elif c == "(":
            depth += 1
            j += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return j
            j += 1
        else:
            j += 1
    raise TranslateError(f"unbalanced parens in: {s[i:i + 80]!r}")


def find_call(s: str, name: str, start: int = 0) -> tuple[int, int] | None:
    """(name_start, paren_index) of the next NAME( call, or None."""
    m = re.compile(r"\b" + re.escape(name) + r"\s*\(", re.I).search(s, start)
    if not m:
        return None
    return m.start(), m.end() - 1


def parse_string_literal(s: str, i: int) -> tuple[str, int]:
    """MySQL string literal at i (single or double quoted); returns the decoded
    value and the index just past the closing quote. Handles '' and \\ escapes."""
    q = s[i]
    j, out = i + 1, []
    while j < len(s):
        c = s[j]
        if c == "\\" and j + 1 < len(s):
            nxt = s[j + 1]
            out.append({"n": "\n", "t": "\t", "r": "\r", "0": "\0", "\\": "\\",
                        "'": "'", '"': '"', "%": "%", "_": "_"}.get(nxt, nxt))
            j += 2
        elif c == q:
            if j + 1 < len(s) and s[j + 1] == q:
                out.append(q)
                j += 2
            else:
                return "".join(out), j + 1
        else:
            out.append(c)
            j += 1
    raise TranslateError(f"unterminated string literal in: {s[i:i + 80]!r}")


def sqlite_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def split_code_segments(expr: str) -> list[tuple[bool, str]]:
    """Split an expression into (is_string_literal, text) segments so rewrites
    never touch text inside quotes."""
    segs, i, n = [], 0, len(expr)
    buf = []
    while i < n:
        c = expr[i]
        if c in ("'", '"'):
            if buf:
                segs.append((False, "".join(buf)))
                buf = []
            value, j = parse_string_literal(expr, i)
            segs.append((True, sqlite_literal(value)))
            i = j
        elif c == "`":
            j = expr.find("`", i + 1)
            j = n if j < 0 else j + 1
            buf.append(expr[i:j])
            i = j
        else:
            buf.append(c)
            i += 1
    if buf:
        segs.append((False, "".join(buf)))
    return segs


# ------------------------------------------------------------------ #
# MySQL regex -> SQLite GLOB (the four patterns the migrations use)
# ------------------------------------------------------------------ #

def _regex_atom_to_glob(pat: str, i: int) -> tuple[str, int]:
    c = pat[i]
    if c == "[":
        j = pat.find("]", i)
        if j < 0:
            raise TranslateError(f"bad character class in regex {pat!r}")
        inner = pat[i + 1:j]
        if inner.startswith("^"):
            return "[!" + inner[1:] + "]", j + 1
        return "[" + inner + "]", j + 1
    if c == "\\":
        nxt = pat[i + 1] if i + 1 < len(pat) else ""
        return {"d": "[0-9]", "w": "[A-Za-z0-9_]", "s": "[ \t]"} .get(nxt, nxt), i + 2
    if c == ".":
        return "?", i + 1
    if c in "*?":
        return "[" + c + "]", i + 1
    return c, i + 1


def regex_to_globs(pat: str) -> list[str]:
    """Convert an anchored MySQL regex to one or more SQLite GLOB patterns
    (a list when a {n,m} range needs an OR). Raises on anything unhandled."""
    if not pat.startswith("^") or not pat.endswith("$"):
        raise TranslateError(f"regex {pat!r} is not ^...$ anchored; no safe GLOB translation")
    body = pat[1:-1]
    variants: list[str] = [""]
    i = 0
    while i < len(body):
        atom, i = _regex_atom_to_glob(body, i)
        low, high = 1, 1
        if i < len(body) and body[i] == "{":
            j = body.find("}", i)
            if j < 0:
                raise TranslateError(f"bad quantifier in regex {pat!r}")
            q = body[i + 1:j]
            if "," in q:
                a, b = q.split(",", 1)
                low, high = int(a), int(b)
            else:
                low = high = int(q)
            i = j + 1
        elif i < len(body) and body[i] in "+*":
            raise TranslateError(f"quantifier {body[i]!r} in regex {pat!r} has no safe GLOB translation")
        if low == high:
            variants = [v + atom * low for v in variants]
        else:
            expanded = []
            for v in variants:
                for k in range(low, high + 1):
                    expanded.append(v + atom * k)
            variants = expanded
    return variants


def _glob_condition(col: str, pat: str) -> str:
    # A trailing `*` on a character class has no finite GLOB expansion, so the
    # two star patterns in the migrations get an exact equivalent built from
    # GLOB + NOT GLOB ("first char in class, every char in the allowed set,
    # every dot followed by a letter, no trailing dot").
    special = {
        "^[a-z][a-z0-9_.-]*$": (
            f"{col} GLOB '[a-z]*' AND {col} NOT GLOB '*[^a-z0-9_.-]*'"),
        "^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$": (
            f"{col} GLOB '[a-z]*' AND {col} GLOB '*.*' AND {col} NOT GLOB '*[^a-z0-9_.]*'"
            f" AND {col} NOT GLOB '*.[^a-z]*' AND {col} NOT GLOB '*.'"),
    }
    if pat in special:
        return "(" + special[pat] + ")"
    globs = regex_to_globs(pat)
    if len(globs) == 1:
        return f"{col} GLOB {sqlite_literal(globs[0])}"
    return "(" + " OR ".join(f"{col} GLOB {sqlite_literal(g)}" for g in globs) + ")"


# ------------------------------------------------------------------ #
# expression translation (MySQL -> SQLite)
# ------------------------------------------------------------------ #

def _replace_call(expr: str, name: str, repl) -> str:
    """Replace every NAME(...) call with repl(inner_text). Paren aware."""
    out, i = [], 0
    while True:
        found = find_call(expr, name, i)
        if found is None:
            out.append(expr[i:])
            break
        name_start, paren = found
        out.append(expr[i:name_start])
        close = matching_paren(expr, paren)
        out.append(repl(expr[paren + 1:close]))
        i = close + 1
    return "".join(out)


def _call_args(inner: str) -> list[str]:
    return split_top_commas(inner)


def translate_expr(expr: str) -> str:
    """Translate a MySQL expression (CHECK, DEFAULT, generated column, view,
    DML) to SQLite. String literals pass through untouched."""
    # JSON_UNQUOTE(JSON_EXTRACT(...)) is just json_extract in SQLite
    # (json_extract already returns the bare string); unwrap it first.
    while True:
        found = find_call(expr, "JSON_UNQUOTE")
        if found is None:
            break
        name_start, paren = found
        close = matching_paren(expr, paren)
        expr = expr[:name_start] + expr[paren + 1:close] + expr[close + 1:]
    expr = _replace_call(expr, "REGEXP_LIKE", lambda inner: _glob_condition(
        _call_args(inner)[0].strip(), parse_string_literal(_call_args(inner)[1].strip(), 0)[0]))
    # `col` REGEXP 'pat' -> col GLOB 'glob'. This runs on the raw text (before
    # string literals are split into segments) because the pattern literal is
    # part of the match.
    expr = re.sub(r"(`[^`]+`|[A-Za-z_][\w]*)\s+REGEXP\s+'((?:[^'\\]|\\.)*)'",
                  lambda m: _glob_condition(m.group(1), m.group(2).replace("\\'", "'")), expr, flags=re.I)
    expr = _replace_call(expr, "CONCAT", lambda inner: "(" + " || ".join(a.strip() for a in _call_args(inner)) + ")")
    expr = _replace_call(expr, "LPAD", lambda inner: _lpad(_call_args(inner)))
    expr = _replace_call(expr, "OCTET_LENGTH", lambda inner: f"length(CAST({inner.strip()} AS BLOB))")
    expr = _replace_call(expr, "IF", lambda inner: _if_to_case(_call_args(inner)))
    out = []
    for is_str, seg in split_code_segments(expr):
        if is_str:
            out.append(seg)
            continue
        s = seg
        s = re.sub(r"\bYEAR\s*\(\s*UTC_TIMESTAMP\s*\(\s*\)\s*\)", "CAST(strftime('%Y', 'now') AS INTEGER)", s, flags=re.I)
        s = re.sub(r"\bUTC_TIMESTAMP\s*\(\s*\)", MS_NOW, s, flags=re.I)
        s = re.sub(r"\bCURRENT_TIMESTAMP\s*\(\s*6\s*\)", MS_NOW, s, flags=re.I)
        s = re.sub(r"\bCURRENT_TIMESTAMP\b", MS_NOW, s, flags=re.I)
        s = re.sub(r"\bJSON_TYPE\s*\(", "json_type(", s, flags=re.I)
        s = re.sub(r"\bJSON_OBJECT\s*\(", "json_object(", s, flags=re.I)
        s = re.sub(r"\bJSON_ARRAY\s*\(", "json_array(", s, flags=re.I)
        s = re.sub(r"\bJSON_EXTRACT\s*\(", "json_extract(", s, flags=re.I)
        s = re.sub(r"\bJSON_VALID\s*\(", "json_valid(", s, flags=re.I)
        s = re.sub(r"\bCHAR_LENGTH\s*\(", "length(", s, flags=re.I)
        s = re.sub(r"\bLOWER\s*\(", "lower(", s, flags=re.I)
        s = re.sub(r"\bUPPER\s*\(", "upper(", s, flags=re.I)
        s = re.sub(r"\bTRIM\s*\(", "trim(", s, flags=re.I)
        s = re.sub(r"\bUUID\s*\(\s*\)", UUID_EXPR, s, flags=re.I)
        s = s.replace("<=>", " IS ")
        s = re.sub(r"\bCAST\s*\(\s*(.+?)\s+AS\s+CHAR\s*\)", r"CAST(\1 AS TEXT)", s, flags=re.I)
        s = re.sub(r"\bCAST\s*\(\s*(.+?)\s+AS\s+BINARY\s*\)", r"CAST(\1 AS BLOB)", s, flags=re.I)
        s = re.sub(r"\bCAST\s*\(\s*(.+?)\s+AS\s+(?:SIGNED|UNSIGNED)\s*\)", r"CAST(\1 AS INTEGER)", s, flags=re.I)
        s = re.sub(r"\bTRUE\b", "1", s, flags=re.I)
        s = re.sub(r"\bFALSE\b", "0", s, flags=re.I)
        out.append(s)
    joined = "".join(out)
    # json_type() returns lowercase in SQLite; the MySQL literals are upper.
    # This runs on the joined text because the literal lives in its own segment.
    joined = re.sub(r"(json_type\([^)]*\)\s*=\s*)'OBJECT'", r"\1'object'", joined)
    joined = re.sub(r"(json_type\([^)]*\)\s*=\s*)'ARRAY'", r"\1'array'", joined)
    return joined


def _lpad(args: list[str]) -> str:
    if len(args) != 3:
        raise TranslateError(f"LPAD with {len(args)} args is not handled: {args}")
    value, width, pad = (a.strip() for a in args)
    pad_val, _ = parse_string_literal(pad, 0) if pad.startswith("'") else (None, 0)
    if pad_val == "0" and width.isdigit():
        return f"printf('%0{width}d', {value})"
    raise TranslateError(f"LPAD with pad {pad!r} is not handled")


def _if_to_case(args: list[str]) -> str:
    if len(args) != 3:
        raise TranslateError(f"IF with {len(args)} args is not handled: {args}")
    cond, then, els = (a.strip() for a in args)
    return f"(CASE WHEN {cond} THEN {then} ELSE {els} END)"


# ------------------------------------------------------------------ #
# column / table model
# ------------------------------------------------------------------ #

INT_TYPES = {"TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT"}
TEXT_TYPES = {"CHAR", "VARCHAR", "TEXT", "MEDIUMTEXT", "LONGTEXT", "TINYTTEXT"}
REAL_TYPES = {"FLOAT", "DOUBLE", "DECIMAL", "NUMERIC"}
DATE_TYPES = {"DATETIME", "TIMESTAMP", "DATE", "TIME"}
BLOB_TYPES = {"BLOB", "MEDIUMBLOB", "LONGBLOB", "TINYBLOB", "BINARY", "VARBINARY"}


@dataclass
class Column:
    name: str
    mysql_type: str
    sqlite_type: str
    notnull: bool = False
    default: str | None = None          # SQLite DEFAULT clause (already translated)
    autoinc: bool = False
    unique: bool = False
    pk: bool = False
    checks: list[tuple[str | None, str]] = field(default_factory=list)  # (name, expr)
    collation: str | None = None        # None = not a TEXT column
    collation_reason: str = ""
    on_update: bool = False
    generated: str | None = None        # SQLite GENERATED ALWAYS AS (...) STORED
    length: int | None = None
    enum_values: list[str] | None = None
    is_json: bool = False

    def ddl(self, inline_pk: bool) -> str:
        parts = [f"`{self.name}` {self.sqlite_type}"]
        if self.collation:
            parts.append(f"COLLATE {self.collation}")
        if self.generated:
            parts.append(f"GENERATED ALWAYS AS ({self.generated}) STORED")
        if self.pk and inline_pk:
            parts.append("PRIMARY KEY")
            if self.autoinc:
                parts.append("AUTOINCREMENT")
        if self.notnull:
            parts.append("NOT NULL")
        if self.default is not None:
            parts.append(f"DEFAULT {self.default}")
        if self.unique:
            parts.append("UNIQUE")
        for cname, expr in self.checks:
            parts.append(f"CONSTRAINT `{cname}` CHECK ({expr})" if cname else f"CHECK ({expr})")
        return " ".join(parts)


@dataclass
class Unique:
    name: str | None
    cols: list[str]


@dataclass
class ForeignKey:
    name: str | None
    cols: list[str]
    ref_table: str
    ref_cols: list[str]
    on_delete: str | None = None
    on_update: str | None = None


@dataclass
class Table:
    name: str
    cols: dict[str, Column] = field(default_factory=dict)
    pk: list[str] = field(default_factory=list)
    uniques: list[Unique] = field(default_factory=list)
    fks: list[ForeignKey] = field(default_factory=list)
    checks: list[tuple[str | None, str]] = field(default_factory=list)

    def ddl(self, name: str | None = None) -> str:
        inline_pk = len(self.pk) == 1
        lines = [f"CREATE TABLE `{name or self.name}` ("]
        items: list[str] = [f"  {c.ddl(inline_pk and c.name in self.pk)}" for c in self.cols.values()]
        if not inline_pk and self.pk:
            items.append(f"  PRIMARY KEY ({', '.join(f'`{c}`' for c in self.pk)})")
        for u in self.uniques:
            cols = ", ".join(f"`{c}`" for c in u.cols)
            items.append(f"  CONSTRAINT `{u.name}` UNIQUE ({cols})" if u.name else f"  UNIQUE ({cols})")
        for fk in self.fks:
            cols = ", ".join(f"`{c}`" for c in fk.cols)
            ref = ", ".join(f"`{c}`" for c in fk.ref_cols)
            s = f"  CONSTRAINT `{fk.name}` FOREIGN KEY ({cols}) REFERENCES `{fk.ref_table}` ({ref})" if fk.name \
                else f"  FOREIGN KEY ({cols}) REFERENCES `{fk.ref_table}` ({ref})"
            if fk.on_delete:
                s += f" ON DELETE {fk.on_delete}"
            if fk.on_update:
                s += f" ON UPDATE {fk.on_update}"
            items.append(s)
        for cname, expr in self.checks:
            items.append(f"  CONSTRAINT `{cname}` CHECK ({expr})" if cname else f"  CHECK ({expr})")
        lines.append(",\n".join(items))
        lines.append(") STRICT;")
        return "\n".join(lines)


@dataclass
class Index:
    name: str
    table: str
    cols: list[tuple[str, str | None]]  # (column, 'DESC' | None); prefix lengths dropped
    unique: bool = False

    def ddl(self) -> str:
        cols = ", ".join(f"`{c}`" + (" DESC" if d else "") for c, d in self.cols)
        u = "UNIQUE " if self.unique else ""
        return f"CREATE {u}INDEX `{self.name}` ON `{self.table}` ({cols});"


@dataclass
class Model:
    tables: dict[str, Table] = field(default_factory=dict)
    table_order: list[str] = field(default_factory=list)
    indexes: dict[str, Index] = field(default_factory=dict)
    views: dict[str, str] = field(default_factory=dict)          # name -> CREATE VIEW sql
    triggers: dict[str, tuple[str, str]] = field(default_factory=dict)  # name -> (table, sql)
    warnings: list[str] = field(default_factory=list)
    decisions: list[str] = field(default_factory=list)

    def table(self, name: str) -> Table:
        if name not in self.tables:
            raise TranslateError(f"table `{name}` does not exist yet in the model")
        return self.tables[name]


def _parse_default(rest: str) -> str | None:
    m = re.search(r"\bDEFAULT\b", rest, re.I)
    if not m:
        return None
    tail = rest[m.end():].strip()
    if tail.startswith("("):
        close = matching_paren(tail, 0)
        return _default_paren(tail[1:close])
    if tail.startswith("'"):
        value, _ = parse_string_literal(tail, 0)
        return sqlite_literal(value)
    m2 = re.match(r"(CURRENT_TIMESTAMP\s*\(\s*6\s*\)|CURRENT_TIMESTAMP|TRUE|FALSE|NULL|-?\d+(?:\.\d+)?)", tail, re.I)
    if not m2:
        raise TranslateError(f"unhandled DEFAULT in: {rest[:120]!r}")
    word = m2.group(1).upper()
    if word.startswith("CURRENT_TIMESTAMP"):
        return MS_NOW
    if word == "TRUE":
        return "1"
    if word == "FALSE":
        return "0"
    if word == "NULL":
        return "NULL"
    return m2.group(1)


def _default_paren(inner: str) -> str:
    inner = inner.strip()
    if re.match(r"JSON_OBJECT\s*\(", inner, re.I):
        return "(json_object())"
    if re.match(r"JSON_ARRAY\s*\(", inner, re.I):
        return "(json_array())"
    return f"({translate_expr(inner)})"


def _extract_check(text: str) -> tuple[str | None, str, str]:
    """Find CHECK (...) in text; return (name_or_None, translated_expr, text_with_it_removed)."""
    m = re.search(r"(?:CONSTRAINT\s+`?([^`\s]+)`?\s+)?CHECK\s*\(", text, re.I)
    if not m:
        return None, "", text
    name = m.group(1)
    paren = m.end() - 1
    close = matching_paren(text, paren)
    expr = translate_expr(text[paren + 1:close])
    return name, expr, (text[:m.start()] + text[close + 1:]).strip()


def _extract_all_checks(text: str) -> tuple[list[tuple[str | None, str]], str]:
    checks = []
    while True:
        name, expr, text = _extract_check(text)
        if not expr:
            return checks, text
        checks.append((name, expr))


def parse_column_def(text: str, warnings: list[str], table_name: str) -> Column:
    m = re.match(r"`([^`]+)`\s*|([A-Za-z_][\w]*)\s+", text)
    if not m:
        raise TranslateError(f"column definition does not start with a name: {text[:100]!r}")
    name, rest = m.group(1) or m.group(2), text[m.end():]
    # GENERATED ALWAYS AS (...) STORED|VIRTUAL
    generated = None
    gm = re.search(r"\bGENERATED\s+ALWAYS\s+AS\s*\(", rest, re.I)
    if gm:
        paren = gm.end() - 1
        close = matching_paren(rest, paren)
        generated = translate_expr(rest[paren + 1:close])
        rest = (rest[:gm.start()] + rest[close + 1:]).strip()
        if re.search(r"\bVIRTUAL\b", rest, re.I):
            warnings.append(f"{table_name}.{name}: VIRTUAL generated column stored as STORED "
                            "(SQLite treats VIRTUAL as the default; STORED keeps the value materialised)")
    tm = re.match(r"([A-Za-z]+)\s*(\([^)]*\))?", rest)
    if not tm:
        raise TranslateError(f"column {name}: no type in {rest[:80]!r}")
    base, params = tm.group(1).upper(), tm.group(2) or ""
    rest = rest[tm.end():]
    unsigned = bool(re.match(r"\s*UNSIGNED\b", rest, re.I))
    if unsigned:
        rest = re.sub(r"^\s*UNSIGNED\b", "", rest, flags=re.I)
    charset = re.search(r"CHARACTER\s+SET\s+(\w+)", rest, re.I)
    collate = re.search(r"COLLATE\s+([\w_]+)", rest, re.I)
    explicit_collation = collate.group(1).lower() if collate else None
    checks, rest = _extract_all_checks(rest)
    notnull = bool(re.search(r"\bNOT\s+NULL\b", rest, re.I))
    autoinc = bool(re.search(r"\bAUTO_INCREMENT\b", rest, re.I))
    on_update = bool(re.search(r"\bON\s+UPDATE\s+CURRENT_TIMESTAMP", rest, re.I))
    unique = bool(re.search(r"\bUNIQUE\b", rest, re.I))
    pk = bool(re.search(r"\bPRIMARY\s+KEY\b", rest, re.I))
    default = _parse_default(rest)
    if re.search(r"\bAFTER\s+`[^`]+`|\bFIRST\b", rest, re.I):
        warnings.append(f"{table_name}.{name}: MySQL AFTER/FIRST column position is dropped "
                        "(column order is not preserved; application code uses named columns)")
    # ---- type mapping (STRICT: only INTEGER, REAL, TEXT, BLOB) ----
    length, enum_values, is_json = None, None, False
    if base in INT_TYPES:
        sqlite_type = "INTEGER"
        if unsigned:
            warnings.append(f"{table_name}.{name}: UNSIGNED {base} becomes signed INTEGER "
                            "(values above 2^63-1 cannot be stored; ids and counters are far below that)")
    elif base in ("DECIMAL", "NUMERIC"):
        sqlite_type = "REAL"
        warnings.append(f"{table_name}.{name}: {base}{params} becomes REAL "
                        "(exact decimal semantics are lost; the column holds a score or ratio, not money)")
    elif base in ("FLOAT", "DOUBLE"):
        sqlite_type = "REAL"
    elif base in ("BOOLEAN", "BOOL", "BIT"):
        sqlite_type = "INTEGER"
    elif base in TEXT_TYPES or base in ("ENUM", "SET"):
        sqlite_type = "TEXT"
        if base in ("CHAR", "VARCHAR"):
            length = int(re.search(r"\((\d+)\)", params).group(1)) if params else None
        if base == "ENUM":
            enum_values = [v for v in re.findall(r"'((?:[^'\\]|\\.)*)'", params)]
            if not enum_values:
                raise TranslateError(f"column {name}: ENUM with no values")
        if base == "SET":
            raise TranslateError(f"column {name}: SET type is not handled (no SET columns were found in the survey; re-check)")
    elif base == "JSON":
        sqlite_type = "TEXT"
        is_json = True
    elif base in DATE_TYPES:
        sqlite_type = "INTEGER"
    elif base in BLOB_TYPES:
        sqlite_type = "BLOB"
    elif base == "YEAR":
        sqlite_type = "INTEGER"
    else:
        raise TranslateError(f"column {name}: unhandled MySQL type {base}{params}")
    # ---- collation: per-column case-sensitivity decision ----
    collation, reason = None, ""
    if sqlite_type == "TEXT":
        if explicit_collation in ("ascii_bin", "utf8mb4_bin") or (charset and charset.group(1).lower() == "ascii"):
            collation, reason = "BINARY", (f"explicit {explicit_collation or 'ascii charset'}: "
                                           "identifiers, codes and hashes compare byte for byte")
        else:
            collation, reason = "NOCASE", ("table default utf8mb4_0900_ai_ci is case-insensitive; "
                                           "NOCASE reproduces it for ASCII. Accent folding is NOT reproduced "
                                           "(stock SQLite has no ICU); a name differing only by an accent "
                                           "compares unequal on SQLite where MySQL would call it equal")
    col = Column(name=name, mysql_type=f"{base}{params}" + (" UNSIGNED" if unsigned else ""),
                 sqlite_type=sqlite_type, notnull=notnull, default=default, autoinc=autoinc,
                 unique=unique, pk=pk, checks=checks, collation=collation, collation_reason=reason,
                 on_update=on_update, generated=generated, length=length,
                 enum_values=enum_values, is_json=is_json)
    if length is not None:
        col.checks.append((f"ck_len_{name}", f"length(`{name}`) <= {length}"))
    if enum_values is not None:
        vals = ", ".join(sqlite_literal(v) for v in enum_values)
        col.checks.append((f"ck_enum_{name}", f"`{name}` IN ({vals})"))
    if is_json:
        col.checks.append((f"ck_json_{name}", f"json_valid(`{name}`)"))
    return col


def _col_list(text: str) -> list[str]:
    return [c.strip().strip("`") for c in split_top_commas(text) if c.strip()]


def _parse_index_cols(text: str) -> list[tuple[str, str | None]]:
    """`(a, b DESC, c(191))` -> [(a, None), (b, 'DESC'), (c, None)]; prefix lengths dropped."""
    out = []
    for part in split_top_commas(text):
        m = re.match(r"`?([^`\s(),]+)`?\s*(?:\(\d+\))?\s*(DESC|ASC)?", part.strip(), re.I)
        if not m:
            raise TranslateError(f"cannot parse index column {part!r}")
        out.append((m.group(1), "DESC" if (m.group(2) or "").upper() == "DESC" else None))
    return out


def _parse_fk(text: str) -> ForeignKey:
    m = re.match(r"(?:CONSTRAINT\s+`?([^`\s]+)`?\s+)?FOREIGN\s+KEY\s*\(([^)]*)\)\s*REFERENCES\s+`?([\w]+)`?\s*\(([^)]*)\)"
                 r"(?:\s+ON\s+DELETE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?"
                 r"(?:\s+ON\s+UPDATE\s+(CASCADE|SET\s+NULL|SET\s+DEFAULT|RESTRICT|NO\s+ACTION))?",
                 text.strip(), re.I | re.S)
    if not m:
        raise TranslateError(f"cannot parse foreign key: {text[:160]!r}")
    return ForeignKey(name=m.group(1), cols=_col_list(m.group(2)), ref_table=m.group(3),
                      ref_cols=_col_list(m.group(4)),
                      on_delete=(m.group(5) or "").upper() or None,
                      on_update=(m.group(6) or "").upper() or None)


def _parse_table_constraint(text: str, table: Table, warnings: list[str]) -> str | None:
    """Parse one table-level constraint; returns 'index' if it was an inline index."""
    t = text.strip()
    m = re.match(r"CONSTRAINT\s+`?([^`\s]+)`?\s+(.*)$", t, re.I | re.S)
    cname, body = (m.group(1), m.group(2)) if m else (None, t)
    if re.match(r"PRIMARY\s+KEY\s*\(", body, re.I):
        table.pk = _col_list(body[body.index("(") + 1:matching_paren(body, body.index("("))])
        return None
    if re.match(r"UNIQUE\s*(?:KEY|INDEX)?\s*(?:`[^`]+`\s*)?\(", body, re.I):
        paren = body.index("(")
        table.uniques.append(Unique(cname, _col_list(body[paren + 1:matching_paren(body, paren)])))
        return None
    if re.match(r"(?:KEY|INDEX)\s*", body, re.I):
        return "index"
    if re.match(r"FOREIGN\s+KEY\s*\(", body, re.I):
        full = (f"CONSTRAINT `{cname}` {body}") if cname else body
        table.fks.append(_parse_fk(full))
        return None
    if re.match(r"CHECK\s*\(", body, re.I):
        _, expr, _ = _extract_check(body)
        table.checks.append((cname, expr))
        return None
    raise TranslateError(f"unhandled table constraint in `{table.name}`: {text[:140]!r}")


def parse_create_table(stmt: str, model: Model) -> None:
    m = re.match(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([^`\s(]+)`?\s*\(", stmt, re.I | re.S)
    if not m:
        raise TranslateError(f"cannot parse CREATE TABLE: {stmt[:120]!r}")
    name = m.group(1)
    open_i = stmt.index("(", m.end() - 1)
    close_i = matching_paren(stmt, open_i)
    body = stmt[open_i + 1:close_i]
    table = Table(name=name)
    for part in split_top_commas(body):
        p = part.strip()
        if re.match(r"(?:`[^`]+`|[A-Za-z_][\w]*)\s+[A-Za-z]", p) and not re.match(
                r"(?:CONSTRAINT\b|PRIMARY\b|UNIQUE\b|FOREIGN\b|CHECK\b|KEY\b|INDEX\b)", p, re.I):
            col = parse_column_def(p, model.warnings, name)
            if col.name in table.cols:
                raise TranslateError(f"duplicate column `{col.name}` in `{name}`")
            table.cols[col.name] = col
            if col.pk:
                table.pk = [col.name]
        elif re.match(r"(?:CONSTRAINT\s+`?[^`\s]+`?\s+)?PRIMARY\s+KEY\b", p, re.I):
            _parse_table_constraint(p, table, model.warnings)
        elif re.match(r"(?:CONSTRAINT\s+`?[^`\s]+`?\s+)?UNIQUE\b", p, re.I):
            _parse_table_constraint(p, table, model.warnings)
        elif re.match(r"(?:CONSTRAINT\s+`?[^`\s]+`?\s+)?FOREIGN\s+KEY\b", p, re.I):
            _parse_table_constraint(p, table, model.warnings)
        elif re.match(r"(?:CONSTRAINT\s+`?[^`\s]+`?\s+)?CHECK\b", p, re.I):
            _parse_table_constraint(p, table, model.warnings)
        elif re.match(r"(?:CONSTRAINT\s+`?[^`\s]+`?\s+)?(?:KEY|INDEX)\b", p, re.I):
            # inline INDEX `name` (cols) — record as an index, not a constraint
            im = re.match(r"(?:CONSTRAINT\s+`[^`]+`\s+)?(?:KEY|INDEX)\s+`?([^`\s(]+)`?\s*\((.*)\)\s*$", p, re.I | re.S)
            if not im:
                raise TranslateError(f"cannot parse inline index in `{name}`: {p[:120]!r}")
            model.indexes[im.group(1)] = Index(im.group(1), name, _parse_index_cols(im.group(2)))
        elif re.match(r"(?:KEY|INDEX)\s+`?[^`\s(]+`?\s*\(", p, re.I):
            im = re.match(r"(?:KEY|INDEX)\s+`?([^`\s(]+)`?\s*\((.*)\)\s*$", p, re.I | re.S)
            model.indexes[im.group(1)] = Index(im.group(1), name, _parse_index_cols(im.group(2)))
        else:
            raise TranslateError(f"unhandled CREATE TABLE entry in `{name}`: {p[:140]!r}")
    if name in model.tables:
        raise TranslateError(f"table `{name}` created twice")
    model.tables[name] = table
    model.table_order.append(name)


# ------------------------------------------------------------------ #
# touch triggers (ON UPDATE CURRENT_TIMESTAMP) and table rebuilds
# ------------------------------------------------------------------ #

def touch_trigger_sql(table: Table, col: Column) -> str:
    pk = table.pk
    if not pk:
        raise TranslateError(f"table `{table.name}` has an ON UPDATE column but no primary key")
    where = " AND ".join(f"`{c}` = NEW.`{c}`" for c in pk)
    return (f"CREATE TRIGGER `trg_{table.name}_{col.name}_touch` AFTER UPDATE ON `{table.name}`\n"
            f"WHEN NEW.`{col.name}` = OLD.`{col.name}`\n"
            "BEGIN\n"
            f"  UPDATE `{table.name}` SET `{col.name}` = "
            f"MAX({MS_NOW}, OLD.`{col.name}`+1)\n"
            f"  WHERE {where};\n"
            "END;")


def touch_triggers_for(model: Model, table_name: str) -> list[str]:
    table = model.tables[table_name]
    return [touch_trigger_sql(table, c) for c in table.cols.values() if c.on_update]


def _filler(col: Column) -> str:
    return {"INTEGER": "0", "REAL": "0", "TEXT": "''", "BLOB": "x''"}[col.sqlite_type]


def rebuild_statements(model: Model, table_name: str, reason: str, old_cols: list[str]) -> list[str]:
    """SQLite cannot ADD/DROP a constraint or MODIFY a column, so the table is
    rebuilt: new table, copy the shared columns, drop the old table, rename.
    The caller has already applied the change to the model; old_cols is the
    column list before the change."""
    table = model.tables[table_name]
    new_name = f"__otsi_new_{table_name}"
    insert_cols, select_exprs = [], []
    for c in table.cols.values():
        if c.name in old_cols:
            insert_cols.append(f"`{c.name}`")
            select_exprs.append(f"`{c.name}`")
        elif c.default is not None:
            continue  # omitted: the column default applies
        elif c.notnull:
            insert_cols.append(f"`{c.name}`")
            select_exprs.append(_filler(c))
        # nullable without a default: omitted, defaults to NULL
    cols_sql = ", ".join(insert_cols)
    sel_sql = ", ".join(select_exprs)
    stmts = [f"-- table rebuild ({reason}): SQLite cannot ADD/DROP a constraint or MODIFY a column",
             # Views name this table: with the default rename behaviour SQLite
             # re-parses them while the table is dropped and fails. Legacy
             # rename leaves view/trigger references by name, and the table
             # has the same name again when the rebuild finishes.
             "PRAGMA legacy_alter_table=ON;",
             table.ddl(name=new_name),
             f"INSERT INTO `{new_name}` ({cols_sql}) SELECT {sel_sql} FROM `{table_name}`;",
             f"DROP TABLE `{table_name}`;",
             f"ALTER TABLE `{new_name}` RENAME TO `{table_name}`;",
             "PRAGMA legacy_alter_table=OFF;"]
    for idx in model.indexes.values():
        if idx.table == table_name:
            stmts.append(idx.ddl())
    for tname, (ttable, tsql) in model.triggers.items():
        if ttable == table_name:
            stmts.append(tsql)
    stmts.extend(touch_triggers_for(model, table_name))
    return stmts


# ------------------------------------------------------------------ #
# ALTER TABLE
# ------------------------------------------------------------------ #

def _parse_constraint_action(action: str, table: Table, model: Model) -> str:
    """Apply one ADD CONSTRAINT action; returns 'rebuild' (constraints always need one)."""
    body = re.sub(r"^ADD\s+CONSTRAINT\s+`([^`]+)`\s+", r"CONSTRAINT `\1` ", action, flags=re.I)
    body = re.sub(r"^ADD\s+", "", body, flags=re.I)
    _parse_table_constraint(body, table, model.warnings)
    return "rebuild"


def _parse_add_index(action: str, table: Table, model: Model) -> Index:
    m = re.match(r"ADD\s+(UNIQUE\s+)?(?:KEY|INDEX)\s*(?:`([^`]+)`\s*)?\((.*)\)\s*$", action, re.I | re.S)
    if not m:
        raise TranslateError(f"cannot parse ADD INDEX action: {action[:140]!r}")
    unique = bool(m.group(1))
    name = m.group(2) or f"uq_{table.name}_{_parse_index_cols(m.group(3))[0][0]}"
    return Index(name, table.name, _parse_index_cols(m.group(3)), unique)


def apply_alter(stmt: str, model: Model, out: list[str], migration_name: str) -> None:
    m = re.match(r"ALTER\s+TABLE\s+`([^`]+)`\s+(.*)$", stmt, re.I | re.S)
    if not m:
        raise TranslateError(f"cannot parse ALTER TABLE: {stmt[:120]!r}")
    table_name, rest = m.group(1), m.group(2).strip()
    table = model.table(table_name)
    old_cols = list(table.cols)
    actions = split_top_commas(rest)
    needs_rebuild = False
    rebuild_reason = ""
    direct: list[str] = []
    for action in actions:
        a = action.strip()
        if re.match(r"ADD\s+COLUMN\b", a, re.I) or re.match(r"ADD\s+`[^`]+`\s+", a, re.I):
            coldef = re.sub(r"^ADD\s+(?:COLUMN\s+)?", "", a, flags=re.I)
            col = parse_column_def(coldef, model.warnings, table_name)
            if col.name in table.cols:
                raise TranslateError(f"{migration_name}: ADD COLUMN `{col.name}` already exists in `{table_name}`")
            if col.notnull and col.default is None and not col.generated:
                model.warnings.append(
                    f"{migration_name}: ADD COLUMN `{table_name}`.`{col.name}` is NOT NULL without a DEFAULT; "
                    "the rebuild fills existing rows with 0/'' (MySQL would refuse this on a non-empty table)")
                needs_rebuild = True
                rebuild_reason = f"ADD COLUMN `{col.name}` NOT NULL without a default"
            table.cols[col.name] = col
            if col.pk:
                table.pk = [col.name]
            if not needs_rebuild:
                direct.append(f"ALTER TABLE `{table_name}` ADD COLUMN {col.ddl(inline_pk=False)};")
        elif re.match(r"ADD\s+(?:CONSTRAINT\b|UNIQUE\b|PRIMARY\s+KEY\b|FOREIGN\s+KEY\b|CHECK\b)", a, re.I):
            _parse_constraint_action(a, table, model)
            needs_rebuild = True
            rebuild_reason = "ADD CONSTRAINT"
        elif re.match(r"ADD\s+(?:UNIQUE\s+)?(?:KEY|INDEX)\b", a, re.I):
            idx = _parse_add_index(a, table, model)
            model.indexes[idx.name] = idx
            if not needs_rebuild:
                direct.append(idx.ddl())
        elif re.match(r"DROP\s+CHECK\s+", a, re.I):
            name = re.match(r"DROP\s+CHECK\s+`([^`]+)`", a, re.I).group(1)
            table.checks = [(n, e) for n, e in table.checks if n != name]
            for c in table.cols.values():
                c.checks = [(n, e) for n, e in c.checks if n != name]
            needs_rebuild = True
            rebuild_reason = f"DROP CHECK `{name}`"
        elif re.match(r"DROP\s+FOREIGN\s+KEY\s+", a, re.I):
            name = re.match(r"DROP\s+FOREIGN\s+KEY\s+`([^`]+)`", a, re.I).group(1)
            table.fks = [f for f in table.fks if f.name != name]
            needs_rebuild = True
            rebuild_reason = f"DROP FOREIGN KEY `{name}`"
        elif re.match(r"DROP\s+CONSTRAINT\s+", a, re.I):
            name = re.match(r"DROP\s+CONSTRAINT\s+`([^`]+)`", a, re.I).group(1)
            table.checks = [(n, e) for n, e in table.checks if n != name]
            table.fks = [f for f in table.fks if f.name != name]
            table.uniques = [u for u in table.uniques if u.name != name]
            needs_rebuild = True
            rebuild_reason = f"DROP CONSTRAINT `{name}`"
        elif re.match(r"DROP\s+INDEX\s+", a, re.I):
            name = re.match(r"DROP\s+INDEX\s+`([^`]+)`", a, re.I).group(1)
            model.indexes.pop(name, None)
            if not needs_rebuild:
                direct.append(f"DROP INDEX IF EXISTS `{name}`;")
        elif re.match(r"DROP\s+COLUMN\s+", a, re.I):
            name = re.match(r"DROP\s+COLUMN\s+`([^`]+)`", a, re.I).group(1)
            table.cols.pop(name, None)
            table.pk = [c for c in table.pk if c != name]
            needs_rebuild = True
            rebuild_reason = f"DROP COLUMN `{name}`"
        elif re.match(r"DROP\s+PRIMARY\s+KEY\s*$", a, re.I):
            table.pk = []
            needs_rebuild = True
            rebuild_reason = "DROP PRIMARY KEY"
        elif re.match(r"MODIFY\s+(?:COLUMN\s+)?`[^`]+`", a, re.I):
            coldef = re.sub(r"^MODIFY\s+(?:COLUMN\s+)?", "", a, flags=re.I)
            col = parse_column_def(coldef, model.warnings, table_name)
            if col.name not in table.cols:
                raise TranslateError(f"{migration_name}: MODIFY unknown column `{col.name}` in `{table_name}`")
            old = table.cols[col.name]
            table.cols[col.name] = col
            if old.pk and not col.pk:
                table.pk = [c for c in table.pk if c != col.name]
            if col.pk:
                table.pk = [col.name]
            needs_rebuild = True
            rebuild_reason = f"MODIFY COLUMN `{col.name}`"
        else:
            raise TranslateError(f"{migration_name}: unhandled ALTER action in `{table_name}`: {a[:140]!r}")
    if needs_rebuild:
        out.extend(rebuild_statements(model, table_name, rebuild_reason, old_cols))
    else:
        out.extend(direct)


# ------------------------------------------------------------------ #
# DML translation
# ------------------------------------------------------------------ #

_DATETIME_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?)?$")


def datetime_to_ms(value: str) -> int:
    from datetime import datetime, timezone

    m = _DATETIME_RE.match(value)
    if not m:
        raise TranslateError(f"cannot convert datetime literal {value!r} to epoch milliseconds")
    year, mon, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
    hh, mm, ss = (int(m.group(4) or 0), int(m.group(5) or 0), int(m.group(6) or 0))
    frac = m.group(7) or ""
    micros = int((frac + "000000")[:6])
    dt = datetime(year, mon, day, hh, mm, ss, micros, tzinfo=timezone.utc)
    return int(dt.timestamp() * 1000)


def _translate_value(value: str, col: Column | None) -> str:
    v = value.strip()
    if v.startswith("'"):
        decoded, _ = parse_string_literal(v, 0)
        if col and col.sqlite_type == "INTEGER" and col.mysql_type.split("(")[0] in DATE_TYPES:
            return str(datetime_to_ms(decoded))
        return sqlite_literal(decoded)
    if v.upper() in ("NULL", "TRUE", "FALSE") or re.match(r"^-?\d+(\.\d+)?$", v):
        return {"TRUE": "1", "FALSE": "0"}.get(v.upper(), v)
    return translate_expr(v)


def translate_insert(stmt: str, model: Model) -> str:
    m = re.match(r"INSERT\s+(IGNORE\s+)?INTO\s+`([^`]+)`\s*\(([^)]*)\)\s*VALUES\s*(.*)$", stmt, re.I | re.S)
    if m:
        ignore, table_name, cols_raw, values_raw = m.group(1), m.group(2), m.group(3), m.group(4)
        table = model.table(table_name)
        cols = _col_list(cols_raw)
        rows = []
        rest = values_raw.strip()
        while rest:
            if not rest.startswith("("):
                raise TranslateError(f"cannot parse INSERT VALUES row: {rest[:80]!r}")
            close = matching_paren(rest, 0)
            row = [_translate_value(v, table.cols.get(c)) for v, c in zip(split_top_commas(rest[1:close]), cols)]
            if len(row) != len(cols):
                raise TranslateError(f"INSERT into `{table_name}`: row has {len(row)} values for {len(cols)} columns")
            rows.append("(" + ", ".join(row) + ")")
            rest = rest[close + 1:].strip()
            if rest.startswith(","):
                rest = rest[1:].strip()
            elif rest:
                raise TranslateError(f"trailing text after INSERT VALUES: {rest[:80]!r}")
        verb = "INSERT OR IGNORE INTO" if ignore else "INSERT INTO"
        return f"{verb} `{table_name}` ({', '.join(f'`{c}`' for c in cols)}) VALUES " + ", ".join(rows) + ";"
    m2 = re.match(r"INSERT\s+(IGNORE\s+)?INTO\s+`[^`]+`(?:\s*\([^)]*\))?\s+SELECT\b", stmt, re.I | re.S)
    if m2:
        out = translate_expr(stmt).rstrip(";")
        if m2.group(1):
            out = re.sub(r"^INSERT\s+INTO", "INSERT OR IGNORE INTO", out, count=1, flags=re.I)
        return out + ";"
    raise TranslateError(f"cannot parse INSERT: {stmt[:140]!r}")


def translate_update(stmt: str, model: Model) -> str:
    # SQLite wants UPDATE t AS alias (the bare `UPDATE t alias` MySQL allows is a syntax error),
    # and it does not allow the alias on the left of a SET assignment (r.`col` = ...),
    # though correlated r.`id` references inside subqueries stay valid.
    m = re.match(r"UPDATE\s+`([^`]+)`\s+`?(\w+)`?\s+SET\b", stmt, re.I)
    if m and m.group(2).upper() != "SET":
        alias = m.group(2)
        stmt = stmt[:m.start(2)] + "AS " + stmt[m.start(2):]
        set_m = re.search(r"\bSET\b", stmt, re.I)
        end = len(stmt)
        depth, i = 0, set_m.end()
        while i < len(stmt):
            ch = stmt[i]
            if ch in ("'", '"'):
                _, i = parse_string_literal(stmt, i)
                continue
            if ch == "`":
                j = stmt.find("`", i + 1)
                i = len(stmt) if j < 0 else j + 1
                continue
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
            elif depth == 0 and re.match(r"WHERE\b", stmt[i:], re.I) and (
                    i == 0 or (not stmt[i - 1].isalnum() and stmt[i - 1] != "_")):
                end = i
                break
            i += 1
        head, set_clause, tail = stmt[:set_m.end()], stmt[set_m.end():end], stmt[end:]
        set_clause = re.sub(r"\b" + re.escape(alias) + r"\.`([^`]+)`\s*=",
                            r"`\1` =", set_clause)
        stmt = head + set_clause + tail
    return translate_expr(stmt).rstrip(";") + ";"


def translate_dml(stmt: str, model: Model) -> str:
    head = stmt.strip()[:12].upper()
    if head.startswith("INSERT"):
        return translate_insert(stmt, model)
    if head.startswith("UPDATE"):
        return translate_update(stmt, model)
    if head.startswith("DELETE"):
        return translate_expr(stmt).rstrip(";") + ";"
    raise TranslateError(f"unhandled DML: {stmt[:120]!r}")


# ------------------------------------------------------------------ #
# trigger overlay (hand-written SQLite equivalents)
# ------------------------------------------------------------------ #

def load_overlay() -> dict[str, list[str]]:
    """tools/db/sqlite_triggers.sql, split into per-migration sections by
    `-- == NNNN ==` markers. Returns {version: [trigger statements]}."""
    if not TRIGGERS_OVERLAY.exists():
        raise TranslateError(f"trigger overlay is missing: {TRIGGERS_OVERLAY}")
    text = TRIGGERS_OVERLAY.read_text(encoding="utf-8")
    sections: dict[str, list[str]] = {}
    current: str | None = None
    buf: list[str] = []

    def flush() -> None:
        nonlocal buf
        if current is not None:
            body = "\n".join(buf).strip()
            if body:
                # The SQLite splitter, not the MySQL one: a trigger body holds
                # BEGIN ...; ... END; and only sqlite3.complete_statement()
                # keeps it in one piece.
                sections[current] = migrate.split_sqlite_statements(body)
        buf = []

    for line in text.splitlines():
        m = re.match(r"-- == (\d{4}) ==\s*$", line.strip())
        if m:
            flush()
            current = m.group(1)
            continue
        if current is not None:
            buf.append(line)
    flush()
    return sections


# ------------------------------------------------------------------ #
# per-migration processing
# ------------------------------------------------------------------ #

PROCEDURE_OWNERS = {
    "sp_issue_canonical_player_id": (
        "APPLICATION CODE — PlayersService.register() "
        "(apps/api/src/modules/players/players.service.ts) must call the adapter's "
        "issueCanonicalPlayerId() instead of CALL sp_issue_canonical_player_id. "
        "Same checks, same error messages, one transaction; the sequence is reserved "
        "with INSERT ... ON CONFLICT DO UPDATE and the row is re-read, so concurrent "
        "issuance serialises per namespace exactly as the 0018 procedure did."),
    "sp_merge_players": (
        "APPLICATION CODE — PlayersService.merge() "
        "(apps/api/src/modules/players/players.service.ts) must call the adapter's "
        "mergePlayers() instead of CALL sp_merge_players. Same checks, same error "
        "messages, one transaction; both player rows are locked in id order."),
}


def process_migration(mig: migrate.Migration, model: Model, overlay: dict[str, list[str]],
                      report: dict) -> tuple[list[str], list[str]]:
    """Translate one MySQL migration file. Returns (sqlite statements, seed-DML
    statements for the bootstrap). The model is advanced to the post-migration state."""
    out: list[str] = []
    dml: list[str] = []
    seen_triggers: set[str] = set()
    for stmt in migrate.split_statements(mig.sql):
        s = stmt.strip()
        head = re.match(r"(CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX|"
                        r"CREATE\s+TRIGGER|CREATE\s+PROCEDURE|DROP\s+PROCEDURE|CREATE\s+VIEW|"
                        r"INSERT\b|UPDATE\b|DELETE\b|CREATE\s+FUNCTION|CREATE\s+EVENT|SET\b)", s, re.I)
        kind = head.group(1).upper() if head else ""
        kind = re.sub(r"\s+", " ", kind)
        if kind == "CREATE TABLE":
            parse_create_table(s, model)
            table = model.tables[re.match(r"CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([^`\s(]+)`?", s, re.I).group(1)]
            out.append(table.ddl())
            # inline indexes declared inside this CREATE TABLE
            for idx in model.indexes.values():
                if idx.table == table.name:
                    out.append(idx.ddl())
            out.extend(touch_triggers_for(model, table.name))
        elif kind == "ALTER TABLE":
            apply_alter(s, model, out, mig.name)
        elif kind in ("CREATE INDEX", "CREATE UNIQUE INDEX"):
            m = re.match(r"CREATE\s+(UNIQUE\s+)?INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`\s*\((.*)\)\s*$", s, re.I | re.S)
            if not m:
                raise TranslateError(f"{mig.name}: cannot parse {kind}: {s[:140]!r}")
            idx = Index(m.group(2), m.group(3), _parse_index_cols(m.group(4)), bool(m.group(1)))
            model.indexes[idx.name] = idx
            out.append(idx.ddl())
        elif kind == "DROP INDEX":
            m = re.match(r"DROP\s+INDEX\s+`([^`]+)`\s+ON\s+`([^`]+)`", s, re.I)
            if not m:
                raise TranslateError(f"{mig.name}: cannot parse DROP INDEX: {s[:120]!r}")
            model.indexes.pop(m.group(1), None)
            out.append(f"DROP INDEX IF EXISTS `{m.group(1)}`;")
        elif kind == "CREATE VIEW":
            m = re.match(r"CREATE\s+VIEW\s+`([^`]+)`\s+AS\s+(.*)$", s, re.I | re.S)
            if not m:
                raise TranslateError(f"{mig.name}: cannot parse CREATE VIEW: {s[:120]!r}")
            view_sql = f"CREATE VIEW `{m.group(1)}` AS {translate_expr(m.group(2).strip())};"
            model.views[m.group(1)] = view_sql
            out.append(view_sql)
        elif kind == "CREATE TRIGGER":
            tm = re.match(r"CREATE\s+TRIGGER\s+`?([\w]+)`?", s, re.I)
            if not tm:
                raise TranslateError(f"{mig.name}: cannot parse CREATE TRIGGER: {s[:120]!r}")
            seen_triggers.add(tm.group(1))
            # The SQLite equivalent comes from the hand-written overlay, spliced
            # in below (one section per migration, in trigger order).
        elif kind == "CREATE PROCEDURE":
            pm = re.match(r"CREATE\s+PROCEDURE\s+`?([\w]+)`?", s, re.I)
            if not pm:
                raise TranslateError(f"{mig.name}: cannot parse CREATE PROCEDURE: {s[:120]!r}")
            owner = PROCEDURE_OWNERS.get(pm.group(1))
            if not owner:
                raise TranslateError(f"{mig.name}: procedure {pm.group(1)} has no application-code owner recorded")
            report.setdefault("procedures", {})[pm.group(1)] = owner
            out.append(f"-- {pm.group(1)}: {owner}")
        elif kind == "DROP PROCEDURE":
            pm = re.match(r"DROP\s+PROCEDURE\s+(?:IF\s+EXISTS\s+)?`?([\w]+)`?", s, re.I)
            out.append(f"-- DROP PROCEDURE {pm.group(1) if pm else '?'}: no SQLite equivalent; "
                       "the procedure is replaced by application code (see the mapping note)")
        elif kind in ("INSERT", "UPDATE", "DELETE"):
            translated = translate_dml(s, model)
            out.append(translated)
            dml.append(translated)
        elif kind in ("CREATE FUNCTION", "CREATE EVENT", "SET"):
            raise TranslateError(f"{mig.name}: {kind} has no SQLite translation and no owner recorded: {s[:120]!r}")
        else:
            raise TranslateError(f"{mig.name}: unhandled statement: {s[:140]!r}")
    # Splice the hand-written SQLite triggers for this migration, in order.
    for trig_sql in overlay.get(mig.version, []):
        tm = re.match(r"CREATE\s+TRIGGER\s+`?([\w]+)`?", trig_sql, re.I)
        if not tm:
            raise TranslateError(f"overlay for {mig.version}: not a CREATE TRIGGER: {trig_sql[:100]!r}")
        if tm.group(1) not in seen_triggers and not any(
                tm.group(1).startswith(seen + "_") for seen in seen_triggers):
            model.warnings.append(f"{mig.name}: overlay trigger `{tm.group(1)}` has no MySQL trigger "
                                  "of that name in this migration (check the overlay)")
        table_m = re.search(r"ON\s+`?([\w]+)`?", trig_sql, re.I)
        model.triggers[tm.group(1)] = (table_m.group(1) if table_m else "?", trig_sql)
        out.append(trig_sql)
    for name in seen_triggers:
        if not any(t == name or t.startswith(name + "_") for t in model.triggers):
            raise TranslateError(f"{mig.name}: MySQL trigger `{name}` has no SQLite equivalent in the overlay")
    report.setdefault("migrations", {})[mig.version] = {
        "file": mig.name, "statements": len(out), "seed_dml": len(dml)}
    return out, dml


# ------------------------------------------------------------------ #
# outputs
# ------------------------------------------------------------------ #

HEADER = ("-- GENERATED by otsi-vie/tools/db/sqlite_translate.py from the MySQL migrations.\n"
          "-- Do not hand-edit: fix the translator (or tools/db/sqlite_triggers.sql) and re-run it.\n"
          "-- SQLite rules applied: STRICT tables; dates as INTEGER epoch ms; booleans as\n"
          "-- INTEGER 0/1; JSON as TEXT with json_valid checks; foreign keys declared in DDL\n"
          "-- (enforced with PRAGMA foreign_keys=ON by the runner and the API adapter).\n")


def emit_bootstrap(model: Model, all_dml: list[str]) -> str:
    parts = [HEADER,
             "-- Fresh-install schema: the end state of every migration, 0001-0075.",
             "-- The runner records every migration version as applied after this file runs.\n"]
    for name in model.table_order:
        parts.append(model.tables[name].ddl())
    for idx in model.indexes.values():
        parts.append(idx.ddl())
    for view_sql in model.views.values():
        parts.append(view_sql)
    for _, (_, trig_sql) in model.triggers.items():
        parts.append(trig_sql)
    for name in model.table_order:
        parts.extend(touch_triggers_for(model, name))
    if all_dml:
        parts.append("\n-- Seed and data-carry-over statements, in migration order "
                    "(no-ops on a fresh install with no rows to carry over).")
        parts.extend(all_dml)
    return "\n".join(parts) + "\n"


def write_collations(model: Model) -> None:
    with open(COLLATIONS_FILE, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["table", "column", "mysql_type", "sqlite_type", "sqlite_collation", "decision"])
        for name in model.table_order:
            for col in model.tables[name].cols.values():
                w.writerow([name, col.name, col.mysql_type, col.sqlite_type,
                            col.collation or "n/a (not TEXT)",
                            col.collation_reason or "not a TEXT column; collation does not apply"])


def run(check_only: bool = False) -> dict:
    model = Model()
    overlay = load_overlay()
    report: dict = {"migrations": {}, "procedures": {}, "warnings": [], "tables": 0,
                    "indexes": 0, "views": 0, "triggers": 0}
    per_migration: dict[str, list[str]] = {}
    all_dml: list[str] = []
    for mig in migrate.discover():
        out, dml = process_migration(mig, model, overlay, report)
        per_migration[mig.name] = out
        all_dml.extend(dml)
    report["tables"] = len(model.tables)
    report["indexes"] = len(model.indexes)
    report["views"] = len(model.views)
    report["triggers"] = len(model.triggers)
    report["warnings"] = model.warnings
    report["touch_triggers"] = sum(
        1 for name in model.table_order for c in model.tables[name].cols.values() if c.on_update)
    if check_only:
        return report
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for old in OUT_DIR.glob("*.sqlite.sql"):
        old.unlink()
    for mig in migrate.discover():
        out = per_migration[mig.name]
        dest = OUT_DIR / mig.name.replace(".sql", ".sqlite.sql")
        dest.write_text(HEADER + "\n".join(out) + "\n", encoding="utf-8")
    BOOTSTRAP_FILE.write_text(emit_bootstrap(model, all_dml), encoding="utf-8")
    write_collations(model)
    REPORT_FILE.write_text(json.dumps(report, indent=2), encoding="utf-8")
    return report


def main() -> int:
    check_only = "--check" in sys.argv
    try:
        report = run(check_only)
    except TranslateError as e:
        print(f"TRANSLATE FAILED: {e}", file=sys.stderr)
        return 1
    print(f"tables={report['tables']} indexes={report['indexes']} views={report['views']} "
          f"triggers={report['triggers']} touch_triggers={report['touch_triggers']} "
          f"warnings={len(report['warnings'])}")
    for w in report["warnings"]:
        print(f"  warn: {w}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
