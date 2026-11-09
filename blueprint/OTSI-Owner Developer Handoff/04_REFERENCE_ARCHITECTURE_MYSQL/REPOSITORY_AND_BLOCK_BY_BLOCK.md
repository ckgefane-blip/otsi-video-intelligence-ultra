> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Construction sequence — developer must build block by block

## Recommended monorepo layout
```text
otsi-vie/
  apps/web/src/{routes,features,components,design-system,state}
  services/api/src/{auth,projects,media,analysis,identity,metrics,reels,reports,rights,delivery}
  workers/{ingest,transcode,detect,track,identify,events,tactics,render,reports,deliver}
  packages/{contracts,temporal-geometry,renderer-math,rights-policy,ui-types}
  db/migrations/              # approved environment-specific adaptations
  infra/{terraform,k8s,compose,observability}
  evaluations/{annotations,benchmarks,metrics}
  tests/{unit,api,db,integration,e2e,security,visual,cv-golden}
  docs/{ADRs,runbooks,release-notes,traceability}
```

## Block 00 — Inventory and reconcile (hard prerequisite)
Inputs: actual existing source tree, (not applicable to the greenfield build: no existing database is inspected or used, owner decision 2026-10-26) migration journal [MySQL correction C-DOC-15], storage bucket layout, secrets inventory without copying secrets, ten approved UI images and MD files, registry and website allocator service, rights policy. Outputs: file-level current-state map, table/column match matrix, unknown/gap list, proposed additions and no-destruction migration plan, decisions log. Gate: owner approves migration compatibility and no loss of existing functionality. **No production DDL deployment at this step**.

## Block 01 — Codebase contracts and infrastructure
Create monorepo/CI, typed API schemas and generated client, isolated local docker services, production deploy manifests, test coverage harness, structured logging/tracing, Git branch/review strategy. Gate: commit pinned builds, reproducible fixtures, security scans, API health smoke, DB migration from empty clone and rollback rehearsals.

## Block 02 — Tenant/auth/rights foundation
Implement OIDC auth, org roles, membership changes, authorization middleware, server-enforced tenant isolation and child server-enforced tenant isolation, rights grants and decisions, audit events. Gate: unauthorized and cross-org ID tests deny every source and derivative; revoked assets denied at download time.

## Block 03 — Registry, clubs, players, matches
Wire existing canonical player IDs, name aliases, roster and jersey evidence, no new parallel allocator. Gate: all existing registry values retained exactly; conflict and missing ID remain explicit, never auto-assigned; website 10 posts/8 IDs status verified against live data rather than assumed current.

## Block 04 — Upload/ingest and playback
Resumable upload, signed upload parts, source verification, ffprobe, rendition, shot/frame PTS map, persisted progress, media rights. Gate: file and permitted direct URL work, abort/retry, malformed/malicious media failures, local player plays verified proxy with correct source time.

## Block 05 — Detection and ball worker
Implement detector interface and licensed weights, all visible classes, coordinate transformation and chunked output. Gate: annotated frame tests, per-class evaluation and full-frame bounding-box overlays regardless of ball possession.

## Block 06 — Tracking and continuity
Two-stage association + motion/appearance, shot boundaries, occlusion and reentry, track segment persistence, confidence and track diagnostics. Gate: benchmark IDF1/HOTA, ID switches, camera cut regression and no invented off-camera bounding boxes.

## Block 07 — Identity resolution and human review
Candidate scorer with roster, jersey OCR and appearance, append-only decision workflow, track-to-player claim guard, conflicts. Gate: evidence trace, unknown IDs remain unknown, conflicting jersey leads review, canonical ID not overwritten.

## Block 08 — Events/calibration/metrics/tactics
Implement event candidates, decisions, pitch calibration quality, heatmap by verified pitch coordinate, off-ball track analytics, metrics registry. Gate: no speed/distance where metric cannot be calibrated; report values show evidence state and source; event precision tests.

## Block 09 — Pages 01–05 live wiring
Home and ingest screens real APIs, processing pipeline SSE, Analysis player overlays & timelines, Tactical page measured views and unsupported states. Gate: click-by-click E2E upload→analysis→select track→review identity→play overlays; no UI falsely says completed.

## Block 10 — Reel/spotlight editor
Backend reel model, selected verified targets, candidate moments, timeline layers, keyframes, browser GPU preview with same math as server compositor, rights guard. Gate: cross-cut player retention, target lost handling, clip editing saves/reloads with version conflict detection.

## Block 11 — Rendering/reporting/delivery
Actual frame compositor/FFmpeg MP4 encode, artifact QA, server PDF, search/library, policy-protected share links, signed downloads and queued delivery. Gate: downloadable playable MP4 and PDF from a licensed fixture with verified provenance, RED/export-denied behavior tested.

## Block 12 — Pages 06–10, integration and release
Connect reel builder, clip studio, report, library and delivery screens end-to-end. UX and responsive checks, security assessment, GPU capacity, restore drill, performance SLA, staging soak and approval. Gate: complete release evidence folder with pass/fail matrix and recorded demo on actual UI, **not a static mock**.

## Mandatory deliverable per block
Working source changes; migrations with safety analysis; API DTOs/OpenAPI; fixture/test data; unit/integration/e2e tests; measured results; diagnostics; security/rights coverage; changelog; rollback; screenshot or recording of actual page wiring; owner acceptance note. Every skipped or failed item remains open and blocks production label.

## Architecture decision records
ADR-001 API runtime, ADR-002 durable queue, ADR-003 model/dataset licenses, ADR-004 tracker architecture and thresholds, ADR-005 object lifecycle, ADR-006 canonical ID adapter, ADR-007 tenant isolation, ADR-008 rights inheritance, ADR-009 metric ontology and confidence, ADR-010 video timebase alignment, ADR-011 renderer technology, ADR-012 deployment topology and SLOs.
