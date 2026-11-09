> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# OTSI VIE — Page 06: Reel Builder / Spotlight Composer

> UI/UX + frontend behavior + backend engineering specification. **Visible section count: 10.** Reference: approved visual direction, first 10-image batch. This file documents the intended implementation, not an audited deployment.

## Page purpose, entry and exit

This page implements **Reel Builder / Spotlight Composer** in the connected OTSI Video Intelligence Engine journey. Entry may be direct via authenticated deep link or from the preceding screen. Persist workspace, match, asset, analysis-run, selected player(s), match time and project revision in URL/application state as applicable. Exit to related pages must not reset unsaved choices silently. Every section below is scoped by its actual purpose; section counts vary per page.

## Section inventory (top-to-bottom, purpose-specific)

1. **Four-step reel workflow** — Select Player, Choose Moments, Edit & Style, Export with check and active markers.

2. **Aspect ratio presets** — 16:9, 9:16, 1:1 presets with platform examples.

3. **Reel metadata and music** — Title, description, automatic duration selector, licensed cinematic music preset.

4. **Cinematic preview video** — Dominant selected-player footage with light rays, spotlight glow, source score/time, identity header and playback bar.

5. **Targeting and lock controls** — Auto Track Player, Lock on #17, Re-detect Player.

6. **Spotlight settings sliders** — Intensity, ray width, vignette, glow, target-lock sensitivity and Reset All.

7. **Overlays and branding toggles** — Player card, match score/time, competition logo, animated lower third, watermark, custom logo, end screen.

8. **Suggested key moments carousel** — Five visible clip candidates with thumbnails, tags, timestamps, duration and selection checkboxes; twelve suggested total.

9. **Multitrack quick timeline** — Video clip strip, spotlight effect lane, purple text overlays, audio waveform, playhead.

10. **Generate Reel, Preview Render and Save** — Right-column primary Generate button, preview render, save project.


## Ultra-detailed section specifications


### 01. Four-step reel workflow

**Visual anatomy / what this section shows.** Select Player, Choose Moments, Edit & Style, Export with check and active markers.

**User workflow and behavior.** Persist project step, allow safe backwards navigation; checks require validated upstream state, not cosmetic confirmation. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_projects, otsi_reel_workflow_states`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /reels/:id; PATCH /reels/:id/workflow`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Run rights validation at each export-sensitive transition. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 02. Aspect ratio presets

**Visual anatomy / what this section shows.** 16:9, 9:16, 1:1 presets with platform examples.

**User workflow and behavior.** Changing format updates preview safe-area and tracking-aware reframing; project keeps per-aspect override rather than overwriting master. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_presets, otsi_reel_project_variants`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /reel-presets; PATCH /reels/:id/variants`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Aspect ratio does not guarantee platform compatibility. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 03. Reel metadata and music

**Visual anatomy / what this section shows.** Title, description, automatic duration selector, licensed cinematic music preset.

**User workflow and behavior.** Input auto-saved with debounce/version control; music requires usage rights; duration reflects actual selected segments and effects. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_projects, otsi_audio_assets, otsi_rights_grants`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `PATCH /reels/:id; GET /audio-library`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Protect private player and match descriptions on shared links. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 04. Cinematic preview video

**Visual anatomy / what this section shows.** Dominant selected-player footage with light rays, spotlight glow, source score/time, identity header and playback bar.

**User workflow and behavior.** WebGL/canvas preview computes target anchor from interpolated *valid* track point; smooth temporal tracking with keyframe correction; freeze/hide when target is lost rather than spotlighting random person. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_segments, otsi_track_points, otsi_effect_keyframes, otsi_identity_matches`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /reels/:id/preview-manifest; GET /tracks/:id/points`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Effect is decorative, does not certify player identity. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 05. Targeting and lock controls

**Visual anatomy / what this section shows.** Auto Track Player, Lock on #17, Re-detect Player.

**User workflow and behavior.** Manual target confirmation chooses canonical track(s) across source segments; unresolved identity triggers review; re-detect spawns auditable analysis/review, never silently remaps. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_identity_matches, otsi_identity_review_tasks, otsi_track_links`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `POST /reels/:id/resolve-target; POST /tracks/:id/reanalyse`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Unknown beats wrong, especially after occlusion or camera cut. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 06. Spotlight settings sliders

**Visual anatomy / what this section shows.** Intensity, ray width, vignette, glow, target-lock sensitivity and Reset All.

**User workflow and behavior.** Changes update preview in realtime, throttled commit as effect parameters/keyframes; Reset restores selected preset while preserving undo history. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_effect_presets, otsi_effect_keyframes, otsi_reel_project_versions`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `PATCH /reels/:id/effects; POST /reels/:id/undo`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Slider values are UI percentages mapped into renderer parameters, not model confidence. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 07. Overlays and branding toggles

**Visual anatomy / what this section shows.** Player card, match score/time, competition logo, animated lower third, watermark, custom logo, end screen.

**User workflow and behavior.** Each overlay has layer order and time range; branding asset provenance and licensed usage enforced; render disabled when required image rights lacking. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_brand_assets, otsi_reel_overlay_layers, otsi_rights_grants`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /branding/assets; PATCH /reels/:id/overlays`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** No unauthorized competition insignia in published reels. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 08. Suggested key moments carousel

**Visual anatomy / what this section shows.** Five visible clip candidates with thumbnails, tags, timestamps, duration and selection checkboxes; twelve suggested total.

**User workflow and behavior.** Server ranks evidence-backed events and extracts safe handles; multi-select adds clip references; manual review can reject false highlights. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_events, otsi_clip_suggestions, otsi_clips, otsi_event_evidence`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /runs/:id/clip-suggestions?player_id=; POST /reels/:id/segments`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Confidence/ranking must state model and criteria. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 09. Multitrack quick timeline

**Visual anatomy / what this section shows.** Video clip strip, spotlight effect lane, purple text overlays, audio waveform, playhead.

**User workflow and behavior.** Drag to reorder; trim in/out with frame snapping; keyframe effect segments; undo/redo via project revision, preserving source media. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_segments, otsi_effect_keyframes, otsi_audio_cues`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `PATCH /reels/:id/timeline; POST /reels/:id/versions`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Concurrent editors require revision conflict detection. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 10. Generate Reel, Preview Render and Save

**Visual anatomy / what this section shows.** Right-column primary Generate button, preview render, save project.

**User workflow and behavior.** Preflight checks review state, footage rights, missing target tracking, export profile and quota; queue idempotent render with immutable project revision. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_render_jobs, otsi_render_preflight_results, otsi_reel_project_versions`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `POST /reels/:id/preflight; POST /reels/:id/render`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** RED and analysis-only footage blocked even if browser button appears enabled. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

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
| Authorized analyst enters Reel Builder / Spotlight Composer | Correct match/project context, role, navigation and section-specific data load. |
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
