"""Database test fixtures. Every run creates a BRAND-NEW scratch database on the disposable MySQL 8.4 server (127.0.0.1:3507, see
tools/db/db_check.py), applies all migrations with the real migrator, provisions the roles, and drops the database afterwards.
It never connects to port 3306 or to any existing database."""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

import pymysql
import pytest

APP = Path(__file__).resolve().parents[2]
ROOT = APP.parent
sys.path.insert(0, str(APP / "tools" / "db"))
sys.path.insert(0, str(Path(__file__).parent))

import migrate  # noqa: E402
import roles  # noqa: E402
from factory import Factory, load_meta  # noqa: E402

HOST, PORT = "127.0.0.1", int(os.environ.get("OTSI_VIE_TEST_DB_PORT", "3507"))
assert PORT != 3306, "the tests must never touch the existing MySQL on 3306"


def _root_password() -> str:
    env = ROOT / ".local" / "mysql-lint.env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("MYSQL_ROOT_PASSWORD="):
            return line.split("=", 1)[1].strip()
    raise RuntimeError("no MYSQL_ROOT_PASSWORD in .local/mysql-lint.env (run tools/db/db_check.py once to start the server)")


PW = _root_password()


def dsn(db: str, user: str = "root", pw: str | None = None) -> str:
    return f"mysql://{user}:{pw if pw is not None else PW}@{HOST}:{PORT}/{db}"


def connect(db: str, user: str = "root", pw: str | None = None, autocommit: bool = True):
    return pymysql.connect(host=HOST, port=PORT, user=user, password=pw if pw is not None else PW, database=db, charset="utf8mb4", autocommit=autocommit)


@pytest.fixture(scope="session")
def scratch_db():
    name = "vie_test_" + uuid.uuid4().hex[:12]
    admin = pymysql.connect(host=HOST, port=PORT, user="root", password=PW, autocommit=True)
    with admin.cursor() as cur:
        cur.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci")
    try:
        migrate.up(dsn(name), applied_by="pytest")
        roles.provision(dsn(name))
        yield name
    finally:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
        admin.close()


@pytest.fixture(scope="session")
def meta(scratch_db):
    c = connect(scratch_db)
    with c.cursor() as cur:
        m = load_meta(cur)
    c.close()
    return m


@pytest.fixture()
def db(scratch_db):
    c = connect(scratch_db)
    yield c
    c.close()


@pytest.fixture()
def make(db, meta):
    return Factory(db, meta)


@pytest.fixture(scope="session")
def accounts(scratch_db):
    """One test account per role (random passwords, dropped afterwards)."""
    admin = pymysql.connect(host=HOST, port=PORT, user="root", password=PW, autocommit=True)
    made = {}
    with admin.cursor() as cur:
        for role in roles.ROLES:
            user = f"{role}_{uuid.uuid4().hex[:6]}"
            pw = uuid.uuid4().hex
            cur.execute(f"CREATE USER '{user}'@'%' IDENTIFIED BY '{pw}'")
            cur.execute(f"GRANT {role} TO '{user}'@'%'")
            cur.execute(f"SET DEFAULT ROLE {role} TO '{user}'@'%'")
            made[role] = (user, pw)
    yield made
    with admin.cursor() as cur:
        for user, _ in made.values():
            cur.execute(f"DROP USER IF EXISTS '{user}'@'%'")
    admin.close()
