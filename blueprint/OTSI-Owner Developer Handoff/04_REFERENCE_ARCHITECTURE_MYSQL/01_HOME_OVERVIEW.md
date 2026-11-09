> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# OTSI VIE — Page 01: Home / Overview

> UI/UX + frontend behavior + backend engineering specification. **Visible section count: 9.** Reference: approved visual direction, first 10-image batch. This file documents the intended implementation, not an audited deployment.

## Page purpose, entry and exit

This page implements **Home / Overview** in the connected OTSI Video Intelligence Engine journey. Entry may be direct via authenticated deep link or from the preceding screen. Persist workspace, match, asset, analysis-run, selected player(s), match time and project revision in URL/application state as applicable. Exit to related pages must not reset unsaved choices silently. Every section below is scoped by its actual purpose; section counts vary per page.

## Section inventory (top-to-bottom, purpose-specific)

1. **Global app header and navigation** — OTSI wordmark, Home/Matches/Analysis/Reels/Reports/Library navigation, global search, keyboard hint, theme toggle, analyst profile.

2. **Hero: football video intelligence** — Stadium broadcast visual with target player ID, bounding boxes, visual spotlight and illustrative stat HUD; big product headline and two primary CTAs.

3. **Featured reel** — Large right hero video card with preview, play, duration, descriptive tags, engagement-looking counters and share controls.

4. **Headline KPI strip** — Cards for matches analyzed, players tracked, reels generated, reports created, trends and sparklines.

5. **Trust and credibility strip** — Association/league-style logos and statement of professional trust.

6. **Recent matches** — Four rows with thumbnails, competition, match title, date, duration and score; View All.

7. **Sample reels gallery** — Three side-by-side reel thumbnails with play, duration, title, subtitle, and optional engagement icons.

8. **Platform capabilities grid** — Six descriptive capabilities: detection, tactical intelligence, custom reels, reports, statistics, collaboration.

9. **How It Works journey** — Five-stage illustrated walkthrough: ingest, AI analysis, player selection, reel generation, reports/share.


## Ultra-detailed section specifications


### 01. Global app header and navigation

**Visual anatomy / what this section shows.** OTSI wordmark, Home/Matches/Analysis/Reels/Reports/Library navigation, global search, keyboard hint, theme toggle, analyst profile.

**User workflow and behavior.** App shell persists on route changes; active route reflects router; search offers grouped suggestions and keyboard traversal; theme respects saved preference. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_users, otsi_memberships, otsi_workspaces, otsi_user_preferences, otsi_search_index`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /me; GET /workspaces/:id; GET /search/suggest?q=; PATCH /me/preferences`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Do not expose unauthorized search matches or private player records. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 02. Hero: football video intelligence

**Visual anatomy / what this section shows.** Stadium broadcast visual with target player ID, bounding boxes, visual spotlight and illustrative stat HUD; big product headline and two primary CTAs.

**User workflow and behavior.** Upload Video opens ingest file mode; Paste Link opens URL mode; visuals are marketing/demo only and not current match detections. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_demo_assets or approved marketing CMS assets; no analytics table required`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /marketing/home; route /upload?mode=file|url`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Avoid false partner endorsements; images/logos require licensing. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 03. Featured reel

**Visual anatomy / what this section shows.** Large right hero video card with preview, play, duration, descriptive tags, engagement-looking counters and share controls.

**User workflow and behavior.** Play launches accessible preview with poster fallback; share opens scoped rights dialog; counters not shown unless genuinely collected. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_projects, otsi_render_jobs, otsi_media_assets, otsi_engagement_events, otsi_delivery_links`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /reels?featured=true; POST /reels/:id/share`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Check playback entitlement; do not market fabricated engagements as real. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 04. Headline KPI strip

**Visual anatomy / what this section shows.** Cards for matches analyzed, players tracked, reels generated, reports created, trends and sparklines.

**User workflow and behavior.** Each card links to filtered matching records; period selector applies consistently; present unique counts and avoid counting retries as matches. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_matches, otsi_analysis_runs, otsi_identity_matches, otsi_render_jobs, otsi_reports, otsi_analytics_rollups`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /analytics/home?period=30d&workspace=`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Metric glossary defines all denominators; differentiate tracks from unique confirmed players. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 05. Trust and credibility strip

**Visual anatomy / what this section shows.** Association/league-style logos and statement of professional trust.

**User workflow and behavior.** Only render approved customer/partner logos with contractual permission; otherwise replace with independently verifiable product commitments. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_brand_assets, otsi_marketing_claims`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /marketing/endorsements`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** No implied UEFA/FIFA/Wyscout partnership. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 06. Recent matches

**Visual anatomy / what this section shows.** Four rows with thumbnails, competition, match title, date, duration and score; View All.

**User workflow and behavior.** Open match overview, continue analysis if ready, open processing if pending; sorted by last activity; show status indicators. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_matches, otsi_media_assets, otsi_teams, otsi_competitions, otsi_analysis_runs`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /matches?sort=recent&limit=4`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Scores and timestamps must come from imported verified metadata. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 07. Sample reels gallery

**Visual anatomy / what this section shows.** Three side-by-side reel thumbnails with play, duration, title, subtitle, and optional engagement icons.

**User workflow and behavior.** Play authorized stream; bookmark if permitted; open Reel Builder from card; handle unfinished renders with disabled playback. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_reel_projects, otsi_render_jobs, otsi_media_assets, otsi_bookmarks`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /reels?sample=true&limit=3; POST /bookmarks`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Protect athlete footage rights. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 08. Platform capabilities grid

**Visual anatomy / what this section shows.** Six descriptive capabilities: detection, tactical intelligence, custom reels, reports, statistics, collaboration.

**User workflow and behavior.** Card links to relevant feature route or explainer; capability labels include Demo / Available / Planned according to deployment. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_feature_flags, otsi_capability_registry`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /capabilities`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** Never imply planned deep CV models are live. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

**Visual states and acceptance scenarios.** Skeleton while loading; helpful explanation when empty; partial-result banner when upstream job is incomplete; explicit unavailable/permission denied; retryable failure with correlation reference; read-only state when viewer role lacks write permission. **Accept when:** this section renders correct persisted data after refresh, changes on user action are reflected in the intended dependent sections, actions are audit-logged, and no missing metric is replaced with an invented value.


### 09. How It Works journey

**Visual anatomy / what this section shows.** Five-stage illustrated walkthrough: ingest, AI analysis, player selection, reel generation, reports/share.

**User workflow and behavior.** Each stage is a navigable guided step; resume current project when one exists; step-specific tooltips outline prerequisites. Support mouse/keyboard navigation, accessible help, permission-appropriate action labels, clear selected/hover/focus/disabled states and responsive layout. Any change that affects analysis or a rendered artifact must visibly indicate unsaved, saved, pending-review, rejected, or published state as appropriate.

**Proposed persistence and source-of-truth mapping.** `otsi_onboarding_progress, otsi_analysis_runs, otsi_reel_projects, otsi_reports`. Join through workspace authorization, match/asset IDs and run/version IDs rather than free-text player names. Read from normalized, independently versioned source records. Use rollups or precomputed spatial tiles only as caches, not as an untraceable source of truth. Source media binaries live in rights-protected object storage and all derived outputs retain parent asset IDs and checksums.

**Proposed service contract.** `GET /onboarding/progress; POST /onboarding/action`. Inputs: the current `workspace_id`, `match_id`, `asset_id`, `analysis_run_id`, `player_id`, `project_id` and interval filters only where applicable. Responses should include stable ID, revision, server state, source attribution, `updated_at`, and `permissions` when an action is offered. Validate IDs server-side and return structured errors.

**Computation, consistency and safeguards.** No promised turnaround time without measured system SLA. The UI must not change the evidence state from inferred to confirmed just because an analyst selected a row; confirmation requires a review decision. Interactively changing filters invalidates cached queries by ID, timestamp window and algorithm version. Client-side optimistic updates roll back on authoritative rejection.

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
| Authorized analyst enters Home / Overview | Correct match/project context, role, navigation and section-specific data load. |
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
