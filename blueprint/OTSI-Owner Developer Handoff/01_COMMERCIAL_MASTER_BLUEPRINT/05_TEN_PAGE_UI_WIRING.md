# 05 — Page-to-service mapping and global UI behavior
These routes are **required real pages**, not screenshots mounted as backgrounds. Exact layout per `02_APPROVED_UI_IMPLEMENTATION/03_APPROVED_UI_IMAGES/`; all sections per adjacent MD files. Screenshot mock data is never used as production statistics.

|Route|Approved page|REST / event dependencies|Key user interactions|Data ownership|
|---|---|---|---|---|
|`/`|01 Home|GET /v1/dashboard, /projects, /reels, /reports|CTA upload/link, recent assets, search|Dashboard read model|
|`/upload`|02 Upload & Ingest|POST /uploads/init; PUT multipart; POST /uploads/complete; POST /imports|Drop files, validate, URL, resume|Ingest API + S3|
|`/jobs/:id`|03 AI Processing|GET /jobs/:id; GET /jobs/:id/events; SSE events|stage panels, retry, inspect logs|Workflow service|
|`/videos/:id/analyze`|04 Analysis Workspace|GET /videos/:id/observations, /tracks, /events, /identities; PATCH /reviews|video sync, 22 boxes when available, select, filter, identity repair|CV observation & review|
|`/videos/:id/tactics`|05 Tactical Intelligence|GET /tactics/shape, /pass-network, /heatmap, /runs|time brush, synchronized view, compare|Tactical domain|
|`/reels/new`|06 Reel Builder|POST /reels; GET /clip-candidates; PATCH /reels/:id|choose target, presets, rays, suggest|Reel domain|
|`/reels/:id/studio`|07 Clip Studio|GET/PATCH /reels/:id/timeline; POST /preview-renders|trim/split, tracks, captions, undo, save revisions|Timeline domain|
|`/players/:id/reports/:rid`|08 Player Report|GET /reports/:id, /players/:id/metrics, /events|view heatmap, uncertainty, export PDF|Reports/evidence|
|`/library`|09 Library|GET /assets/search, /projects, /shares|filters, versions, select, open, duplicate|Asset & project service|
|`/reels/:id/export`|10 Export & Delivery|POST /render-jobs; GET /render-jobs/:id; POST /shares|configure preset, queue, rights, deliver|Render/delivery/billing|

## Global frontend architecture
- App Shell: organization picker, top navigation, project context, theme toggle persisted to user preferences; keyboard shortcuts; accessible focus and tooltips.
- React Query server cache keyed by organization/project/asset/version, strict cache invalidation after mutations. SSE reconnect with `Last-Event-ID` and REST reconciliation.
- Player timeline: video media PTS is sole playhead clock; interpolation policy shared with rendering. UI shows `Detected`, `Inferred`, `Confirmed`, `Not measured` states distinctly and includes origin tags on every figure.
- Viewport: desktop-first target from image; 1440 and 2560 wide tested, tablet widths collapse side panels rather than shrink text to unreadability. Canvas overlay transforms for letterbox/crop and device pixel ratio.
- Auth: loading skeletons, `403` locked action, `409` stale version conflict, `422` invalid clip range, `429` quota/rate limit, `402` entitlement; each has recovery action. Upload cancellation actually cancels multipart uploads; job cancel is idempotent.
- Every button route or mutation is cataloged during build, `data-testid` and Playwright assertions cover all; no inactive decorative download/export buttons.
