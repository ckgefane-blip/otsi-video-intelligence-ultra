# 04 — Reel editing and deterministic spotlight MP4 compositor

## Canonical non-destructive edit manifest
Immutable source references + version-pinned timeline JSON. Every clip: `clip_id,video_id,source_sha256,in_pts_us,out_pts_us,output_start_us,speed,track_id,player_id,identity_decision_version,effect_profile_id,rights_grant_snapshot,review_status`. Layers ordered using `{layer_id,z_index,kind,keyframes,parameters,asset_sha256}`. Timeline edits use optimistic concurrency `If-Match: version` and create new revisions. Unknown/RED targets can be reviewed in-editor but cannot enqueue release render.

## Spotlight coordinate engine
For each output frame PTS, find source PTS through edit speed/time transform. Load authorized track observations at source PTS; interpolate **only** within same track and shot and QA-allowed gap. Derive center from anchor point (torso/feet depending effect) then apply source->crop->output transformation. Smooth coordinates using bounded look-ahead filter, never smoothing across hard cut, identity break or large gap. Draw beam with configurable spread, intensity, falloff, feather, hue and screen-space vignette. Support multi-target and manual keyframe re-anchors. If target absent, follow explicit per-clip policy `HIDE_EFFECT` / `BLOCK_RENDER` (no free-running guessed spotlight). Preview and export must use same manifest, transforms and compositor settings; use pixel/geometry comparison golden tests.

## Renderer steps
`VALIDATE` identity/version + rights + subscription entitlement -> `RESOLVE_INPUTS` immutable assets -> `CUT` decode frames PTS-correct -> `COMPOSITE` keyframes, 2D overlays, focus rays -> `AUDIO_MIX` loudness/bus/fades -> `ENCODE` H.264 MP4 8-bit 4:2:0 plus optional H.265 licensing profile -> `QC` decode output, timestamps, A/V sync, blacks/frozen frames, track alignment -> `PUBLISH` atomic artifact pointer. Worker writes temp object and only publishes final after checksum+QC. Retry is idempotent by manifest sha256 and output preset. Distinct rights checks before queue, before rendering and before every delivery signed URL.

## Output variants
16:9 1920x1080, 9:16 1080x1920, 1:1 1080x1080 as initial product profiles. 4K available only when source quality and plan permit (never label a blown-up 1080p source as native 4K). Preserve original sound where rights permit. Burned captions are user-reviewable. Export UI must show `QUEUED/VALIDATING/RENDERING/QC/READY/BLOCKED/FAILED`, not a fake countdown.

## Acceptance
For annotated sample clips, after fade-in spotlight center error measured against verified player anchor distribution; zero frames emphasizing a different identifiable player; gap/cut test never shows stale spotlight; target visible through realistic motion and different aspect ratios; generated MP4 fully playable and structurally valid; source and exported timeline agree on moment order; retry yields same sequence and manifest references. Rendering a blank file or metadata-only reel is a blocking failure.
