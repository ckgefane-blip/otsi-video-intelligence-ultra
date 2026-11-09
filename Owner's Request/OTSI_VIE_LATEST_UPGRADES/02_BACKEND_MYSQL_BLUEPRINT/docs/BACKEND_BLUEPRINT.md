# OTSI VIE — Back-end & MySQL Blueprint v2 (aligned to the ten corrected UIs)

**Status:** design + validated reference schema. The 14 migrations were executed on **MySQL 8.4.13** (InnoDB, strict SQL mode) in a disposable container, and **49/49 behavioural tests pass** (see `VALIDATION_REPORT.md`). This is not a running application. The API, workers and UI wiring still have to be built and tested against this contract.

**Lineage:** v2 extends the *OTSI-Owner Developer Handoff* MySQL reference schema (`01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/001…002`). It keeps that schema's names, principles and ADRs:
- greenfield `otsi_owner_vie`
- tenant isolation
- immutable media
- evidence-first metrics
- asynchronous GPU processing
- deterministic compositing
- rights and billing gates at enqueue and at delivery

It also fixes the handoff's defects and fills every data gap exposed by the ten corrected UIs (§9).

---

## 1. System shape

```
Browser (Next.js, 10 pages) ──HTTPS──► API / BFF (NestJS + Fastify, OpenAPI 3.1)
   ▲  SSE (job/render progress, Last-Event-ID)        │  writes state + outbox_events in ONE transaction
   │                                                  ▼
   │                                   MySQL 8.4  otsi_owner_vie  (this blueprint)
   │                                                  │  outbox dispatcher (FOR UPDATE SKIP LOCKED)
   │                                                  ▼
   │                                   Temporal workflows ──► Python GPU workers (detect/track/identify/events/tactics)
   │                                                  │                └─► Render workers (FFmpeg / compositor)
   │                                                  ▼
   └──── signed URLs ◄──────────────── S3-compatible object storage (source, proxies, Parquet CV data, renders, PDFs)
                                      Redis (cache, rate limits)   Search: MySQL FULLTEXT (v1) → OpenSearch when measured need
```

**Data planes**

| Plane | Lives in |
|---|---|
| Transactional state, metadata, evidence, decisions | MySQL |
| Bytes (video, Parquet observations, renders, PDFs, images) | Object storage, referenced by `assets` (with SHA-256 and lineage) |
| Per-frame boxes | Parquet in S3 (authoritative), plus a hash-partitioned `track_observations` working window in MySQL for overlay queries |

## 2. Conventions every developer must follow

| Topic | Rule |
|---|---|
| IDs | UUIDv7 made by the API or worker. Stored as `CHAR(36) ASCII_BIN` (36 bytes, not 144 as utf8mb4). Time-ordered, so inserts append to the B-tree. |
| Tenancy | Every tenant table has `organization_id` + `UNIQUE(organization_id,id)`. Children reference parents with **composite FKs** `(organization_id, parent_id)`, so a cross-tenant reference is **rejected by MySQL itself** (tested). The API still adds `WHERE organization_id = :org` to every query and checks membership. Views expose `organization_id` and must be filtered. |
| Time | `DATETIME(6)` UTC. Media time is integer **microseconds** (`*_pts_us`). The match clock is `match_clock_ms`. Formatting ("62:17", "Tue, 16 Apr 2024", "1.8 GB", "1080p") happens in the BFF/UI, never in SQL. |
| Evidence | Every analytical number has `evidence_state ∈ {DETECTED, INFERRED, CONFIRMED, NOT_MEASURED}`. CHECKs enforce that **NOT_MEASURED ⇒ value NULL** and measured ⇒ value present. The UI renders NULL as "—" with a tooltip, never 0. |
| Metres / km/h | Allowed only with a passing `pitch_calibrations` row (`calibration_id` required by CHECK on shapes, runs and event coordinates). |
| Identity | Anonymous `tracks` ≠ canonical `players`. Confirmation happens only via append-only `track_identity_decisions` (HUMAN with reviewer, or AUTO_POLICY with policy version). Triggers project the decision onto `tracks`. Player names appear in the UI only for CONFIRMED tracks. |
| Canonical OTSI Player ID | `OTSI-CCC-YYYY-NNNNNN`, issued **only** by `sp_allocate_otsi_player_id`: row-locked, gap-free, never inferred from a jersey number. |
| Concurrency | `row_version` is bumped by triggers and exposed as the ETag. Mutations send `If-Match`, and a mismatch returns `409 VERSION_CONFLICT`. Costly jobs require an `Idempotency-Key` (unique per org at DB level). |
| State machines | Pipeline runs, videos, reels, reports and render jobs: illegal transitions raise `SQLSTATE 45000` from triggers (defence in depth). |
| Ledgers | Identity decisions, event decisions, policy decisions, reel revisions and audit events are append-only (triggers block UPDATE/DELETE). |
| JSON | Bounded use only: config snapshots, overlays, evidence. Saved-search queries are validated with `JSON_SCHEMA_VALID` in a CHECK. |
| Secrets | No passwords, tokens or card data in MySQL, except a share-link `password_hash` (argon2id) and `token_hash` (SHA-256). OIDC subject only. |

## 3. Domain modules → tables (151 tables, 18 views, 24 triggers, 2 procedures)

| Module (migration) | Purpose | Key tables |
|---|---|---|
| 001 Foundation | tenants, users, roles, prefs, notifications, storage | organizations, users, memberships, invitations, user_preferences, notifications, storage_buckets, assets |
| 002 Registry | canonical football data | countries, competitions, seasons, clubs, club_aliases, club_kits, positions, players, player_positions, player_club_spells, otsi_player_id_sequences, matches, match_periods, match_rosters, partner_brands |
| 003 Library | projects and the unified catalogue | projects, project_members, folders, tags, library_items (+players/tags/collaborators), saved_searches, bookmarks, item_likes, item_engagement_daily, comments |
| 004 Ingest | 02 Upload & Ingest | supported_media_formats, ingest_limits, video_sources, video_ingest_options, ingest_batches, upload_sessions, upload_parts, url_imports, video_classifications, video_detected_teams, rights_grants, video_shots, video_frame_index |
| 005 Pipeline/CV | 03 AI Processing, tracking, identity | model_versions, model_evaluation_*, pipeline_stage_definitions, pipeline_runs, pipeline_steps, pipeline_step_segments, job_log_entries, worker_nodes, worker_resource_samples, run_worker_assignments, pipeline_preview_frames, evidence_records, detection_batches, tracks, track_observations (partitioned), track_segments, track_gaps, presence_intervals, track_identity_candidates, track_identity_decisions, identity_review_tasks, pitch_calibrations |
| 006 Analytics | 04, 05 and 08 numbers | event_types, event_candidates, event_decisions, metric_definitions, metric_values, metric_cohorts, cohort_metric_baselines, team_shape_snapshots, team_shape_nodes, pass_networks (+nodes/edges), heatmaps, possession_episodes, movement_segments, tactical_windows |
| 007 Reels/Studio | 06 Reel Builder, 07 Clip Studio | music_tracks, brand_kits, effect_presets, reel_projects, reel_style_settings, reel_targets, moment_suggestions, media_clips, media_clip_tags, reel_clips, timeline_tracks, timeline_items, effect_keyframes, caption_cues, reel_revisions, reel_chapters, reel_settings_flags |
| 008 Reports | 08 Player Report | reports, report_metric_snapshots, report_identity_confidence, player_role_profiles, player_role_traits, report_insights, report_insight_citations, scouting_assessments, scouting_strengths, scouting_dossiers, scouting_dossier_items, player_notes |
| 009 Delivery | 10 Export & Delivery | export_presets, render_jobs, render_job_stages, render_qc_checks, export_bundles, report_exports, share_links, share_link_access, deliveries, delivery_recipients, client_contacts |
| 010 Commercial/Ops | 01 KPIs, billing, governance | kpi_snapshots, plans…invoices, entitlement_grants, quota_*, usage_events, policy_decisions, artifact_dependencies, audit_events (monthly partitions), outbox_events, idempotency_keys, security_events, admin_actions, processing_dead_letters, retention_jobs, release_signoffs, schema_migrations |
| 011 Integrity | triggers + procedures | state machines, append-only, identity/event projections, OTSI ID allocator, audit partition roll-forward |
| 012 Read models | one view per UI block | v_home_*, v_reel_cards, v_upload_*, v_run_*, v_system_resources, v_analysis_player_rows, v_event_chip_counts, v_player_header, v_player_current_metrics, v_library_*, v_export_queue, v_delivery_readiness |
| 013 Seed | configuration only | positions, 8 supported formats, 12 stage definitions, 21 event types, 27 metric definitions, 3 export presets, 12 effect presets |
| 014 Roles | least privilege | otsi_migrator, otsi_app_rw (ledgers insert-only), otsi_worker_rw, otsi_readonly |

Full column-level detail: `DATA_DICTIONARY.md`. Diagrams: `ERD.md`.

## 4. End-to-end flows (what writes what)

1. **Ingest (02).**
   - `POST /videos` creates `video_sources` (PENDING) and `video_ingest_options` (the 14 toggles).
   - `POST /uploads/init` creates `upload_sessions` and an S3 multipart upload.
   - Parts go straight to S3 and are recorded in `upload_parts`.
   - `POST /uploads/:id/complete` verifies the SHA-256 and creates `assets(SOURCE_VIDEO)`. The video moves to VALIDATING, and the probe sets `width/height/fps/duration`. Then INGESTED (a CHECK makes this impossible without probe data), with a `rights_grants` row required.
   - A URL import passes SSRF and provider-terms gates (CHECK) before fetching.
2. **Pipeline (03).**
   - The outbox event `video.ingested` starts a Temporal workflow.
   - `pipeline_runs` (attempt n, idempotent) and `pipeline_steps` per stage advance `progress` monotonically (trigger).
   - Workers write `job_log_entries` (the log panel), `pipeline_preview_frames` (the tiles), `worker_resource_samples` (System Resources), `detection_batches` + Parquet, `tracks`, `track_observations`, `presence_intervals`, `pitch_calibrations` and `event_candidates`.
   - Retrying creates a new attempt row; a failed run is never edited back to READY.
3. **Identity (04, 08).**
   - Models write `track_identity_candidates` (the "Conf." column).
   - Reviewers resolve `identity_review_tasks` by inserting `track_identity_decisions`; a trigger updates `tracks.identity_state`/`current_player_id`.
4. **Analytics (04, 05, 08).**
   - The tactics step writes `metric_values` (with `evidence_state`, coverage, calibration), `team_shape_*`, `pass_networks`, `heatmaps`, `movement_segments` and `tactical_windows`.
   - Recompute inserts new rows and flags old ones `is_current = FALSE`, so history is preserved.
5. **Reel (06/07).**
   - `reel_projects` + `reel_style_settings` + `reel_targets` (trigger: must cite a CONFIRMED decision for that same player).
   - Then `moment_suggestions` → `reel_clips` → `timeline_*`.
   - Save Project writes an immutable `reel_revisions` row (the ETag-checked timeline).
6. **Render (10).**
   - `POST /render-jobs` runs a policy check (`policy_decisions`), reserves quota (`quota_reservations`), and creates `render_jobs` pinned to a revision plus `render_job_stages` and `export_bundles`.
   - The worker produces output + manifest assets and writes `render_qc_checks`.
   - SUCCEEDED requires output, manifest and 100% (CHECK + trigger).
7. **Delivery (09/10).**
   - `share_links` (token hash, optional password, expiry, download/comment flags) and `deliveries` (+ recipients).
   - Rights are re-checked at delivery time (`policy_decisions`), and every open is logged in `share_link_access`.
8. **Catalogue (01, 09).**
   - Each domain write upserts `library_items` (+ players/tags/collaborators) in the same transaction, or via the outbox projector.
   - A nightly/15-minute job materialises `kpi_snapshots`.

## 5. Realtime and caching
- **SSE channels.** Each is scoped to the organization and re-authorised at reconnect; the browser sends `Last-Event-ID`.
  - `run:{id}` streams `job_log_entries.id` as the event id, plus stage progress.
  - `render:{id}` streams stage progress, ETA and state.
- **REST is the source of truth.** On reconnect the UI refetches `v_run_stage_progress` / `v_export_queue`.
- **Caches.** Redis holds dashboard read models (60 s) and reference data (positions, formats, event types, metric definitions: 24 h, invalidated by deploy).

## 6. Performance and scale
- `track_observations` is `PARTITION BY KEY(video_id) PARTITIONS 32`. The PK `(video_id, frame_index, track_id)` and `ix_obs_track_pts` serve "boxes at time t" and "one track over a window". The window is evicted after analysis is finalised (Parquet stays).
- `audit_events` is `RANGE COLUMNS(occurred_at)` by month. `sp_audit_add_next_partition()` runs monthly, and old partitions are dropped per retention.
- Every UI list has a covering-prefix index starting `(organization_id, …, updated_at|created_at)` for cursor pagination (`WHERE (updated_at,id) < (:t,:id) ORDER BY updated_at DESC, id DESC LIMIT n`).
- FULLTEXT indexes cover `library_items(title, subtitle, description)`, `players` names and `media_clips`. Move to OpenSearch when p95 search exceeds 300 ms or multilingual stemming is needed.
- Generated STORED columns avoid recomputation on read: `video_sources.fps`, `upload_sessions.progress_pct`, `kpi_snapshots.trend_pct`, `reel_clips.output_duration_us`, `timeline_items.end_us`, `media_clips.duration_us`, `assets.object_key_hash`.
- **Sizing guide (per 95-minute match at 50 fps):**
  - ~285k frame-index rows
  - 25–30 tracks
  - ~7M observation rows if kept in the window (do not keep them all; keep a keyframe stride or rely on Parquet)
  - ~1.5k event candidates
  - ~2k metric values

## 7. Security and governance
- Use separate DB accounts per role (014). The API account cannot UPDATE/DELETE ledgers, and the worker account has no billing or identity-admin access.
- phpMyAdmin is internal-only and read-only in production.
- Rights and entitlements are checked at **enqueue and at delivery** (ADR-007) and recorded in `policy_decisions`, with `artifact_dependencies` used to block derived renders when a source right is revoked.
- Audit every mutation (`audit_events` with request id, before/after JSON).
- Admin actions need a justification, and a second approver where `approved_by` is set (CHECK forbids self-approval).
- Personal data: player bio fields carry `bio_evidence_state`; ages are derived, not stored; share-link access stores hashed IP/UA only. `retention_jobs` honours `legal_hold`.
- **Third-party marks:**
  - competition logos, club crests, player photos and partner logos require a licence reference (CHECKs)
  - `partner_brands` drives the Home "TRUSTED PARTNERS" strip, so with no licence nothing is shown

## 8. Error model (unchanged from the handoff, mapped to DB signals)
| DB signal | API error |
|---|---|
| composite FK failure (cross-tenant) | `404 NOT_FOUND` (never disclose existence) |
| `INVALID_*_STATE_TRANSITION` | `409 INVALID_STATE` |
| row_version mismatch (application check) | `409 VERSION_CONFLICT` |
| duplicate idempotency key | replay stored response (`idempotency_keys`) |
| `IDENTITY_UNRESOLVED` | `422 IDENTITY_UNRESOLVED` |
| `ck_mv_*` / `ck_tss_metres` | `422 EVIDENCE_NOT_MEASURED` (worker bug: alert) |
| `ck_url_fetch_gate` | `423 RIGHTS_BLOCKED` / `422 INVALID_URL` |
| policy decision DENY | `423 RIGHTS_BLOCKED` or `402 ENTITLEMENT_REQUIRED` |
| quota reservation failure | `429 QUOTA_EXCEEDED` |
| `INGEST_OPTIONS_LOCKED_START_NEW_RUN` | `409 ACTIVE_JOB_EXISTS` |

## 9. What changed versus the Developer Handoff schema (gap analysis)

**Defects fixed**
- `policy_decisions` used PostgreSQL `CHAR(36)[]` arrays, which are invalid in MySQL. They are now JSON arrays with a type CHECK.
- utf8mb4 `CHAR(36)` keys (144-byte index entries) are now ASCII (36 bytes).
- No tenant consistency in FKs: composite tenant FKs added throughout.
- The `track_observations` FK to a frame table would have prevented partitioning. It is now partitioned, without FKs, by design.
- No constraint stopped a run being marked SUCCEEDED at <100% or without output (added).
- `metric_values` allowed a measured state with no value (added the inverse CHECK).
- `comments.body` was VARCHAR(255) (now 4000, threaded, with external reviewers via share links).
- `players` had no tenant/global distinction, merge handling, bio, nationality or positions.
- `matches` used free-text competition/season.
- Audit had no partitioning.
- The OTSI ID allocator was described but not implemented (now a tested procedure).
- **MySQL NULL pitfall:** CHECKs that compare nullable columns let rows through (found by the tests and fixed with COALESCE).

**Gaps filled from the corrected UIs** (each traceable in `UI_FIELD_TO_DATA_SOURCE_MAP.csv`):

| Page | Added |
|---|---|
| Header | display mode, avatar initials/colour, job titles |
| 01 | KPI snapshots with real trend series (replacing the decorative bars), featured reel, engagement counts, bookmarks, licensed partner brands |
| 02 | the 14 processing toggles, batch uploads, URL provider gates, format allow-list, content classification with confidence band, detected teams needing confirmation, ingest limit per org (resolves the 2 GB vs 50 GB copy conflict as configuration) |
| 03 | stage display definitions (labels, descriptions, colours, order), frame-range segments for the Processing Timeline, log rows with pending state, worker resources for System Resources, preview frames for the tiles, output summary view |
| 04 | event chip groups, presence lanes, identity candidates with rank, review queue |
| 05 | team shape snapshots + nodes, pass networks, heatmaps (pitch vs image space), off-ball runs, pressing windows, cohorts |
| 06 | wizard step, aspect ratio, duration mode, music library, spotlight/overlay/branding settings with range CHECKs, moment suggestions |
| 07 | media clips with Inspector metadata/tags/notes, 11 timeline track types, captions, revisions, chapters |
| 08 | frozen report snapshots, per-task confidence, role profiles + traits, AI insights with mandatory citations and review state, scouting assessments with four-eyes verification, dossiers, notes |
| 09 | unified library catalogue, collaborators, tags, saved searches (schema-validated), tab counts |
| 10 | export presets, render stages, QC checks, export bundles (PDF/CSV/PNG), share-link status, delivery recipients and client contacts, 300-char message |

## 10. Owner decisions still required
1. **Single max upload size.** The UI copy conflicts: 01 says "up to 2GB", 02 says "50 GB". It is stored in `ingest_limits`; you pick the value.
2. **Header label.** "Owner" (`memberships.role`) or the user's display name?
3. **Retention periods** for `track_observations` windows, `worker_resource_samples` and audit partitions.
4. **Licences.** Which partner/competition marks are actually licensed? With no licence row, nothing renders.
5. **Auto-confirmation policy for identity.** Are any AUTO_POLICY confirmations acceptable, and at what validated threshold?
6. **Search engine.** Stay on MySQL FULLTEXT for v1, or adopt OpenSearch from the start.
