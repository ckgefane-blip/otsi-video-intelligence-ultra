"""User-supplied access tokens for provider imports (ADR-027): sealed by the API with AES-256-GCM (OTSI_VIE_CREDENTIAL_KEY, base64 of 32
bytes), opened only by the worker when it imports, and deleted from the job as soon as the job settles. Never logged, never stored in clear."""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _key() -> bytes:
    raw = os.environ.get("OTSI_VIE_CREDENTIAL_KEY", "")
    key = base64.b64decode(raw) if raw else b""
    if len(key) != 32:
        raise RuntimeError("OTSI_VIE_CREDENTIAL_KEY is not configured (base64 of 32 bytes)")
    return key


def open_sealed(sealed: dict, associated: str) -> str:
    """`associated` binds the token to its video: a sealed token copied to another job does not open."""
    if sealed.get("v") != 1:
        raise ValueError("unknown sealed-credential version")
    nonce, ct = base64.b64decode(sealed["iv"]), base64.b64decode(sealed["ct"])
    return AESGCM(_key()).decrypt(nonce, ct, associated.encode()).decode("utf-8")


def seal(token: str, associated: str) -> dict:
    """Used by tests (the API seals in TypeScript with the same format)."""
    nonce = os.urandom(12)
    return {"v": 1, "iv": base64.b64encode(nonce).decode(), "ct": base64.b64encode(AESGCM(_key()).encrypt(nonce, token.encode(), associated.encode())).decode()}
