"""Create the local database and the runtime account (packaged desktop app, ADR-144).

The desktop shell runs this as a compiled binary (Nuitka; no .py ships)
before the migrations: portable MySQL has no database yet, and migrate.py
requires the database to exist in its DSN. This tool is the only step that
connects as root without a database selected.

  db_setup            create the database + app user (env-driven, no args)

MySQL backend (OTSI_VIE_DB_BACKEND=mysql, the default until the staged
SQLite switch in docs/sqlite-rollout.md reaches a machine):
  OTSI_VIE_ADMIN_HOST (default 127.0.0.1), OTSI_VIE_ADMIN_PORT (default 3510),
  OTSI_VIE_ADMIN_USER (default root), OTSI_VIE_ADMIN_PASSWORD (required),
  OTSI_VIE_APP_DB (default otsi_owner_vie),
  OTSI_VIE_APP_DB_USER, OTSI_VIE_APP_DB_PASSWORD (required).

SQLite backend (OTSI_VIE_DB_BACKEND=sqlite, the default for a fresh desktop
install once the rollout reaches it):
  OTSI_VIE_SQLITE_PATH (required, e.g. D:\\OTSI-VIE\\db\\otsi-vie.sqlite).
  There is no server, no user and no role to create: the file is created
  from database/sqlite-bootstrap.sql (all 74 migrations recorded as
  applied) the first time, and later runs are a no-op. The API adapter
  opens the same file; the MySQL roles (tools/db/roles.py) do not apply.

It creates the database (utf8mb4), the app user, grants it the otsi_app
role (the role itself is provisioned by tools/db/roles.py after the
migrations), and sets that role as its default. Safe to run twice.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

_NAME = re.compile(r"^[A-Za-z0-9_]+$")


def _name(value: str, what: str) -> str:
    if not _NAME.match(value or ""):
        raise SystemExit(f"db_setup: {what} {value!r} is not a plain database/user name")
    return value


def _setup_sqlite() -> int:
    """First run: create the SQLite file from the bootstrap schema. Later
    runs: nothing to do (migrate.py upgrades it)."""
    path = os.environ.get("OTSI_VIE_SQLITE_PATH", "")
    if not path:
        raise SystemExit("db_setup: OTSI_VIE_SQLITE_PATH is required for the sqlite backend")
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import migrate

    dsn = f"sqlite:///{Path(path)}"
    if Path(path).exists() and Path(path).stat().st_size > 0:
        # Already a database: refuse to bootstrap over it, but do not fail
        # the launch — migrate.py up owns the upgrade from here.
        rows = migrate.status_sqlite(dsn)
        applied = sum(1 for _, _, s in rows if s == "applied")
        print(f"db_setup: SQLite database {path} ready ({applied} migrations applied)")
        return 0
    migrate.bootstrap_sqlite(dsn, applied_by="db-setup:sqlite")
    print(f"db_setup: SQLite database {path} created from sqlite-bootstrap.sql")
    return 0


def main() -> int:
    if os.environ.get("OTSI_VIE_DB_BACKEND", "mysql").lower() == "sqlite":
        return _setup_sqlite()
    import pymysql  # noqa: WPS433 — MySQL-only; the sqlite path must not need it

    host = os.environ.get("OTSI_VIE_ADMIN_HOST", "127.0.0.1")
    port = int(os.environ.get("OTSI_VIE_ADMIN_PORT", "3510"))
    admin_user = os.environ.get("OTSI_VIE_ADMIN_USER", "root")
    admin_password = os.environ.get("OTSI_VIE_ADMIN_PASSWORD", "")
    db = _name(os.environ.get("OTSI_VIE_APP_DB", "otsi_owner_vie"), "database")
    app_user = _name(os.environ.get("OTSI_VIE_APP_DB_USER", ""), "app user")
    app_password = os.environ.get("OTSI_VIE_APP_DB_PASSWORD", "")
    if not admin_password or not app_user or not app_password:
        raise SystemExit("db_setup: OTSI_VIE_ADMIN_PASSWORD, OTSI_VIE_APP_DB_USER and "
                         "OTSI_VIE_APP_DB_PASSWORD are all required")
    conn = pymysql.connect(host=host, port=port, user=admin_user,
                           password=admin_password, autocommit=True)
    try:
        with conn.cursor() as cur:
            cur.execute(f"CREATE DATABASE IF NOT EXISTS `{db}` "
                        "CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
            cur.execute(f"CREATE USER IF NOT EXISTS '{app_user}'@'%' IDENTIFIED BY %s",
                        (app_password,))
            cur.execute(f"GRANT otsi_app TO '{app_user}'@'%'")
            cur.execute(f"SET DEFAULT ROLE otsi_app TO '{app_user}'@'%'")
    finally:
        conn.close()
    print(f"db_setup: database {db} and user {app_user} ready")
    return 0


if __name__ == "__main__":
    sys.exit(main())
