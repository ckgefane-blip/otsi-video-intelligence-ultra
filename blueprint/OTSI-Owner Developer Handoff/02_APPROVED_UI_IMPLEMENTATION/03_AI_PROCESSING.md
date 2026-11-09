# OTSI VIE — Page 03: AI Processing Pipeline

> UI/UX + frontend behavior + backend engineering specification. **Visible section count: 11.** Reference: approved visual direction, first 10-image batch. This file documents the intended implementation, not an audited deployment.

## Page purpose, entry and exit

This page implements **AI Processing Pipeline** in the connected OTSI Video Intelligence Engine journey. Entry may be direct via authenticated deep link or from the preceding screen. Persist workspace, match, asset, analysis-run, selected player(s), match time and project revision in URL/application state as applicable. Exit to related pages must not reset unsaved choices silently. Every section below is scoped by its actual purpose; section counts vary per page.

## Section inventory (top-to-bottom, purpose-specific)

1. **Run headline and selected media summary** — Large title, current match competition/teams/date, source quality/duration, overall progress.

2. **Five-step pipeline lifecycle** — Detection, tracking, identity resolution, event detection, indexing cards with status, progress and short descriptions.

3. **Main frame-level detection preview** — Large sync-able broadcast video with bounding boxes, labels, one highlighted candidate and per-frame timestamp.

4. **Player detection inset** — Crop preview of detected player and box/id indication.

5. **Ball detection inset** — Ball close-up with box and model confidence.

6. **Team identification inset** — Side-by-side team kit classification candidates.

7. **Event marker inset** — Mini-pitch with typed event markers; legend for passes/shots/tackles/fouls/offside.

8. **Processing log** — Timestamped streaming diagnostic list, Live dot, auto-scroll.

9. **System resources** — GPU, CPU and memory usage displays and trend sparklines.

10. **Frame-level processing timeline** — Time-ranged colored stage bands, seek cursor and coverage/holes.

11. **Live output summary** — Players tracked, ball track count, detected events, processed duration summary cards.


## Ultra-detailed section specifications


### 01. Run headline and selected media summary

**Visual anatomy / what this section shows.** Large title, current match competition/teams/date, source quality/duration, overall progress.

**User workflow and behavior.** Link back to ingest item; overall progress weighted from actual completed frames/stages; accessible current status. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_matches, otsi_media_assets, otsi_analysis_runs`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /analysis-runs/:id`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** No fabricated ETA or completion. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 02. Five-step pipeline lifecycle

**Visual anatomy / what this section shows.** Detection, tracking, identity resolution, event detection, indexing cards with status, progress and short descriptions.

**User workflow and behavior.** Stage DAG supports independent retries, cancellation and output provenance; identity remains review-pending even if track generation completes. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_pipeline_stage_runs, otsi_analysis_runs, otsi_model_versions`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /analysis-runs/:id/stages; POST /analysis-runs/:id/retry-stage`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Do not conflate object tracking with player identification. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 03. Main frame-level detection preview

**Visual anatomy / what this section shows.** Large sync-able broadcast video with bounding boxes, labels, one highlighted candidate and per-frame timestamp.

**User workflow and behavior.** Overlay sourced by PTS from detector/tracker outputs and video transform mapping; choose team/overlay modes, play or scrub without reading nonexistent frames. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_tracklets, otsi_track_points, otsi_frame_detections, otsi_media_assets`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /runs/:id/frames?from_ms=&to_ms=; GET /media/:id/playback`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Mark unresolved identities and occlusions; off-camera player should have no box. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 04. Player detection inset

**Visual anatomy / what this section shows.** Crop preview of detected player and box/id indication.

**User workflow and behavior.** Shows count of concurrently detected players or distinct tracklets with tooltip; open frame/candidate confidence details. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_frame_detections, otsi_tracklets`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /runs/:id/detections?kind=person`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** 22 detected in a frame is not 22 confirmed distinct people. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 05. Ball detection inset

**Visual anatomy / what this section shows.** Ball close-up with box and model confidence.

**User workflow and behavior.** Tracks ball independently; show lost-ball periods and inference status; click jumps to source frame. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_ball_detections, otsi_ball_tracks`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /runs/:id/detections?kind=ball`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Confidence model calibrated per-version; hide when missing. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 06. Team identification inset

**Visual anatomy / what this section shows.** Side-by-side team kit classification candidates.

**User workflow and behavior.** Sample track crops, team-color clusters and manual corrections; reviewer confirmation yields canonical team association. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_team_assignments, otsi_identity_review_tasks, otsi_teams`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /runs/:id/team-assignments; POST /review/team-assignments/:id`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** A kit color match is an inference, not verified club identity. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 07. Event marker inset

**Visual anatomy / what this section shows.** Mini-pitch with typed event markers; legend for passes/shots/tackles/fouls/offside.

**User workflow and behavior.** Select marker to seek video; store algorithm provenance and review status; filter unsupported event types. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_events, otsi_event_evidence`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /runs/:id/events?types=`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Offside and foul classification require special governance and should not claim officiating-grade correctness. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 08. Processing log

**Visual anatomy / what this section shows.** Timestamped streaming diagnostic list, Live dot, auto-scroll.

**User workflow and behavior.** Deduplicate events by sequence id, group noisy messages, pause auto-scroll when user scrolls, filter errors; audit logs separate. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_job_events, otsi_pipeline_stage_runs`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /jobs/:id/events; GET /jobs/:id/logs`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Do not expose server filesystem paths, keys or secrets. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 09. System resources

**Visual anatomy / what this section shows.** GPU, CPU and memory usage displays and trend sparklines.

**User workflow and behavior.** Display only organization-permitted aggregate worker telemetry, freshness timestamp and hardware labels; hide for unauthorized customers. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_worker_telemetry, otsi_compute_workers`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /system/processing-capacity`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Per-worker GPU claims require real metrics; do not disclose internal fleet data. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 10. Frame-level processing timeline

**Visual anatomy / what this section shows.** Time-ranged colored stage bands, seek cursor and coverage/holes.

**User workflow and behavior.** Scrub by PTS, show processed coverage by stage, clicks focus corresponding source preview; large matches paginated by interval. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_stage_time_spans, otsi_pipeline_artifacts`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /analysis-runs/:id/timeline?start_ms=&end_ms=`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Handle partial coverage and corrupted segments explicitly. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 11. Live output summary

**Visual anatomy / what this section shows.** Players tracked, ball track count, detected events, processed duration summary cards.

**User workflow and behavior.** Compute counters with declared definitions (unique tracklets versus unique confirmed players); update with event stream; clicking opens filtered detail. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_tracklets, otsi_identity_matches, otsi_events, otsi_analysis_runs`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /analysis-runs/:id/summary`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Never present unreviewed detections as verified discoveries. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


## Specification status and implementation boundaries

- **Screen reference:** the rendered image is a visual design specification, **not evidence that live data or backend services exist**. All match scores, player stats, percentages, match footage, brands, client identities, usage totals, service capacities and timestamps shown in the image are illustrative fixtures until independently imported and verified.
- **Schema:** every `otsi_*` table, field and API endpoint in this document is a **proposed logical contract** for implementation. It is *not* a claim that such a table currently exists. During integration, maintain an explicit mapping from this contract to the real schema and do not overwrite canonical existing records.
- **Trust:** each computed quantity and player association MUST carry `evidence_state` (`DETECTED`, `INFERRED`, `CONFIRMED`, `NOT_MEASURED`), `measurement_method`, `source_asset_id`, `algorithm_version`, and, where meaningful, `confidence` and `reviewer_id`. A detected bounding box is not automatically a confirmed player identity. When the measurement is unavailable, show “Not measured”; never fabricate distance, speed, xG, precision, role or recognition accuracy.
- **Rights:** distinguish `INTERNAL`, `EXPORT_ALLOWED`, `PUBLIC`, `ANALYSIS_ONLY`, `UNKNOWN`, `EXPIRED`; sharing/download/export needs an export-entitled right at the point of delivery, independent of the right to analyze. Consent policies apply to minors. `RED`/rejected/unreviewed-for-export clips cannot be exported. Check rights again when a queued job executes or a signed link is opened.
- **Units/time:** persist clock times as integer milliseconds relative to source media and use a separate period/match-clock transform (stoppage time, halftime, seek discontinuities). Show distance in km only if camera calibration and acceptable measurement quality exist. Percentages must show a denominator and methodology tooltip.
- **Accessibility:** keyboard focus, semantic labels, 44px-equivalent touch targets where feasible, color + icon + text for statuses, captioning, reduced-motion variants for cinematic rays, and WCAG AA contrast. Desktop is primary; on tablet collapse inspectors into drawers; never hide safety controls.
- **Error contract:** backend errors include `code`, `message`, `correlation_id`, `retryable`, `field_errors` and an audit trail as appropriate. Loading, empty, permission-denied, partial-data, offline/reconnect, and retry states must be designed for each section.
- **Design tokens (proposed):** canvas `#06111F`, panel `#0C1D30`, raised `#10243A`, border `#1B3C56`, primary electric-blue `#079BFF`, cyan `#17D1F8`, amber `#F1A824`, text `#F4F8FF`, secondary text `#9CB1C5`; consistent 8px spacing scale, moderate 8–12px corner radius, typography for tabular numerals, restrained background glow. Exact production palette and OTSI logo asset must be approved; generated logo artwork is a concept only.

## Shared domain model and proposed relationships

`otsi_organizations(id, name)` owns `otsi_workspaces(id, organization_id, name)` and membership through `otsi_memberships(workspace_id,user_id,role)`. `otsi_matches(id,workspace_id,competition_id,home_team_id,away_team_id,kickoff_at,match_status)` owns `otsi_media_assets(id,match_id,storage_key,checksum,duration_ms,frame_rate,width,height,rights_id)` and `otsi_analysis_runs(id,asset_id,pipeline_version,status,started_at,finished_at)`. Each run owns `otsi_tracklets(id,run_id,temporary_object_id,start_ms,end_ms,team_id,quality_state)` and time-indexed `otsi_track_points(tracklet_id,pts_ms,bbox_x,bbox_y,bbox_w,bbox_h,visibility,occlusion_state)`; canonical identity is mapped through `otsi_identity_matches(tracklet_id,player_id,decision_state,confidence,reviewed_by,reviewed_at)` to `otsi_players(id,canonical_otsi_id,display_name,team_id,jersey_number)`.

`otsi_events(id,run_id,player_id,tracklet_id,event_type,start_ms,end_ms,evidence_state,confidence,source_method)` links `otsi_clips(id,asset_id,start_ms,end_ms,review_state,rights_snapshot_id)` and `otsi_clip_events(clip_id,event_id)`. A reel is `otsi_reel_projects(id,workspace_id,title,revision,status)` with ordered `otsi_reel_segments(id,project_id,clip_id,source_in_ms,source_out_ms,sequence,transform_json)` and `otsi_effect_keyframes(segment_id,tracklet_id,time_ms,effect_type,parameters_json)`. `otsi_render_jobs(id,project_id,revision,status,output_asset_id,progress,rights_check_at)` produces an encoded `otsi_media_assets` record and separately governed `otsi_delivery_links(id,asset_id,expires_at,rights_id,download_policy)`.

Quantified outputs are `otsi_measurements(id,subject_type,subject_id,metric_key,value,unit,source_run_id,measurement_method,evidence_state,confidence,quality_flags_json)`. `otsi_reports(id,workspace_id,player_id,run_id,report_version,status,output_asset_id)` links derived insights to provenance. `otsi_audit_events(id,actor_id,action,resource_type,resource_id,at,metadata_json)` records review, writes, publishing, sharing and downloads. Store original footage and binary reports in object storage, not relational BLOB fields; DB stores checksum, URI/storage key, content type, permissions, and versions. Implement real schema by migrations and read-only compatibility mapping, never by assuming these contracts already exist.

## Common service conventions

- `GET /api/v1/me`, `GET /api/v1/workspaces/{id}`, `GET /api/v1/matches/{id}` return permission-scoped identities and match context; every collection endpoint is cursor-paginated and server-filtered.
- `GET /api/v1/media/{id}/playback` returns short-lived authorized playback manifests; no public raw object-store credentials.
- `POST` mutation endpoints require authentication, workspace authorization, input validation, idempotency key for expensive jobs, CSRF defenses when session cookies are used, and audit logging.
- Long-running jobs publish versioned progress messages on `/api/v1/jobs/{id}/events` (SSE/WebSocket), with polling fallback, monotonic stage transitions and explicit failed/cancelled/retryable states. Never infer completion from frontend animation.
- Video annotation overlays are timestamped normalized coordinates, interpolated only across bounded valid track intervals. Hide boxes when the track is occluded/off-camera and indicate reidentification uncertainty on reentry.
- Design samples must include clear `DEMO DATA` markers in mock mode, especially on reports, rankings, metrics and public-facing trust claims.


## Page-specific acceptance test matrix

| Scenario | Expected behavior |
|---|---|
| Authorized analyst enters AI Processing Pipeline | Correct match/project context, role, navigation and section-specific data load. |
| User has no data | Empty state guides import or creation without misleading placeholder metrics. |
| Source analysis only partly complete | Only genuinely available layers/sections work, unknown data remain unknown. |
| Selected item has ambiguous identity | Track ID may display; confirmed real-player identity and export actions remain gated. |
| User toggles/filter/searches | Server-scoped results update without losing unsaved work or playback sync. |
| Network disconnects | Current read-only view survives where possible; mutations queue only when safe, otherwise show retry. |
| User lacks export entitlement | Preview may remain if permitted; download/share delivery fails closed. |
| Rights or consent revoked after render queued | Recheck prevents output delivery even if an earlier preview existed. |
| Reload/deep link | Persisted state restores with current server truth and correct revision. |
| Tablet width | Secondary inspector collapses; primary task remains readable and keyboard accessible. |

## Data validation and release checklist

- Capture screenshot comparison with the corresponding image at desktop target and tablet layout; verify no clipping, overlap or placeholder-only controls.
- Unit-test all metric definitions, time transforms, state transitions, permission guards and API error types.
- Integrate source/evidence drilldown before enabling verified scouting/export badges.
- QA with a known match containing occlusions, camera cuts, substituted players, absent jersey numbers, multiple teams with similar kits and unseen players.
- Audit every displayed image metric; label sample fixture data in non-production environments.
- Verify export rights with a matrix including INTERNAL, EXPORT_ALLOWED, PUBLIC, ANALYSIS_ONLY, UNKNOWN, EXPIRED and guardian-consent restrictions.
- Instrument performance, accessibility, tracking provenance and rendering job failure analytics.

## Explicit non-claims

These UI visuals do **not** establish real integrations with UEFA, FIFA, clubs, Wyscout or Hudl; do not establish a real tracked player, a completed encoded reel, accurate physical measurements, live GPU stats, or an implemented production database. The implementation team must validate each capability before it is presented as production-ready.
