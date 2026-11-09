# OTSI VIE — Page 02: Upload & Ingest

> UI/UX + frontend behavior + backend engineering specification. **Visible section count: 10.** Reference: approved visual direction, first 10-image batch. This file documents the intended implementation, not an audited deployment.

## Page purpose, entry and exit

This page implements **Upload & Ingest** in the connected OTSI Video Intelligence Engine journey. Entry may be direct via authenticated deep link or from the preceding screen. Persist workspace, match, asset, analysis-run, selected player(s), match time and project revision in URL/application state as applicable. Exit to related pages must not reset unsaved choices silently. Every section below is scoped by its actual purpose; section counts vary per page.

## Section inventory (top-to-bottom, purpose-specific)

1. **Upload page header and source-mode tabs** — Title, help action, Upload File, YouTube/URL, Batch Upload switcher.

2. **Match context metadata sidebar** — Optional competition, season, match dropdowns; selection links the new asset to a known record.

3. **Visual processing configuration** — Stabilize, auto-crop, enhancement, crowd-noise removal, aspect correction.

4. **Detection and ingest options** — Player/team detection, ball detection, jersey OCR, pitch line analysis, event markers, auto-create, metadata, highlights, send-to-analysis.

5. **Primary drag-drop file panel** — Large stadium-backed dropzone, accepted types, max-size guidance, Browse Files, paste-link fallback.

6. **URL input and external-source ingestion** — URL textbox and Add URL action, YouTube/direct-link style support.

7. **Supported formats strip** — Tiles for MP4, MOV, AVI, MKV, MPEG, FLV, TS, WEBM with codec hints.

8. **Recent uploads panel** — Recent files with thumbnail, duration, date, progress/queued/completed/failed chips and overflow menu.

9. **Selected upload preview / metadata editor** — Right detail preview, file name, size, dimensions, FPS, duration, matched competition/teams and Edit Metadata.

10. **Processing pipeline preview strip** — Horizontal upload, detection, tracking, indexing, analysis-ready cards with progress bars and video thumbnails.


## Ultra-detailed section specifications


### 01. Upload page header and source-mode tabs

**Visual anatomy / what this section shows.** Title, help action, Upload File, YouTube/URL, Batch Upload switcher.

**User workflow and behavior.** Selecting a tab changes only input method and retains valid metadata draft; unsupported sources show explicit rights/licensing guidance. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_ingest_drafts, otsi_external_sources`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `POST /ingest/drafts; PATCH /ingest/drafts/:id`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Remote media acquisition must comply with site rights and access controls. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 02. Match context metadata sidebar

**Visual anatomy / what this section shows.** Optional competition, season, match dropdowns; selection links the new asset to a known record.

**User workflow and behavior.** Searchable async pickers, no duplicate match if one exists; user can create new match after validation and prevent invalid teams. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_competitions, otsi_seasons, otsi_matches, otsi_teams`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /competitions; GET /matches?season=; POST /matches`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Season/match fixtures in picture are mock only. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 03. Visual processing configuration

**Visual anatomy / what this section shows.** Stabilize, auto-crop, enhancement, crowd-noise removal, aspect correction.

**User workflow and behavior.** Each switch creates a versioned preprocessing request; unsupported transforms disabled with reason; preview original vs processed and preserve original immutable. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_ingest_profiles, otsi_transcode_jobs, otsi_media_asset_versions`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `PATCH /ingest/drafts/:id/settings; POST /transcodes`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Quality enhancement cannot manufacture factual evidence. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 04. Detection and ingest options

**Visual anatomy / what this section shows.** Player/team detection, ball detection, jersey OCR, pitch line analysis, event markers, auto-create, metadata, highlights, send-to-analysis.

**User workflow and behavior.** Selections become pipeline config snapshot; dependencies validated (player tracks require detection); avoid showing default-on as proof support. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_pipeline_profiles, otsi_pipeline_run_configs`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /pipeline/capabilities; PATCH /ingest/drafts/:id/config`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Planned models shown disabled with status. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 05. Primary drag-drop file panel

**Visual anatomy / what this section shows.** Large stadium-backed dropzone, accepted types, max-size guidance, Browse Files, paste-link fallback.

**User workflow and behavior.** Validate MIME plus file signature, size and quota; chunked resumable upload with pause/resume/retry, checksum, cancel; never auto-submit merely on drop without chosen settings. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_upload_sessions, otsi_media_assets, object storage multipart upload state`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `POST /uploads/init; PUT signed parts; POST /uploads/complete; DELETE /uploads/:id`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Scan malware, enforce quotas; size limit sourced from configuration not artwork. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 06. URL input and external-source ingestion

**Visual anatomy / what this section shows.** URL textbox and Add URL action, YouTube/direct-link style support.

**User workflow and behavior.** Validate allowlist, metadata availability, entitlement and server-side SSRF safeguards; distinguish metadata-only links from downloadable sources. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_external_sources, otsi_ingest_jobs, otsi_rights_grants`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `POST /ingest/resolve-url; POST /ingest/from-url`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** No bypassing DRM, platform TOS, or private links. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 07. Supported formats strip

**Visual anatomy / what this section shows.** Tiles for MP4, MOV, AVI, MKV, MPEG, FLV, TS, WEBM with codec hints.

**User workflow and behavior.** List generated from backend transcoder capabilities, distinguish container vs codec, expose incompatibility diagnostics. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_supported_media_profiles (configuration table)`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /system/media-capabilities`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Do not promise every codec/container without testing. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 08. Recent uploads panel

**Visual anatomy / what this section shows.** Recent files with thumbnail, duration, date, progress/queued/completed/failed chips and overflow menu.

**User workflow and behavior.** Open job detail, cancel/retry per permissions, display exact status and elapsed timestamps; paginate beyond first five. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_upload_sessions, otsi_ingest_jobs, otsi_media_assets`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /ingest/jobs?limit=5; POST /ingest/jobs/:id/retry`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Redact original private filenames where necessary. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 09. Selected upload preview / metadata editor

**Visual anatomy / what this section shows.** Right detail preview, file name, size, dimensions, FPS, duration, matched competition/teams and Edit Metadata.

**User workflow and behavior.** Read verified ffprobe-derived media metadata; inline edits versioned and audited; detected teams remain inferred until confirmation. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_media_assets, otsi_media_technical_metadata, otsi_match_asset_links, otsi_identity_review_tasks`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /media/:id/metadata; PATCH /media/:id/metadata`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Never let inferred team labels overwrite confirmed canonical identities. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 10. Processing pipeline preview strip

**Visual anatomy / what this section shows.** Horizontal upload, detection, tracking, indexing, analysis-ready cards with progress bars and video thumbnails.

**User workflow and behavior.** Live job events update stage progress; failed states expose retry scope; processing continues server-side after tab closes; inspect frame preview by timestamp. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_analysis_runs, otsi_pipeline_stage_runs, otsi_pipeline_artifacts`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /analysis-runs/:id; GET /jobs/:id/events`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Progress percentages backed by completed work units, not timer-based simulation. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

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
| Authorized analyst enters Upload & Ingest | Correct match/project context, role, navigation and section-specific data load. |
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
