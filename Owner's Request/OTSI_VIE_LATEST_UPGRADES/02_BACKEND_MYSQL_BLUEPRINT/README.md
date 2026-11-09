# OTSI VIE — Back-end & MySQL Blueprint v2

This is the back-end and database that feeds the **ten corrected OTSI VIE UIs**. It is built on the *OTSI-Owner Developer Handoff* MySQL reference schema, keeping its decisions and fixing its defects (BACKEND_BLUEPRINT §9).

**Validated:** all 14 migrations run cleanly on **MySQL 8.4.13**, and **49/49** behavioural tests pass.

## Read in this order
1. `docs/BACKEND_BLUEPRINT.md`
   - architecture, conventions, modules, end-to-end flows
   - realtime, performance, security, error mapping
   - gap analysis versus the handoff, and owner decisions still needed
2. `docs/API_CONTRACT_BY_PAGE.md` — every endpoint each page calls, its DTO and the table/view behind it.
3. `docs/UI_FIELD_TO_DATA_SOURCE_MAP.csv` — every displayed UI field (159 fields, from the UI spec's DATA_CONTRACT_MATRIX) mapped to its MySQL column/view and endpoint.
4. `docs/DATA_DICTIONARY.md` — all 151 tables, with columns, types, FKs, indexes and CHECKs, generated from the live validated database. Column comments name the UI element each column feeds.
5. `docs/ERD.md` — Mermaid entity-relationship diagrams per module.
6. `docs/VALIDATION_REPORT.md` — what was executed and proven, and what is still untested.

## SQL
| File | Use |
|---|---|
| `sql/001…014_*.sql` | Versioned migrations, run in numeric order (recommended: run them through your migration tool) |
| `sql/otsi_owner_vie_ALL_IN_ONE.sql` | The same 14 files concatenated, for a one-shot phpMyAdmin import into an **empty** server/schema |
| `tests/behaviour_tests.sql` | Run on a disposable copy after migrating. It creates `otsi_test` and synthetic tenants. **Never run it on production.** |
| `sql_src/` + `tools/build_sql.py` | Source with type macros (`ID36`, `TS6`, `EVSTATE`…). Edit here, rebuild with `python tools/build_sql.py` |

## Safety
- The schema is the greenfield `otsi_owner_vie`. **Do not run it against an existing database or your current engine DB.**
- First check the target: `SELECT VERSION();` must report MySQL 8.4.x (not MariaDB).
- Accounts and passwords come from your secrets manager (`014_roles_least_privilege.sql` creates roles only).
- No sample people, clubs, matches or statistics are seeded. Only configuration (formats, stages, event types, metric definitions, presets) is included.
