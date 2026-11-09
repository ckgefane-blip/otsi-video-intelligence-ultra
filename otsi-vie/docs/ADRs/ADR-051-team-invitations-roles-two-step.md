# ADR-051 — Team invitations, roles per person, and two-step sign-in

**Date:** 2026-11-05 · **Status:** implemented; API, database and unit tests pass · **Owner request:** roadmap Step 1, "Start Step 1"
(invite a user by e-mail link, choose their role, remove them; 2-step sign-in with an authenticator app, free, no SMS)

## Decision
- **Invitations (migration 0036 `organization_invitations`).** An owner or admin invites an e-mail address with a role. The link is
  `https://<app>/invite#<token>`: a random 256-bit token, stored only as its SHA-256, valid 7 days, used once, withdrawable. Inviting
  the same address again replaces the old link. The token sits after `#`, so it never reaches a server log, the tunnel or the proxy.
- **No mail service (ADR-030, zero cost).** The API sends no e-mail. The inviter copies the link, or "Open in my e-mail" hands a ready
  message to their own mail app (`mailto:`). A free SMTP relay can be added later without changing the API.
- **Accepting.** A new person chooses a name and a password (12+ characters) and is signed in (`POST /v1/auth/invitations/accept`, same
  CSRF and origin rules as sign-in). An address that already has an account signs in first and accepts with one click
  (`POST /v1/invitations/join`); the account's e-mail must be the invited one.
- **Roles.** The six existing membership roles; what each may do is the API's existing `@Roles` rules, summarised for the screen in
  `ROLE_SUMMARY` (contracts). Rules enforced by the API: only OWNER / ADMIN manage the team; an admin never gives, changes or removes
  the owner role; nobody changes or removes themselves (another owner does), so an organization always keeps an owner (also checked in
  the transaction). Removing a member deletes the membership row; access ends on their next request because the AuthGuard reads the
  membership every time. What they made stays with the organization. Every change is audited.
- **Two-step sign-in (migration 0037 `user_totp`, `user_recovery_codes`).** RFC 6238 codes (HMAC-SHA1, 30 s, 6 digits, one step of
  drift) written with Node's crypto (`core/totp.ts`, checked against the RFC test vectors). The secret is sealed with AES-256-GCM, key
  derived from the installation's sign-in signing key, user id bound as associated data. A code works once (`last_used_step`). Ten
  recovery codes, SHA-256 only, each once. Switching on needs the password and a code; off needs the password and a code.
- **Sign-in with two-step on.** The right password returns `{mfa_required, mfa_token}` and no cookie. The token is a 5-minute JWT
  signed with the same key for the audience `<audience>#two-step`, so the AuthGuard can never accept it as an access token. It is
  exchanged with a code at `POST /v1/auth/login/two-step`. Wrong codes count toward the same lockout as wrong passwords (5: 15 minutes).
- **Screens.** Account menu: "Team and roles" (owners and admins) → `/settings/team`; "2-step sign-in" → `/settings/security`. The public
  page `/invite`. The sign-in page gains the code step. The ten approved pages and the header are unchanged.
- **New dependency:** `qrcode` 1.5.4 (MIT) draws the set-up QR picture on the server as a PNG data URL (the page policy already allows
  `data:` images). Licence gate passes.

## Consequences and limits
- Rotating the sign-in signing key makes the stored secrets unreadable: people with two-step on would use a recovery code, then set it
  up again. Key rotation must re-seal the secrets first (Block 15 item).
- Organization-wide "two-step required" and a password-reset link are not built (a reset needs e-mail; same zero-cost limit).
- An installation using an external OIDC provider has no local password, so the accept-with-password and two-step routes are not
  mounted; that provider handles both.

## Tests
- `apps/api/test/team.api.test.ts` (9): link, hash only, single use, withdrawn, expired, replaced, existing account, roles and owner
  rules, removal ends access, tenant isolation, two-step set-up, code sign-in, replay refused, recovery codes, lockout, switching off.
- `apps/api/test/totp.test.ts` (4): RFC 6238 vectors, drift window, base32, sealing bound to user and key.
- `tests/db`: schema inventory regenerated with exactly the three new tables; minimal-row test covers them.
