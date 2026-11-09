# ADR-021: Local sign-in (built-in auth adapter) until an external OIDC provider is chosen

Status: accepted (2026-10-26)

## Context
The owner must be able to open OTSI VIE and use it for real (ADR-020). Every API route already requires an RS256 access token for a configured issuer and audience plus an ACTIVE membership (ADR-017). Which external identity provider to use in production is an open owner decision (threat model, open decision 2). The deployment baseline lists an `auth-adapter` component.

## Decision
1. **Built-in issuer.** When `OTSI_VIE_LOCAL_SIGNING_KEY_FILE` is set, the API also *issues* the access tokens it verifies: RS256, 15-minute lifetime, issuer/audience from configuration, `sub = users.external_subject` (`local:<user id>`). The AuthGuard is unchanged; switching to an external OIDC provider means removing the key and setting `OTSI_VIE_JWKS_URL` — no API or UI change.
2. **Passwords** (`local_credentials`, migration 0010/0011): scrypt N=2^15, r=8, p=1, per-password salt, parameters in the stored hash; length policy 12-256 (NIST 800-63B). Same 401 and similar timing for unknown email and wrong password (dummy hash). 5 consecutive failures lock the credential for 15 minutes.
3. **Sessions** (`auth_sessions`): opaque 256-bit refresh token in an HttpOnly, SameSite=Strict, Path=/ cookie (`__Host-` and Secure except on a plain-HTTP local machine); only its SHA-256 is stored. Every refresh rotates it. A rotated token presented again **after** a 20-second grace window revokes the whole family (`REUSE_DETECTED`); **within** the window it is treated as a lost response (the browser aborted the request after the server rotated — observed in e2e with fast reloads) and continues the family. Logout revokes the family.
4. **CSRF.** Login, refresh and logout require `X-OTSI-CSRF: 1` and, when an Origin is sent, an allowed origin. The web app reaches the API only through its own origin (`/api/*` proxy), so cookies are first-party and the CSP `connect-src` is `'self'`. The access token lives in memory only (never localStorage).
5. **First owner.** `bootstrap-owner` (CLI; `tools/dev/local_stack.py bootstrap-owner`) creates the first organization, its OWNER and the credential, audited as SYSTEM `bootstrap`; it refuses once an organization exists unless explicitly told to add another. Self-service registration and invitations are F01 (later).
6. **`GET /v1/me`** (account-level, no organization header) lists the user's ACTIVE memberships; the web app picks the organization (remembered per browser, always validated).

## Not yet (tracked)
MFA for OWNER/ADMIN (threat model 3.1), password change/reset flows, breached-password blocklist, per-IP rate limiting at the edge, security-event audit for sign-ins (audit rows are organization-scoped; sign-in events are kept in `auth_sessions` / `local_credentials` for now).

## Evidence
`apps/api/test/auth.api.test.ts` (11): bootstrap, login, no enumeration, CSRF/origin, lockout (found and fixed a MySQL SET-ordering bug that locked after 4 failures), rotation with grace and reuse detection, logout, hash-only storage, membership-less accounts. `tests/db/test_behaviour.py`: credential and session CHECKs (found the case-insensitive e-mail check, fixed by 0011). `apps/web/e2e/shell.spec.ts`: sign-in redirect and return, wrong password message, open-redirect refusal, profile and sign-out, reload keeps the session, no token readable by scripts.
