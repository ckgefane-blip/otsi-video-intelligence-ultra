# Codex / Claude Code — exact greenfield execution mandate

You are the implementation agent for OTSI Video Intelligence Engine **v2 greenfield commercial**. Build complete frontend AND backend AND database AND CV/production workers, not just a visual prototype. Use `../00_START_HERE.md` and the packages in precedence order. Never inspect/use older OTSI production DB as an implementation dependency. Work in clean repo, create actual source code and migrations with tests. Keep decisions in `docs/ADRs`, architecture alignment in `docs/TRACEABILITY.md`, and evidence in `release-evidence`.

## Mandatory first work
1. Generate repo layout from `REPOSITORY_MAP.md`. Pin runtime versions and license-appropriate model candidates; do not pretend approved weights exist.
2. Inspect the MySQL reference SQL (`01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/001..002`); the older PostgreSQL files 001..007 are not part of this handoff and are not used. Implemented as `otsi-vie/database/migrations/0001..`. [MySQL correction C-DOC-08] **Migrations are draft starters and must be schema-linted/tested, application-enforced tenant isolation-completed before use**. Resolve references/foreign keys and ensure schema name, permissions and migration order. Show `make db-check` output before application code.
3. Build auth, tenant isolation, migrations, outbox, S3 and durable workflows. Wire a first test with actual source footage and player boxes; no fake finished states.
4. Implement UI images faithfully as React components; 10 pages, no screenshot-as-background. Render with all real state types, and allow DEMO-labelled seeded fixture data only on demo org accounts.
5. Implement CV, render and reports against real video and measure quality. Fail closed when no usable model/rights evidence.
6. Build billing, admin, usage limits, observability, CI/CD and launch gates. No production-ready label until every gate is signed.

## Agent workflow: no ambiguity
For each backlog block: record migration/schema changes, real API contracts, Python/TS sources, unit/integration/e2e tests, one traced video artifact when applicable, screenshots and required human checks. Commit block with acceptance record. Blocked external dependencies documented in `BLOCKERS.md`, never swapped to silent mock. At any point, user can run stack locally and inspect status. Do not delete previous finished blocks.

## Quality stop conditions
Unknown player identity => unresolved; no video-derived speed without valid homography; RED/unapproved clip => no external export; when tracking ends beam disappears or render blocked; expired right => no signed URL; unpaid/no quota => no new expensive tasks; successful render => actual decodable MP4; webhook replay => no duplicate plan activation. Each failure must have test.
