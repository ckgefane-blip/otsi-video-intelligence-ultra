"""The OTSI VIE v2 migrator: applies database/migrations/NNNN_*.sql in order, exactly once each, with version tracking.

Rules (ADR-014):
  * `schema_migrations` records version, file name, SHA-256 of the file, who applied it, when, and how long it took.
  * Only PENDING versions run, in ascending order. Re-running is a no-op (repeatable).
  * An APPLIED file whose content changed, a missing/renumbered applied file, or a pending version older than the newest applied one
    STOPS the run with an error. Nothing is dropped or "repaired": a deployed migration is never edited, a fix is a new migration.
  * One run at a time: a named server lock (GET_LOCK) is held for the whole run.
  * MySQL commits DDL implicitly, so a file cannot be rolled back as a unit. A file that fails part-way is NOT recorded; the run stops and
    reports the statement, and the operator restores from the pre-migration snapshot (DEPLOYMENT runbook) — never an automatic retry.

Connection: --dsn mysql://user:password@host:port/database or the env var OTSI_VIE_DB_DSN. The database must already exist.
Usage:  python otsi-vie/tools/db/migrate.py status|up [--dsn ...]
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlparse

import pymysql

MIGRATIONS = Path(__file__).resolve().parents[2] / "database" / "migrations"
LOCK = "otsi_vie_migrate"
FILE_RE = re.compile(r"^(\d{4})_[a-z0-9_]+\.sql$")

BOOTSTRAP = """CREATE TABLE IF NOT EXISTS `schema_migrations` (
  `version` CHAR(4) NOT NULL PRIMARY KEY,
  `name` VARCHAR(191) NOT NULL,
  `sha256` CHAR(64) NOT NULL,
  `applied_by` VARCHAR(191) NOT NULL,
  `applied_at` DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `duration_ms` INT UNSIGNED NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci"""


class MigrationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    path: Path

    @property
    def sql(self) -> str:
        return self.path.read_text(encoding="utf-8")

    @property
    def sha256(self) -> str:
        return hashlib.sha256(self.path.read_bytes()).hexdigest()


def discover(folder: Path = MIGRATIONS) -> list[Migration]:
    found = []
    for p in sorted(folder.glob("*.sql")):
        m = FILE_RE.match(p.name)
        if not m:
            raise MigrationError(f"{p.name}: migration files must be named NNNN_lower_snake.sql")
        found.append(Migration(m.group(1), p.name, p))
    versions = [m.version for m in found]
    if len(set(versions)) != len(versions):
        raise MigrationError(f"duplicate migration versions: {versions}")
    return found


def split_statements(sql: str) -> list[str]:
    """Split a migration file into statements like the mysql client does: honours `DELIMITER x`, quotes, backticks and comments."""
    out, buf, delim = [], [], ";"
    i, n = 0, len(sql)
    line_start = True
    while i < n:
        if line_start:
            m = re.match(r"[ \t]*DELIMITER[ \t]+(\S+)[ \t]*(\r?\n|$)", sql[i:], re.I)
            if m:
                delim = m.group(1)
                i += m.end()
                continue
        c = sql[i]
        if c in ("'", '"', "`"):
            j = i + 1
            while j < n and sql[j] != c:
                j += 2 if sql[j] == "\\" and c != "`" else 1
            buf.append(sql[i:j + 1])
            i = j + 1
            line_start = False
            continue
        if sql.startswith("--", i) or c == "#":
            j = sql.find("\n", i)
            i = n if j < 0 else j
            continue
        if sql.startswith("/*", i):
            j = sql.find("*/", i + 2)
            i = n if j < 0 else j + 2
            continue
        if sql.startswith(delim, i):
            stmt = "".join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            i += len(delim)
            line_start = False
            continue
        buf.append(c)
        line_start = c == "\n"
        i += 1
    tail = "".join(buf).strip()
    if tail:
        out.append(tail)
    return out


def connect(dsn: str):
    u = urlparse(dsn)
    if u.scheme != "mysql" or not u.path.strip("/"):
        raise MigrationError("DSN must look like mysql://user:password@host:port/database")
    return pymysql.connect(host=u.hostname or "127.0.0.1", port=u.port or 3306, user=unquote(u.username or ""), password=unquote(u.password or ""),
                           database=u.path.strip("/"), charset="utf8mb4", autocommit=True, client_flag=0)


def applied(cur) -> dict[str, tuple[str, str]]:
    cur.execute("SELECT version, name, sha256 FROM schema_migrations ORDER BY version")
    return {v: (n, h) for v, n, h in cur.fetchall()}


def plan(cur, migrations: list[Migration]) -> list[Migration]:
    done = applied(cur)
    by_version = {m.version: m for m in migrations}
    for v, (name, digest) in done.items():
        m = by_version.get(v)
        if m is None:
            raise MigrationError(f"applied migration {v} ({name}) is missing from the folder")
        if m.name != name:
            raise MigrationError(f"applied migration {v} was renamed: {name} -> {m.name}")
        if m.sha256 != digest:
            raise MigrationError(f"applied migration {m.name} was edited after it ran (checksum mismatch); write a new migration instead")
    newest = max(done) if done else None
    pending = [m for m in migrations if m.version not in done]
    late = [m.name for m in pending if newest and m.version < newest]
    if late:
        raise MigrationError(f"pending migrations are older than the newest applied one ({newest}): {late}")
    return pending


def up(dsn: str, migrations: list[Migration] | None = None, applied_by: str = "migrate.py") -> list[str]:
    migrations = discover() if migrations is None else migrations
    conn = connect(dsn)
    ran: list[str] = []
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT GET_LOCK(%s, 30)", (LOCK,))
            if cur.fetchone()[0] != 1:
                raise MigrationError("another migration run holds the lock")
            try:
                cur.execute(BOOTSTRAP)
                for m in plan(cur, migrations):
                    t0 = time.monotonic()
                    for k, stmt in enumerate(split_statements(m.sql), 1):
                        try:
                            cur.execute(stmt)
                        except pymysql.MySQLError as e:
                            raise MigrationError(f"{m.name} statement {k} failed: {e.args}\n{stmt[:400]}") from None
                        cur.execute("SHOW WARNINGS")
                        warnings = [w for w in cur.fetchall() if w[0] != "Note"]
                        if warnings:
                            raise MigrationError(f"{m.name} statement {k} raised warnings: {warnings}")
                    cur.execute("INSERT INTO schema_migrations (version, name, sha256, applied_by, duration_ms) VALUES (%s,%s,%s,%s,%s)",
                                (m.version, m.name, m.sha256, applied_by, int((time.monotonic() - t0) * 1000)))
                    ran.append(m.name)
            finally:
                cur.execute("SELECT RELEASE_LOCK(%s)", (LOCK,))
    finally:
        conn.close()
    return ran


def status(dsn: str) -> list[tuple[str, str, str]]:
    conn = connect(dsn)
    try:
        with conn.cursor() as cur:
            cur.execute(BOOTSTRAP)
            done = applied(cur)
    finally:
        conn.close()
    return [(m.version, m.name, "applied" if m.version in done else "pending") for m in discover()]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("command", choices=["status", "up"])
    ap.add_argument("--dsn", default=os.environ.get("OTSI_VIE_DB_DSN"))
    a = ap.parse_args()
    if not a.dsn:
        ap.error("give --dsn or set OTSI_VIE_DB_DSN")
    try:
        if a.command == "status":
            for row in status(a.dsn):
                print("  ".join(row))
        else:
            ran = up(a.dsn)
            print("applied:", ", ".join(ran) if ran else "nothing pending")
    except MigrationError as e:
        print(f"MIGRATION STOPPED: {e}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
