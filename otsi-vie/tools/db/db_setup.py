"""Create the local database and the runtime account (packaged desktop app, ADR-144).

The desktop shell runs this as a compiled binary (Nuitka; no .py ships)
before the migrations: portable MySQL has no database yet, and migrate.py
requires the database to exist in its DSN. This tool is the only step that
connects as root without a database selected.

  db_setup            create the database + app user (env-driven, no args)

Environment (all set by the desktop shell; nothing is printed):
  OTSI_VIE_ADMIN_HOST (default 127.0.0.1), OTSI_VIE_ADMIN_PORT (default 3510),
  OTSI_VIE_ADMIN_USER (default root), OTSI_VIE_ADMIN_PASSWORD (required),
  OTSI_VIE_APP_DB (default otsi_owner_vie),
  OTSI_VIE_APP_DB_USER, OTSI_VIE_APP_DB_PASSWORD (required).

It creates the database (utf8mb4), the app user, grants it the otsi_app
role (the role itself is provisioned by tools/db/roles.py after the
migrations), and sets that role as its default. Safe to run twice.
"""
from __future__ import annotations

import os
import re
import sys

import pymysql

_NAME = re.compile(r"^[A-Za-z0-9_]+$")


def _name(value: str, what: str) -> str:
    if not _NAME.match(value or ""):
        raise SystemExit(f"db_setup: {what} {value!r} is not a plain database/user name")
    return value


def main() -> int:
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
