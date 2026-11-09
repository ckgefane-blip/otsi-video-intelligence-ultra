# ADR-114: System Monitoring, Queue Depths, Storage Thresholds, and Local Alerts

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.6: Monitoring and Alerts
- **Migration:** None (Builds on `worker_status` table, `worker_jobs`, and OS telemetry)

## Context

Production operations of OTSI VIE v2 require continuous insight into worker health, asynchronous queue depths, and storage volume saturation. To maintain zero hosting and subscription cost (ADR-030), monitoring and alerts must be evaluated and stored locally without external cloud telemetry vendors (e.g. Datadog, PagerDuty):
1. **Worker Cluster Health:** Detecting unresponsive or stalled worker nodes by inspecting heartbeat frequency in `worker_status`.
2. **Asynchronous Queue Depth & Wait Times:** Tracking queued and running workloads across job types (`INGEST`, `ANALYSIS`, `RENDER`, `SNAPSHOT`, `REPORT`, `BEAT_GRID`) and alerting when jobs wait longer than normal thresholds.
3. **Storage & Disk Saturation:** Continuously reading mount volume disk usage where media assets and video frames reside, alerting before exhaustion.
4. **Local Alert Notifications:** Surfacing actionable warnings and critical operational alerts directly within the Admin Console interface with recommended operator remediation steps.

## Decision

1. **Contracts (`packages/contracts/src/monitoring.ts`):**
   - Defined Zod schemas:
     - `AlertSeverity`: `INFO`, `WARNING`, `CRITICAL`.
     - `SystemAlert`: `id`, `code`, `severity`, `title`, `message`, `source`, `timestamp`, `suggested_action`.
     - `QueueDepthMetric`: `kind`, `queued_count`, `running_count`, `oldest_queued_age_seconds`.
     - `DiskSpaceMetric`: `mount`, `total_bytes`, `used_bytes`, `free_bytes`, `percent_used`.
     - `WorkerHealthMetric`: `worker_id`, `host`, `kinds`, `healthy`, `busy`, `last_reported_age_seconds`, `cpu_percent`, `memory_used_bytes`, `memory_total_bytes`, `gpu_name`.
     - `SystemMonitoringReport`: `status` (`HEALTHY`, `DEGRADED`, `CRITICAL`), `timestamp`, `active_workers_count`, `stalled_workers_count`, `workers`, `queues`, `disk`, `alerts`.
   - Exported through `packages/contracts/src/index.ts`.

2. **Backend API (`apps/api/src/modules/monitoring/monitoring.ts`):**
   - Registered `MonitoringController` and `MonitoringService` in `apps/api/src/app.ts` with `@Roles("OWNER", "ADMIN")`.
   - Endpoints:
     - `GET /v1/admin/monitoring`: Evaluates real-time health across worker heartbeats, job queue depths, and disk storage usage via `fs.statfsSync`.
     - `GET /v1/admin/monitoring/alerts`: Returns active system alerts.
   - Threshold Rules:
     - `WORKER_HEARTBEAT_TIMEOUT`: Warning when worker heartbeat exceeds 35s.
     - `NO_ACTIVE_WORKERS`: Critical when no workers have reported.
     - `QUEUE_BACKLOG_HIGH`: Warning when >50 jobs are queued or oldest job wait exceeds 10 minutes.
     - `DISK_SPACE_LOW` / `DISK_SPACE_CRITICAL`: Warning at >80% disk utilization, Critical at >90% disk utilization.

3. **Web UI (`apps/web/src/components/admin/AdminConsole.tsx`):**
   - Added interactive System Monitoring Alerts Banner at the top of the Admin Console, color-coded by severity, displaying the title, descriptive message, and suggested operator remediation action.
   - Connected `/v1/admin/monitoring` into Admin Console data loader.

4. **Verification & Testing:**
   - API integration tests in `apps/api/test/monitoring.api.test.ts` (3/3 tests passing).
   - Web component vitest tests in `apps/web/test/adminConsole.test.tsx` (5/5 tests passing).

## Consequences

- Full local observability and automated health degradation warnings with zero third-party cloud costs.
- Operators receive immediate, proactive diagnostic feedback and actionable advice before system degradation causes user disruption.
