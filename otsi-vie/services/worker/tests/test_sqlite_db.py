"""SQLite backend tests for vie_worker.db (distribution plan v4 §1d, safeguards 3/4).

Self-contained: every test builds its own throwaway SQLite stack (sqlite_support.make_stack) and
needs no fixture, so the same file runs under the repo's pytest on the owner's host AND under the
direct runner here (otsi-vie/services/worker/run_sqlite_tests.py) — pytest cannot run here because
tests/conftest.py needs .local/mysql-lint.env + MySQL 3507. Nothing here touches the MySQL path.
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import tempfile
import threading
import time
import uuid
from datetime import datetime, timezone

import pytest

from vie_worker import db
from vie_worker.db import audit, connect, publish, tx
from vie_worker.jobs import JobRunner, LeaseLost

import sqlite_support


def _stack():
    d = tempfile.mkdtemp(prefix="vie-sqlite-test-")
    stack = sqlite_support.make_stack(d)
    stack["_tmpdir"] = d
    return stack


def _drop(stack):
    shutil.rmtree(stack["_tmpdir"], ignore_errors=True)


def _org_job(stack, kind="PROXY"):
    """One org + one QUEUED job; returns (org, job_id). Uses db.py connections (the root shim)."""
    org, jid = str(uuid.uuid4()), str(uuid.uuid4())
    c = connect(stack["dsn"])
    try:
        with c.cursor() as cur:
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)", (org, "T " + org[-6:], "t-" + org))
            cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (%s, %s, %s, 'video', %s, %s, %s)",
                        (jid, org, kind, str(uuid.uuid4()), "t:" + jid, json.dumps({})))
    finally:
        c.close()
    return org, jid


def test_connect_sqlite_sets_pragmas():
    stack = _stack()
    try:
        c = connect(stack["dsn"])
        try:
            with c.cursor() as cur:
                cur.execute("PRAGMA journal_mode")
                assert cur.fetchone()["journal_mode"] == "wal"
                cur.execute("PRAGMA foreign_keys")
                assert cur.fetchone()["foreign_keys"] == 1
                cur.execute("PRAGMA busy_timeout")
                assert cur.fetchone()["timeout"] == db.BUSY_TIMEOUT_MS == 30000  # PRAGMA names the column "timeout"
                cur.execute("PRAGMA synchronous")
                assert cur.fetchone()["synchronous"] == 1  # NORMAL
        finally:
            c.close()
    finally:
        _drop(stack)


def test_connect_refuses_paths_outside_the_data_folder():
    stack = _stack()
    try:
        # an absolute path outside OTSI_VIE_DATA_DIR / OTSI_VIE_STORAGE_DIR: refused
        with pytest.raises(ValueError):
            connect("sqlite:///tmp/otsi-outside-data-dir.db")
        # a relative path: refused (it could resolve anywhere)
        with pytest.raises(ValueError):
            connect("sqlite://relative.db")
        # :memory: touches no file: allowed
        c = connect("sqlite:///:memory:")
        c.close()
        # inside the data folder: allowed
        c = connect(f"sqlite:///{stack['data_dir']}/ok.db")
        c.close()
    finally:
        _drop(stack)


def test_connect_still_refuses_port_3306():
    # runs before any pymysql import, so it holds even where pymysql is not installed
    with pytest.raises(ValueError):
        connect("mysql://u:p@127.0.0.1:3306/x")


def test_percent_s_placeholders_and_dict_rows():
    stack = _stack()
    try:
        org, jid = _org_job(stack)
        c = connect(stack["dsn"])
        try:
            with c.cursor() as cur:
                cur.execute("SELECT id, kind, state FROM worker_jobs WHERE id = %s", (jid,))
                row = cur.fetchone()
                assert isinstance(row, dict) and row["id"] == jid and row["kind"] == "PROXY" and row["state"] == "QUEUED"
                cur.execute("SELECT COUNT(*) AS n FROM worker_jobs WHERE organization_id = %s", (org,))
                assert cur.fetchone()["n"] == 1
        finally:
            c.close()
    finally:
        _drop(stack)


def test_tx_is_begin_immediate_and_serialises_writers():
    """Two connections, one row: the second writer's tx() must WAIT for the first (busy_timeout) and
    then succeed — never a 'database is locked' error. This is the property the claim depends on."""
    stack = _stack()
    try:
        org, jid = _org_job(stack)
        a = connect(stack["dsn"])
        try:
            with tx(a) as cur:
                cur.execute("UPDATE worker_jobs SET progress = %s WHERE id = %s", (10.0, jid))
                held = threading.Event()

                def second_writer():
                    # its own connection, opened in this thread: sqlite3 connections are
                    # thread-bound (check_same_thread), as the real workers are separate processes
                    b = connect(stack["dsn"])
                    try:
                        with tx(b) as cur2:
                            cur2.execute("UPDATE worker_jobs SET progress = %s WHERE id = %s", (20.0, jid))
                        held.set()
                    except sqlite3.OperationalError:
                        pass  # held stays unset: the test below fails
                    finally:
                        b.close()

                t = threading.Thread(target=second_writer)
                t.start()
                time.sleep(0.5)
                assert not held.is_set()  # still waiting while the first tx is open: the lock is held
            t.join(timeout=35)
            assert held.is_set()  # waited, then committed once the first tx closed
            with a.cursor() as cur:
                cur.execute("SELECT progress FROM worker_jobs WHERE id = %s", (jid,))
                assert cur.fetchone()["progress"] == 20.0
        finally:
            a.close()
    finally:
        _drop(stack)


def test_audit_and_publish_roundtrip_with_dedupe_noop():
    stack = _stack()
    try:
        org, _ = _org_job(stack)
        c = connect(stack["dsn"])
        try:
            with tx(c) as cur:
                audit(cur, org, "test-worker", "video.ingested", "video", "v-1", {"bytes": 7}, "req-1")
                publish(cur, org, "video", "v-1", "video.ingested", {"bytes": 7}, dedupe_key="dup-1")
                publish(cur, org, "video", "v-1", "video.ingested", {"bytes": 7}, dedupe_key="dup-1")  # no-op
            with c.cursor() as cur:
                cur.execute("SELECT action, actor_kind, actor_service, after_state FROM audit_events")
                row = cur.fetchone()
                assert (row["action"], row["actor_kind"], row["actor_service"]) == ("video.ingested", "SERVICE", "test-worker")
                assert json.loads(row["after_state"]) == {"bytes": 7}
                cur.execute("SELECT COUNT(*) AS n FROM outbox_events")
                assert cur.fetchone()["n"] == 1
            with pytest.raises(ValueError):
                with tx(c) as cur:
                    audit(cur, org, "test-worker", "BAD ACTION!", "video", "v-1", None, "req-2")
        finally:
            c.close()
    finally:
        _drop(stack)


def test_same_value_progress_is_not_a_lost_lease():
    """The SQLite regression behind FOUND_ROWS: a progress report that changes nothing must still
    count as holding the lease (jobs._conditional checks the token, not the changed-row count)."""
    stack = _stack()
    try:
        _, jid = _org_job(stack)
        runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
        claimed = runner.claim()
        assert claimed is not None and claimed.id == jid
        for _ in range(5):
            runner.progress(claimed, 99.0, "Making the playback copy")
        assert not claimed._lost.is_set()
        assert runner.succeed(claimed, {"ok": True})
    finally:
        _drop(stack)


def test_a_taken_over_job_is_still_detected():
    stack = _stack()
    try:
        _, jid = _org_job(stack)
        runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
        claimed = runner.claim()
        assert claimed is not None
        root = connect(stack["dsn"])  # another owner takes the claim away
        try:
            with root.cursor() as cur:
                cur.execute("UPDATE worker_jobs SET claim_token = NULL, lease_expires_at = NULL, state = 'CANCELLED' WHERE id = %s", (jid,))
        finally:
            root.close()
        with pytest.raises(LeaseLost):
            runner.progress(claimed, 50.0, "still working")
        assert claimed._lost.is_set()
    finally:
        _drop(stack)


def test_fail_retry_sets_a_future_available_at():
    """fail() retryable: the SQLite branch must compute available_at in Python (no INTERVAL)."""
    stack = _stack()
    try:
        _, jid = _org_job(stack)
        runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
        claimed = runner.claim()
        assert claimed is not None
        before = db.now_ms()
        assert runner.fail(claimed, "RETRY_ME", "try again", retryable=True) == "retry"
        c = connect(stack["dsn"])
        try:
            with c.cursor() as cur:
                cur.execute("SELECT state, available_at, error_code FROM worker_jobs WHERE id = %s", (jid,))
                row = cur.fetchone()
        finally:
            c.close()
        assert row["state"] == "QUEUED" and row["error_code"] == "RETRY_ME"
        assert before < row["available_at"] <= before + 600_000
    finally:
        _drop(stack)


def test_current_timestamp_translates_to_integer_ms():
    stack = _stack()
    try:
        org, jid = _org_job(stack)
        c = connect(stack["dsn"])
        try:
            with c.cursor() as cur:
                cur.execute("UPDATE worker_jobs SET finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s", (jid,))
                cur.execute("SELECT finished_at, created_at, available_at FROM worker_jobs WHERE id = %s", (jid,))
                row = cur.fetchone()
            now = db.now_ms()
            for col in ("finished_at", "created_at", "available_at"):
                assert isinstance(row[col], int) and now - 60_000 < row[col] <= now, col
        finally:
            c.close()
    finally:
        _drop(stack)


def test_for_update_is_dropped_inside_tx():
    """The settle pattern every worker uses (SELECT claim_token ... FOR UPDATE, then a write, inside
    tx) must work on SQLite: the FOR UPDATE is redundant under BEGIN IMMEDIATE, so it is stripped."""
    stack = _stack()
    try:
        _, jid = _org_job(stack)
        runner = JobRunner(stack["dsn"], "w1", ["PROXY"], lease_seconds=120)
        claimed = runner.claim()
        assert claimed is not None
        with tx(runner.conn) as cur:
            cur.execute("SELECT claim_token FROM worker_jobs WHERE id = %s FOR UPDATE", (jid,))
            assert cur.fetchone()["claim_token"] == claimed.token
            cur.execute("UPDATE worker_jobs SET stage_message = %s WHERE id = %s", ("settled", jid))
    finally:
        _drop(stack)


def test_datetime_param_stored_as_integer_ms_and_boolean_as_0_1():
    stack = _stack()
    try:
        c = connect(stack["dsn"])
        try:
            started = datetime(2026, 11, 11, 8, 20, 0, tzinfo=timezone.utc)
            with c.cursor() as cur:
                cur.execute("INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, "
                            "gpu_name, gpu_percent, busy, started_at, reported_at) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, %s)",
                            ("w1", "host", "[]", 1.5, 8, 100, 200, None, True, started, db.now_ms()))
                cur.execute("SELECT started_at, busy, reported_at FROM worker_status WHERE worker_id = %s", ("w1",))
                row = cur.fetchone()
            assert row["started_at"] == db.to_ms(started) and row["busy"] == 1 and isinstance(row["reported_at"], int)
        finally:
            c.close()
    finally:
        _drop(stack)


def test_worker_status_upsert_sql():
    """The status.py SQLite branch (INSERT ... ON CONFLICT DO UPDATE), run as SQL: a second write for
    the same worker updates the row in place instead of adding one. The full StatusReporter.write()
    path needs psutil, which is not installed on this VM — it runs on the owner's host under pytest."""
    stack = _stack()
    try:
        c = connect(stack["dsn"])
        try:
            sql = """INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name,
                             gpu_percent, busy, started_at, reported_at)
                     VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NULL, %s, %s, UTC_TIMESTAMP(6))
                     ON CONFLICT(worker_id) DO UPDATE SET cpu_percent = excluded.cpu_percent, cpu_count = excluded.cpu_count,
                       memory_used_bytes = excluded.memory_used_bytes, memory_total_bytes = excluded.memory_total_bytes,
                       gpu_name = excluded.gpu_name, busy = excluded.busy, reported_at = excluded.reported_at"""
            started = datetime(2026, 11, 11, 8, 20, 0, tzinfo=timezone.utc)
            with c.cursor() as cur:
                cur.execute(sql, ("w1", "h", '["PROXY"]', 1.0, 8, 100, 200, None, False, started))
                cur.execute(sql, ("w1", "h", '["PROXY"]', 42.5, 8, 150, 200, None, True, started))
                cur.execute("SELECT COUNT(*) AS n, cpu_percent, busy, started_at FROM worker_status")
                row = cur.fetchone()
            assert row["n"] == 1 and row["cpu_percent"] == 42.5 and row["busy"] == 1
            assert row["started_at"] == db.to_ms(started)  # the first write's started_at is kept
        finally:
            c.close()
    finally:
        _drop(stack)


def test_json_roundtrip_through_audit():
    stack = _stack()
    try:
        org, _ = _org_job(stack)
        after = {"nested": {"a": [1, 2, 3]}, "flag": True, "n": 1.5}
        c = connect(stack["dsn"])
        try:
            with tx(c) as cur:
                audit(cur, org, "test-worker", "video.checked", "video", "v-9", after, "req-9")
            with c.cursor() as cur:
                cur.execute("SELECT after_state FROM audit_events")
                assert json.loads(cur.fetchone()["after_state"]) == after
        finally:
            c.close()
    finally:
        _drop(stack)


def test_frame_index_insert_or_ignore_skips_duplicates():
    """analyze.py:364 - the frame-index upsert is INSERT OR IGNORE on SQLite
    (the MySQL form is ON DUPLICATE KEY UPDATE ... = ...). Same PK/UNIQUE
    shape as the real video_frame_index: a duplicate frame_index or pts_us
    for the same video is skipped, never an error, never a second row."""
    stack = _stack()
    try:
        c = connect(stack["dsn"])
        try:
            with tx(c) as cur:
                cur.execute("""CREATE TABLE video_frame_index (
                    video_id TEXT NOT NULL,
                    frame_index INTEGER NOT NULL,
                    pts_us INTEGER NOT NULL,
                    keyframe INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (video_id, frame_index),
                    UNIQUE (video_id, pts_us)
                ) STRICT""")
            rows = [("vid-1", 0, 0, 0), ("vid-1", 1, 33333, 0),
                    ("vid-1", 0, 0, 0), ("vid-1", 2, 33333, 0)]
            with tx(c) as cur:
                cur.executemany("INSERT OR IGNORE INTO video_frame_index (video_id, frame_index, pts_us, keyframe) VALUES (%s, %s, %s, %s)", rows)
            with c.cursor() as cur:
                cur.execute("SELECT COUNT(*) AS n FROM video_frame_index")
                assert cur.fetchone()["n"] == 2
        finally:
            c.close()
    finally:
        _drop(stack)
