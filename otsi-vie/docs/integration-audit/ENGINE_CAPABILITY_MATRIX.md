# Engine capability matrix — detection, tracking and identity

**Commit:** `d3ef2f5` · 2026-10-27. Statuses as defined in `CURRENT_IMPLEMENTATION_AUDIT.md`.

The six capabilities below are different things. The application must never present one as another.

| # | Capability | What it means | Status | What actually exists | Evidence |
|---|---|---|---|---|---|
| 1 | **Player detection** | A person (or the ball) is boxed in one analysed frame. Says nothing about who it is or which team. | Implemented, **accuracy not verified** | RT-DETRv2-R18 (Apache-2.0, COCO "person"/"sports ball"), 2×2 tiling for distant players, on-pitch grass filter, OpenVINO on the Arc GPU (parity-checked against PyTorch). Every raw detection kept as Parquet evidence with SHA-256. | test_analyze.py (real footage), ADR-024, ADR-026, release-evidence/model-benchmarks |
| 2 | **Within-shot multi-object tracking** | Consecutive detections of the same visible person inside one camera shot share a temporary track number ("track 7"). | Implemented, **accuracy not verified** | Kalman + Hungarian (two-stage, IoU-gated) for people; distance-gated association for the ball; a track ends after 1 s unseen; only `DETECTED` observations are stored. Measured against a dense reference: 0-7 persistent identity switches per clip, coverage 73-85 % at 2 fps. | test_tracker.py, ADR-025, ADR-028, release-evidence/sampling-study/20261027 |
| 3 | **Cross-camera-cut association** | Deciding that track 7 before a cut and track 31 after it are the same person. | **Not implemented — by design today** | Every cut ends every track (`end_all`); nothing is bridged. Shots are stored per run. | test_tracker.py `test_a_cut_ends_every_track_and_nothing_is_bridged` |
| 4 | **Automatic re-identification** | The engine proposes, from appearance/number/face, that a track is a specific known player (or the same person as another track). | **Not implemented** | Kit-colour re-linking was measured and **rejected** (contradicted as often as confirmed — teammates share kits). No jersey OCR, no face or appearance model. | ADR-028 decision 6 |
| 5 | **Human-confirmed canonical OTSI Player ID** | A person decides "track 7 is player X". If X is REGISTERED, the permanent `OTSI-CCC-YYYY-NNNNNN` is shown; a provisional player shows no ID. | **Implemented and verified** (manual path) | Append-only decisions (CONFIRMED / REJECTED / UNRESOLVED / CANDIDATE), stale-decision refusal, correction reason required (database trigger), audit + outbox events; allocator issues each ID once, concurrency-tested; merges keep both records. UI: identity panel in the Analysis Workspace. | identity.api.test.ts (12), tests/db/test_identity.py, workspace.spec.ts, ADR-016/017 |
| 6 | **Target-player tracking for the cinematic spotlight** | Following ONE confirmed player continuously at playback frame rate across a reel, with every rendered position traceable to evidence. | **Not implemented** | Prerequisites exist: confirmed decisions, pinned reel targets (DB), per-frame timestamps. Decided design (ADR-028): dense re-analysis of only the reel's seconds at 10-15 fps; positions between detections stored and shown as `INTERPOLATED`, never `DETECTED`; a target is followed only within tracks confirmed for that player. | ADR-028 decision 2 |

## The unknown states the engine preserves
| Situation | What the engine records | What the UI shows |
|---|---|---|
| Person detected, no decision | track `UNRESOLVED` | "Unidentified person · track N" (box cyan) |
| Decision CONFIRMED for a provisional player | decision + player | "Name · provisional, no OTSI Player ID yet" (box green) |
| Decision CONFIRMED for a registered player | decision + player | "Name · OTSI-CCC-YYYY-NNNNNN" |
| Decision REJECTED ("not this player") | decision (history kept) | the track is not that player; shown unidentified |
| Player not visible / between tracks | no observation | presence timeline gap ("not observed"); no box |
| Between analysed frames | no observation | dashed box = nearest analysed frame, labelled; no interpolated box |
| Ball | track `BALL` | "Ball · track N" — never an identity |

Rules enforced in code: a track number is never shown as a player ID; no name or ID appears without a CONFIRMED human decision; a merged or retired
player cannot receive new decisions; a correction needs a reason and is appended, never overwritten.

## Measured performance (this machine: Core Ultra 7 155H, Intel Arc iGPU)
| Item | Value |
|---|---|
| Detection, tiled, OpenVINO GPU FP32 | 397-487 ms per analysed 1080p frame (dense study runs) / 462 ms (device benchmark) |
| 90-minute match at the default 2 fps | 71-88 min |
| 3 fps / 5 fps | 107-132 min / 179-219 min |
| CPU fallback (PyTorch) at 2 fps | about 190 min |
| Ball tracked / ball detected at 2 fps | 73-97 % |
| Linear interpolation vs real box at 2 fps (mean IoU) | 0.65-0.90 → not good enough for a spotlight; dense re-analysis planned |

## What "verified" does NOT cover yet
- No labelled football footage exists in the project: precision, recall, HOTA and IDF1 are **unmeasured**. The tracking reference in ADR-028 is
  the same tracker at full frame rate, not ground truth.
- No model has documented approval thresholds; none may be called production-ready (project rule §6).
- Role classes (player / goalkeeper / referee), team assignment and jersey numbers do not exist.
