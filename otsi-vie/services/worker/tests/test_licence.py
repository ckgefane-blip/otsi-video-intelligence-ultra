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
    LicenceError,
    check_licence_for_job,
    verify_licence_token,
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
