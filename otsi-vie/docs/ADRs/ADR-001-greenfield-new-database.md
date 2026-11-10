# ADR-001: Greenfield new database

Status: reconstructed (2026-11-10) — see Recovery note; not an original ADR file.

## Context
The OTSI Video Intelligence Engine is a new commercial application, not an
extension of an existing OTSI product. The owner's handoff establishes a
greenfield build with its own data store, and the agent rules record the
owner's explicit choice of a new isolated MySQL database, not PostgreSQL
(`CLAUDE.md` §1–§2). Existing OTSI databases and deployments must not be
read, modified, or overwritten.

## Decision
Build a **new, isolated MySQL 8.4 database** for VIE (proposed name
`otsi_owner_vie`), greenfield. Do not reuse, migrate into, or connect to an
existing OTSI database. No PostgreSQL in the deployable application.

## Evidence and alternatives
Alternatives recorded in the rules: reusing an existing OTSI database
(forbidden — never DROP, TRUNCATE, or overwrite existing databases) and
PostgreSQL (rejected by owner decision). As built: the foundation commit
(`3f7a7de`) lands corrected MySQL 8.4 migrations 0001–0005 with the migrator,
roles, and DB tests; the migration series runs 0001–0066.

## Recovery note
No original ADR-001 file exists in this repository: `otsi-vie/docs/ADRs/`
starts at ADR-011, and the git history contains no add or delete of an
ADR-001 file. This file is a reconstruction written 2026-11-10 from the
decision log in
`blueprint/OTSI-Owner Developer Handoff/01_COMMERCIAL_MASTER_BLUEPRINT/01_STACK_AND_DECISIONS.md`
("ADR-001 greenfield new database") and the corroborating passages cited
above. The original date, author, and alternatives considered beyond those
recorded here are not stated anywhere found and are not invented.

Numbering conflict on record: a second blueprint document,
`blueprint/OTSI-Owner Developer Handoff/04_REFERENCE_ARCHITECTURE_MYSQL/REPOSITORY_AND_BLOCK_BY_BLOCK.md`,
lists a different ADR-001–012 mapping (there ADR-001 is "API runtime",
ADR-011 "renderer technology", ADR-012 "deployment topology and SLOs").
That mapping conflicts with the decision log used here, with the
cross-references to ADR-002, ADR-007, ADR-009, and ADR-010 in the blueprint
and product docs, and with the actual ADR-011 and ADR-012 files. It is not
used here; the conflict is recorded for the owner to resolve.
