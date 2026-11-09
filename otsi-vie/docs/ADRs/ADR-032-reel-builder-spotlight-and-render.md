# ADR-032: Reel Builder, cinematic spotlight and MP4 production

Status: accepted for development and local testing (2026-10-27; owner priorities: Reel Builder, cinematic spotlight, actual MP4 production;
zero-cost policy ADR-030; encoders ADR-029). Commercial distribution and paid export are not activated (owner decisions E1-E3).

## Product rules implemented
- **The user makes the reel by clicking.** A reel is created from a player a person CONFIRMED (Analysis Workspace → "Create highlight reel");
  nothing is pre-filled: the user adds suggested moments, trims (in/out), reorders, removes clips, chooses aspect and spotlight look, renders.
- **Only confirmed identity reaches the spotlight.** `reel_targets` pin the exact CONFIRMED identity decisions (0008). Any later correction
  makes the reel *stale*: the UI says so, rendering is refused (API and worker), and "Refresh" re-pins the player's current confirmed tracks.
- **Moments are honest.** Suggested moments are stretches where the player is visible on confirmed tracks (observations merged within 1.5 s,
  padded 1 s, 3–12 s). They are labelled as visibility, not events: event detection (Block 08) is not built.
- **The spotlight never invents a position.** Per clip the worker re-analyses ONLY that window at 10 fps (ADR-028: 2-fps interpolation is not
  good enough), joins dense tracks to the confirmed observations (match within 70 ms and IoU ≥ 0.3, used only within 0.5 s of a confirming
  observation), interpolates between path points at most 0.6 s apart (counted INTERPOLATED) and draws **no spotlight** where the player was
  not seen (MISSING), fading over 0.25 s at the edges. Every render reports DETECTED / INTERPOLATED / MISSING frame counts.

## Rendering pipeline (`vie_worker/render/reel.py`, job RENDER)
check targets → path per clip → composite every source frame (LGPL FFmpeg decode; soft-ellipse spotlight at quarter resolution, ring at the
feet, name caption with the OTSI Player ID when registered; aspect crop 9:16 / 1:1 following the player with exponential smoothing) →
encode (`encoders.choose`: Intel QSV H.264 preferred; AV1 / VP9 selectable; bitrate scaled to the output size; audio of the same windows,
AAC in MP4 / Opus in WebM) → validate (codec, size, exact frame count, duration, faststart, full decode) → REEL asset + MANIFEST asset
(pinned decisions, per-clip coverage, encoder, FFmpeg build, validation, notice) + `reel_manifest_versions` + render job SUCCEEDED.
Frames stream through the encoder (no clip is held in memory). Playback and download use the signed media gateway (REEL assets, Range,
attachment on download).

## Data (migration 0015)
`reel_projects.player_id, run_id, aspect, settings`; `reel_clips.origin, label`; `render_jobs.failure_detail, result`; worker job kind
RENDER; outbox `reel.render_requested` → one RENDER job. API: 13 routes (`docs/api/API_CONTRACT_INVENTORY.json`).

## Measured (this machine, Intel Arc iGPU)
| Run | Output | Spotlight frames | Time |
|---|---|---|---|
| Worker test, France–Germany 6 s clip | 1920×1080 H.264 High (intel-qsv-h264), exact frame count, validated | DETECTED > 0, all frames accounted | ~30 s incl. dense re-analysis |
| Browser journey, France–Germany 9.5 s suggested moment | 1920×1080, 285 frames, intel-qsv-h264, validated, MP4 downloaded | 86 detected · 170 interpolated · 29 without the player | 85.3 s |
Render time is dominated by the dense re-analysis (tiled detection ≈ 0.46 s per analysed frame at 10 fps ≈ 4.6 s per second of reel);
compositing and hardware encoding are faster than real time.

## Limits
- Visual quality of the effect is judged by eye (evidence frames in the test output); no perceptual metric.
- Music, logo/branding overlays: not connected (no free licensed music library; owner brand assets pending) — said so in the UI.
- Event-based highlight selection waits for Block 08.
- H.264 playback cannot be checked in Playwright's open-source Chromium (no decoder); verified in desktop Chromium (ADR-029) and by full decode.
