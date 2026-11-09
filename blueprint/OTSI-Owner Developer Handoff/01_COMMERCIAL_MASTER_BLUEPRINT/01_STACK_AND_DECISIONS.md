# 01 — Prescriptive system architecture and ADRs

## Locked deployment stack
- Monorepo: pnpm workspaces + Turborepo for TS; uv/pyproject for Python. Runtime: Node.js current supported LTS, Python 3.12+, MySQL 8.4 LTS, Redis 7+, S3-compatible object storage (production AWS S3), Kubernetes with GPU worker nodes. Pin exact patch/container digests in lock files before implementation.
- Frontend: Next.js App Router + React + TypeScript strict, Tailwind design tokens, Radix primitives, Zustand only for ephemeral video editor selection, TanStack Query for API state, Zod on boundaries; video HTML5/hls.js, a requestAnimationFrame canvas/WebGL overlay aligned to `video.currentTime`; no fake player tracking.
- API: NestJS TypeScript with Fastify adapter, OpenAPI 3.1 generation, class validators or Zod, JWT/OIDC via mature auth provider, OpenTelemetry instrumentation; JWT audience and issuer validation mandatory.
- Data: MySQL via Prisma or Kysely for app tables and explicit raw SQL for partitions, security policies, generated functions and high-volume queries. All migrations versioned and transactional where possible. Use the MySQL driver's connection pool (ProxySQL only if measured load needs it) with server-side prepared statements; pgBouncer does not apply. [MySQL correction C-DOC-01]
- Async: Temporal for durable workflow orchestration (preferred), Redis for bounded cache/rate limiting; workers in Python using PyTorch + OpenCV + FFmpeg/ffprobe; object detections and embeddings stored in Parquet on S3 plus operational/query indexes in MySQL. Redis alone is NOT a durable workflow engine.
- Rendering: FFmpeg plus deterministic OpenCV/PyAV or GPU shader effect compositor in a dedicated worker. All MP4 files validated using ffprobe and perceptual alignment quality gates.
- Identity: visual anonymous `track_id` distinct from verified canonical `player_id`. Use UUIDs; canonical IDs in new platform are `OTSI-CCC-YYYY-NNNNNN`, allocated server-side with concurrency-safe sequence, never inferred from jersey number.
- Commercial: Stripe Billing for web subscription where merchant eligibility and jurisdiction permit. Vendor swap via `BillingProvider` abstraction. No card numbers or CVV stored in platform DB. Provider webhook signatures verified, inbox idempotency enforced. Trial and plan entitlements are server-enforced.
- Infrastructure: Terraform for cloud resources, Helm/Kubernetes deployment; GitHub Actions or equivalent; SOPS/secrets manager; Grafana/Prometheus, Loki and Tempo; managed MySQL 8.4 LTS with binary-log point-in-time recovery [MySQL correction C-DOC-02]; S3 versioning/lifecycle.

## Architectural boundaries
Web UI -> API/BFF -> domain services (Identity, Project, Ingest, CV Job, Observation, Events, Reels, Reports, Delivery, Billing, Admin). API commits transactional state + event outbox. Dispatcher starts Temporal workflows idempotently. Workflow consumes durable assets, emits asset manifests, updates DB and outbox events. Browser subscribes to scoped SSE or WebSockets; refresh resolves state from REST. No browser-supplied player confidence is trusted by backend.

## Separate data planes
Transactional: MySQL. Immutable source/proxy/reel/report and CV Parquet: S3, versioned keys & SHA-256. Short-lived credentials and temporary URLs: signed gateway subject to rights at each request. Cache: Redis. Time-continuous interpolation computed from immutable observations and projected to UI at video frame time. Access control checked at API and storage signing layers.

## Design/release constraints
No use of UEFA/FIFA/league logos to imply endorsement. Mock numbers shown as `DEMO` and never exported as measurements. No unsupported URL scraper: accept direct URLs and licensed integrations only, verify SSRF controls and provider terms. No computed speed/distance without pitch calibration and quantified uncertainty. A player out of frame has null coordinates; cannot be tracked visually there. False spotlight on another player blocks release.

## Architecture decision log
ADR-001 greenfield new database; ADR-002 tenant data isolation; ADR-003 immutable media/artifacts; ADR-004 evidence-first metrics; ADR-005 asynchronous GPU processing; ADR-006 compositing is deterministic; ADR-007 rights and billing gates at enqueue AND delivery; ADR-008 web-first 10 pages; ADR-009 model weights require documented commercial license; ADR-010 telemetry must not leak raw video or sensitive biometric templates.
