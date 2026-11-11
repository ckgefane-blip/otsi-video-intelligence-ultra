# ADR-143: Windows Hello / passkey (WebAuthn) sign-in — biometric sign-in without typing email + password (DRAFT, owner approval pending, ultra-only)

- **Status:** Draft. This ADR records the passkey build on `muse/ultra-main`; it needs owner approval before it is
  presented as accepted. It changes no accepted ADR. **Ultra-only:** the number 143 is the next free number in ultra
  (ultra is at ADR-142 after the Scouting Pack). Antigravity's repo is at ADR-138 as far as ultra can see; this build
  is written from the owner's request and the existing ultra code alone — no Antigravity code was read or copied — and the two
  must never be merged (see the migration collision note in §1).
- **Date:** 2026-11-11 (Muse, `muse/ultra-main`)
- **Scope:** The owner asked (2026-11-11 09:54) for biometric and any other sign-in options on the login/signup page
  "so that user don't have to manually type login and password each single time", and chose the build on 2026-11-11 10:44
  ("Build Windows Hello / passkey sign-in"). This build puts the mechanism in place. Password sign-in stays as the
  fallback and recovery path. There is still no self-service forgot-password flow — that is not part of this ADR.

## 1. Numbering: migration 0074

Ultra is at migration 0073 (Scouting Pack). Antigravity used 0067, 0068, 0069 **and 0070** in their own repo for
different things. This build uses **0074** because it is the next number free in ultra as far as ultra can see.
The migration file records this, and the warning stands: a future collision is still possible if their series
reaches 0074 for something else. If that ever happens, the merge is the problem, not this number — never renumber
a migration that has run anywhere.

## 2. Decisions

### What it is

- **A WebAuthn passkey** — created with Windows Hello (fingerprint, face or PIN) on the owner's machine — that signs
  the person in without typing email + password. The server stores only the public half: the credential ID, the COSE
  public key (base64url), and the signature counter. A private key is never stored, sent, or logged — it never leaves
  the authenticator.
- **Password stays.** The password form is the fallback everywhere (sign-in page and recovery), and a passkey can be
  removed in Settings → Security. Removing a passkey never locks the user out — the password still works.

### Relying party (RP)

- The desktop app runs on `http://localhost:4311`, a loopback origin, which is a secure context for WebAuthn.
- RP ID is configurable (`OTSI_VIE_WEBAUTHN_RP_ID`, default `localhost`); RP name is "OTSI VIE"
  (`OTSI_VIE_WEBAUTHN_RP_NAME`). The RP ID is `localhost` — **never `127.0.0.1`: Chromium rejects `127.0.0.1` as a
  WebAuthn RP ID (`SecurityError: 127.0.0.1 is an invalid domain`), while `localhost` is a valid domain.** The app
  therefore serves the web and the API on `localhost` (not `127.0.0.1`) — `backend.js` `WEB_URL`/`API_URL`,
  `local_stack.py` `OTSI_VIE_API_INTERNAL_URL`, and this RP ID all use `localhost`. (MySQL stays on `127.0.0.1` — it
  is plain TCP and WebAuthn never sees it. The JWT issuer is also left on `127.0.0.1` so existing sessions keep working.)
  The RP ID is a loopback host, never a public domain, so a passkey created here cannot be used to sign in to any
  other site.
- Expected origin = the configured `allowedOrigins`, else the request's loopback origin, else `http://127.0.0.1:4311`.
- No `authenticatorAttachment` restriction (platform and cross-platform authenticators both allowed);
  `userVerification: required`; attestation `none` (no attestation statement is collected or stored).

### Challenges and verification

- Challenges are stored server-side (`webauthn_challenges`), single-use, and expire after ~5 minutes. A challenge is
  consumed (deleted) **before** the signature is checked, so a failed attempt cannot be replayed with the same challenge.
  Registration challenges are tied to the signed-in user; login challenges are tied to the email the sign-in started with.
- The signature counter is the clone detector: on every login the authenticator's counter must be higher than the stored
  one. A counter that goes backwards means the credential may have been cloned, so the login is rejected
  (`401 WEBAUTHN_COUNTER_REJECTED`) and the stored counter is left untouched — the user removes the passkey in Settings.
- Any other verification failure is the generic `401 WEBAUTHN_VERIFICATION_FAILED` (no enumeration of which check failed).

### Who can use a passkey

- A passkey login only succeeds for a verified (non-provisional) user — the same bar password sign-in sets: the user must
  have completed account setup (a row in `local_credentials`). An invited-only user has none, so a passkey cannot sign
  them in.
- A passkey login bypasses two-step sign-in. Possession of the authenticator + a biometric/PIN (`userVerification:
  required`) is at least as strong as password + authenticator code, so asking for a code as well adds friction without
  adding security.

### Session

- A successful passkey login issues a session through the same `issue()` path as password login — identical refresh
  cookie (14-day) and access token. Nothing about the session changes.

## 3. Endpoints and UI

- API (`apps/api/src/modules/auth/webauthn.ts`, migration 0074): `POST /v1/auth/webauthn/register/options`,
  `POST /v1/auth/webauthn/register/verify`, `POST /v1/auth/webauthn/login/options`,
  `POST /v1/auth/webauthn/login/verify`, `GET /v1/auth/webauthn/credentials`,
  `DELETE /v1/auth/webauthn/credentials/:id`. Contracts in `packages/contracts/src/webauthn.ts`.
- Web: a "Sign in with Windows Hello" button on the sign-in page, shown only when the browser reports WebAuthn support
  (otherwise a clear message that passkeys are not supported here and the password should be used); a Passkeys section
  in Settings → Security (list, add with a device-name field, remove per passkey). All new strings are in the
  dictionaries in EN/RU/ES/DE/FR.

## 4. What is not verified here

- The API tests (`apps/api/test/webauthn.api.test.ts`) typecheck clean but cannot run on this VM — they need the owner's
  host MySQL 3507. They cover challenge issue, bad attestation (401, no crash), no-enumeration on login/options, expired
  challenge, counter-backwards rejection (with a real hand-built ES256 assertion, so the rejection proves the counter
  check), counter-forward sign-in + counter update, single-use replay rejection, and list/delete.
- Migration 0074 has not been applied anywhere; it applies automatically on the app's first run after pull.
- No live Windows Hello sign-in has been clicked through — the manual test (register in Settings, sign out, sign in with
  Windows Hello, confirm the session sticks, remove the passkey) must be done on the owner's machine.
