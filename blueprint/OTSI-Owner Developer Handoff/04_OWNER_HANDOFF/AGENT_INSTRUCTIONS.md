# Paste into Codex or Claude Code

Build OTSI Video Intelligence Engine as a greenfield commercial web platform following this package. **Visual authority:** 10 approved PNG pages. **Functional authority:** MySQL-based engineering specifications and 10 page MD specs. **Database authority:** a NEW, isolated `otsi_owner_vie` database on MySQL 8.4 LTS, NOT PostgreSQL; `phpMyAdmin` is only the administrative tool. Do not access/change existing databases. Verify the real database version (the screenshot alone does not prove it is MySQL 8.4 rather than MariaDB). If version incompatible, document the required hosting/runtime change before migrations.

1. Create new monorepo for Next.js/React/TypeScript frontend, NestJS/Fastify API, Python CV workers, FFmpeg/render worker, Temporal workflows, S3-compatible object store, deployment/monitoring and test suites.
2. Follow 00_START_HERE.md and MySQL adaptation. Translate the reference DDL into versioned migrations, validate with a disposable MySQL 8.4 container; repair syntax/integrity gaps before production. Do not execute archived PG files. No mock-based declaration of working AI.
3. Implement actual player detection for each visible on-field player independent of ball possession; shot-aware multi-object tracking; identity candidate scoring with uncertain states; human verification UI; grounded event/tactical metrics; reproducible tracking-linked spotlight compositor and encoded MP4; evidence/rights gates for every output.
4. Implement all 10 approved UI pages matching their layouts and actions, using real backend endpoints. Simulated fixtures may be used only in a visually marked developer/demo mode.
5. Build tenant isolation enforced by service authorization in every query and object-storage operation, since MySQL has no native PostgreSQL RLS. Test cross-tenant denial on every route/job/artifact.
6. Commercial administration, entitlements, quotas and signed webhook processing must be implemented with tests, not exposed as fake functionality.
7. Work in sequence with observable acceptance evidence per block, automated tests, security/load benchmarks and actual match footage tests. Never claim production ready before model evaluation, rights verification, backups/restore, real video output, and all release gates pass.

Start by reporting repository creation, MySQL version check, schema lint/migration validation results and first foundation build. Do not substitute old databases or prior engines.
