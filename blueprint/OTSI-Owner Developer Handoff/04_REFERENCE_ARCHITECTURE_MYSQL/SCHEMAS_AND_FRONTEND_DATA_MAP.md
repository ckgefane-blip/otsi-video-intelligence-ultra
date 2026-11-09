> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Full UI → backend → DB traceability (10 screens)

## Universal shell
Authenticated `GET /me`, `/organizations`, global search, role-scoped navigation, feature flags, theme preference, notifications. Client separates `server state` (React Query) from transient editor/viewer state (Zustand or equivalent). All pages use `loading`, `empty`, `partial`, `ready`, `review_required`, `blocked`, `error` states, contextual retry and network reconnect.

| Screen | UI sections and data consumers | API/service | DB entities |
|---|---|---|---|
| 01 Home | hero/CTA (static localized copy); dashboard KPIs (real aggregates w/ freshness); recent matches; sample reels; capabilities; how-it-works | GET `/dashboard`, `/library`; user/entitlements | video_sources, matches, reel_projects, render_jobs, report_jobs, assets, projects |
| 02 Upload | match context, file drop zone, URL input, batch ingest, formats, recent upload cards, progress preview, metadata editor | `/uploads/init/complete`, `/videos/import`, `/videos/{id}`, `/analysis-runs/{id}` | projects, matches, video_sources, assets, pipeline_runs/steps, rights_grants |
| 03 AI Processing | total/stage progress, processing viewer, object tiles, GPU metrics, processing log, frame timeline, summary | `/analysis-runs/{id}`, `/events`, `/overlay-chunks`, ops telemetry endpoint | steps, job_events, detection_batches, tracks, frame_index, model_versions |
| 04 Analysis | player boxes/IDs/tracks toggles, video transport, player list, event filters, track presence lanes, selected player, clip creation | `/playback`, `/overlay-chunks`, `/tracks`, `/events`, `/reels` | tracks, observations, decisions, events, assets, metrics, reel_clips |
| 05 Tactical | formation board, synced viewer, passing network, heatmaps, pressing, off-ball runs, comparisons | `/tactics`, `/metrics`, `/events`, `/playback` | pitch_calibrations, metric_definitions/values, track_segments, event_candidates |
| 06 Reel Builder | steps, target selection, style/ratio sliders, preview, suggested moments, layered timeline, branding, generate action | `/reels`, `/moment-suggestions`, `/reels/{id}/renders` | reel_projects/targets/clips, timeline_*, effect_presets, render_jobs |
| 07 Clip Studio | media bin, track inspector, preview, editing tools, n-layer timeline, keyframes, captions/audio, save | `/library`, `/reels/{id}`, `/playback`, `/moment-suggestions` | assets, reel_clips, timeline_tracks/items, effect_keyframes, comments |
| 08 Player Report | identity header, provenance/status, metrics, heatmap, event list, action map, comparison, PDF, scouting dossier | `/players/{id}/report-data`, `/reports`, `/tracks/{id}/identity-candidates` | players/rosters, identity_decisions, metric_values, event_candidates, report_jobs |
| 09 Library | tabs/counts, filters, saved search, project rows, selected asset preview, collaborators, share/download | `/library`, `/projects`, `/assets/{id}/download-grant`, `/assets/{id}/share-links` | projects, assets, reel_projects, share_links, memberships |
| 10 Export | final preview, chapters, output config, render queue, report bundle, branding, share link, notifications, delivery | `/renders`, `/reports`, `/assets/{id}/download-grant`, `/deliveries` | render_jobs, report_jobs, rights_grants, assets, share_links, deliveries |

## Shared types
```ts
type EvidenceState = 'DETECTED'|'INFERRED'|'CONFIRMED'|'NOT_MEASURED';
type IdentityState = 'UNRESOLVED'|'CANDIDATE'|'CONFIRMED'|'REJECTED'|'CONFLICT';
type JobState = 'QUEUED'|'RUNNING'|'SUCCEEDED'|'FAILED'|'CANCELLED'|'BLOCKED'|'REVIEW_REQUIRED';
type MediaPtsUs = number; // integer, <= Number.MAX_SAFE_INTEGER; use bigint where necessary
interface EvidenceLabel {state:EvidenceState; modelVersionId?:string; evidenceId?:string; definitionId?:string; qualityScore?:number}
interface MetricView {key:string; value:number|null; unit:string; evidence:EvidenceLabel; sampleWindow:{startPtsUs:number; endPtsUs:number}}
interface TrackPoint {frameIndex:number; ptsUs:number; bbox:[number,number,number,number]; observationState:'DETECTED'|'PREDICTED'|'INTERPOLATED'|'REVIEWED'; confidence:number|null}
interface ReelClip {id:string; sourceVideoId:string; sourceInPtsUs:number; sourceOutPtsUs:number; seq:number; reviewState:'PENDING'|'APPROVED'|'REJECTED'|'RED'}
```

## UI consistency laws
- Never derive `Processing complete` from `100%` progress if a mandatory step failed or review pending.
- All table stats from server-provided metrics with provenance. `NOT_MEASURED` renders em dash and explanatory tooltip, not 0.
- Boxes use confidence/evidence per frame, with gaps; when player selected by image click, select track UUID first, then fetch identity decision.
- No 'UEFA/FIFA trusted' or logo partnership indicators without legally substantiated licenses; demo visual references do not authorize commercial branding.
- A UI toggle switches display state only; track overlay does not imply engine reprocessing unless explicit workflow requests it.
- Every reel export checks clip edit version, source/license restrictions and verified target across timeline.
- Match context left panel should be present only where useful; not every page should be forced into identical sidebars.
