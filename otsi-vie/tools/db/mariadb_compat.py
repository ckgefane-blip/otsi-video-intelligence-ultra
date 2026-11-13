"""MariaDB 11.4 compatibility for the MySQL 8.4 migrations (ADR-146 §6).

The central server (accounts.otsi.cc) runs on the Spaceship host's MariaDB 11.4.13, not MySQL 8.4. The migrations stay
written once, for MySQL; when migrate.py talks to a MariaDB server it passes every statement through ``rewrite()`` first.
The schema_migrations checksum is still the MySQL file's checksum, so a migration has one identity on both servers.

Each rule below fixes one measured MariaDB refusal (found by running every migration on a disposable MariaDB 11.4,
``otsi-vie-central-mariadb``) and keeps the MySQL meaning. Nothing here guesses: a statement no rule matches runs as written.
"""
from __future__ import annotations

import re
from typing import Callable

# REGEXP_LIKE(expr, 'pattern'[, 'flags']) -> (expr REGEXP '(?flags)pattern'). MariaDB has no REGEXP_LIKE (and refuses it in
# CHECK); its REGEXP is PCRE2, where (?-i) / (?i) set case sensitivity like MySQL's 'c' / 'i' match types.
_REGEXP_LIKE = re.compile(
    r"REGEXP_LIKE\(\s*(?P<expr>[^,()]+(?:\([^()]*\))?)\s*,\s*'(?P<pat>(?:[^'\\]|\\.|'')*)'\s*(?:,\s*'(?P<flags>[a-z]*)'\s*)?\)", re.I)


def _regexp_like(m: re.Match[str]) -> str:
    flags = (m.group("flags") or "").lower()
    prefix = "(?-i)" if "c" in flags else "(?i)" if "i" in flags else ""
    return f"({m.group('expr').strip()} REGEXP '{prefix}{m.group('pat')}')"


# MySQL names an unnamed column CHECK `<table>_chk_<n>` and drops it with DROP CHECK. MariaDB keeps an unnamed column CHECK as
# part of the column itself, so it is removed by redefining the column without it, with the column's own baseline definition
# (0001). The two the migrations drop:
_AUTO_CHECK_COLUMNS = {
    "players_chk_1": "MODIFY `canonical_state` VARCHAR(255) NOT NULL DEFAULT 'PENDING'",
    "tracks_chk_1": "MODIFY `class_name` VARCHAR(255) NOT NULL",
}
# a named CHECK: MySQL `DROP CHECK name` -> MariaDB `DROP CONSTRAINT name`
_DROP_CHECK = re.compile(r"\bDROP\s+CHECK\s+`(?P<name>[A-Za-z0-9_]+)`", re.I)


def _drop_check(m: re.Match[str]) -> str:
    name = m.group("name")
    return _AUTO_CHECK_COLUMNS.get(name) or f"DROP CONSTRAINT `{name}`"


RULES: list[tuple[str, re.Pattern[str], Callable[[re.Match[str]], str]]] = [
    ("REGEXP_LIKE -> REGEXP (PCRE2 flags)", _REGEXP_LIKE, _regexp_like),
    ("DROP CHECK -> DROP CONSTRAINT (auto names mapped)", _DROP_CHECK, _drop_check),
]


def rewrite(stmt: str) -> str:
    for _name, pattern, repl in RULES:
        stmt = pattern.sub(repl, stmt)
    return stmt


# MySQL 8.4's default collation utf8mb4_0900_ai_ci: MariaDB 11.4 has it, MariaDB 10.11 (this VM's test server)
# does not, and refuses any statement that names it. The migrations name it in 47 files, and the migrator's
# own BOOTSTRAP names it too. On a MariaDB older than 11.4 the collation is rewritten to utf8mb4_unicode_ci
# (the closest MariaDB collation; the data here is identifiers and names, where the two agree). On 11.4 and
# on MySQL the statement runs as written. Nothing else rewrites the collation.
_COLLATION_0900 = re.compile(r"utf8mb4_0900_ai_ci", re.I)


def collation_needs_rewrite(version: str) -> bool:
    """True when this MariaDB is too old to have utf8mb4_0900_ai_ci (before 11.4)."""
    if not is_mariadb(version):
        return False
    m = re.match(r"(\d+)\.(\d+)", version.strip())
    if not m:
        return False
    major, minor = int(m.group(1)), int(m.group(2))
    return (major, minor) < (11, 4)


def rewrite_collation(stmt: str) -> str:
    return _COLLATION_0900.sub("utf8mb4_unicode_ci", stmt)


def is_mariadb(version: str) -> bool:
    return "mariadb" in version.lower()
