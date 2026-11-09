# OTSI VIE — API contract by page (BFF → MySQL)

**Transport (inherited from the handoff)**

| Item | Rule |
|---|---|
| Base path and payloads | Base `/v1`, JSON camelCase |
| Media time | Integer microseconds, sent as strings when > 2^53 |
| Timestamps | ISO-8601 UTC |
| Pagination | Cursor-based: `?cursor=&limit=` |
| Optimistic locking | ETag = `row_version`; mutations send `If-Match` |
| Costly jobs | `Idempotency-Key` header |
| Errors | `{error:{code,message,requestId,details,retryable}}` |

**Evidence wrapper used everywhere a number is shown**

```ts
type EvidenceState = 'DETECTED'|'INFERRED'|'CONFIRMED'|'NOT_MEASURED';
interface Measured<T=number> { value: T|null; unit?: string; evidence: EvidenceState; coverage?: number|null;
  deltaPct?: number|null; uncertainty?: number|null; qualityScore?: number|null; metricKey?: string }
// value === null  ⇔ evidence === 'NOT_MEASURED'  → UI renders "—" + tooltip (never 0)
type JobState = 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'BLOCKED'|'REVIEW_REQUIRED';
interface AssetRef { id: string; url?: string /* short-lived signed URL, issued only after authorisation */ }
```

Every query below runs with `organization_id = :org` taken from the authenticated membership, never from the request.

---

## Shell (all pages)
`GET /me` → users + memberships + organizations + user_preferences
```ts
{ user:{id, displayName, initials, avatarColor, avatar?:AssetRef}, organization:{id, name /* "OTSI VIE" line */},
  role:'OWNER'|'ADMIN'|'ANALYST'|'EDITOR'|'SCOUT'|'VIEWER', preferences:{displayMode:'QHD'|'FHD'|'AUTO', uiState}, unreadNotifications:number }
```
`PATCH /me/preferences` (If-Match). `GET /notifications?cursor`.

## 01 Home Overview
`GET /dashboard` reads 1 view per block.
```ts
{ kpis: Array<{key:'MATCHES_ANALYZED'|'PLAYERS_TRACKED'|'REELS_GENERATED'|'REPORTS_CREATED'; value:number; trendPct:number|null; series:number[]; computedAt:string}>, // v_home_kpis
  featuredReel: null | {libraryItemId, reelId, title, subtitle, durationUs, outputResolution:'720p'|'1080p'|'1440p'|'4K'|null,
                        tags:string[], views:number, likes:number, thumbnail:AssetRef, leadPlayerId:string|null},      // v_reel_cards WHERE is_featured
  spotlight: null | {player:{id, displayName, squadNumber:number|null, positionLabel, clubName}, metrics:Measured[]},     // v_player_header + v_player_current_metrics (CONFIRMED identity only)
  recentMatches: Array<{videoId, matchId, title, competitionName, kickoffAt, durationUs, score:{home:number,away:number}|null,
                        scoreEvidence:EvidenceState, poster:AssetRef, crests:[AssetRef|null,AssetRef|null], analysisStatus:JobState|null}>, // v_home_recent_matches LIMIT 4
  sampleReels: Array<…same as featuredReel…>,                                                                            // v_reel_cards ORDER BY updated_at DESC LIMIT 3
  partners: Array<{name, logo:AssetRef}> }                                                                              // partner_brands (licensed only)
```
- Mutations: `POST /library/:id/bookmark`, `DELETE …/bookmark`, `POST /library/:id/like`.
- CTAs route to `/upload` (file or URL tab).
- Empty state: `featuredReel:null`, so the UI shows "No published reels yet".

## 02 Upload & Ingest
| Endpoint | Source |
|---|---|
| `GET /ingest/config` | `supported_media_formats` (8 chips), `ingest_limits` (max bytes/duration) |
| `GET /competitions?q` · `GET /competitions/:id/seasons` · `GET /matches?competitionId&seasonId` | registry (Match Context selects) |
| `POST /videos` `{projectId, matchId?, title?, ingestMode, options:{14 toggles}}` | `video_sources` + `video_ingest_options` |
| `POST /uploads/init` `{videoId, filename, bytes, sha256?, mimeType}` (Idempotency-Key) | `upload_sessions` → returns part URLs |
| `POST /uploads/:id/parts/:n/complete` `{etag, sha256}` · `POST /uploads/:id/complete` · `DELETE /uploads/:id` (aborts multipart) | `upload_parts`, `assets` |
| `POST /imports` `{videoId, url, provider}` | `url_imports` (SSRF + terms gates) |
| `POST /batches` | `ingest_batches` |
| `GET /videos/recent?limit=5` | `v_upload_recent` (status pill = `statusPill`: COMPLETED/PROCESSING/QUEUED/FAILED/NONE) |
| `GET /videos/:id/summary` | `v_upload_selected_item` + `video_detected_teams` |
| `GET /videos/:id/pipeline?surface=UPLOAD` | `v_run_stage_progress` (+ `upload_sessions.progress_pct` for "Uploading") + latest `pipeline_preview_frames` per kind |
| `PATCH /videos/:id/metadata` (If-Match) | `video_sources`, `matches`, `video_detected_teams` confirmation |

```ts
// GET /videos/:id/summary
{ videoId, title, matchTitle, competitionName, kickoffAt, poster:AssetRef,
  file:{name, bytes}, resolution:{w,h}, fps:number, durationUs, detectedContent:{class, band:'HIGH'|'MEDIUM'|'LOW'|null, evidence},
  detectedTeams:Array<{side, kitColorName, proposedClub:{id,name,crest}|null, confidence, evidence}> }
```

## 03 AI Processing
| Endpoint | Source |
|---|---|
| `GET /runs/:id` | `pipeline_runs` + `v_match_labels` (job card: competition, match title, date, resolution, duration, overall progress, ETA) |
| `GET /runs/:id/stages?surface=PROCESSING` | `v_run_stage_progress` (5 cards: ring/bar/percent/pill) |
| `GET /runs/:id/previews` | `pipeline_preview_frames` (PROCESSING_VIEW + 4 tiles: headline count/confidence, overlay boxes) |
| `GET /runs/:id/log?after=<id>` and **SSE** `GET /runs/:id/events` | `job_log_entries` (`id` is the SSE event id) |
| `GET /runs/:id/timeline` | `pipeline_step_segments` + stage colours |
| `GET /runs/:id/summary` | `v_run_output_summary` (Players Tracked, Ball Tracked, Events Detected, Processed) |
| `GET /system/resources` (role ≥ ANALYST; aggregated, non-identifying) | `v_system_resources` + last 14 samples for sparklines |
| `POST /runs/:id/cancel` · `POST /runs/:id/retry` (new attempt row) | `pipeline_runs` |

```ts
// stage card
{ code, label, description, order, status:JobState, progress:number, startedAt, completedAt }
// log row
{ id:number, at:string, level:'INFO'|'SUCCESS'|'WARN'|'ERROR', pending:boolean, message:string, code:string, params:object }
```

## 04 Analysis Workspace
| Endpoint | Source |
|---|---|
| `GET /videos/:id/context` | `v_match_labels`, roster counts per side (`match_rosters`), latest run status (match card + Team Filter counts) |
| `GET /videos/:id/playback` | signed HLS/MP4 URL of `proxy_asset_id` (rights check) |
| `GET /videos/:id/observations?fromUs&toUs&classes` | `track_observations` window (or Parquet range via worker) → `{ptsUs, trackId, bbox:[x,y,w,h], state, conf}` |
| `GET /videos/:id/tracks` | `v_analysis_player_rows` (Players list: #, name only if CONFIRMED, team code, Conf. = top candidate score, Status = quality bars) |
| `GET /videos/:id/presence?trackIds` | `presence_intervals` (Tracks & Presence lanes) |
| `GET /videos/:id/events?chipGroups&fromUs&toUs` · `GET /videos/:id/event-counts` | `event_candidates`, `v_event_chip_counts` |
| `GET /players/:id/summary?videoId` | `v_player_header`, `v_player_current_metrics` (Distance, Top Speed, Passes, Key Passes + deltaPct; Season/Match toggle = `window_kind`), `heatmaps` |
| `POST /identity-decisions` `{trackId, playerId, state, reason, validFromUs?, validToUs?}` (role REVIEW) | `track_identity_decisions` |
| `POST /event-decisions` | `event_decisions` |
| `POST /media-clips` `{videoId, inUs, outUs, playerId?, eventId?}` ("Create Analysis Clip") | `media_clips` |

Overlay toggles are client-only display state, persisted in `user_preferences.ui_state`.

## 05 Tactical Intelligence
| Endpoint | Source |
|---|---|
| `GET /videos/:id/tactics/shape?team&phase&atUs` | `team_shape_snapshots` + `team_shape_nodes` (formation, nodes with confirmed names, width/length/line height/compactness, variability series, stability, build-up/defensive shapes) |
| `GET /videos/:id/tactics/pass-network?team&fromUs&toUs&minEvidence` | `pass_networks` / `_nodes` / `_edges` |
| `GET /videos/:id/tactics/heatmaps?team&kind=POSITION|TERRITORY|FINAL_THIRDS` | `heatmaps` + `metric_values(possession_pct)` |
| `GET /videos/:id/tactics/pressing?team&phase` | `event_candidates` (PRESSURE/BALL_RECOVERY/FORCED_TURNOVER) + `tactical_windows` + `metric_values` (ppda, high_press_success_pct, final_third_regains, avg_press_height_m) |
| `GET /videos/:id/tactics/runs?playerId&fromUs&toUs` | `movement_segments` + run metrics |
| `GET /players/compare?ids=a,b&cohortId&window` | `v_player_header` ×2 + `v_player_current_metrics` |

Each tactical payload carries `evidence` and `calibrated:boolean`. If uncalibrated, metre values are `null` (`NOT_MEASURED`).

## 06 Reel Builder
| Endpoint | Source |
|---|---|
| `POST /reels` `{projectId, videoId, reelKind}` | `reel_projects` + default `reel_style_settings`, `reel_settings_flags`, timeline tracks |
| `GET /reels/:id` (ETag) | reel + style + targets + target player header + scorebug labels |
| `PATCH /reels/:id` `{title, description, aspectRatio, durationMode, musicTrackId, wizardStep}` | `reel_projects` |
| `PUT /reels/:id/style` (sliders 0–100, overlay and branding toggles) | `reel_style_settings` |
| `PUT /reels/:id/targets` `{playerId, identityDecisionId}` | `reel_targets` (DB rejects unconfirmed → `422 IDENTITY_UNRESOLVED`) |
| `GET /reels/:id/moments` · `PATCH /reels/:id/moments/:mid {status}` | `moment_suggestions` (header count = non-dismissed) |
| `GET /music-tracks` | `music_tracks` (licensed) |
| `POST /reels/:id/revisions` (Save Project) | `reel_revisions` (immutable snapshot + SHA-256) |
| `POST /reels/:id/render-jobs {kind:'PREVIEW'|'FINAL'}` (Generate Reel / Preview Render) | see 10 |

## 07 Clip Studio
| Endpoint | Source |
|---|---|
| `GET /media-bin?folderId&q&tab=MEDIA|GRAPHICS|AUDIO|TEMPLATES&cursor` | `media_clips` (FULLTEXT) / `effect_presets` / `music_tracks` / `library_items` templates |
| `GET /folders/:id/breadcrumb` | `folders.path_cache` |
| `GET /reels/:id/timeline` (ETag) · `PUT /reels/:id/timeline` (If-Match) | `timeline_tracks`, `timeline_items`, `effect_keyframes`, `caption_cues`, `reel_clips` (counts per track = items per track) |
| `GET /media-clips/:id` · `PATCH /media-clips/:id` · `PUT /media-clips/:id/tags` | Inspector: name, duration, resolution/fps/format, added-at, player, match, event type, timestamp + period, tags, notes |
| `POST /reels/:id/ai-edit` · `POST /reels/:id/auto-captions` · `POST /reels/:id/ai-highlights` | jobs → workers (results land as timeline items with `source='AUTO_*'`) |
| `POST /reels/:id/preview-renders` | render job kind PREVIEW |

Undo/Redo is client-side; Save writes a revision. STAT items must reference `metricValueId` (DB CHECK).

## 08 Player Report
`GET /players/:id/report?reportId` (or latest PUBLISHED/READY for the player and scope)
```ts
{ report:{id,status,scope,cohort}, header: v_player_header & {squadNumber, clubCrest, flag},
  confidence:{trackingCoverage:number|null, identityState, observedMinutes:number|null, qualityBand},     // report_identity_confidence
  role:{title, summary, traits:string[], authorKind, approved:boolean}|null,                               // player_role_profiles(+traits)
  kpis: Measured[] /* 9 tiles, frozen */, comparison: Array<{metricKey,label,player:Measured,cohortAvg:number|null}>, // report_metric_snapshots
  insights: Array<{icon,accent,headline,body,reviewState,citations:Array<{metricValueId?,eventId?,cohortId?}>}>,   // report_insights
  scouting:{overallRating:number|null, scaleMax:10, strengths:string[], quote:string|null, status, verifiedBy?}|null }
```
- `GET /players/:id/heatmap?videoId&kind=POSITION|TOUCHES|TERRITORY&period` → `heatmaps`
- `GET /players/:id/events?videoId&types&cursor` → `event_candidates` (+ `clip_asset_id` play buttons)
- `GET /players/:id/action-map?videoId&types` → `event_candidates` with coordinates (calibrated only)
- `POST /reports/:id/exports {kind:'PLAYER_REPORT_PDF'}` → `report_exports`
- `POST /dossiers/:id/items` (Add to Scouting Dossier)
- `POST /share-links` (Share Link)
- `PATCH /reports/:id/role` (Edit)

## 09 Library / Project Center
| Endpoint | Source |
|---|---|
| `GET /library?tab&q&type&competitionId&clubId&createdBy&dateRange&cursor` | `v_library_rows` (+ `MATCH(title,subtitle,description) AGAINST (:q IN BOOLEAN MODE)`) |
| `GET /library/counts` | `v_library_tab_counts` (+ "Shared With Me" = items where caller is collaborator) |
| `GET/POST/DELETE /saved-searches` | `saved_searches` (JSON-schema-validated) |
| `GET /library/:id` | item + players featured + match labels + creator + tags + collaborators + file facts |
| `POST /library/:id/duplicate` · `POST /projects` (New Project) | domain duplicate + `library_items` |
| `POST /assets/:id/download-url` | policy check DOWNLOAD → signed URL, audit |
| `POST /share-links` · `POST /deliveries` (Send to Client) · `PUT /library/:id/collaborators` (Manage Access) | delivery tables, `library_item_collaborators` |

Row DTO: `{id, type, title, subtitle, durationUs, thumbnail, playersFeatured:{ids:string[], extra:number}, collaborators:[{initials,color}], updatedAt, status}`.

## 10 Export & Delivery
| Endpoint | Source |
|---|---|
| `GET /reels/:id/export-context` | Project Summary (`reel_projects`, `v_match_labels`, tags, chapters count, sequence duration) |
| `GET /export-presets` | `export_presets` |
| `GET /brand-kits` | `brand_kits` |
| `GET/PUT /reels/:id/chapters` | `reel_chapters` + `reel_settings_flags.auto_chapters` |
| `POST /render-jobs` `{reelId, revisionId, presetId?, resolution, frameRate, aspectRatio, container, codec, quality, branding:{include, brandKitId, logo, playerNameStats, matchInfoBanner, introOutro}, bundle:{performancePdf, playerAnalysisPdf, eventListCsv, heatmapsPng}}` (Idempotency-Key) | policy → quota → `render_jobs`, `render_job_stages`, `export_bundles` |
| `GET /render-queue` | `v_export_queue` (spec line built client-side: `${container} • ${resolution} • ${aspect} • mm:ss`) |
| `POST /render-jobs/:id/pause` · `/resume` · `/cancel` · `DELETE /render-queue` (Clear All) | `render_jobs` |
| `GET /render-jobs/:id` + **SSE** `/render-jobs/:id/events` | `render_job_stages` (Preparing Files → Rendering Video → Processing Reports → Finalizing), progress, ETA |
| `GET /render-jobs/:id/readiness` | `v_delivery_readiness` (Ready for Delivery / Delivery not ready) |
| `POST /share-links {libraryItemId, password?, expiresAt?, canDownload, canComment}` · `PATCH /share-links/:id` | `share_links` (status PENDING_EXPORT → ACTIVE when render succeeds) |
| `POST /deliveries {libraryItemId, renderJobId, channel, message≤300, notifyTeam, notifyClient, recipients[]}` | `deliveries`, `delivery_recipients`, `client_contacts` |
| `POST /render-jobs/:id/download-all` | zipped signed URL of output + bundle files |
