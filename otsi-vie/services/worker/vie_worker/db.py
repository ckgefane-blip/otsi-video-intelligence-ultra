"""Database access for the workers, on two backends (distribution plan v4 §1d, safeguard 1: one database layer).

The interface is unchanged from the MySQL-only version — ``connect(dsn)``, ``tx(conn)``, ``audit(...)``, ``publish(...)`` —
so existing worker call sites keep working. The DSN scheme picks the backend:

* ``mysql://...`` — the central-server / host path, unchanged: pymysql, FOUND_ROWS for job leases, UTC, utf8mb4,
  refusing port 3306. pymysql is imported lazily, only for this scheme, so a SQLite-only PC never needs it.
* ``sqlite:///<absolute path>`` (or ``sqlite:///:memory:``) — the on-PC local database (ADR-144, owner-approved
  2026-11-11). The connection sets ``PRAGMA journal_mode=WAL``, ``PRAGMA foreign_keys=ON``,
  ``PRAGMA busy_timeout=30000`` and ``PRAGMA synchronous=NORMAL`` (see ``connect`` for why each value).

SQLite dialect differences are absorbed here, in the cursor wrapper, so call sites do not fork:
``%s`` placeholders become ``?``; ``CURRENT_TIMESTAMP(6)`` / ``UTC_TIMESTAMP(6)`` become the integer-ms
expression (plan §1d: dates stored as integer ms since the epoch); ``FOR UPDATE`` / ``FOR UPDATE SKIP LOCKED``
is dropped (inside ``tx`` the SQLite connection already holds the exclusive write lock — see ``tx``);
``datetime`` parameters become integer ms; booleans become 0/1; JSON stays ``json.dumps`` / ``json.loads``
on the Python side, exactly as before. ``ON DUPLICATE KEY UPDATE`` and ``INTERVAL ...`` arithmetic are NOT
translated: the two places that need them (``jobs`` lease expiry, ``status`` upsert) branch explicitly on the
backend, and anything else using them is a known gap recorded in the module that owns it.

The SQLite file must live inside the app's data folder: ``connect`` refuses any other absolute path (or
documents, via ``OTSI_VIE_DATA_DIR`` / ``OTSI_VIE_STORAGE_DIR``, where that folder is). This check lives here
because ``connect`` is the single entry point for opening the local database — no worker module opens a
SQLite file any other way.
"""
from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import parse_qs, unquote, urlparse
import os

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
ACTION = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")

#: Busy timeout for the SQLite backend, in ms. Three writers with short transactions wait milliseconds
#: at most (a BEGIN IMMEDIATE write lock is held only for one claim/settle — see jobs.claim); 30,000 ms
#: is orders of magnitude above any legitimate wait, so transient contention never surfaces as an error,
#: but a genuinely wedged writer still fails loudly instead of hanging the worker forever.
BUSY_TIMEOUT_MS = 30000

#: SQLite expression for "now, as integer ms since the epoch" — the replacement for
#: CURRENT_TIMESTAMP(6) / UTC_TIMESTAMP(6) in translated SQL (plan §1d: dates as integer ms).
_NOW_MS_SQL = "CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)"

_FOR_UPDATE = re.compile(r"\bFOR\s+UPDATE\b(\s+SKIP\s+LOCKED)?", re.I)
_NOW_FN = re.compile(r"\b(?:CURRENT_TIMESTAMP|UTC_TIMESTAMP)\s*\(\s*6\s*\)", re.I)
_NOW0_FN = re.compile(r"\bNOW\s*\(\s*6\s*\)", re.I)


def now_ms() -> int:
    """Now, as integer ms since the epoch (UTC) — the canonical timestamp on the SQLite backend."""
    return int(datetime.now(timezone.utc).timestamp() * 1000)


def to_ms(value: datetime | date) -> int:
    """A datetime (naive = UTC, as the workers already treat naive datetimes) or a date, as integer ms."""
    if isinstance(value, datetime):
        dt = value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    return int(datetime(value.year, value.month, value.day, tzinfo=timezone.utc).timestamp() * 1000)


def from_ms(ms: int | None) -> datetime | None:
    """Integer ms since the epoch back to an aware UTC datetime (for dumps / comparisons)."""
    return None if ms is None else datetime.fromtimestamp(ms / 1000, tz=timezone.utc)


def is_sqlite_dsn(dsn: str) -> bool:
    return urlparse(dsn).scheme == "sqlite"


def is_sqlite_conn(conn: Any) -> bool:
    return getattr(conn, "backend", None) == "sqlite"


def backend_of(conn: Any) -> str:
    return "sqlite" if is_sqlite_conn(conn) else "mysql"


# ------------------------------------------------------------------ SQLite path guard
def _data_roots() -> list[Path]:
    roots = []
    for env in ("OTSI_VIE_DATA_DIR", "OTSI_VIE_STORAGE_DIR"):
        v = os.environ.get(env)
        if v:
            roots.append(Path(v).expanduser().resolve())
    return roots


def _check_sqlite_path(path: Path) -> Path:
    """A SQLite file may only live inside the app's data folder (ADR-144 §1.2: videos, tracks, renders,
    project metadata and the local database all live under the data folder). ``:memory:`` is allowed —
    it touches no file at all. Anything else raises instead of opening an arbitrary file."""
    if str(path) == ":memory:":
        return path
    if not path.is_absolute():
        raise ValueError(f"refusing relative SQLite path {path} (set OTSI_VIE_DATA_DIR to the app data folder)")
    resolved = path.resolve()
    for root in _data_roots():
        if resolved.is_relative_to(root):
            return resolved
    raise ValueError(f"refusing SQLite path {resolved} outside the app data folder "
                     f"(set OTSI_VIE_DATA_DIR or OTSI_VIE_STORAGE_DIR; roots now: {_data_roots() or 'none set'})")


def _sqlite_path_from_dsn(dsn: str) -> Path:
    u = urlparse(dsn)
    if u.netloc == ":memory:" or u.path == "/:memory:":
        return Path(":memory:")
    if u.netloc:
        raise ValueError(f"SQLite DSN must be sqlite:///<absolute path> or sqlite:///:memory:, got {dsn!r}")
    if not u.path.startswith("/"):
        raise ValueError(f"SQLite DSN must be sqlite:///<absolute path> or sqlite:///:memory:, got {dsn!r}")
    return Path(u.path)


# ------------------------------------------------------------------ SQLite cursor: same interface, translated SQL
def _translate_sql(sql: str) -> str:
    """MySQL-isms in worker SQL, translated for SQLite. Only the constructs the workers actually use,
    each covered by a test in tests/test_sqlite_db.py. No literal ``%s`` may appear inside a SQL string
    literal anywhere in the workers (verified by grep when this was written); ``%s`` here is always a
    placeholder."""
    sql = _FOR_UPDATE.sub("", sql)
    sql = _NOW_FN.sub(_NOW_MS_SQL, sql)
    sql = _NOW0_FN.sub(_NOW_MS_SQL, sql)
    return sql.replace("%s", "?")


def _convert_param(value: Any) -> Any:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, datetime):
        return to_ms(value)
    if isinstance(value, date):
        return to_ms(value)
    if isinstance(value, (dict, list)):
        raise ValueError("pass JSON as a json.dumps() string, not a dict/list (the workers already do this)")
    return value


class SQLiteCursor:
    """A pymysql-shaped cursor over sqlite3: ``%s`` params, dict rows, ``execute`` returning the affected
    row count (as pymysql does), context-manager use, iteration. ``cursor(SomeCursorClass)`` — the
    pymysql streaming-cursor argument ball_job passes — is accepted and ignored: a sqlite3 cursor already
    streams rows lazily."""

    def __init__(self, raw: sqlite3.Cursor):
        self._raw = raw

    def execute(self, sql: str, args: Any = ()) -> int:
        self._raw.execute(_translate_sql(sql), tuple(_convert_param(a) for a in (args or ())))
        return self._raw.rowcount

    def executemany(self, sql: str, seq: Any) -> int:
        self._raw.executemany(_translate_sql(sql), [tuple(_convert_param(a) for a in row) for row in seq])
        return self._raw.rowcount

    def fetchone(self) -> dict | None:
        row = self._raw.fetchone()
        return None if row is None else dict(row)

    def fetchall(self) -> list[dict]:
        return [dict(r) for r in self._raw.fetchall()]

    def fetchmany(self, size: int = 1) -> list[dict]:
        return [dict(r) for r in self._raw.fetchmany(size)]

    def __iter__(self) -> Iterator[dict]:
        for row in self._raw:
            yield dict(row)

    def __enter__(self) -> "SQLiteCursor":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def close(self) -> None:
        self._raw.close()

    @property
    def rowcount(self) -> int:
        return self._raw.rowcount

    @property
    def lastrowid(self) -> int | None:
        return self._raw.lastrowid


class SQLiteConnection:
    """A pymysql-shaped connection over sqlite3 (autocommit; ``begin()`` is BEGIN IMMEDIATE — see ``tx``)."""

    backend = "sqlite"

    def __init__(self, raw: sqlite3.Connection, path: Path):
        self._raw, self.path = raw, path

    def cursor(self, *args: Any, **kwargs: Any) -> SQLiteCursor:
        return SQLiteCursor(self._raw.cursor())

    def begin(self) -> None:
        """BEGIN IMMEDIATE takes the write lock up front, so everything inside ``tx`` — the claim's
        SELECT-then-UPDATE, a settle's token check-then-UPDATE — is one atomic step no other writer can
        interleave with. That is what makes the dropped FOR UPDATE safe."""
        self._raw.execute("BEGIN IMMEDIATE")

    def commit(self) -> None:
        self._raw.commit()

    def rollback(self) -> None:
        self._raw.rollback()

    def close(self) -> None:
        self._raw.close()

    def execute(self, sql: str, args: Any = ()) -> SQLiteCursor:
        cur = self.cursor()
        cur.execute(sql, args)
        return cur


def _connect_sqlite(dsn: str, *, busy_timeout_ms: int | None = None) -> SQLiteConnection:
    path = _check_sqlite_path(_sqlite_path_from_dsn(dsn))
    if busy_timeout_ms is None:
        # overridable per DSN for tests: sqlite:////path.db?busy_timeout_ms=0
        q = parse_qs(urlparse(dsn).query)
        busy_timeout_ms = int(q.get("busy_timeout_ms", [BUSY_TIMEOUT_MS])[0])
    if str(path) != ":memory:":
        path.parent.mkdir(parents=True, exist_ok=True)
    raw = sqlite3.connect(str(path), isolation_level=None, check_same_thread=True)
    raw.row_factory = sqlite3.Row
    try:
        # WAL: readers never block writers and writers never block readers — the three workers
        # (ingest, media, analysis) share one file. synchronous=NORMAL with WAL is safe against a
        # process crash (the realistic failure: a worker killed mid-write); it only risks the last
        # committed transactions on an OS crash / power loss, which is acceptable for local project
        # data — tracks and events are recomputed from the video, and FULL would fsync on every
        # commit and slow the ingest burst. Decided explicitly; see ADR-144 §1.2.
        raw.execute(f"PRAGMA journal_mode=WAL")
        raw.execute("PRAGMA foreign_keys=ON")
        raw.execute(f"PRAGMA busy_timeout={int(busy_timeout_ms)}")
        raw.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        raw.close()
        raise
    return SQLiteConnection(raw, path)


def _connect_mysql(dsn: str, *, found_rows: bool = False):
    u = urlparse(dsn)
    if u.scheme != "mysql":
        raise ValueError("OTSI_VIE_DB_DSN must be a mysql:// or sqlite:/// URL")
    if (u.port or 3306) == 3306:
        raise ValueError("refusing port 3306 (the existing OTSI database)")
    import pymysql
    import pymysql.constants.CLIENT  # noqa: F401  (pymysql.constants.CLIENT.FOUND_ROWS)

    conn = pymysql.connect(host=u.hostname, port=u.port, user=unquote(u.username or ""), password=unquote(u.password or ""),
                           database=u.path.lstrip("/"), charset="utf8mb4", autocommit=True, cursorclass=pymysql.cursors.DictCursor,
                           client_flag=pymysql.constants.CLIENT.FOUND_ROWS if found_rows else 0)
    with conn.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
    return conn


def connect(dsn: str, *, found_rows: bool = False, busy_timeout_ms: int | None = None):
    """found_rows=True makes cursor.execute() return the number of rows MATCHED by an UPDATE, not the number it CHANGED. The job lease checks need
    that: "UPDATE ... WHERE claim_token = ?" matches exactly one row while the worker still owns the job, even when the update writes the same
    values as before (a progress report that did not move). Counting changed rows read that as a lost lease and restarted long jobs.

    On SQLite there is no FOUND_ROWS: ``jobs._conditional`` instead checks the token with a SELECT inside the same
    BEGIN IMMEDIATE transaction and only then updates, which gives the same matched-row meaning (see jobs.py).
    ``busy_timeout_ms`` applies to the SQLite backend only."""
    if is_sqlite_dsn(dsn):
        return _connect_sqlite(dsn, busy_timeout_ms=busy_timeout_ms)
    return _connect_mysql(dsn, found_rows=found_rows)


@contextmanager
def tx(conn) -> Iterator[Any]:
    conn.begin()
    try:
        with conn.cursor() as cur:
            yield cur
        conn.commit()
    except BaseException:
        conn.rollback()
        raise


def streaming_cursor(conn):
    """A streaming (server-side, unbuffered) cursor: the ball job reads millions of track_observations and
    must not load them all into memory. MySQL needs SSCursor for that; a sqlite3 cursor already streams."""
    if is_sqlite_conn(conn):
        return conn.cursor()
    import pymysql
    return conn.cursor(pymysql.cursors.SSCursor)


def _is_duplicate_key(error: BaseException) -> bool:
    if isinstance(error, sqlite3.IntegrityError):
        return True
    try:
        import pymysql
    except ImportError:
        return False
    return isinstance(error, pymysql.err.IntegrityError) and bool(error.args) and error.args[0] == 1062


def audit(cur, organization_id: str, service: str, action: str, entity_type: str, entity_id: str | None, after: dict | None, request_id: str) -> None:
    """The worker side of the general audit writer (ADR-019): a SERVICE actor, same validation and shape as apps/api/src/core/audit.ts."""
    if not ACTION.match(action):
        raise ValueError(f"invalid audit action {action}")
    cur.execute("INSERT INTO audit_events (organization_id, actor_id, actor_kind, actor_service, action, entity_type, entity_id, request_id, after_state) "
                "VALUES (%s, NULL, 'SERVICE', %s, %s, %s, %s, %s, %s)",
                (organization_id, service, action, entity_type, entity_id, request_id[:255], json.dumps(after) if after is not None else None))


def publish(cur, organization_id: str, aggregate_type: str, aggregate_id: str, event_type: str, payload: dict, dedupe_key: str | None = None) -> None:
    """Write to the ONE outbox (ADR-012/018) in the caller's transaction; a repeated dedupe key is a no-op."""
    if not ACTION.match(event_type):
        raise ValueError(f"invalid event type {event_type}")
    try:
        cur.execute("INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload, dedupe_key) VALUES (%s, %s, %s, %s, %s, %s)",
                    (organization_id, aggregate_type, aggregate_id, event_type, json.dumps(payload), dedupe_key))
    except Exception as e:  # noqa: BLE001 - pymysql 1062 and sqlite3 IntegrityError are the same "already there" on the two backends
        if not _is_duplicate_key(e) or dedupe_key is None:
            raise
