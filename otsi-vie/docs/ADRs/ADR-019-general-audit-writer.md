# ADR-019: One general audit writer for every module

Status: accepted (2026-10-26)

## Context
F59 requires "mutation -> immutable event" with traceable lineage. `audit_events` is append-only in the database (ADR-013), but the API wrote it from an identity-specific helper inside the players service, with no actor kind (background services have no user row), no request correlation, and no protection against secrets in before/after states.

## Decision
1. **One writer:** `apps/api/src/core/audit.ts`. `writeAudit(executor, actor, entry)` appends a row; `recordChange(executor, actor, change)` appends the row **and** publishes the matching outbox event with the same executor, so audit row, event and business change commit or roll back together. Modules never INSERT into `audit_events` themselves (the two stored procedures of ADR-016 are the only other writers and use the same shape).
2. **Actor** (migration 0009): `actor_kind` USER (requires `actor_id`) / SERVICE / SYSTEM (require `actor_service`, e.g. `outbox-dispatcher`); CHECK-enforced. `userActor(principal)` carries the request id.
3. **Correlation:** every API response carries `X-Request-Id`; the same id is stored in `audit_events.request_id`. Background actions use a component-specific id (e.g. `outbox:<event id>`).
4. **Shape:** action = dotted lower-case verb phrase (`track.identity_corrected`), CHECK-enforced in MySQL and validated in code; entity type lower-case identifier; entity id UUID or NULL.
5. **Privacy:** before/after states pass through `redact()` — credential-like keys (password, secret, token, authorization, api_key, private_key, card_number, cvv, iban, ...) become `[REDACTED]`, secrets inside strings are masked. States over 64 KiB are replaced by a size marker; audit rows describe changes, they do not archive documents.
6. **Reading:** `GET /v1/audit-events` (OWNER, ADMIN; `entity_type`, `entity_id`, `action`, keyset paging `before_id`, `limit` ≤ 200). The organization filter is in SQL; another tenant's rows are never loaded. Index `idx_audit_entity_time`.
7. **Immutability** stays as ADR-013: the runtime account has SELECT + INSERT only; triggers refuse UPDATE always and DELETE except for the retention account.

## Not decided here
Auditing of reads/denied requests (security event log) and the platform-administrator audit console are later work (F55/F59, block 15). Audit-log access itself is restricted to OWNER/ADMIN; whether reads of the audit log are themselves audited is recorded as an open item in the threat model.

## Evidence
`apps/api/test/audit.api.test.ts` (7 tests): user/org/request id/before-after rows and the outbox events written by a real track correction; redaction; malformed entries refused; oversized state marker; audit + outbox commit-or-neither; runtime account cannot UPDATE/DELETE (1142); tenant isolation and role matrix of the read API; paging and query validation. `tests/db/test_behaviour.py`: actor and action CHECKs.
