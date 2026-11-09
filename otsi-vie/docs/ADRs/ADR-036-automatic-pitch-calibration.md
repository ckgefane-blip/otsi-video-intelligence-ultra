# ADR-036: Automatic pitch calibration

Status: accepted for development and local testing (2026-11-01; owner: "Can't we have the engine auto calibrate pitch in videos? This is
endless back and forth and user frustration", then "Yes, build it"). Builds on the pitch geometry (0024), the match camera (0025, the person's
moments joined into one camera) and ADR-030 (zero cost).

## Decision
- The whole video is calibrated by the engine with one button ("Find the pitch automatically", request `mode = AUTO`, migration 0026).
  Clicking moments stays as the fallback for what it cannot find.
- A keypoint network finds named pitch points in a frame: **PnLCalib** single-view keypoint model (HRNetV2-W48, 57 keypoints;
  github.com/mguti97/PnLCalib release v1.0.0 `SV_kp`), weights **CC BY 4.0** (commercial use with attribution; LICENSE_REGISTER). It is
  SHA-256-pinned in the model registry (`pnlcalib_sv_kp`), converted once to OpenVINO (`tools/models/convert_pnlcalib.py`, with Microsoft's
  MIT HRNet architecture) and run on the Arc GPU at FP16 (0.29 s/frame; FP32 gives identical calibrations at 0.78 s). PnLCalib's GPL code is
  not used: decoding and fitting are ours (`vie_worker/pitch_auto.py`).
- **Our match camera is the safety check.** The camera stands in one place and only pans, tilts and zooms (`vie_worker/camera.py`); it is
  refined from the 20 frames with the most keypoints plus the person's moments; each frame is then fitted with only pan, tilt and zoom,
  outliers dropped, and accepted only with ≥ 5 agreeing points (≤ 7 px rms of 1280), pitch lines known to ≤ 6 px (1 sigma, covariance) and a
  pitch that covers the grass. Without any camera: a homography with ≥ 6 points and ≤ 4 px.
- One frame every 2 s; a measured frame stands for 1 s each side (`pitch_calibrations`, INFERRED; the reader takes the best quality).

## Evidence (the owner's match, 156 min, 720p broadcast)
- Rejected first, measured: line-mask search (≈ 1/3 right, checks could not tell which), camera following by picture motion (lost in
  zooms), registration to stored views (plain grass aligns anywhere: ≈ 2 of 20 right). PnLCalib alone: 12 of 13 calibrated frames right.
- With our camera check, 40 frames: 9 calibrated, 9 right by eye, 0 wrong (PnLCalib's one wrong frame refused); the owner's three moments
  match his clicks to a median of 4.5, 9.9 and 6.8 px; studio, graphics and close-ups never calibrated.
- Whole match: 4,688 frames in 30.5 min on the Arc GPU; 1,409 with pitch points; **884 calibrated**; 32 frames judged by eye (one every
  5 min): 11 calibrated, **11 right**, 0 wrong; 5 wide main-camera frames missed (not measured), all studio/graphics/close-ups refused.
- A published keypoint coordinate is a typo (keypoint 52 at 9.0 m from the centre, its mirror at 9.15 m): the true geometry is used.

## Open
- Coverage: ≈ 70 % of wide main-camera frames; the rest stay not measured. Next: follow the camera between calibrated frames.
- Counsel (LICENSE_REGISTER L5): the authors state the SoccerNet research agreement has expired and the weights carry no further restrictions.
- Precision/recall on a labelled answer key (the owner's marked frames) is still to be measured; the numbers above are by eye.
