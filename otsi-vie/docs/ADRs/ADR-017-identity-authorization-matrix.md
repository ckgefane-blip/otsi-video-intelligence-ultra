# ADR-017: Who may do what with player identity (authorization matrix)

Status: accepted (implements the owner directive of 2026-10-26, Part 8, test 15)

## Context
The canonical OTSI Player ID (ADR-016) lives in one registry shared by every organization, but the people who use it belong to tenants. A tenant must be able to build its own rosters and identify players in its own footage. It must not be able to see another tenant's unverified records, edit another tenant's tracks, or rewrite the shared registry that all tenants rely on.

## Decision
1. **Who you are.** Every request carries an RS256 access token, verified for signature, issuer, audience and expiry. A failure returns 401 (`UNAUTHENTICATED` / `INVALID_TOKEN`).
2. **Which organization you act for.** The `X-Organization-Id` header names the organization. The API trusts it only after it finds an ACTIVE membership for that user in that organization; otherwise it returns 403 `NOT_A_MEMBER`. The role comes from that membership row, never from the token, so revoking or changing a membership takes effect on the next request.
3. **Matrix** (403 `ROLE_NOT_ALLOWED` when the role is missing):

| Action | Roles | Scope |
|---|---|---|
| Create a provisional player (`POST /v1/players`, Idempotency-Key) | OWNER, ADMIN, ANALYST, EDITOR, SCOUT | Owned by the creating organization |
| Read a player (`GET /v1/players/:id`, `/by-otsi-id/:id`) | any member | REGISTERED, RETIRED or MERGED: every organization. PROVISIONAL: only the creating organization (404 elsewhere, so the record's existence does not leak) |
| Register: issue the permanent ID (`POST …/registration`, Idempotency-Key) | OWNER, ADMIN | Only the creating organization's provisional players |
| Merge a provisional duplicate into a registered player | OWNER, ADMIN | The duplicate must be the organization's own provisional record |
| Merge two registered players | platform administrator only | 403 `PLATFORM_ADMIN_REQUIRED` to every tenant. A tenant may not change the shared registry. The platform-admin flow is a later block (F59) |
| Read a track's identity | any member | Only tracks whose processing run belongs to the organization (404 otherwise) |
| Decide or correct a track's identity | OWNER, ADMIN, ANALYST | Same track scope. Corrections need `supersedes_id` = the current decision (409 `STALE_DECISION`) and a reason. The target must be a live player |

4. **Defence in depth.** The database independently enforces what it can: composite tenant keys, the runtime account's column-level grants, and triggers on IDs, merges and decisions. Database refusals are mapped to the same stable codes, so a rule broken at either layer produces the same answer.

## Evidence
`apps/api/test/identity.api.test.ts`: 11 tests through the real HTTP stack, a fresh migrated database, and the least-privilege runtime account. Evidence: `release-evidence/block-01-identity-api/`.

## Consequences
Platform-level registry stewardship (merging registered players, retiring IDs) needs its own audited admin surface; it is tracked as part of F59 and is not reachable from tenant roles.
