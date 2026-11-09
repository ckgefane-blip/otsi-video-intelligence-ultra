> Adapted architectural reference only. MySQL migration authority is in `01_COMMERCIAL_MASTER_BLUEPRINT/mysql_migrations/`. Do not assume a described control is implemented or tested.

# Engine specification A: ingestion → full-frame player detection → stable tracking

## 1. Source-video acquisition contract
**Input**: `video_source_id`, upload object hash or permitted URL import adapter, owning organization, rights grant, optional match context. **Outputs**: immutable source asset, probe metadata, proxy asset, shots, frame-to-PTS lookup, indexable thumbnails. Use multipart upload with SHA-256 and resume; restrict MIME by inspecting media bytes; antivirus scan; ffprobe to extract streams, codec, SAR/DAR, pixel format, rotation, audio layout, duration, timebase and VFR. Reject deceptive content, encrypted streams, unsupported codec variants and over-quota files with precise recoverable errors.

URL import: no arbitrary browser video URL guarantee. Only direct permitted media or authorized integrations. Use allowlisted schemes, controlled redirects, DNS rebinding/private IP blocking, payload/time limits, account/provider rate limits and verified redistribution rights. A YouTube link does not inherently authorize downloading. Import adapter may return `PROVIDER_NOT_SUPPORTED` / `RIGHTS_REQUIRED` with a path to upload licensed footage.

Decode with deterministic FFmpeg build; generate display-oriented frames and frame indices linked to decoder PTS. Record source orientation transform. Save playback HLS or fragmented MP4 rendition with audio while retaining original as immutable source; use `ffprobe` after rendition. Record every frame's `frame_index` and `pts_us` or efficient PTS lookup artifact. Detect broadcast shot cuts/zoom and keyframes; long continuous camera edits are segmented by shot IDs. If audio absent, continue normally.

## 2. Detection contract
Detect all visible field participants regardless of ball possession: outfield players, goalkeepers, referees and ball. `PLAYER` classification ≠ verified player ID. Apply image normalization including rotation/letterbox bookkeeping, define detector resolution and stride, map boxes back into original normalized display coordinates. Each observation carries video, frame, PTS, bbox (`x,y,w,h` normalized), category, detector confidence, occlusion flag estimate, model version, shot ID and originating chunk checksum. Reject out-of-bounds/NaN boxes. Store *all useful low score detections* for association/recovery, but suppress low-quality boxes in UI by default.

Suggested baseline: licensed football-trained detector (benchmark model family on in-domain broadcast footage), dedicated small-ball head at appropriate input scale, field segmentation or homography modules only when empirically useful. Model selection MUST follow commercial licensing and measured holdout evaluation; do not claim any one named model is production ready out of the box. `detection_batches` contains chunk artifact metadata; UI queries exposed by indexed server endpoint.

## 3. Multi-object tracking algorithm (implementation contract)
**State** per track: stable UUID, scoped numeric label, Kalman/image-state estimate, appearance embedding(s), team-class posterior, life-cycle, shot context, last detection PTS, quality metrics, occlusion/gap samples. Update by real delta PTS, never assume fixed frame duration.

Pseudo-steps per frame:
```text
for each decoded frame in PTS order:
  detections = detector(frame)                 # ALL visible participants, not ball-only
  map_boxes_to_display_normalized_coordinates(detections)
  high, low = confidence_policy_partition(detections)
  predict_tracks(ΔPTS, camera_motion_estimate)
  stage1 = min_cost_match(active_tracks, high, IoU + appearance + motion + class/team gates)
  stage2 = min_cost_match(unmatched_tracks, low, gated_IoU + motion)  # recover occlusions
  update_matched(stage1 + stage2, observed=True)
  mark_unmatched_advanced_state(occluded_or_exited, do_not_invent_boxes)
  start_new_tracklets(unmatched_credible_detections)
  detect_possible_ID_switches_and_emit_review_flags()
  flush_append_only_chunk(frame_index, pts_us, shot_id, observations, model_version)
```
Association can use ByteTrack-style two-stage matching, augmented by appearance ReID and camera motion compensation. Gate by team color, shape and plausible motion but never hard-force identity on kit colors alone. Detector calibration, matching thresholds and exit/occlusion limits are *evaluation-determined configuration*, not magic constants copied into production. Save appearance embeddings securely; they do not by themselves establish personal identity.

## 4. Lost/off-screen/cut behavior
`DETECTED` is frame-evidenced, `PREDICTED` has uncertainty and strictly bounded lifetime, `INTERPOLATED` is a short internal bridge if confidence warrants, `LEFT_FRAME` means **no visible position** and no drawn bbox beyond last trustworthy frame. Track UUID may persist across a gap only when re-identification has enough evidence; ambiguous re-entry creates a new track and association candidate. At shot cuts reset camera transforms and increase re-ID skepticism. UI should communicate gaps on timeline, never paint an invented tracked player off-camera.

## 5. Persistence/read DTO
Hot observations via `track_observations` and large immutable Parquet via `track_segments.observation_asset_id`; preserve one authoritative chunk hash and no data mismatch. Range API returns `{video_id,run_id,start_pts_us,end_pts_us,coordinate_space:'DISPLAY_NORMALIZED',sampling:'frame|Nfps',tracks:[{track_id,class_name,points:[{pts_us,bbox:[x,y,w,h],observation_state,confidence}]}]}`. Query by source PTS window and pipeline run, not client wall clock.

## 6. Overlay rendering and sync
Browser receives playback rendition's source-time mapping, not merely media.currentTime; timeline keeps time in integer microseconds. For each decoded displayed frame, map playback PTS to source PTS, fetch/cache adjacent overlay chunks, draw only observations that are valid for that exact time or sanctioned interpolation window. Scale overlay by actual content rectangle, accounting for letterbox, crop, rotation, device pixel ratio. QA compares pixel bounding box positions under fullscreen, responsive sizing and scrub-to-frame.

## 7. Metrics and acceptance gates
Holdout video set must contain multiple stadiums, teams, kits, occlusions, camera cuts, weather, low light and players without ball. Annotate human ground truth at sampled frames. Measure per-class AP/recall, ball recall, IDF1/HOTA, ID switches per minute, continuity %, false player IDs, overlay temporal alignment ms, throughput and failure rates. Set target thresholds after baseline; high-precision identity export gate can be stricter than exploration UI. Manual review flags must be generated for excessive ID-switch rate or low-visibility stretches. No claim of universally stable tracking across non-observable footage.

## 8. Reproducibility
Pin source video checksum, decoder build, detector/track model versions, config hashes and seeded execution where possible. Every batch has input/output hash; pipeline rerun creates a fresh run ID. Camera/overlay origin tags attach model version, source frames and postprocess version.
