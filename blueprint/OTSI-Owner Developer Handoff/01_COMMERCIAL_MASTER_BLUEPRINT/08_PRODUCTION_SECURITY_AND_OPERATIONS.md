# 08 — Security, rights, scalability, DR and operations

## Security invariants
Tenant isolation: MySQL has no row-level security or `SET LOCAL` session claims. Every query is scoped by the authenticated organization in the API's service layer (ADR-002), and the database refuses cross-tenant links itself through composite tenant foreign keys (migration 0003_tenant_integrity). [MySQL correction C-DOC-04] No generic service-account bypass for user traffic. Add tenant scoped composite FKs or service validation to prohibit project from one org linking videos from another. Strong CSP, CSRF for cookie sessions, secure SameSite, MFA for admins, image/video upload validation, SSRF redirect and DNS rebinding guards, MIME magic check, antivirus as appropriate, sandboxed decode workers without privileged host mounts, dependency scanning, SBOM and signed containers. Encrypt stored objects and DB volume, enforce TLS and private networking. Secrets from manager, never `.env` committed.

## Media rights matrix
`UNKNOWN/EXPIRED/ANALYSIS_ONLY` deny produced/exported artifacts; `INTERNAL` can authorize internal render/playback only when explicitly granted; `EXPORT_ALLOWED/PUBLIC` authorize external delivery subject to audience/territory/time and commercial license. Minors require VERIFIED guardian consent when applicable; do not infer age from appearance. Rights are evaluated for all source assets/derived artifacts at job creation, worker start, publish, signed URL issuance and every share open. Revocation invalidates public/signed distribution as quickly as infrastructure allows, and actions are auditable.

## Tenant entitlements
All expensive APIs reserve quota atomically, work items carry scoped tenant ID, reserve amount and reconciliation ID; release reservations on failure, commit actual usage on success; protect from retries duplicating usage; soft alerts at thresholds, hard stops per subscription terms. Resource classes CPU / GPU / render; maximum concurrency per tenant and global priority lanes. Billing state is read from verified provider webhooks, not from client-sent checkout completion.

## Deployment baseline
Separate `web`, `api`, `workflow`, `detector`, `tracker`, `inference`, `renderer`, `pdf`, `event-dispatcher`; internal network policies; managed MySQL 8.4, S3, Redis, Temporal [MySQL correction C-DOC-05]. GPU workloads via resource limits + dedicated node pool, keep heavy transcode from web. Kubernetes HPA based on workload backlog & CPU, GPU autoscaling based on queue with max-cost guard. Staging and production isolated accounts and buckets. Infrastructure drift checks and GitOps rollout with canary revert.

## Observability and recovery
Trace `requestId -> workflowId -> runId -> artifactId -> source SHA`; metrics upload success, GPU throughput, queue latency p95, render success, identity switch rate, spotlight mis-target rate, model drift, URL signing failures, billing webhook lag. Alert thresholds defined by measured load tests; no invented SLO pass claims. MySQL point-in-time (binary log) restore drills [MySQL correction C-DOC-16], S3 versioning/retention, off-region backup where legal, runbooks for breach, stuck GPU job, corrupt video, failed billing event and forced rights revocation. No raw source frames in production logs.

## Commercial launch checklist
Legal model license review; rights/terms/privacy/subprocessor inventory; payments/tax jurisdiction; penetration test; accessibility WCAG 2.2 AA target; real browser/tablet tests; load test + tenancy isolation tests; documented model error bounds; signed media compliance; restore drill; ability to support users; vulnerability SLA; release gates all signed.
