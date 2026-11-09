> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Engine specification C: evidence-verified highlight selection, spotlight and real MP4 production

## Contract from UI to render engine
An editable `reel_project` has selected `reel_targets`, ordered `reel_clips`, timeline layers/items/keyframes, source-video hashes, accepted moment suggestions and version. A render request **freezes** the reel version and emits an immutable manifest referencing all source and tracking dependencies. Output may not be published before QA and rights checks.

## Candidate moment scoring
From confirmed or reviewable event windows, generate proposals with action type, source PTS, recommended pre/post roll, target track coverage, identity evidence, framing quality, uncertainty, anti-duplicate score, rights eligibility and why-suggested. Proposed clip window: `max(0,event.start-pre_roll)` to `min(video.duration,event.end+post_roll)`; cut boundaries adjust to decoder-accurate PTS/keyframe mapping, not arbitrary nominal FPS. Candidates do not auto-approve themselves. If target off-camera during highlight action, tag REVIEW_REQUIRED or reject rather than tracking phantom athlete.

## Spotlight target trajectory
Build target anchors at verified visible observations. Ground position for circular ring can be estimated from footpoint of bbox (bottom-center with perspective/occlusion corrections) in original display space; cinematic beam uses smooth anchor near player's center/upper body. Per video shot, handle changes in crop geometry and source→output transform. Smooth jitter with bounded interpolation (e.g. confidence-weighted one-euro or Kalman smoothing), **reset on shot cuts**, avoid overshoot. For gaps under a measured short threshold, interpolate only when association is strong; longer gaps fade spotlight out (never search unrelated teammate). If multiple targets are selected, offer independent circles or group spotlight with clearly defined multi-target policy.

## Effect parameter schema v1
```json
{
  "schema_version": "spotlight.v1",
  "target_track_ids": ["track-uuid"],
  "style": "cinematic_ray",
  "intensity": 0.85,
  "beam_width_fraction": 0.6,
  "vignette": 0.45,
  "dim_background": 0.7,
  "glow": 0.55,
  "ring_radius_px_at_1080p": 70,
  "color_srgb": "#24B7FF",
  "gap_behavior": "FADE_OUT",
  "cut_behavior": "RESET",
  "interpolation": "SMOOTH_BOUNDED"
}
```
Design defaults are **styling only**, not model accuracy/confidence thresholds. Version schema, validate 0..1 range, clamp gamma and alpha. Lens beams, bloom and vignette should preserve target recognizability and meaningful play context. Preview and export MUST use the same effect math and same shot/PTS mapping (browser WebGL preview versus server GPU compositor implementation).

## Frame compositing sequence
1. Decode source using pinned FFmpeg build, retaining PTS and color matrix. Apply requested crop/aspect (`16:9`, `9:16`, `1:1`) with tracking-aware framing and safe crop guards. 2. Transform authoritative source observation bbox to output image. 3. For each visible, quality-approved target compute footpoint and screen-space anchor. 4. Apply relative background dim with soft elliptical mask excluding target (avoid covering player). 5. Composite ground ring and volumetric beam/rays, camera-space bloom and sparse particles. 6. Composite labeled identity/stat overlays only when evidence-backed and rights-cleared; otherwise omit. 7. Apply transitions/keyframe effects, captions, watermark, color management. 8. Mix licensed audio with source ambience and loudness normalization. 9. Encode MP4/H.264 or H.265 per approved policy; preserve audio sync; support vertical crop with documented framing decisions.

## Deterministic manifest v1
```json
{
 "schema_version":"render_manifest.v1",
 "reel_id":"uuid", "reel_version":4,
 "source_assets":[{"video_id":"uuid","sha256":"64 hex"}],
 "pipeline_run_id":"uuid", "identity_decisions":["uuid"],
 "clip_plan":[{"clip_id":"uuid","source_in_pts_us":621700000,"source_out_pts_us":635700000,"speed":1}],
 "effect_config_asset_sha256":"64 hex", "font_assets":[], "audio_assets":[],
 "renderer_image_digest":"sha256:...", "output":{"width":1920,"height":1080,"fps_num":30,"fps_den":1,"codec":"h264"},
 "rights_snapshot_id":"uuid", "created_at":"RFC3339 UTC"
}
```
Must include any source dependency, music license, font licensing, model/policy version, editorial settings, video rotate/crop transforms, finalized track chunks/hashes and selected event decisions. A missing pinned dependency fails closed.

## Rendering jobs and QA
Queue job idempotently per project-version/config hash, not merely browser click. Worker creates temporary output, validates with ffprobe (duration, codec, stream count, frame rate), decodes sample frames, checks temporal overlays and target positioning at start/middle/end and all cuts, checks clipped audio/black frames, compares render preview still hashes/landmarks, then moves verified asset to immutable object key. UI progresses through queued/rendering/verifying/ready or BLOCKED/FAILED. Do not state a download is ready while rendering remains incomplete.

## Rights gate
`INTERNAL`/other allowed produce scope can authorize internal render/attach only under policy; `EXPORT_ALLOWED`/`PUBLIC` authorizes downloads/delivery subject to specific licensing restrictions. `UNKNOWN`, `ANALYSIS_ONLY`, `EXPIRED` block as required by owner policy; minors need VERIFIED guardian consent. This applies when job queued, worker cuts, artifact opened/downloaded, link issued, and delivery dispatcher sends queued message. Inspect every clip/source and overlay dependency. RED clip cannot be exported. Append denial reason and ruleset version in audit.

## Hard acceptance tests
- Given a 10-second annotated clip, exported ring/beam anchor within agreed pixel threshold of reference footpoint on all annotated frames (threshold measured during QC).
- No player-switch under occlusion; fade out on unavailable target; no beam on wrong jersey/teammate after camera cut.
- Scrubbed preview and encoded output match clip start/end and spotlight keyframes to frame tolerance.
- 9:16 crop preserves selected player within safe margins at clip-selected anchor frames; fallback to manual framing when impossible.
- Real output is playable H.264 MP4 with verified audio sync; wrong rights state results in no signed URL.
