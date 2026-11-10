# ADR-002: Tenant data isolation

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
VIE is multi-tenant: several organizations' videos, players, and analyses
share one database. MySQL has no row-level security and no `SET LOCAL`
session claims, so the PostgreSQL-style isolation in the original blueprint
could not be used as written
(`blueprint/CORRECTIONS.md`, C-DOC-04).

## Decision
Tenant isolation is enforced in the **API service layer**: every query is
scoped by the authenticated organization. The database itself refuses
cross-tenant links through **composite tenant foreign keys** (migration
`0003_tenant_integrity`). No generic service-account bypass for user traffic.

## Evidence and alternatives
Alternatives recorded in the corrections: DB session-scoped tenant claims
(`SET LOCAL app.tenant_id` with `WITH CHECK` policies) — not available in
MySQL, rejected. As built and tested: 27 composite tenant foreign keys and
`UNIQUE(id, organization_id)` constraints (migration 0003), with
cross-tenant tests (`blueprint/CHANGELOG.md`, 2026-10-26). Later refinements:
ADR-015 (least-privilege DB roles) and ADR-017 (identity authorization
matrix).

## Recovery note
No original ADR-002 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-002 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-002 tenant data isolation") and the corroborating passages cited
above. The original date, author, and alternatives considered beyond those
recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-002 is "durable queue",
ADR-007 "tenant isolation"). That mapping conflicts with the decision log
used here, with the cross-references to ADR-002, ADR-007, ADR-009, and
ADR-010 in the blueprint and product docs, and with the actual ADR-011 and
ADR-012 files. It is not used here; the conflict is recorded for the owner
to resolve.
