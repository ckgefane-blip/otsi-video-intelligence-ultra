> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# API contract v1 — endpoints, authorization, DTOs, errors and realtime events

## Conventions
Base `/api/v1`; bearer/OIDC session and anti-CSRF where browser cookies used. Server derives `organization_id` from authenticated scoped selection; user-supplied org IDs are not trusted. Every POST that initiates long-running or billable work requires `Idempotency-Key`; return the same resource on retry. RFC 7807 problem+json errors with fields `type,title,status,code,request_id,details` (omit sensitive values). All media PTS are integer microseconds. Paginated reads accept `limit<=100`, `cursor`; writes use `If-Match` project version for concurrency; upload/render status via GET + SSE/WebSocket. No long request waits for inference.

## Endpoint registry
| Method / path | Purpose | Request keys | Response keys | Permission | Persistent entities |
|---|---|---|---|---|---|
| POST `/projects` | create project | name, description | id, version | EDIT_PROJECT | projects |
| GET `/dashboard` | home overview | project_filter | KPIs with `source_state`, recent, suggested | READ_PROJECT | projects/assets/runs |
| POST `/uploads/init` | resumable upload session | project_id,filename,size,checksum,mime | session_id,part_urls,expires_at | INGEST | video_sources, upload session |
| POST `/uploads/{id}/complete` | verify completed upload | checksum,parts | video_id,validation_job_id | INGEST | assets/video_sources/outbox |
| POST `/videos/import` | permitted external provider ingest | project_id,source_url,provider_auth_ref | video_id or RIGHTS_REQUIRED | INGEST | video_sources |
| POST `/videos/{id}/analysis-runs` | queue processing | pipeline_version,config | run_id,status | RUN_ANALYSIS | pipeline_runs/steps |
| GET `/analysis-runs/{id}` | pipeline status | — | stages,progress,quality_flags | READ_ANALYSIS | pipeline_runs/steps |
| GET `/analysis-runs/{id}/events` | SSE cursor stream | Last-Event-ID | job_event_id,payload | READ_ANALYSIS | job_events |
| GET `/videos/{id}/playback` | permitted HLS manifest | run_id | manifest_url,source_pts_mapping | READ_VIDEO | assets/videos |
| GET `/videos/{id}/overlay-chunks` | boxes/track presence | run_id,from_pts_us,to_pts_us,lod | tracks,observations,gaps | READ_ANALYSIS | observations/chunks |
| GET `/videos/{id}/tracks` | track list | run_id,team_filter,cursor | tracks,identity_state,coverage | READ_ANALYSIS | tracks/identities |
| GET `/tracks/{id}/identity-candidates` | evidence-ranked possible players | — | candidates,evidence | REVIEW_IDENTITY | track_identity_candidates |
| POST `/tracks/{id}/identity-decisions` | confirm/reject candidate | candidate_id,decision,reason,expected_version | decision_id,identity_state | REVIEW_IDENTITY | identity_decisions/audit |
| GET `/videos/{id}/events` | event candidates and decisions | run_id,type,range,cursor | events,provenance | READ_ANALYSIS | event_candidates |
| POST `/events/{id}/review` | decision | decision,revisions,reason | review_id | REVIEW_EVENT | event_decisions |
| GET `/videos/{id}/tactics` | calibrated tactical summaries | run_id,team_id,time_range,view | metrics/maps/source_states | READ_ANALYSIS | calibrations/metrics |
| GET `/players/{id}/report-data` | report data | video_id,run_id | identity,metrics,heatmap/events,evidence | READ_REPORT | metric_values |
| POST `/reels` | draft reel | project_id,video_id,name,targets | reel_id,version | EDIT_REEL | reel_projects/targets |
| PATCH `/reels/{id}` | editor optimistic update | version,clip_ops,track_ops,keyframes | version,timeline | EDIT_REEL | reel_* timeline_* |
| GET `/reels/{id}/moment-suggestions` | candidates | target_track_ids,types | moments+why+quality | EDIT_REEL | event_candidates/tracks |
| POST `/reels/{id}/renders` | enqueue render | version,output_config | render_job_id,state,blockers | PRODUCE | render_jobs/outbox |
| GET `/renders/{id}` | progress and output | — | stage,state,asset_id,qc | READ_REEL | render_jobs |
| POST `/reports` | enqueue PDF | player_id,video_id,run_id,config | report_job_id | CREATE_REPORT | report_jobs |
| POST `/assets/{id}/download-grant` | fresh rights check then short URL | intended_use | expires_at,url or denial | EXPORT | rights_grants/audit |
| POST `/assets/{id}/share-links` | share policy | expiry,download,comments,recipient_scope | link_id,url or denial | SHARE | share_links/audit |
| POST `/deliveries` | queue external send | asset_id,destination,recipient | delivery_id,state | DELIVER | deliveries/outbox |
| GET `/library` | filter/sort/search assets | types,team,status,query,cursor | items,counts,next_cursor | READ_PROJECT | assets/reels/reports |

## Example upload session
```json
POST /api/v1/uploads/init
{"project_id":"uuid","filename":"fixture.mp4","size":1920000000,"sha256":"64 hex","mime_type":"video/mp4"}
202 Accepted
{"session_id":"uuid","video_id":"uuid","part_size":8388608,"parts":[{"part":1,"upload_url":"short-lived object-store URL"}],"expires_at":"2026-10-26T10:00:00Z"}
```
The server *must not* trust MIME extension or checksum merely because client supplied it.

## Example frame-aligned overlay response
```json
{"schema_version":"overlay.v1","video_id":"uuid","run_id":"uuid","coordinate_system":"DISPLAY_NORMALIZED","start_pts_us":621600000,"end_pts_us":621800000,"tracks":[{"track_id":"uuid","label":"17","identity_state":"CANDIDATE","player_id":null,"class":"PLAYER","team_id":"uuid","observations":[{"frame_index":31108,"pts_us":621600000,"bbox":[0.42,0.31,0.035,0.16],"observation_state":"DETECTED","confidence":0.91}],"gaps":[]}],"source_time_map_version":"v1"}
```
Never label `17` as a verified jersey number or a player identity unless matching evidence explicitly supports it.

## Sample state/event stream
```json
{"schema_version":"job_event.v1","id":9913,"run_id":"uuid","step":"TRACK","state":"RUNNING","progress":47.3,"processed_pts_us":451700000,"warning_codes":["OCCLUSION_CLUSTER"],"emitted_at":"2026-10-26T09:00:00Z"}
```
User interface renders RUNNING only when backend says RUNNING. Reconnect uses last event ID; append-only cursor monotonic. No fake GPU % in production.

## Idempotency, ordering, concurrency and cache
Reel `PATCH` passes `If-Match: "version-7"`; `409 VERSION_CONFLICT` returns latest state and reconciliation hints. Rendering an older version returns `409 STALE_REEL_VERSION`. Asset download token short lived and tied to user/session; time-limited URL cannot override revocation requirements (proxy delivery when immediate revocation required). Search cache scoped to organization membership and user role. SSE permission is rechecked on reconnect.

## Error catalog
`UPLOAD_INVALID_MEDIA`, `UPLOAD_CHECKSUM_MISMATCH`, `IMPORT_NOT_AUTHORIZED`, `SSRF_BLOCKED`, `QUOTA_EXCEEDED`, `MODEL_UNAVAILABLE`, `VIDEO_NOT_READY`, `UNRESOLVED_IDENTITY`, `RED_CLIP_BLOCKED`, `LOW_TRACK_COVERAGE`, `UNSUPPORTED_METRIC`, `CALIBRATION_REQUIRED`, `RIGHTS_NOT_GRANTED`, `CONSENT_REQUIRED`, `LICENSE_EXPIRED`, `EXPORT_NOT_ALLOWED`, `VERSION_CONFLICT`, `RENDER_OUTPUT_INVALID`, `ARTIFACT_NOT_FOUND`, `STALE_REEL_VERSION`, `RATE_LIMITED`. Each maps to user-specific recovery text and structured audit.
