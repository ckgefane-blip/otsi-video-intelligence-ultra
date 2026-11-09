# ADR-115: Load Testing, Concurrency Verification, Long-Match Ingest, and Resource Audit

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.7: Load Tests
- **Migration:** None (Stress test harnesses verify existing schema, connection pools, and worker leases)

## Context

Prior to production deployments and external pilot onboarding, the OTSI VIE v2 platform must be empirically proven under realistic concurrent loads and match lengths:
1. **Concurrent Chunked Uploads:** Multiple users simultaneously transmitting multipart 1 MB chunks to test connection pool saturation, chunk ordering, and SHA256 integrity without connection resets.
2. **Long-Match High-Density Ingest (90+ min):** Simulating a full 90-minute regulation match with halftime intervals, generating 9,000 observations across 25 tracks (22 players, referees, ball). Testing multi-row batch insert throughput and analytical timeline heat queries.
3. **Concurrent Reel Render Queues:** Multiple concurrent render jobs requested across varying aspect ratios (`16:9`, `9:16`, `1:1`, `4:5`) and export profiles (`REEL`, `SCOUT`, `SOCIAL`, `ARCHIVE`), verifying queue depths and scheduling responsiveness.
4. **Zero Resource Leaks:** Ensuring that load test executions leave 0 hung worker leases, 0 orphaned upload chunks, 0 stranded render jobs, and no lingering database connections.

## Decision

1. **Contracts (`packages/contracts/src/load-testing.ts`):**
   - Defined strict Zod schemas:
     - `LoadTestScenario`: `uploads`, `matches`, `renders`, `all`.
     - `LoadMetric`: `name`, `operations`, `concurrency`, `p50_ms`, `p95_ms`, `p99_ms`, `min_ms`, `max_ms`, `mean_ms`, `throughput_ops_per_sec`, `bytes_transferred`, `throughput_mb_per_sec`, `errors`, `error_codes`.
     - `LoadAssertion`: `name`, `passed`, `message`.
     - `LoadScenarioReport`: `scenario`, `status`, `duration_ms`, `metrics`, `assertions`.
     - `LoadTestReport`: `timestamp`, `environment`, `overall_status`, `total_duration_ms`, `scenarios`, `system_resources`.
   - Exported through `packages/contracts/src/index.ts`.

2. **Harness Implementation (`otsi-vie/tools/load/load_test.py`):**
   - Standalone CLI executing against MySQL 8.4 on port 3508 (`otsi_owner_vie`):
     - **Uploads Scenario:** Concurrently uploads 12 parts totaling 50.3 MB with multi-threaded workers. Verified zero upload errors, full byte integrity, and throughput >100 MB/s.
     - **Matches Scenario:** Ingests a full 90-minute timeline using multi-row batch SQL formatting for `video_frame_index` and `track_observations` (insert p95 < 200 ms), accompanied by 24 concurrent timeline aggregations (query p95 < 100 ms).
     - **Renders Scenario:** Dispatches 16 unique render specifications across profiles and aspect ratios, verifying queue depth tracking and sub-100ms enqueue latency.
     - **Resource & Leak Audit:** Executes sanity scans on `worker_jobs`, `upload_session_parts`, and `outbox_events` to verify zero orphan states and zero hung leases.
     - Automatically cleans up all test-scoped assets and organization data in teardown cascades.

3. **Automated Verification:**
   - Worker unit tests in `otsi-vie/services/worker/tests/test_load.py` verifying percentile interpolation ($p50, p95, p99$), edge cases with empty samples, and harness initialization.
   - Vitest contract validations in `otsi-vie/apps/api/test/load.api.test.ts`.
