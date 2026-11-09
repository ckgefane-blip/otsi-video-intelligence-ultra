# Validation report — OTSI VIE MySQL schema v2

| Item | Result |
|---|---|
| Server | MySQL **8.4.13** (official `mysql:8.4` Docker image), disposable container, no host port exposed |
| Server settings | `sql_mode` = ONLY_FULL_GROUP_BY, STRICT_TRANS_TABLES, NO_ZERO_IN_DATE, NO_ZERO_DATE, ERROR_FOR_DIVISION_BY_ZERO, NO_ENGINE_SUBSTITUTION · charset utf8mb4 / utf8mb4_0900_ai_ci · InnoDB |
| Migrations 001–014 | Executed in order on an empty server: **0 errors** |
| Objects created | 151 tables · 1,537 columns · 357 foreign keys · 116 CHECK constraints · 615 indexes · 18 views · 24 triggers · 2 stored procedures · 4 roles |
| Seed (configuration only) | 15 positions · 8 supported formats · 12 pipeline stage definitions · 21 event types · 27 metric definitions · 3 export presets · 12 effect presets · 1 platform organization |
| Behavioural tests | `tests/behaviour_tests.sql` → **49 / 49 passed** (output in `tests/behaviour_tests_RESULT.txt`) |

## What the tests prove (each is a real INSERT/UPDATE/CALL against the schema)
1. **Tenant isolation in the database.** A video can't reference another tenant's project, and a project creator must be a member of the same tenant (composite FKs).
2. **Video lifecycle.**
   - States can't be skipped.
   - INGESTED is impossible without probe metadata. This test found a real NULL-in-CHECK hole, which is now fixed.
   - The generated fps column is correct.
3. **Pipeline runs.**
   - Illegal transitions are blocked, and progress can't go backwards.
   - SUCCEEDED requires 100%, and FAILED requires a failure code.
   - Ingest options lock when a run starts.
4. **Identity.**
   - A track can't be CONFIRMED without a player.
   - HUMAN decisions need a reviewer, and AUTO_POLICY decisions need a policy version.
   - Decisions are append-only, and confirmed decisions project onto `tracks`.
5. **Evidence.**
   - NOT_MEASURED cannot carry a number, and measured states must carry one.
   - Metre values without a pitch calibration are rejected.
6. **Reels.**
   - A spotlight target must cite a CONFIRMED decision for the same player.
   - Illegal status jumps are blocked, and slider values are bounded.
   - A STAT overlay must bind to a real metric, so typed numbers are rejected.
7. **Render jobs.**
   - Illegal transitions are blocked.
   - SUCCEEDED requires output, manifest and 100%.
   - Saved revisions are immutable, and idempotency keys are unique per tenant.
8. **Canonical OTSI Player ID allocator.**
   - Produces the format `OTSI-NGA-2026-000001`, then `…000002`.
   - Re-allocation and malformed IDs are rejected.
9. **Governance.**
   - URL fetch is blocked without SSRF and terms checks.
   - A scout can't verify their own assessment.
   - Policy decisions are append-only.
   - Saved-search JSON is schema-validated.
10. **Read models.** Views compile, return rows for the right tenant only when filtered, list the 7 UI pipeline stages, and derive age (never stored).

## Not validated (must be done by the developer)
- **Load and performance.** No volume benchmarks were run; the index design is reasoned, not measured. Run them with realistic match volumes (see the BACKEND_BLUEPRINT §6 sizing guide).
- **Concurrent-transaction behaviour.** Test the allocator, quota reservations and the outbox `SKIP LOCKED` dispatcher under parallel load.
- **Hosting and replication.** Not tested on MariaDB or managed MySQL services (Aurora, Cloud SQL, Azure). Replication/binlog PITR and backup restore drills were not tested.
- **Least-privilege accounts.** Roles were created, but the per-account grants were not exercised by a connected application.
- **Application layer.** The API, workers, UI wiring, SSE and object-storage signing do not exist yet; this is the data contract they must implement.
