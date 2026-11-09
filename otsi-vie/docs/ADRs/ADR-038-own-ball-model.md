# ADR-038: Our own ball model, trained on the owner's footage

Status: accepted for development and local testing (2026-11-01; owner: "The yellow circle runs around most times without the ball", then
"Proceed" and "Yes, install it" for PyTorch with Intel GPU support). Builds on ADR-037 (the path search), ADR-030 (zero cost).

## Problem
ADR-037 follows the ball through the general detector's "sports ball" boxes. On broadcast wide shots the ball is 4-6 px and the general detector
(trained on everyday photos) rarely proposes it; boots, socks and grass spots then win. The detector's own scores do not separate right
from wrong, so no rule over its output can fix it (owner's playback check, 38:10-38:31: ring on grass or stands most of the time).

## Licence search (nothing ready-made is clean for commercial use)
- Football ball weights in WASB-SBDT, FootAndBall, DeepBall (code MIT) are trained on the ISSIA-CNR soccer videos: no stated licence.
- SoccerNet tracking: commercial use not confirmed; related SoccerNet sets are non-commercial.
- Dryad "high-quality sport ball dataset" (2026): labels CC0, but the videos are CC BY-NC-ND (non-commercial).
- SoccerTrack v2 (CC BY 4.0): no per-frame ball positions, panoramic camera.
- Roboflow Universe sets (listed CC BY 4.0): user uploads of broadcast footage; broadcaster rights unclear.

## Decision
- **Our own network** (`tools/models/ball_train.py`): a small U-Net over three consecutive video frames (9 channels: the frame before, the
  analysed frame, the frame after; motion makes a small ball visible), output a heat map of the ball's centre (CenterNet focal loss, sigma
  2 px). No third-party code or weights.
- **Training data from the owner's own match** (`tools/models/ball_dataset.py`): positives where the ADR-037 path stands on a detection the
  detector is sure of (score >= 0.6; 18 of 18 checked by eye were the ball, including 4-11 px balls), negatives around decoy candidates and
  at random; 128 px crops at full resolution; the last 15 % of the match held out. The owner's marks join as truth.
- **Training** on the Intel Arc GPU with PyTorch XPU 2.15 (BSD) in a separate environment `.venv-train` (the app's environment is unchanged);
  `onnx` (Apache-2.0) for the export. The XPU backend miscomputed non-contiguous inputs and asserted on boolean-mask writes: the script uses
  contiguous tensors and `torch.where` / mask weights.
- **Inference in the worker** (`vie_worker/ball_net.py`) on OpenVINO (GPU, FP16, throughput mode, 4 frames in flight): 0.078 s per analysed
  frame including decoding (~73 min for a 156-min match at 6 fps). Heat-map peaks >= 0.3 are candidates for the same ADR-037 path search
  (size rule skipped: a peak has no box). Cached as Parquet next to the run's detections, so following the ball again is seconds.
  `TRACK_BALL` uses the model when one is registered (`ball_net` in the model registry, SHA-256 pinned) and the video's source is present;
  it runs in the analysis worker group (GPU work, serial with ANALYZE).

## Measured
- Training: 27,245 crops (9,369 with the ball), 15 epochs, 2 h 21 min on the Arc. Held-out crops (3,554; 1,210 with the ball):
  **precision 0.983, recall 0.815** (right within 4 px).
- Full frames, owner's complaint stretch 38:10-38:31 (22 frames at 1 s): ring on the ball in 17 of 17 frames where it shows one, 0 wrong
  (ADR-037 engine: about 8 wrong); 5 frames unknown (the far camera, ball tiny).
- NOT yet measured: the whole match against the owner's marks. Crops of "sure" frames are easier than average; the full-match number will be
  lower.

## Risks and next steps
- Trained on one match: other stadiums, kits and cameras may be weaker. Each new match adds sure examples; the owner's marks add hard ones.
- Labels come from the old engine's sure detections: balls it never saw are missing as positives (the model learns some anyway, as the
  free-kick close-up shows). Retrain with the new model's sure detections plus marks (self-training) once measured.
- Speed: a narrower network (width 16) would be about twice as fast; decide after the full-match measurement.
