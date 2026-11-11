"""Claiming and settling `worker_jobs` (ADR-022) — the same safety rules as the outbox dispatcher (ADR-018):

  claim      FOR UPDATE SKIP LOCKED over QUEUED-and-due jobs, or RUNNING jobs whose lease expired (a crashed worker); a fresh claim token.
             On SQLite the same claim runs under BEGIN IMMEDIATE (no FOR UPDATE — the write lock is already held, so no other writer
             can claim between the SELECT and the UPDATE); timestamps are integer ms computed once in Python.
             Highest priority first (1..9), then the oldest; a PAUSED job is never claimed; an organization with `org_max_running` jobs
             already running waits (ADR-060: one club's long queue does not hold every worker). The cap is checked inside the claim
             transaction; two workers claiming at the same instant may pass it by one (a soft cap, never a lost job)
  heartbeat  a thread renews the lease while the handler runs; if the token no longer matches, the job was taken over -> LeaseLost
  settle     every terminal update is conditional on the claim token (a worker that lost its lease cannot overwrite the new owner)
  retry      a RetryableError goes back to QUEUED with back-off until max_attempts; any other error, or the last attempt, is FAILED with a
             stable error code and a short, secret-free detail
"""
from __future__ import annotations

import json
import logging
import random
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from .db import connect, is_sqlite_conn, is_sqlite_dsn, now_ms, tx
from .licence import LicenceError, check_licence_for_job

log = logging.getLogger("vie_worker.jobs")


class LeaseLost(Exception):
    pass


class JobError(Exception):
    """A decided failure: `code` is stable and machine-readable, the message is safe to show to users."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class RetryableError(JobError):
    pass


@dataclass
class Job:
    id: str
    organization_id: str
    kind: str
    subject_type: str
    subject_id: str
    payload: dict
    attempts: int
    max_attempts: int
    token: str
    _lost: threading.Event = field(default_factory=threading.Event, repr=False)
    _seen: float = field(default=0.0, repr=False)


class JobRunner:
    def __init__(self, dsn: str, worker_id: str, kinds: list[str], lease_seconds: int = 120, org_max_running: int = 4):
        self.dsn, self.worker_id, self.kinds, self.lease = dsn, worker_id, kinds, lease_seconds
        self.org_max_running = max(1, int(org_max_running))
        self.conn = connect(dsn)

    def claim(self) -> Job | None:
        token = str(uuid.uuid4())
        marks = ",".join(["%s"] * len(self.kinds))
        # SQLite has no FOR UPDATE SKIP LOCKED — and needs none: tx() is BEGIN IMMEDIATE there, so the
        # SELECT and the UPDATE below hold the exclusive write lock together and no other writer can
        # claim between them. Timestamps are integer ms, computed once here so the read and the write agree.
        if is_sqlite_conn(self.conn):
            now = now_ms()
            with tx(self.conn) as cur:
                cur.execute(
                    f"""SELECT j.id FROM worker_jobs j
                         WHERE j.kind IN ({marks}) AND ((j.state = 'QUEUED' AND j.available_at <= %s
                                AND (SELECT COUNT(*) FROM worker_jobs r WHERE r.organization_id = j.organization_id AND r.state = 'RUNNING'
                                        AND r.lease_expires_at > %s) < %s)
                            OR (j.state = 'RUNNING' AND j.lease_expires_at <= %s))
                         ORDER BY j.priority, j.created_at LIMIT 1""", (*self.kinds, now, now, self.org_max_running, now))
                row = cur.fetchone()
                if not row:
                    return None
                cur.execute(
                    """UPDATE worker_jobs SET state = 'RUNNING', claim_token = %s, worker_id = %s, attempts = attempts + 1,
                              lease_expires_at = %s, heartbeat_at = %s,
                              started_at = COALESCE(started_at, %s), error_code = NULL, error_detail = NULL
                        WHERE id = %s""", (token, self.worker_id[:100], now + self.lease * 1000, now, now, row["id"]))
                cur.execute("SELECT id, organization_id, kind, subject_type, subject_id, payload, attempts, max_attempts FROM worker_jobs WHERE id = %s", (row["id"],))
                j = cur.fetchone()
        else:
            with tx(self.conn) as cur:
                cur.execute(
                    f"""SELECT j.id FROM worker_jobs j
                         WHERE j.kind IN ({marks}) AND ((j.state = 'QUEUED' AND j.available_at <= CURRENT_TIMESTAMP(6)
                                AND (SELECT COUNT(*) FROM worker_jobs r WHERE r.organization_id = j.organization_id AND r.state = 'RUNNING'
                                        AND r.lease_expires_at > CURRENT_TIMESTAMP(6)) < %s)
                            OR (j.state = 'RUNNING' AND j.lease_expires_at <= CURRENT_TIMESTAMP(6)))
                         ORDER BY j.priority, j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED""", (*self.kinds, self.org_max_running))
                row = cur.fetchone()
                if not row:
                    return None
                cur.execute(
                    """UPDATE worker_jobs SET state = 'RUNNING', claim_token = %s, worker_id = %s, attempts = attempts + 1,
                              lease_expires_at = CURRENT_TIMESTAMP(6) + INTERVAL %s SECOND, heartbeat_at = CURRENT_TIMESTAMP(6),
                              started_at = COALESCE(started_at, CURRENT_TIMESTAMP(6)), error_code = NULL, error_detail = NULL
                        WHERE id = %s""", (token, self.worker_id[:100], self.lease, row["id"]))
                cur.execute("SELECT id, organization_id, kind, subject_type, subject_id, payload, attempts, max_attempts FROM worker_jobs WHERE id = %s", (row["id"],))
                j = cur.fetchone()
        payload = j["payload"] if isinstance(j["payload"], dict) else json.loads(j["payload"])
        return Job(j["id"], j["organization_id"], j["kind"], j["subject_type"], j["subject_id"], payload, j["attempts"], j["max_attempts"], token)

    def _conditional(self, job: Job, sql: str, args: tuple) -> bool:
        c = connect(self.dsn, found_rows=True)      # separate connection: callable from the heartbeat thread and the handler; counts MATCHED rows (see db.connect)
        try:
            if is_sqlite_conn(c):
                # SQLite counts CHANGED rows, not matched ones, so rowcount cannot say whether the lease
                # is still ours (a progress report that did not move changes nothing). Check the token
                # first, then update, inside one BEGIN IMMEDIATE transaction: atomic, and the same
                # matched-row meaning as FOUND_ROWS on MySQL.
                with tx(c) as cur:
                    cur.execute("SELECT 1 FROM worker_jobs WHERE id = %s AND claim_token = %s", (job.id, job.token))
                    if cur.fetchone() is None:
                        return False
                    cur.execute(sql, args)
                    return True
            with c.cursor() as cur:
                return cur.execute(sql, args) == 1
        finally:
            c.close()

    def progress(self, job: Job, percent: float, message: str) -> None:
        if job._lost.is_set():
            raise LeaseLost()
        ok = self._conditional(job, "UPDATE worker_jobs SET progress = %s, stage_message = %s WHERE id = %s AND claim_token = %s",
                               (round(max(0.0, min(100.0, percent)), 2), message[:255], job.id, job.token))
        if not ok:
            job._lost.set()
            raise LeaseLost()

    def check(self, job: Job) -> None:
        if job._lost.is_set():
            raise LeaseLost()

    def still_mine(self, job: Job, every_s: float = 3.0) -> None:
        """Inside a long loop: at most every `every_s` seconds, is the claim still this worker's? A person's Cancel clears it (a render,
        owner 2026-11-02), so the work stops within seconds instead of at the next heartbeat."""
        self.check(job)
        now = time.monotonic()
        if now - job._seen < every_s:
            return
        job._seen = now
        c = connect(self.dsn)
        try:
            with c.cursor() as cur:
                cur.execute("SELECT 1 FROM worker_jobs WHERE id = %s AND claim_token = %s", (job.id, job.token))
                mine = cur.fetchone() is not None
        finally:
            c.close()
        if not mine:
            job._lost.set()
            raise LeaseLost()

    def heartbeat(self, job: Job, stop: threading.Event) -> None:
        while not stop.wait(self.lease / 3):
            try:
                if is_sqlite_dsn(self.dsn):
                    now = now_ms()
                    ok = self._conditional(job, "UPDATE worker_jobs SET lease_expires_at = %s, heartbeat_at = %s "
                                                "WHERE id = %s AND claim_token = %s", (now + self.lease * 1000, now, job.id, job.token))
                else:
                    ok = self._conditional(job, "UPDATE worker_jobs SET lease_expires_at = CURRENT_TIMESTAMP(6) + INTERVAL %s SECOND, heartbeat_at = CURRENT_TIMESTAMP(6) "
                                                "WHERE id = %s AND claim_token = %s", (self.lease, job.id, job.token))
                if not ok:
                    job._lost.set()
                    return
            except Exception as e:  # noqa: BLE001 - a lock wait while the handler saves its results (it holds this job row) must not end the heartbeat: try again next tick
                log.warning("heartbeat skipped (%s); will retry", e)

    def succeed(self, job: Job, result: dict[str, Any]) -> bool:
        return self._conditional(job, """UPDATE worker_jobs SET state = 'SUCCEEDED', progress = 100, result = %s, claim_token = NULL, lease_expires_at = NULL,
                                           finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s AND claim_token = %s""", (json.dumps(result), job.id, job.token))

    def fail(self, job: Job, code: str, detail: str, retryable: bool) -> str:
        if retryable and job.attempts < job.max_attempts:
            delay = min(600, 15 * 2 ** (job.attempts - 1)) * (0.5 + random.random() / 2)
            if is_sqlite_dsn(self.dsn):
                self._conditional(job, """UPDATE worker_jobs SET state = 'QUEUED', claim_token = NULL, lease_expires_at = NULL, error_code = %s, error_detail = %s,
                                            available_at = %s WHERE id = %s AND claim_token = %s""",
                                  (code[:64], detail[:1000], now_ms() + int(delay * 1000), job.id, job.token))
            else:
                self._conditional(job, """UPDATE worker_jobs SET state = 'QUEUED', claim_token = NULL, lease_expires_at = NULL, error_code = %s, error_detail = %s,
                                            available_at = CURRENT_TIMESTAMP(6) + INTERVAL %s MICROSECOND WHERE id = %s AND claim_token = %s""",
                                  (code[:64], detail[:1000], int(delay * 1_000_000), job.id, job.token))
            return "retry"
        self._conditional(job, """UPDATE worker_jobs SET state = 'FAILED', claim_token = NULL, lease_expires_at = NULL, error_code = %s, error_detail = %s,
                                    finished_at = CURRENT_TIMESTAMP(6) WHERE id = %s AND claim_token = %s""", (code[:64], detail[:1000], job.id, job.token))
        return "failed"

    def run_one(self, handlers: dict) -> str | None:
        """Claim one job and run its handler; returns the outcome or None when nothing was due."""
        job = self.claim()
        if job is None:
            return None
        # Licence (ADR-144 1.5): paid work is refused at job start when the licence does not verify - no token in central
        # mode, or a token whose signature, expiry or organisation fails (see vie_worker/licence.py). Not retried: a licence
        # refusal cannot succeed until the shell has refreshed the token and this worker has restarted with the new environment.
        try:
            check_licence_for_job(job)
        except LicenceError as e:
            return self.fail(job, e.code, str(e), retryable=False)
        stop = threading.Event()
        beat = threading.Thread(target=self.heartbeat, args=(job, stop), daemon=True)
        beat.start()
        try:
            result = handlers[job.kind](self, job)
            return "succeeded" if self.succeed(job, result or {}) else "lost"
        except LeaseLost:
            return "lost"
        except RetryableError as e:
            return self.fail(job, e.code, str(e), retryable=True)
        except JobError as e:
            return self.fail(job, e.code, str(e), retryable=False)
        except Exception as e:  # noqa: BLE001 - an unexpected error: full detail to the operator log, a safe summary on the job, retried
            log.exception("job %s (%s) failed unexpectedly", job.id, job.kind)
            return self.fail(job, "INTERNAL_ERROR", f"{type(e).__name__}: the worker could not finish this job", retryable=True)
        finally:
            stop.set()
