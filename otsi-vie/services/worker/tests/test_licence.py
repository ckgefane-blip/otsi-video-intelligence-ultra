"""Licence enforcement in the worker (ADR-144 §1.5; distribution-build audit Finding 2).

Self-contained: every test builds what it needs (an Ed25519 key pair minted
here, a throwaway SQLite stack for the run_one tests) and needs no fixture,
so the same file runs under the repo's pytest on the owner's host AND under
the direct runner here (otsi-vie/services/worker/run_sqlite_tests.py) —
pytest cannot run here because tests/conftest.py needs .local/mysql-lint.env
+ MySQL 3507. Nothing here touches the MySQL path.

The tokens minted here are the same shape the API issues (licence.ts):
Ed25519 (EdDSA), audience "otsi-vie-licence", ``exp`` carrying the same
instant as ``expires_at``.
"""
from __future__ import annotations

import base64
import json
import os
import shutil
import tempfile
import time
import uuid
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

from vie_worker.jobs import Job, JobRunner
from vie_worker.db import connect
from vie_worker.licence import (
    LICENCE_AUDIENCE,
    TICKET_AUDIENCE,
    LicenceError,
    check_licence_for_job,
    verify_licence_token,
    verify_ticket_token,
)

import sqlite_support


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _keypair():
    private = Ed25519PrivateKey.generate()
    pem = private.public_key().public_bytes(Encoding.PEM, PublicFormat.SubjectPublicKeyInfo).decode("ascii")
    return private, pem


def _mint(private, org, *, exp_offset=3600, plan="FREE", features=None, tokens=500,
          issuer="https://accounts.test.otsi.invalid"):
    """A licence token minted the way the API mints one (EdDSA, same claims)."""
    now = int(time.time())
    exp = now + exp_offset
    header = {"alg": "EdDSA", "typ": "JWT"}
    payload = {
        "organization_id": org, "plan": plan, "features": list(features or []),
        "tokens": tokens, "expires_at": datetime.fromtimestamp(exp, timezone.utc).isoformat().replace("+00:00", "Z"),
        "iss": issuer, "aud": LICENCE_AUDIENCE, "sub": org, "iat": now, "exp": exp, "jti": str(uuid.uuid4()),
    }
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}"
    return f"{signing_input}.{_b64(private.sign(signing_input.encode('ascii')))}"


def _raises_code(fn, code):
    """Run fn(); it must raise LicenceError with this code. Plain asserts, so
    this works under real pytest AND the direct runner's pytest stub (whose
    ``raises`` has no excinfo)."""
    try:
        fn()
    except LicenceError as e:
        assert e.code == code, f"expected {code}, got {e.code}"
        return
    raise AssertionError(f"expected LicenceError({code})")


def _job(org, kind="ANALYZE"):
    return Job(str(uuid.uuid4()), org, kind, "video", str(uuid.uuid4()), {}, 1, 3, "tok")


def _stack():
    d = tempfile.mkdtemp(prefix="vie-sqlite-licence-")
    stack = sqlite_support.make_stack(d)
    stack["_tmpdir"] = d
    return stack


def _drop(stack):
    shutil.rmtree(stack["_tmpdir"], ignore_errors=True)


def _enqueue(stack, org, kind):
    jid = str(uuid.uuid4())
    c = connect(stack["dsn"])
    try:
        with c.cursor() as cur:
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)", (org, "L " + org[-6:], "l-" + org))
            cur.execute(
                "INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload)"
                " VALUES (%s, %s, %s, 'video', %s, %s, %s)",
                (jid, org, kind, str(uuid.uuid4()), "l:" + jid, json.dumps({})))
    finally:
        c.close()
    return jid


def _job_row(stack, jid):
    c = connect(stack["dsn"])
    try:
        with c.cursor() as cur:
            cur.execute("SELECT state, error_code FROM worker_jobs WHERE id = %s", (jid,))
            return cur.fetchone()
    finally:
        c.close()


def test_valid_token_passes():
    private, pem = _keypair()
    org = str(uuid.uuid4())
    claims = verify_licence_token(_mint(private, org), public_key_pem=pem)
    assert claims == {
        "organization_id": org, "plan": "FREE", "features": [], "tokens": 500,
        "expires_at": claims["expires_at"],
    }


def test_tampered_token_fails():
    private, pem = _keypair()
    org = str(uuid.uuid4())
    parts = _mint(private, org).split(".")
    payload = parts[1]
    tampered = f"{parts[0]}.{payload[:-1]}{'B' if payload[-1] != 'B' else 'A'}.{parts[2]}"
    _raises_code(lambda: verify_licence_token(tampered, public_key_pem=pem), "LICENCE_INVALID")


def test_expired_token_fails():
    private, pem = _keypair()
    org = str(uuid.uuid4())
    _raises_code(lambda: verify_licence_token(_mint(private, org, exp_offset=-60), public_key_pem=pem), "LICENCE_EXPIRED")


def test_token_from_the_wrong_key_fails():
    _, pem = _keypair()
    other_private, _ = _keypair()
    org = str(uuid.uuid4())
    _raises_code(lambda: verify_licence_token(_mint(other_private, org), public_key_pem=pem), "LICENCE_INVALID")


def test_token_with_no_key_configured_fails():
    private, _ = _keypair()
    org = str(uuid.uuid4())
    _raises_code(lambda: verify_licence_token(_mint(private, org)), "LICENCE_NOT_CONFIGURED")


def test_wrong_org_fails():
    private, pem = _keypair()
    org, other_org = str(uuid.uuid4()), str(uuid.uuid4())
    env = {"OTSI_VIE_LICENCE_TOKEN": _mint(private, org), "OTSI_VIE_LICENCE_PUBLIC_KEY_PEM": pem}
    _raises_code(lambda: check_licence_for_job(_job(other_org), env), "LICENCE_INVALID")


def test_missing_token_in_central_mode_fails():
    env = {"OTSI_VIE_CENTRAL_MODE": "yes"}
    _raises_code(lambda: check_licence_for_job(_job(str(uuid.uuid4())), env), "LICENCE_REQUIRED")
    env = {"OTSI_VIE_CENTRAL_SERVER_URL": "https://accounts.test.otsi.invalid"}
    _raises_code(lambda: check_licence_for_job(_job(str(uuid.uuid4())), env), "LICENCE_REQUIRED")


def test_missing_token_in_local_only_passes():
    assert check_licence_for_job(_job(str(uuid.uuid4())), {}) is None


def test_ingest_is_never_gated():
    # Preparation, not paid work: a PROXY job runs even in central mode
    # with no token at all.
    env = {"OTSI_VIE_CENTRAL_MODE": "yes"}
    assert check_licence_for_job(_job(str(uuid.uuid4()), "PROXY"), env) is None
    assert check_licence_for_job(_job(str(uuid.uuid4()), "INGEST_UPLOAD"), env) is None


def _run_one_env(monkey_env):
    """Set os.environ for a run_one test (the gate reads the process env);
    returns a restore function."""
    keys = ("OTSI_VIE_LICENCE_TOKEN", "OTSI_VIE_LICENCE_PUBLIC_KEY_PEM",
            "OTSI_VIE_CENTRAL_JWKS_URL", "OTSI_VIE_CENTRAL_MODE",
            "OTSI_VIE_CENTRAL_SERVER_URL", "OTSI_VIE_JWT_ISSUER")
    saved = {k: os.environ.get(k) for k in keys}
    for k in keys:
        os.environ.pop(k, None)
    os.environ.update(monkey_env)

    def restore():
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
    return restore


def test_run_one_refuses_a_paid_job_without_a_licence_in_central_mode():
    stack = _stack()
    restore = _run_one_env({"OTSI_VIE_CENTRAL_MODE": "yes"})
    try:
        org = str(uuid.uuid4())
        jid = _enqueue(stack, org, "ANALYZE")
        ran = []
        runner = JobRunner(stack["dsn"], "w1", ["ANALYZE"])
        outcome = runner.run_one({"ANALYZE": lambda r, j: ran.append(j.id)})
        assert outcome == "failed"
        assert ran == []  # the handler never ran
        row = _job_row(stack, jid)
        assert row["state"] == "FAILED"
        assert row["error_code"] == "LICENCE_REQUIRED"
    finally:
        restore()
        _drop(stack)


def test_run_one_runs_a_paid_job_local_only():
    stack = _stack()
    restore = _run_one_env({})
    try:
        org = str(uuid.uuid4())
        jid = _enqueue(stack, org, "ANALYZE")
        ran = []
        runner = JobRunner(stack["dsn"], "w1", ["ANALYZE"])
        outcome = runner.run_one({"ANALYZE": lambda r, j: ran.append(j.id) or {}})
        assert outcome == "succeeded"
        assert ran == [jid]
        row = _job_row(stack, jid)
        assert row["state"] == "SUCCEEDED"
    finally:
        restore()
        _drop(stack)


def test_run_one_runs_a_paid_job_with_a_valid_licence():
    private, pem = _keypair()
    stack = _stack()
    try:
        org = str(uuid.uuid4())
        jid = _enqueue(stack, org, "ANALYZE")
        restore = _run_one_env({
            "OTSI_VIE_LICENCE_TOKEN": _mint(private, org),
            "OTSI_VIE_LICENCE_PUBLIC_KEY_PEM": pem,
        })
        try:
            ran = []
            runner = JobRunner(stack["dsn"], "w1", ["ANALYZE"])
            outcome = runner.run_one({"ANALYZE": lambda r, j: ran.append(j.id) or {}})
            assert outcome == "succeeded"
            assert ran == [jid]
        finally:
            restore()
    finally:
        _drop(stack)


# ---- linked desktop (ADR-146): the licence and the job's ticket come from the database ----------------------------------

LINKED_ENV = {"OTSI_VIE_CENTRAL_SERVER_URL": "https://accounts.test.otsi.invalid"}
LINKED_TABLES = """
CREATE TABLE IF NOT EXISTS central_links (
  user_id TEXT NOT NULL, organization_id TEXT NOT NULL, central_url TEXT NOT NULL, refresh_sealed TEXT NOT NULL,
  licence_token TEXT, licence_expires_at INTEGER, PRIMARY KEY (user_id, organization_id)
) STRICT;
CREATE TABLE IF NOT EXISTS linked_job_tickets (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, job_type TEXT NOT NULL, job_id TEXT NOT NULL, amount INTEGER NOT NULL,
  source TEXT NOT NULL, state TEXT NOT NULL, ticket_token TEXT, UNIQUE (organization_id, job_type, job_id)
) STRICT;
"""


def _mint_ticket(private, org, job_type, job_id, *, exp_offset=3600, amount=30, audience=TICKET_AUDIENCE):
    """A job ticket minted the way the central server mints one (tickets.ts)."""
    now = int(time.time())
    exp = now + exp_offset
    header = {"alg": "EdDSA", "typ": "JWT"}
    payload = {"organization_id": org, "job_type": job_type, "job_id": job_id, "amount": amount,
               "expires_at": datetime.fromtimestamp(exp, timezone.utc).isoformat().replace("+00:00", "Z"),
               "iss": "https://accounts.test.otsi.invalid", "aud": audience, "sub": org, "iat": now, "exp": exp, "jti": str(uuid.uuid4())}
    signing_input = f"{_b64(json.dumps(header).encode())}.{_b64(json.dumps(payload).encode())}"
    return f"{signing_input}.{_b64(private.sign(signing_input.encode('ascii')))}"


class _Linked:
    """A throwaway SQLite stack with the two linked-desktop tables, one organisation and its licence."""

    def __init__(self, licence_offset=3600, with_licence=True):
        self.private, self.pem = _keypair()
        self.stack = _stack()
        self.org = str(uuid.uuid4())
        self.conn = connect(self.stack["dsn"])
        with self.conn.cursor() as cur:
            for stmt in [x for x in LINKED_TABLES.split(";") if x.strip()]:
                cur.execute(stmt)
            cur.execute("INSERT INTO organizations (id, name, slug) VALUES (%s, %s, %s)", (self.org, "Linked FC", "linked-" + self.org))
            if with_licence:
                cur.execute("INSERT INTO central_links (user_id, organization_id, central_url, refresh_sealed, licence_token, licence_expires_at)"
                            " VALUES (%s, %s, %s, %s, %s, %s)",
                            (str(uuid.uuid4()), self.org, "https://accounts.test.otsi.invalid", "v1.x.y",
                             _mint(self.private, self.org, exp_offset=licence_offset), int(time.time() * 1000)))
        self.env = {**LINKED_ENV, "OTSI_VIE_LICENCE_PUBLIC_KEY_PEM": self.pem}

    def ticket(self, job_type, job_id, *, source="ONLINE", state="ACTIVE", token=None):
        if source == "ONLINE" and token is None:
            token = _mint_ticket(self.private, self.org, job_type, job_id)
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO linked_job_tickets (id, organization_id, job_type, job_id, amount, source, state, ticket_token)"
                        " VALUES (%s, %s, %s, %s, %s, %s, %s, %s)", (str(uuid.uuid4()), self.org, job_type, job_id, 30, source, state, token))

    def job(self, kind="ANALYZE", subject=None):
        return Job(str(uuid.uuid4()), self.org, kind, "pipeline_run", subject or str(uuid.uuid4()), {}, 1, 3, "tok")

    def check(self, job):
        return check_licence_for_job(job, self.env, conn=self.conn)

    def close(self):
        self.conn.close()
        _drop(self.stack)


def test_linked_without_a_licence_is_refused():
    L = _Linked(with_licence=False)
    try:
        _raises_code(lambda: L.check(L.job()), "LICENCE_REQUIRED")
    finally:
        L.close()


def test_linked_paid_job_needs_its_ticket():
    L = _Linked()
    try:
        _raises_code(lambda: L.check(L.job("ANALYZE")), "TICKET_REQUIRED")
        _raises_code(lambda: L.check(L.job("RENDER")), "TICKET_REQUIRED")
        run = str(uuid.uuid4())
        L.ticket("ANALYSIS", run)
        assert L.check(L.job("ANALYZE", run))["organization_id"] == L.org
        render = str(uuid.uuid4())
        L.ticket("REEL_RENDER", render)
        assert L.check(L.job("RENDER", render))["organization_id"] == L.org
    finally:
        L.close()


def test_linked_ticket_must_name_this_job_and_verify():
    L = _Linked()
    try:
        run, other = str(uuid.uuid4()), str(uuid.uuid4())
        L.ticket("ANALYSIS", run, token=_mint_ticket(L.private, L.org, "ANALYSIS", other))       # signed for another job
        _raises_code(lambda: L.check(L.job("ANALYZE", run)), "TICKET_INVALID")
        forged_key, _ = _keypair()
        run2 = str(uuid.uuid4())
        L.ticket("ANALYSIS", run2, token=_mint_ticket(forged_key, L.org, "ANALYSIS", run2))       # not central's key
        _raises_code(lambda: L.check(L.job("ANALYZE", run2)), "TICKET_INVALID")
        run3 = str(uuid.uuid4())
        L.ticket("ANALYSIS", run3, token=_mint(L.private, L.org))                                # a licence is not a ticket
        _raises_code(lambda: L.check(L.job("ANALYZE", run3)), "TICKET_INVALID")
        run4 = str(uuid.uuid4())
        L.ticket("ANALYSIS", run4, token=_mint_ticket(L.private, L.org, "ANALYSIS", run4, exp_offset=-60))
        _raises_code(lambda: L.check(L.job("ANALYZE", run4)), "TICKET_EXPIRED")
    finally:
        L.close()


def test_linked_offline_spend_runs_and_a_refunded_job_does_not():
    L = _Linked()
    try:
        run = str(uuid.uuid4())
        L.ticket("ANALYSIS", run, source="OFFLINE", state="ACTIVE", token=None)
        assert L.check(L.job("ANALYZE", run))["organization_id"] == L.org
        settled = str(uuid.uuid4())
        L.ticket("ANALYSIS", settled, source="OFFLINE", state="SETTLED", token=None)
        assert L.check(L.job("ANALYZE", settled))["organization_id"] == L.org
        refunded = str(uuid.uuid4())
        L.ticket("REEL_RENDER", refunded, state="REFUNDED")
        _raises_code(lambda: L.check(L.job("RENDER", refunded)), "TICKET_REQUIRED")
    finally:
        L.close()


def test_linked_licence_grace_and_unticketed_paid_kinds():
    L = _Linked(licence_offset=-3 * 86400)            # expired three days ago: inside the 14-day grace
    try:
        assert L.check(L.job("CALIBRATE_PITCH"))["organization_id"] == L.org   # paid kind, not charged per job: licence only
        assert check_licence_for_job(L.job("PROXY"), L.env, conn=L.conn) is None
        _raises_code(lambda: check_licence_for_job(L.job("CALIBRATE_PITCH"), {**L.env, "OTSI_VIE_LICENCE_GRACE_DAYS": "2"}, conn=L.conn), "LICENCE_EXPIRED")
    finally:
        L.close()


def test_verify_ticket_token_claims():
    private, pem = _keypair()
    org, job_id = str(uuid.uuid4()), str(uuid.uuid4())
    claims = verify_ticket_token(_mint_ticket(private, org, "ANALYSIS", job_id, amount=12), public_key_pem=pem)
    assert (claims["organization_id"], claims["job_type"], claims["job_id"], claims["amount"]) == (org, "ANALYSIS", job_id, 12)
    _raises_code(lambda: verify_ticket_token(_mint_ticket(private, org, "ANALYSIS", job_id, audience=LICENCE_AUDIENCE), public_key_pem=pem), "TICKET_INVALID")


def test_run_one_on_a_linked_desktop_runs_a_ticketed_job_and_refuses_one_without():
    L = _Linked()
    restore = _run_one_env({**L.env})
    try:
        good, bad = str(uuid.uuid4()), str(uuid.uuid4())
        L.ticket("ANALYSIS", good)
        ids = {}
        with L.conn.cursor() as cur:
            for subject in (good, bad):
                jid = str(uuid.uuid4())
                ids[subject] = jid
                cur.execute("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload)"
                            " VALUES (%s, %s, 'ANALYZE', 'pipeline_run', %s, %s, %s)", (jid, L.org, subject, "l:" + jid, json.dumps({})))
        ran = []
        runner = JobRunner(L.stack["dsn"], "w1", ["ANALYZE"])
        outcomes = [runner.run_one({"ANALYZE": lambda r, j: ran.append(j.subject_id) or {}}) for _ in range(2)]
        assert sorted(outcomes) == ["failed", "succeeded"]
        assert ran == [good]
        assert _job_row(L.stack, ids[good])["state"] == "SUCCEEDED"
        row = _job_row(L.stack, ids[bad])
        assert (row["state"], row["error_code"]) == ("FAILED", "TICKET_REQUIRED")
    finally:
        restore()
        L.close()
