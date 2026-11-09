# 03 — Media, computer vision, player tracking: construction-level contracts

## Media clocks (one authoritative rule)
Persist `pts_us` in integer microseconds based on presentation timestamps from the **source** timebase; `frame_index` is only monotonically increasing display order. Variable-frame-rate sources MUST NOT be mapped via `frame_index/fps`. Each generated proxy needs a source->proxy PTS mapping. Every detection carries `{video_id,run_id,shot_id,frame_index,pts_us,object_class,bbox_xywh_norm,confidence,model_id}`. `bbox_xywh_norm` within `[0,1]` and coordinates relative to uncropped decoded frame. Transform through video viewport `object-fit:contain`, zoom/pan and aspect-crop before render. Negative/NaN boxes rejected.

## Pipeline tasks & durable artifact boundaries
1. `probe`: ffprobe metadata, SHA256, malware guard, checksum verified; fail closed on DRM/unsupported streams.
2. `decode`: sample frames at configurable cadence; run full-resolution or tiled detection as benchmark demands, preserve PTS; generate immutable frame inventory.
3. `cut`: classify hard cuts and camera angles; no trajectory automatically bridges a cut.
4. `detect`: model adapter `detect(batch)->list[Detection]`; batch by decoded resolution, detector NMS and calibration per evaluation set. Player detection is independent of ball proximity.
5. `track`: multi-object association using image motion, appearance embeddings, IoU and gating. Association costs calibrated to validation set; reject impossible movement; track lifecycle states tentative/active/occluded/lost/terminated. Assignment methods (e.g. Hungarian) are implementation candidates not hard-coded correctness guarantees.
6. `identify`: jersey OCR, team cues, match roster, appearance and substitution windows produce candidates. Candidate score and evidence logged. Separate anonymous `track_uuid`, within-shot `tracklet_uuid`, and `player_uuid`. No synthetic re-ID after cut without evidence. Analyst chooses CONFIRM, REJECT, SPLIT, MERGE; store audit/version and invalidate downstream dependent renders.
7. `events`: ball-player geometry + temporal classifiers produce **hypotheses**, with keyframes, uncertainty, event taxonomy and human review. True event type counts must never be fabricated from track presence.
8. `geometry`: calibrate pitch using known line landmarks, fit homography per valid shot and record reprojection error. If inaccurate/occluded, no distance/speed metrics; screen-space heatmaps only with explicit label.
9. `aggregate`: presence windows, visible movement, team formations with coverage checks and reports; immutable Parquet snapshots with lineage.

## Bounding-box API example
```json
{"videoId":"uuid","runId":"uuid","window":{"fromPtsUs":621000000,"toPtsUs":623000000},"coordSystem":"normalized-decoded-frame","frameWidth":1920,"frameHeight":1080,"observations":[{"ptsUs":621700000,"trackId":"uuid","playerId":null,"class":"PLAYER","bbox":[0.45,0.26,0.04,0.16],"confidence":0.91,"identityState":"UNRESOLVED","source":"DETECTED","shotId":"uuid"}]}
```
Server paginates by `(pts_us, frame_index, id)`; client interpolates only within the same shot, same track, max measured gap defined by model QA; otherwise draws no box. Sparse detections must not masquerade as per-frame tracking.

## Critical adverse cases
- Camera pans with all players: compensate global motion; quality gate for tracks under panning.
- Occlusion: a track may be temporarily hidden; no box rendered when unobserved if gap exceeds interpolation bound.
- Player swap/identical jerseys: abstain on ambiguous identity; break track rather than silently swap.
- Replays, close-ups, bench footage: shot classification and track namespaces protect timeline continuity.
- Ball in air/out of view: null possession with confidence reason.
- Broadcast-only source: no positions for off-screen players; no full-team shape inference without sufficient coverage.

## Model operational contract
`ModelManifest = {task,version,sha256,license,training_provenance,eval_dataset,threshold_config,latency_p95,input_spec,output_spec}`. Weights never downloaded unchecked. Commercial licensing reviewed. Maintain holdout footage across lighting/weather/leagues/angles; publish confusion matrices and HOTA/IDF1, ball precision/recall, false identity switches and spotlight false-target rate. Thresholds **must be measured and approved**, not invented as defaults.
