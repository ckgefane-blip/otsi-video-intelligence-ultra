# ADR-028: Frame sampling and tracking quality — measured defaults

Status: accepted (2026-10-27; owner directive: configurable/adaptive sampling, cut detection, re-identification, motion association
where justified, frame-accurate timestamps, spotlight continuity, explicit unobserved handling, defaults chosen by measurement)

## How it was measured (`tools/models/sampling_study.py`, evidence `release-evidence/sampling-study/20261027/`)
- Three real clips (Wikimedia Commons, licences in `.local/eval-footage/SOURCES.json`): France–Germany broadcast-style wide shot
  (1080p30, 17 s, no cuts), NSA Naples amateur match news piece (1080p30, 40 s, 6 cuts), OCSC vs Oakland highlights (4K60, 40 s
  window analysed at 1080p30).
- The production detector (RT-DETRv2-R18, tiles 2, pitch filter, OpenVINO on the Arc GPU) ran on **every** frame once; each
  sampling rate is then simulated from exactly those detections, so rates differ only in which frames they see.
- Reference = the production tracker on every frame. It is **not ground truth** (no labelled football footage exists in the
  project yet); at full frame rate consecutive boxes overlap almost completely, so it is the best evidence the same detector gives.
- Metrics: persistent identity switch (a track that moves to another, simultaneously visible person and stays on him >= 1 s — the
  error that would put a spotlight on the wrong player), fragmentation (tracks per reference track), coverage (share of reference
  observations inside a confirmed track), ball frames tracked / frames with a ball detection, cuts found vs reference, centre motion
  between samples (in body heights), and the IoU between a straight-line interpolation and the real dense detection in between.

## Results
| Clip | fps | 90-min match on Arc GPU | persistent switches | tracks per ref. track | coverage | ball tracked / detected | interp. IoU mean (p10) | cuts found / ref |
|---|---|---|---|---|---|---|---|---|
| France–Germany (wide) | 1 | 36 min | 1 | 4.04 | 53% | 16/16 | 0.73 (0.53) | 0/0 |
| France–Germany (wide) | 2 | 71 min | 3 | 3.97 | 73% | 19/26 | 0.80 (0.63) | 0/0 |
| France–Germany (wide) | 3 | 107 min | 7 | 2.77 | 88% | 32/42 | 0.82 (0.67) | 0/0 |
| France–Germany (wide) | 5 | 179 min | 3 | 1.81 | 94% | 48/66 | 0.87 (0.75) | 0/0 |
| France–Germany (wide) | 10 | 357 min | 10 | 1.59 | 97% | 117/130 | 0.91 (0.83) | 0/0 |
| France–Germany (wide) | 15 | 536 min | 6 | 1.60 | 98% | 178/191 | 0.93 (0.85) | 0/0 |
| Naples (amateur, cuts) | 1 | 43 min | 0 | 1.18 | 81% | 22/23 | 0.83 (0.48) | 7/6 |
| Naples (amateur, cuts) | 2 | 86 min | 2 | 1.61 | 85% | 41/45 | 0.90 (0.68) | 6/6 |
| Naples (amateur, cuts) | 3 | 128 min | 0 | 1.74 | 93% | 56/65 | 0.91 (0.71) | 6/6 |
| Naples (amateur, cuts) | 5 | 214 min | 2 | 1.74 | 93% | 106/111 | 0.93 (0.79) | 6/6 |
| Naples (amateur, cuts) | 10 | 428 min | 1 | 1.46 | 97% | 205/220 | 0.95 (0.88) | 6/6 |
| Naples (amateur, cuts) | 15 | 642 min | 1 | 1.70 | 98% | 309/327 | 0.96 (0.92) | 7/6 |
| OCSC highlights (fast) | 1 | 44 min | 0 | 2.07 | 71% | 35/36 | 0.48 (0.09) | 5/0 |
| OCSC highlights (fast) | 2 | 88 min | 2 | 2.66 | 74% | 70/72 | 0.65 (0.32) | 2/0 |
| OCSC highlights (fast) | 3 | 132 min | 4 | 3.43 | 83% | 98/107 | 0.71 (0.42) | 2/0 |
| OCSC highlights (fast) | 5 | 219 min | 3 | 4.26 | 88% | 161/181 | 0.78 (0.52) | 1/0 |
| OCSC highlights (fast) | 10 | 439 min | 5 | 3.57 | 93% | 331/367 | 0.84 (0.62) | 1/0 |
| OCSC highlights (fast) | 15 | 658 min | 9 | 3.88 | 94% | 498/538 | 0.87 (0.64) | 0/0 |

Tracker variants at 2 fps (persistent switches / coverage):

| Clip | IoU (production) | + camera-motion compensation | + centre-distance blending |
|---|---|---|---|
| France–Germany (wide) | 3 / 73% | 5 / 69% | 16 / 92% |
| Naples (amateur, cuts) | 2 / 85% | 1 / 88% | 3 / 93% |
| OCSC highlights (fast) | 2 / 74% | 0 / 73% | 6 / 91% |

Re-linking a lost player by kit colour (same shot, ≤3 s, plausible position), judged against the reference at 2 fps:

- France–Germany (wide): 48 links, 25 confirmed, 23 contradicted, 0 undecidable
- Naples (amateur, cuts): 9 links, 3 confirmed, 4 contradicted, 2 undecidable
- OCSC highlights (fast): 57 links, 13 confirmed, 39 contradicted, 5 undecidable

Adaptive sampling (base rate, burst where the picture changes fast) vs uniform at a similar frame budget:

- France–Germany (wide): adaptive 3→6 (5.8 fps effective): 9 persistent switches, coverage 95%; uniform 5 fps: 3, 94%
- Naples (amateur, cuts): adaptive 3→6 (4.15 fps effective): 2 persistent switches, coverage 90%; uniform 5 fps: 2, 93%
- OCSC highlights (fast): adaptive 3→6 (5.98 fps effective): 6 persistent switches, coverage 89%; uniform 5 fps: 3, 88%

Before this study the ball was effectively never tracked on wide footage at 1-3 fps (its boxes are a few pixels wide, never overlap
between samples, and most ball detections score below the person threshold): see the ball column, now 73-97 % at 2 fps.

## Decisions
1. **Default stays 2 analysed frames per second, tiles 2** (UI also offers 1, 3, 5). It is the highest rate that finishes a 90-minute
   match in about match time on this machine (71-88 min on the Arc GPU). The identity-harmful error (persistent switch) is rare at
   every rate (0-7 per clip, no trend with rate); what higher rates buy is **coverage and fewer broken tracks** (2 -> 3 fps: coverage
   73 -> 88 % on wide footage, at +50 % time). Broken tracks are safe — unknown stays unknown and the reviewer joins them — so the
   default favours finishing the match; 3 fps is the recommended setting when time allows.
2. **Spotlight continuity is not built on 2-fps interpolation.** A straight line between 2-fps samples misses the real box often
   (mean IoU 0.65-0.90, 10th percentile 0.32-0.68). Reels/spotlight (Blocks 10-11) will re-analyse **only the reel's seconds** densely
   (10-15 fps: mean IoU 0.84-0.96) — a 60-second reel at 15 fps costs about 7 minutes on this GPU. Any box rendered between real
   detections is stored and labelled `INTERPOLATED`, never `DETECTED`; the workspace shows only detections (solid = this frame,
   dashed = nearest analysed frame) and presence gaps as "not observed".
3. **Ball association by reachable distance** (`ball_speed` 0.8 frame widths/s + 3 ball sizes), ball tracks may start from detections
   >= 0.3: adopted (test_tracker.py).
4. **Camera-motion compensation: not adopted.** Phase correlation on the 128-pixel thumbnails is quantised to ~40 % of a distant
   player's width; at 2 fps it changed nothing consistently (3 -> 5, 2 -> 1, 2 -> 0 switches; coverage -4..+3 points). The tracker
   accepts a `camera_shift` so a full-resolution estimate can be tried later; it is off in production.
5. **Centre-distance association: not adopted.** It raises coverage to 91-93 % but multiplies persistent switches (France 3 -> 16) —
   a spotlight on the wrong player is worse than a gap.
6. **Automatic re-identification by kit colour: rejected.** Teammates share a kit; links were contradicted about as often as
   confirmed (France 25/23, OCSC 13/39). Re-linking stays a human identity decision until a real appearance model (face/number,
   Block 07) is evaluated.
7. **Adaptive sampling: not adopted.** At a similar frame budget it was not better than uniform sampling on any clip.
8. **Cuts:** the detector found every reference cut at 2-15 fps on Naples (6/6). On fast highlights it reports a few extra cuts at
   1-3 fps (fast pans look like cuts between distant samples). That errs on the safe side: a track ends, nothing is bridged.
9. **Timestamps:** every observation keeps the source frame index and presentation time (pts_us from the stream, variable frame
   rate exact; ADR-025); no rate change alters that.

## Not done / limits
- No labelled ground truth: absolute accuracy (MOTA/HOTA, ID F1) needs annotated football footage — owner-supplied or licensed.
- Studied on three short clips; a full match may contain situations (long occlusions, replays, graphics) not covered.
