"""Licence enforcement for the worker (ADR-144 §1.5; distribution-build audit Finding 2).

The central server issues server-signed Ed25519 licence tokens (the API's
``verifyLicenceToken`` is the TypeScript reference); the shell stores the
token and passes it to the worker as OTSI_VIE_LICENCE_TOKEN (with the
central public key as OTSI_VIE_LICENCE_PUBLIC_KEY_PEM or the JWKS URL as
OTSI_VIE_CENTRAL_JWKS_URL). The compiled native engine that was supposed
to enforce the token does not exist — so the worker enforces it here, at
job start, in ``check_licence_for_job`` (called from ``JobRunner.run_one``,
the one entry point every job kind flows through).

Rules (the audit's fix, kept exactly):

* paid work — analysis, reel render, report/assessment and the analysis
  pipeline's sub-jobs (see PAID_KINDS) — is refused unless the licence
  verifies: Ed25519 signature, expiry, and the organisation/plan claims.
  Ingest and proxy generation are preparation, not paid work, and are
  never gated; export packs have no worker job kind (the API assembles
  them and charges at enqueue), so there is nothing to gate for them here.
* the token's organisation must be the job's organisation, or the job is
  refused (a token minted for one club must never run another club's work).
* no token at all: refused in central mode (OTSI_VIE_CENTRAL_MODE=yes or a
  central server URL configured) — a central deployment without a licence
  is not a free pass. Allowed in local-only mode: the central server is
  not deployed yet and the desktop app is a vetting tool, so local-only
  work must keep working exactly as today.
* expiry is strict: the token is refused the moment it expires. The
  14-day offline grace (ADR-144 §1.5) is NOT applied here — the shell
  displays an in-grace token as covered, but the worker is now the
  enforcer and the audit's required test is "expired fails". Whether the
  worker should honour the grace is an owner decision (see the report);
  until it is made, a refreshed token is what unblocks work, and the
  shell refreshes it whenever it can reach the server.

A refused job fails with a stable code (LICENCE_INVALID / LICENCE_EXPIRED /
LICENCE_NOT_CONFIGURED / LICENCE_REQUIRED) and is NOT retried: retrying a
licence refusal cannot succeed until the shell has refreshed the token and
the worker has been restarted with the new environment.

Verification needs ``cryptography`` (requirements.txt pins it); the import
is lazy so a worker without it can still run ungated work, and a paid job
then fails LICENCE_NOT_CONFIGURED instead of crashing the process.
"""
from __future__ import annotations

import base64
import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any, Mapping

try:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    from cryptography.hazmat.primitives.serialization import load_pem_public_key
except ImportError:  # pragma: no cover - the installer always ships cryptography
    InvalidSignature = None  # type: ignore[assignment]
    Ed25519PublicKey = None  # type: ignore[assignment]
    load_pem_public_key = None  # type: ignore[assignment]

LICENCE_AUDIENCE = "otsi-vie-licence"

#: Job kinds that are paid work (charged from the wallet at enqueue in the
#: API: analysis 1/min, reel render 10, player report 10). Everything else
#: the worker runs — INGEST_UPLOAD, INGEST_URL, PROXY — is preparation and
#: is never gated. There is no EXPORT kind: export packs are assembled by
#: the API, not by a worker job.
PAID_KINDS = frozenset({
    "ANALYZE", "RENDER", "ASSESS",
    "CALIBRATE_PITCH", "TRACK_BALL", "READ_LINEUPS", "SNAPSHOT", "BEAT_GRID",
})


class LicenceError(Exception):
    """A licence refusal: ``code`` is stable and machine-readable (the same
    codes the API's verifyLicenceToken uses), the message is safe to show."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def _invalid(message: str) -> LicenceError:
    return LicenceError("LICENCE_INVALID", message)


def _b64url_decode(segment: str) -> bytes:
    try:
        return base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
    except Exception:
        raise _invalid("That licence token could not be verified.")


def _parse_iso(value: str) -> float | None:
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except (ValueError, TypeError, AttributeError):
        return None


def _key_from_pem(pem: str):
    if load_pem_public_key is None:
        raise LicenceError("LICENCE_NOT_CONFIGURED", "No licence verification key is configured on this engine.")
    try:
        key = load_pem_public_key(pem.encode("utf-8"))
    except Exception:
        raise LicenceError("LICENCE_NOT_CONFIGURED", "The configured licence public key could not be read.")
    if Ed25519PublicKey is None or not isinstance(key, Ed25519PublicKey):
        raise LicenceError("LICENCE_NOT_CONFIGURED", "The configured licence public key is not an Ed25519 public key.")
    return key


def _key_from_jwks(jwks_url: str, kid: str | None):
    """The central server's Ed25519 public key out of its JWKS endpoint (the
    alternative to the PEM). A fetch failure means the token cannot be
    verified at all, so it is LICENCE_NOT_CONFIGURED, not a pass."""
    if Ed25519PublicKey is None:
        raise LicenceError("LICENCE_NOT_CONFIGURED", "No licence verification key is configured on this engine.")
    try:
        with urllib.request.urlopen(jwks_url, timeout=10) as res:  # noqa: S310 - the URL comes from this engine's own environment
            jwks = json.loads(res.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError, UnicodeDecodeError) as e:
        raise LicenceError("LICENCE_NOT_CONFIGURED", f"The central licence key could not be fetched ({e}).")
    keys = jwks.get("keys") if isinstance(jwks, dict) else None
    if not isinstance(keys, list):
        raise LicenceError("LICENCE_NOT_CONFIGURED", "The central licence key could not be fetched (no JWKS keys).")
    candidates = [k for k in keys if isinstance(k, dict) and k.get("kty") == "OKP" and k.get("crv") == "Ed25519" and isinstance(k.get("x"), str)]
    if kid:
        candidates = [k for k in candidates if k.get("kid") == kid] or candidates
    if not candidates:
        raise LicenceError("LICENCE_NOT_CONFIGURED", "The central licence key could not be fetched (no Ed25519 key).")
    try:
        return Ed25519PublicKey.from_public_bytes(_b64url_decode(candidates[0]["x"]))
    except Exception:
        raise LicenceError("LICENCE_NOT_CONFIGURED", "The central licence key could not be read.")


def verify_licence_token(
    token: str,
    public_key_pem: str | None = None,
    jwks_url: str | None = None,
    issuer: str | None = None,
    audience: str = LICENCE_AUDIENCE,
    now: float | None = None,
) -> dict[str, Any]:
    """Verify a licence token the way the API's verifyLicenceToken does:
    Ed25519 signature, expiry, and the organisation/plan claims — never a
    plain flag. The key order is the API's: an explicitly configured central
    public key (or JWKS) always wins. Returns the claims on success; raises
    LicenceError (LICENCE_INVALID / LICENCE_EXPIRED / LICENCE_NOT_CONFIGURED)
    otherwise. ``issuer`` is checked only when given: the shell does not pass
    it today (licence.js passes the token and the key, not the issuer), so a
    missing issuer is not a refusal — the signature is still the proof."""
    if not isinstance(token, str) or not token:
        raise _invalid("That licence token could not be verified.")
    parts = token.split(".")
    if len(parts) != 3:
        raise _invalid("That licence token could not be verified.")
    header_b64, payload_b64, signature_b64 = parts
    try:
        header = json.loads(_b64url_decode(header_b64).decode("utf-8"))
    except LicenceError:
        raise
    except Exception:
        raise _invalid("That licence token could not be verified.")
    if not isinstance(header, dict) or header.get("alg") != "EdDSA":
        raise _invalid("That licence token could not be verified.")
    if public_key_pem:
        key = _key_from_pem(public_key_pem)
    elif jwks_url:
        key = _key_from_jwks(jwks_url, header.get("kid") if isinstance(header.get("kid"), str) else None)
    else:
        raise LicenceError("LICENCE_NOT_CONFIGURED", "No licence verification key is configured on this engine.")
    try:
        key.verify(_b64url_decode(signature_b64), f"{header_b64}.{payload_b64}".encode("ascii"))
    except LicenceError:
        raise
    except Exception:
        raise _invalid("That licence token could not be verified.")
    try:
        payload = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
    except Exception:
        raise _invalid("That licence token could not be verified.")
    if not isinstance(payload, dict):
        raise _invalid("That licence token could not be verified.")
    now_s = time.time() if now is None else now
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or isinstance(exp, bool):
        raise _invalid("That licence token could not be verified.")
    expires_at = _parse_iso(payload.get("expires_at")) if isinstance(payload.get("expires_at"), str) else None
    if expires_at is None:
        raise _invalid("That licence token could not be verified.")
    if now_s >= min(float(exp), expires_at):
        raise LicenceError("LICENCE_EXPIRED", "That licence token has expired. Sign in again to refresh it.")
    if issuer is not None and payload.get("iss") != issuer:
        raise _invalid("That licence token could not be verified.")
    if payload.get("aud") != audience:
        raise _invalid("That licence token could not be verified.")
    organization_id = payload.get("organization_id")
    plan = payload.get("plan")
    features = payload.get("features")
    tokens = payload.get("tokens")
    if (
        not isinstance(organization_id, str) or not organization_id
        or not isinstance(plan, str) or not plan
        or not isinstance(features, list) or not all(isinstance(f, str) and f for f in features)
        or not isinstance(tokens, int) or isinstance(tokens, bool) or tokens < 0
    ):
        raise _invalid("That licence token could not be verified.")
    return {
        "organization_id": organization_id,
        "plan": plan,
        "features": list(features),
        "tokens": tokens,
        "expires_at": payload["expires_at"],
    }


def is_central_mode(env: Mapping[str, str] | None = None) -> bool:
    """Central mode is on when the deployment says so (OTSI_VIE_CENTRAL_MODE=yes,
    the same value the API's config reads) or a central server URL is
    configured (the desktop shell's case: it points at the central server
    without being the central server)."""
    env = os.environ if env is None else env
    if (env.get("OTSI_VIE_CENTRAL_MODE") or "").strip() == "yes":
        return True
    return bool((env.get("OTSI_VIE_CENTRAL_SERVER_URL") or "").strip())


def check_licence_for_job(job, env: Mapping[str, str] | None = None) -> dict[str, Any] | None:
    """Gate paid work at job start. Returns the verified licence claims when
    a token was presented (and matched the job's organisation), None when
    the job is not paid work or the engine is local-only with no token.
    Raises LicenceError when paid work must not run."""
    if job.kind not in PAID_KINDS:
        return None
    env = os.environ if env is None else env
    token = (env.get("OTSI_VIE_LICENCE_TOKEN") or "").strip()
    if token:
        claims = verify_licence_token(
            token,
            public_key_pem=(env.get("OTSI_VIE_LICENCE_PUBLIC_KEY_PEM") or "").strip() or None,
            jwks_url=(env.get("OTSI_VIE_CENTRAL_JWKS_URL") or "").strip() or None,
            issuer=(env.get("OTSI_VIE_JWT_ISSUER") or "").strip() or None,
        )
        if claims["organization_id"] != job.organization_id:
            raise _invalid("That licence token belongs to a different organization.")
        return claims
    if is_central_mode(env):
        raise LicenceError(
            "LICENCE_REQUIRED",
            "Central mode needs a licence token: sign in on the central server so the app can fetch one.",
        )
    return None
