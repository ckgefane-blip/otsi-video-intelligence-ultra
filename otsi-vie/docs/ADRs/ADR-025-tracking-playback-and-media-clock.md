# ADR-025: Tracking within shots, the media clock, the playback copy and signed media URLs

Status: accepted (2026-10-26)

## Decision
1. **One media clock.** Every time in detections, observations, shots, the playback copy and the UI is `pts_us` = microseconds since the video's first frame, from presentation timestamps (never frame_index / fps; variable frame rate stays exact). Analysed frames are recorded in `video_frame_index` (frame_index, pts_us, keyframe); observations reference it (FK).
2. **Analysis run** (`POST /v1/videos/:id/analysis-runs`, OWNER/ADMIN/ANALYST): steps SHOTS, DETECT, TRACK; `analysis.requested` → subscriber `jobs.analyze` → one `ANALYZE` job. One decoding pass samples frames on a time grid (default 2 per second) for cut detection and detection, then tracking; progress per step; cancel stops at the next batch.
3. **Shots.** Hard cuts from an HSV-histogram (Bhattacharyya) change together with a pixel change; every track ends at a cut (nothing bridged across shots).
4. **Tracker** (own implementation, ByteTrack-style): constant-velocity Kalman per track (dt = real time between samples), two-stage Hungarian association (high-score then low-score detections), IoU and centre-jump gates, confirmation after 2 matches, end after 1 s unmatched (a returning player gets a new track — no invented re-entry). Ball: at most one track at a time. Stored: tracks (class PERSON/BALL, shot, counts, mean confidence, identity UNRESOLVED) and observations with `observation_state = DETECTED` only — nothing interpolated or predicted is stored.
5. **Evidence.** All raw detections (with on-pitch flag and the track they became) in a Parquet file (asset DETECTIONS, SHA-256, `detection_batches`); the model version row records model, revision, settings and weights hash.
6. **Identity.** Tracks are anonymous ("Unidentified person · track N", "Ball · track N"); only a CONFIRMED identity decision may show a player's name and OTSI Player ID (ADR-016).
7. **Playback copy** (`PROXY` job on `video.ingested`): WebM VP9/Opus ≤ 960 px, timestamps rebased to the media clock (overlays align frame-accurately). **Signed media gateway**: `GET /v1/videos/:id/playback` returns `/api/v1/media/:asset?org&exp&sig` (HMAC-SHA256 over asset, organization, expiry; 4 h); the gateway serves only PROXY assets of that organization with HTTP Range. A `<video>` element cannot send a bearer token; the signature is the authorisation and is bound to organization and expiry.

## Not yet (tracked)
Re-identification across shots (Block 07), team/role classification, camera-motion compensation, gap interpolation for display (would be marked INTERPOLATED, never DETECTED), tracking accuracy metrics (HOTA/IDF1 need labelled footage), revocation of issued media URLs before expiry (rights block 12).

## Evidence
`services/worker/tests/test_analyze.py` (real footage), `apps/api/test/analysis.api.test.ts` (runs, cancel, roles, tenant isolation, honest labels, observation window bounds, Range streaming, tampered/foreign/extended signatures refused).
