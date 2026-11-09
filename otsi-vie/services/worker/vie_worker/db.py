"""MySQL access for the workers: the least-privilege runtime account, explicit transactions, UTC, utf8mb4. Never port 3306."""
from __future__ import annotations

import json
import re
from contextlib import contextmanager
from typing import Any, Iterator
from urllib.parse import unquote, urlparse

import pymysql
import pymysql.constants.CLIENT  # noqa: F401  (pymysql.constants.CLIENT.FOUND_ROWS)

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
ACTION = re.compile(r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$")


def connect(dsn: str, *, found_rows: bool = False) -> pymysql.connections.Connection:
    """found_rows=True makes cursor.execute() return the number of rows MATCHED by an UPDATE, not the number it CHANGED. The job lease checks need
    that: "UPDATE ... WHERE claim_token = ?" matches exactly one row while the worker still owns the job, even when the update writes the same
    values as before (a progress report that did not move). Counting changed rows read that as a lost lease and restarted long jobs."""
    u = urlparse(dsn)
    if u.scheme != "mysql":
        raise ValueError("OTSI_VIE_DB_DSN must be a mysql:// URL")
    if (u.port or 3306) == 3306:
        raise ValueError("refusing port 3306 (the existing OTSI database)")
    conn = pymysql.connect(host=u.hostname, port=u.port, user=unquote(u.username or ""), password=unquote(u.password or ""),
                           database=u.path.lstrip("/"), charset="utf8mb4", autocommit=True, cursorclass=pymysql.cursors.DictCursor,
                           client_flag=pymysql.constants.CLIENT.FOUND_ROWS if found_rows else 0)
    with conn.cursor() as cur:
        cur.execute("SET time_zone = '+00:00'")
    return conn


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
    except pymysql.err.IntegrityError as e:
        if e.args[0] != 1062 or dedupe_key is None:
            raise
