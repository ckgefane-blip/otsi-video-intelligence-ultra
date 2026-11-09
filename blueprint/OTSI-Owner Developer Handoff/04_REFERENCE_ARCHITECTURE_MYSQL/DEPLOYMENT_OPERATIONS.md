> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Deployment and operational construction drawings

## Environment matrix
Local: frontend dev server, API, MySQL 8.4, Redis/queue [MySQL correction C-DOC-09], S3-compatible object storage emulator, deterministic fixture clips, mocked GPU adapter. CI: isolated test DB migrations + workers in CPU smoke mode, media/render integration with synthetic legally safe video. Staging: production-equivalent TLS, IAM, true GPU, isolated real evaluation video, blinded QA, restore drills. Production: HTTPS public edge; private API, DB, queues and object storage policies; autoscaled CPU workers and scheduled/queue-managed GPU workers.

## Container/services
`frontend`, `api`, `auth-adapter`, `ingest-worker`, `transcode-worker`, `detect-worker`, `track-worker`, `identity-worker`, `events-worker`, `tactics-worker`, `render-worker`, `reports-worker`, `outbox-dispatcher`, `delivery-worker`, `mysql`, `broker` [MySQL correction C-DOC-10], `cache`, `objectstore`, `observability`. Consolidate workers physically if small deployment, keep separate logical jobs and permissions. Docker images immutable by digest; model weights versioned and checksummed.

## Job topology & retry
Input job accepted → outbox event committed → dispatcher publishes → worker claims lease → idempotent operation on `(run_id,step_name,input_hash,version)` → immutable chunk artifact → DB state completion. Workers heartbeat and gracefully handle cancellation. Exponential backoff + capped retries for transient infra failure, no blind retry for rights deny or invalid media; dead-letter with investigation controls. Two workers may process same message; duplicate must not corrupt results. Stale lease recovery uses fenced generations.

## Capacity planning worksheet
Per full match estimate source GB, proxy GB, decoded frames, detections/frame, observation chunks, GPU seconds at specified resolution, PTS retention, transcode CPU, render output bandwidth and CDN egress. Load-test with target concurrent uploads and active editors; record p50/p95 latency. GPU deployment chosen from measured candidate model throughput, not synthetic marketing numbers. Plan quotas per org, max video duration and backpressure. Never expose GPU stats on UI if backend does not supply real values.

## Observability
Trace upload session → media hash → run ID → step ID → model/weights hash → track IDs → reel/job ID → delivery ID. Metrics: ingest failure, decode duration, detected person recall eval, tracking ID switches eval, identity review backlog, frame throughput, data-lag, render queue age, render failure, player-in-spotlight drift QA, access denial, rights revocation delay, SSE disconnects, DB read latency, object store write failure, storage cost. Alerts with on-call owner and runbook link.

## Backup, disaster recovery and retention
Nightly DB base backups + continuous WAL where supported, immutable encrypted object versioning, policy-defined retention, metadata vs large Parquet lifecycle separation. Define RPO/RTO with owner, test restore regularly on isolated infrastructure. Never assert backup is working without a completed restore test. Backup secrets/KMS key recovery require dual control. Audit redaction: never log full bearer tokens, secret URLs, player biometric embeddings, or raw user messages unnecessarily.

## Rollout and rollback
Feature flags for ingestion provider, detector model version, tracker policies, identity auto-confirm policy, spotlight GPU effect, external deliver. Shadow compare model release to champion on held-out fixtures, canary small tenant group, explicit halt on regression. Schema must expand/contract safely with dual-read/write adapters; never destructively drop prior registry columns before owner signs reconciliation report. Reversible rollout needs old binaries compatible with migrated schema.

## Operational runbooks
1. Job stuck: correlate outbox ID, broker state, worker heartbeat, object chunk hash; retry with lease fencing.
2. Wrong player identity: disable auto-export, invalidate dependent outputs, human review, replay from pinned run, annotate correction.
3. Failed render: preserve manifest/stderr/redacted FFmpeg command, render deterministic preview window, retry after remediating codec/resource.
4. Rights revoked: cancel queued delivery, revoke links, invalidate CDN, block new renders and downloads, audit.
5. Object corruption: quarantine object hash, compare backup, invalidate derived artifacts and reprocess source only if licensed.
6. Tenant incident: block affected auth, rotate credentials, audit unauthorized access paths, incident response under applicable regulations.
