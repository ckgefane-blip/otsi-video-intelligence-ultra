> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Entity relationships, state machines and transaction sequences

## Relational paths
`organization → memberships → users`, `organization → projects → video_sources → pipeline_runs → steps`; `video_source → video_shots → frame_index`; `pipeline_run → detections [blob+index] → tracks → track_segments / track_observations`; `track → identity_candidates → identity_decisions → players`; `pipeline_run → event_candidates → event_decisions`; `video/track/player → metric_values`; `project → reel_project → targets + clips → timeline_tracks/items/keyframes → render_job → asset → deliveries/share_links`; `video/player → report_job → asset`. FKs are specified in SQL; use a graph viewer generated from DDL for formal ERD.

## State machines
- Video: PENDING→VALIDATING→INGESTED or QUARANTINED/FAILED. A failed source cannot create valid tracking jobs.
- Pipeline step: QUEUED→RUNNING→SUCCEEDED, FAILED, CANCELLED, REVIEW_REQUIRED, BLOCKED; attempt count increments on safe retry. Pipeline success requires all mandatory steps successful and quality gate passed.
- Track: ACTIVE↔OCCLUDED→LEFT_FRAME/ENDED, with review when ambiguous. Track fragment merge creates recorded association, not retroactive untracked observations.
- Identity: UNRESOLVED→CANDIDATE→CONFIRMED; REJECTED/CONFLICT result from contradictory evidence. Any latest decision invalidating a reel target forces a pinned-version review before new render.
- Reel: DRAFT→READY only after clips/targets/rights validated; READY→RENDERING→PUBLISHED or BLOCKED. User edits increment version and supersede render manifest.
- Render: QUEUED→RUNNING→SUCCEEDED or FAILED/CANCELLED/BLOCKED/REVIEW_REQUIRED; recovery from FAILED creates explicit new attempt/transition.
- Delivery: QUEUED→RUNNING→SUCCEEDED/FAILED/BLOCKED with **fresh rights** at dispatch and token issuance.

## Transaction: upload initialize
1. Authenticate user + organization; verify create permission and quota.
2. Create project if specified, `video_sources(PENDING)`, upload session in upload subsystem, and outbox event atomically.
3. Return limited upload capability scoped to object key, checksum requirements and expiry. Browser uploads bytes directly to object storage.
4. On completion verify final multipart checksum, security scan, ffprobe metadata; write immutable asset, set video `INGESTED`, enqueue run.
5. Duplicate completion uses idempotency key and returns original video/run IDs.

## Transaction: analysis results publication
Worker writes immutable chunk to temporary object; verifies count/hash and PTS monotonicity; commits asset row + progress event and stable pointer; publishes object by rename/versioned key then `SUCCEEDED` only when readers can retrieve object. Partial chunk is invisible to final overlays. Reconcile orphan uploads asynchronously.

## Transaction: render request
1. Lock reel project/version and read all clips/target identity decisions.
2. Require every selected segment to be visible/qualified; RED clips fail immediately; unresolved overlaps trigger review, not automatic identity merge.
3. Policy service computes `PRODUCE` rights for every source dependency and consents; optionally compute separate `EXPORT` eligibility.
4. Create render manifest with source video hash, pipeline/model IDs, clip in/out PTS, player targets, track chunk hashes, effect params, fonts/music licenses, codec settings and user action.
5. Commit render job+manifest asset pointer+outbox with idempotency key.
6. Worker generates frames/audio, validates outputs, persists artifacts, marks success only after QC.
7. Before download/signed URL, recompute `EXPORT` decision against current rights grants and access.

## Deletion and retention
Soft archive user-visible rows; comply with authorized deletion using tombstone workflows, cancellation of downstream jobs, revoke links, invalidate caches, and object lifecycle, subject to evidence retention obligations. Audit logs may retain minimal immutable metadata under documented retention policies. Shared/source-based derived assets cannot be deleted without dependency impact review.
