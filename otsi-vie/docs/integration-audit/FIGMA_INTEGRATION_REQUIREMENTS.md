# Figma Make integration requirements

**For:** the owner's Figma Make frontend · **Engine commit:** `d3ef2f5` · 2026-10-27
**Rule:** Figma Make completes and polishes the approved interface **against the API that exists**. It does not redesign the 10 approved pages and
does not invent endpoints. Nothing from Figma is merged into `apps/web` until it has been reviewed against this document.

## 1. Non-negotiable product rules the UI must keep
1. **No mock or sample data in the product.** Empty states are real empty states ("No videos yet…"). A section without a backend shows
   "Not connected" (or is hidden behind a clearly marked future state), never invented numbers, players, reels or charts.
2. **Three identifiers are never interchangeable on screen:**
   - jersey number (`#17`) — clothing, not built yet;
   - track number (`track 4`) — temporary, one analysis run only, always labelled as such;
   - OTSI Player ID (`OTSI-CCC-YYYY-NNNNNN`) — permanent, only for REGISTERED/RETIRED players and only after a CONFIRMED human decision.
   A provisional player shows a name and "provisional, no OTSI Player ID yet". Unknown stays "Unidentified person · track N".
3. **Only detected boxes are drawn as detections.** A box comes from an observation; between analysed frames the UI may show the nearest
   analysed frame (styled differently, e.g. dashed) but must not invent positions. Anything interpolated later must be visibly labelled.
4. **Every value shown is measured or "—".** Use "—" for not measured, never 0.
5. **Errors show the API's `message`** (and keep `code` for logic). Never replace a refusal with a generic success.
6. **Roles:** hide or disable actions the role cannot perform; the API refuses them anyway (403 `ROLE_NOT_ALLOWED`).

## 2. Technical integration contract
| Topic | Requirement |
|---|---|
| Base URL | Same-origin `/api/*` (Next.js rewrites to the API). Do not call the API host directly from the browser. |
| Auth | `POST /api/v1/auth/login` with header `x-otsi-csrf: 1` → `access_token` (keep in memory only, never localStorage) + HttpOnly refresh cookie. On 401: one `POST /api/v1/auth/refresh` (same CSRF header), retry once; if it fails, go to `/login?next=…`. Sign out: `POST /api/v1/auth/logout`. |
| Tenant | Header `X-Organization-Id` on every organisation call; list from `GET /v1/me` (`memberships[]` with `role`). |
| Errors | Body `{code, message, request_id}`; show `message`; log `request_id`. |
| Idempotency | `Idempotency-Key` header (8-128 chars) on `POST /v1/uploads`, `/v1/imports`, `/v1/players`, `/v1/players/:id/registration`. Reuse the same key when retrying the same action. |
| Times | Integers in microseconds since the video's first frame (`pts_us`). Convert with `/ 1e6` for seconds. |
| Boxes | `x, y, w, h` normalised 0..1 to the decoded frame; draw in a layer with the video's exact aspect ratio (see `AnalysisWorkspace.tsx`, SVG `viewBox = 0 0 width height`). |
| Media | `GET /v1/videos/:id/playback` returns a short-lived signed `url` (4 h) — use it directly as `<video src>`; it supports HTTP Range. Re-request when expired (403 `LINK_EXPIRED`). |
| Thumbnails | `GET /v1/videos/:id/thumbnail` needs the Bearer token: fetch as blob → object URL (an `<img src>` cannot send the token). |
| Uploads | Use the existing engine `apps/web/src/lib/upload.ts` (part plan from `POST /v1/uploads`, `PUT` parts as `application/octet-stream` with `X-Part-SHA256`, then `complete`). Do not re-implement differently. |
| Polling | Videos while `VALIDATING`, runs while `QUEUED`/`RUNNING`: poll every 2 s; stop when settled. No push channel exists. |
| Schemas | `API_CONTRACT_INVENTORY.json` (generated from the zod contracts in `packages/contracts`). Import types from `@otsi-vie/contracts` rather than re-declaring them. |

## 3. Page-by-page: what Figma may connect now, and what must stay "not connected"
### 01 Home
- Connect now: header (shell), hero CTAs → `/upload?mode=file|url`.
- Possible now with an owner decision: "Recent matches" could list recent **videos** (`GET /v1/videos`), labelled as videos, not matches.
- Must stay not connected: featured reel, KPI strip, sample reels gallery (no reels exist; no sample content allowed), trust strip (owner asset).

### 02 Upload & Ingest
- Connected today — keep behaviour exactly: projects (`GET/POST /v1/projects`), file upload, URL import with provider policy
  (`GET /v1/import-providers`: `status` = supported | needs_authorization | unsupported, `reason`, `alternative`, `method`), recent uploads with
  states `PENDING | VALIDATING | INGESTED | FAILED | QUARANTINED` (+ `failure_code`, `failure_detail`), selected video facts, links to
  `/videos/:id/processing` and `/videos/:id/analyze`.
- The access-token field must only appear for `needs_authorization` providers, be `type=password`, and be sent once as `access_token`.
- Not available: match metadata (competition, teams, date), editing video metadata, processing presets (§3/§4).

### 03 AI Processing (per video)
- Connected: start (`sample_fps` 0.5-10, UI offers 1/2/3/5, default 2; `tiles` 1|2, default 2), steps `SHOTS`, `DETECT`, `TRACK` with
  `status` and `progress`, `job.stage_message`, `failure_code`/`failure_detail`, cancel, `result` (person_tracks, ball_tracks, shots,
  sampled_frames, seconds, frames_per_second, model, runtime).
- Identity, Events, Indexing steps: show as "not built yet" — do not animate them.
- Not available: per-frame preview insets, team classification, events, system resources, frame timeline.

### 04 Analysis Workspace (per video)
- Connected: playback, boxes, overlay toggles, track list, selection, identity review, transport, presence timeline (see FRONTEND_PAGE_MATRIX).
- The approved "22-person roster with thumbnails, jersey numbers, teams" and "player detail card with portrait and metrics" **cannot be
  filled**: those data do not exist. Figma must render the track list / track detail in that space, or the not-connected state.
- Identity actions: confirm (`state: CONFIRMED`, `player_id`), reject (`REJECTED`), reset (`UNRESOLVED`, `player_id: null`); always send
  `supersedes_id` = current `decision_id`; when `supersedes_id` is not null a `reason` (≥ 3 chars) is required; handle 409 `STALE_DECISION`
  by reloading.
- Not available: mode tabs, events ribbon, clip creation, team lanes.

### 05 Tactics · 06 Reels · 07 Clip Studio · 08 Reports · 09 Library · 10 Export
- **No backend exists.** Figma may refine layout and component states (empty, loading, error, not connected) but must not wire them to the
  paths named in the page specs — those paths are plans (`planned_from_page_specs` in the inventory), not APIs.
- When these blocks are built, the engine team publishes the endpoints in the inventory first; Figma connects only after that.

## 4. Component states Figma must design for every connected section
Loading · empty (real, with the next action) · error (API message) · refused by role · not connected (planned block) · stale (another user
changed it: 409 `STALE_VERSION` / `STALE_DECISION` → reload prompt).

## 5. Hand-over process
1. Figma exports components; the engine team reviews them against this document and the approved images (no section removed or renamed —
   section titles come from the page specs and are checked in CI).
2. Accepted components are integrated into `apps/web` behind the existing API client (`lib/api.ts`), context providers and tests.
3. Every integrated page keeps its browser tests green (`tools/dev/e2e.py`); new behaviour gets a new e2e test.
4. Contract changes are made in `packages/contracts` first, then API, then UI — never the other way round.
