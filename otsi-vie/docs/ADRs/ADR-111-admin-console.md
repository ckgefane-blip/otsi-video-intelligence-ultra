# ADR-111: Admin Console for Governance, Models, Concurrency, and Security Audit

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.3: Admin Console
- **Migration:** None (Introspection & runtime orchestration)

## Context

OTSI VIE v2 organizations need high-level governance and operational control over system resources, models, workers, and audit compliance without requiring raw database access or command-line scripting:
1. **Members & Roles Governance:** Visibility into all organization users, their assigned roles (`OWNER`, `ADMIN`, `ANALYST`, `EDITOR`, `SCOUT`, `VIEWER`), 2FA enforcement status, and join dates.
2. **Model Registry & Weights Introspection:** Centralized introspection of all computer vision, tracking, pitch calibration, and audio models defined in the worker registry (`registry.json`), including family, task, license, adapter, and verification of local weights files on disk.
3. **Worker Groups & Concurrency Controls:** Real-time visibility into running worker nodes, active jobs, and queued items across worker queues (`jobs-media`, `jobs-analysis`, `jobs-ingest`). Ability for administrators to adjust concurrency caps (`max_concurrent_renders`, `max_concurrent_analysis`, `max_concurrent_ingest`) and toggle global queue pausing.
4. **Security & Audit Trail:** Immutable log of system actions, role adjustments, deletions, and administrative mutations, with search and actor/entity filtering.

## Decision

1. **Contracts (`packages/contracts/src/admin.ts`):**
   - Defined Zod schemas:
     - `AdminMember`: `user_id`, `display_name`, `email`, `role`, `is_owner`, `two_step`, `created_at`.
     - `AdminOrganizationStats`: `id`, `name`, `created_at`, `member_count`, `video_count`, `reel_count`, `storage_bytes`.
     - `AdminModelEntry`: `key`, `task`, `family`, `adapter`, `source`, `revision`, `weights_license`, `status`, `files`.
     - `WorkerGroupStatus`: `group_name`, `kinds`, `active_workers`, `queued_jobs`, `running_jobs`.
     - `AdminConcurrencySettings`: `max_concurrent_renders`, `max_concurrent_analysis`, `max_concurrent_ingest`, `queue_paused`.
     - `AdminAuditEntry`: `id`, `occurred_at`, `actor_kind`, `actor_id`, `actor_name`, `action`, `entity_type`, `entity_id`, `request_id`, `before_state`, `after_state`.
     - `AdminDashboard`: Aggregates organization, members, models, worker groups, concurrency, recent audit, and system host resources.
   - Exported through `packages/contracts/src/index.ts`.

2. **Backend API (`apps/api/src/modules/admin/admin.ts`):**
   - Implemented `AdminController` and `AdminService` with strict `@Roles("OWNER", "ADMIN")` guard.
   - Endpoints:
     - `GET /v1/admin/dashboard`: Returns aggregate dashboard state.
     - `GET /v1/admin/members`: Organization members list with two-step auth status joined via `user_totp`.
     - `GET /v1/admin/models`: Introspects `registry.json` and verifies local weight files under `.local/models` and `models`.
     - `GET /v1/admin/concurrency` & `PATCH /v1/admin/concurrency`: Returns and updates runtime concurrency limits.
     - `GET /v1/admin/audit`: Filterable security audit trail with pagination.
   - Registered in `apps/api/src/app.ts`.

3. **Web UI (`apps/web/src/components/admin/AdminConsole.tsx` & `/settings/admin`):**
   - Created full-featured tabbed governance interface:
     - **Overview:** 6 KPI metric cards (Members, Videos, Storage, Workers, AI Models, Queued Jobs) + host hardware specs (CPU count/usage, RAM usage, GPU device name) and active worker queues.
     - **Members & Roles:** Member directory with role badges and 2FA status indicators.
     - **Model Registry:** Model table displaying task, family, license, runtime adapter, and weights verification status.
     - **Concurrency & Workers:** Interactive sliders for renders, analysis, and ingest caps, pause toggle, and apply button calling `PATCH /v1/admin/concurrency`.
     - **Security & Audit:** Searchable audit trail table with action tags, actor identification, and JSON state mutation diffs.
   - Added navigation link in `apps/web/src/components/shell/ProfileChip.tsx` and command in `apps/web/src/lib/commands.ts`.

4. **Verification & Testing:**
   - API unit & integration tests in `apps/api/test/admin.api.test.ts` (6 tests passing).
   - Web component vitest suite in `apps/web/test/adminConsole.test.tsx` (3 tests passing).
   - Web command palette tests updated in `apps/web/test/commands.test.ts` (4 tests passing).
   - Full Next.js production build succeeded (`/settings/admin` static route).
   - End-to-end headless browser verification via Playwright across all 5 console tabs on running local stack.

## Consequences

- Organization owners and administrators have an integrated, broadcast-grade dashboard for infrastructure and model introspection.
- Safe concurrency adjustments can be made at runtime without restarting worker processes.
- Audit trail visibility supports compliance and transparency across team operations.
