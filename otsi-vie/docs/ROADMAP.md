# OTSI VIE v2: roadmap from today to the finish

Written 2026-11-05 from the code itself: the API routes, the migrations up to 0035 and the commits up to 2 Nov.
`docs/IMPLEMENTATION_STATUS.md` was last updated on 1 Nov and is behind the code; updating it is the first item of Step 1.
Each step ends the same way: tests pass, the change is redeployed to https://vie.otsi.cc, and you check it by clicking.

## Where we are today

**Built and working in the app**
| Area | What exists |
|---|---|
| Upload | Upload or direct link, video check, playback copy, footage assessment |
| Analysis | Players and ball found and followed; officials learned per match; teams from kit colours, assigned to the match teams |
| Who is who | "Is this X?"; shirt numbers read and proposed from the roster; look-alikes; one person joined across camera cuts; "Who is this?" for unnamed players in events |
| Match | Clubs and matches (date, teams, score, roster); lineup cards read from the broadcast and approved into the roster; halves found from play |
| Pitch | Pitch mapped from the camera automatically for the whole match |
| Events | Possession and passes; ball won, shots and key passes where measurable; pressures; set pieces; goals from the scoreboard; possible tackles, interceptions and fouls |
| Stats | Distance, top speed, runs and sprints, heat zones, team shape (width, length, compactness) |
| Reels | Reel Builder from his events; spotlight beam; drag and drop; overlays, score, branding, watermark, music, intro/outro, event tags, match card; real MP4; stop a render |
| Sharing | Rights grant per video; private share links to finished reels, checked again at every opening, revocable |
| Other | Home with live hero, Library, three-dots menus, notes on reels, saved searches, live address vie.otsi.cc |

**Built, but accuracy not yet measured:** detection, tracking, identity suggestions, events and stats. They run on real footage and you
have checked samples by eye (passes, pressures, his reel's first moment), but there is no scored sample across several matches yet.
Until there is, they are labelled as such and are not production-ready (gates G05-G08).

**Not built yet** (the app says "Not built yet" or "—" where they belong)
- Accounts: inviting users, setting each user's role, 2-step sign-in (MFA)
- Formation names and defensive-line height (Page 05 shows "—"); transitions
- Player report PDF and share link from Page 08; the PDF reports on Page 10
- Comparing players; scouting profile
- Clip Studio graphics, audio and templates tabs
- Plans, usage limits and billing
- Monitoring, backups with a tested restore, load and security tests, legal pages
- Exact match of each page to its approved image (only Page 02 has been measured, within 1 px)

## The road from here

### Step 1: Close the gaps you would hit first (now)
- Bring `docs/IMPLEMENTATION_STATUS.md` up to date with the code, so the record is right again.
- Accounts: invite a user by e-mail link, choose their role (Owner, Admin, Analyst, Viewer), remove them; 2-step sign-in with an
  authenticator app (free, no SMS).
- You walk the whole journey on vie.otsi.cc and re-render your reel; I fix what you report.

**Done when:** you can invite a second person, they sign in with their own role, and the journey runs without help.

### Step 2: Measure the accuracy
- Marking tools for players and events, next to the ball marks that exist on Page 04.
- You mark short stretches of several different matches (never only one).
- The engine is scored per match for detection, tracking, identity and events. The numbers go in the status file and the gates.

**Done when:** each AI result shows a measured score, and anything below the agreed level stays "unverified".

### Step 3: Tactics complete (Page 05)
- Formation names per phase and defensive-line height; transitions.
- Each shown only where enough players are measured; otherwise "not measured".

**Done when:** Page 05 has no "—" where the match has enough measured players.

### Step 4: Reports, PDF and comparison (Pages 08 and 10)
- Player report and team report as PDF, identical to the screen.
- Share link for a report; comparing two players; scouting profile.

**Done when:** you download a player report PDF and send its link.

### Step 5: Clip Studio finished (Page 07)
- Graphics, audio and templates tabs working.

**Done when:** every Clip Studio tab performs a real action.

### Step 6: Plans and billing
- Plans and usage limits (minutes, renders, storage), usage shown per club; a club over its limit is stopped.
- Checkout only after you choose a payment provider with no monthly fee, and give your written yes.

**Done when:** a club on a plan is stopped at its limit.

### Step 7: Design match, all 10 pages
- Each page compared with its approved image at desktop and tablet size, plus the admin console; you sign each one off.

**Done when:** all 10 pages are signed off.

### Step 8: Ready to sell
- Monitoring and alerts.
- Daily backups with a tested restore.
- Load test, security and tenant-isolation tests.
- Privacy, terms, accessibility.
- Release gates G01-G15.

**Done when:** all gates pass and the external sign-offs below are in.

### Step 9: Player Auto-Tracking & Engine Ultra-Enhancements (Track U — scheduled next after the current v3 plan)
Zero-cost, local Intel Arc GPU and truth-preserving (`Detected` / `Inferred` / `Confirmed` / `Not measured`) upgrades across player auto-tracking, spotlight follow, inference throughput, and specialized football AI:

1. **U.1 Occlusion-Protected Phase Follower (`follow.py`):**
   - Mutual-overlap perspective guard: when an active track's torso patch overlaps (`IoU > 0.25`) with a foreground track (`y2_front > y2_back`), suspend FFT phase-correlation updates for the occluded background track and coast on camera-compensated Kalman velocity instead of drifting onto the occluder.
   - Forward-backward phase-correlation residual check (`|shift(A->B) + shift(B->A)| <= 1.5 px`) to reject motion-blurred false shifts.
2. **U.2 Deep-EIoU + Selective On-Demand DINOv2 Association (`tracker.py`, `embed.py`):**
   - Replace raw IoU in Stage 1/2 Hungarian matching with **Iterative Expansion IoU (Deep-EIoU)** (`e = 0.2..0.5`) to handle fast counter-attack pans.
   - Run on-demand `DINOv2-small` cosine gating only on ambiguous association pairs (where 2+ tracks with identical kit colours compete within `IoU > 0.15` or recover after `1..30` frames of occlusion).
3. **U.3 Intra-Track Same-Team Identity Swap Splitter (`appearance.py`):**
   - Extend `split_on_shirt_change` into `split_on_identity_change`: split tracks that exhibit high internal appearance drift (`drift >= 0.28` between first/second half crops) or conflicting high-confidence jersey number reads (`RECOGNIZED` `#A` then `#B`) at the frame of peak velocity/appearance discontinuity (crossing point).
4. **U.4 Pitch-Plane (2D World-Coordinate) & Homography-Warped Kalman Tracking (`tracker.py`, `camera.py`):**
   - Replace pure 2D translation `phase_shift` with inter-frame 8-DOF RANSAC homography warping $H_{t-1 \to t}$ on turf/line features, and track player foot-points in calibrated physical pitch metres `(X, Y)` bounded by biomechanical inertia (`v <= 10.5 m/s`, `a <= 6 m/s^2`).
5. **U.5 Grass-Masked Part-Stripe Re-ID Embeddings (`appearance.py`, `embed.py`):**
   - Mask background turf pixels via `grass_mask` before embedding and pool `DINOv2` patch tokens from a single forward pass into 4 horizontal anatomical stripes (**Head/Hair/Skin**, **Upper Torso/Kit**, **Shorts/Thighs**, **Socks/Boots**) to separate same-team look-alikes on wide angles.
6. **U.6 Super-Resolved & Perspective-Rectified Jersey OCR + Spatio-Temporal Link Fusion (`jersey.py`, `ocr.py`, `appearance.py`):**
   - Add 2x Lanczos torso upscaling + CLAHE local contrast normalization + perspective back-rectification (lowering `OCR_MIN_PX` from `100 px` to `75 px`) and optional `PARSeq-tiny` / `PP-OCRv5` OpenVINO recognition head.
   - Fuse part-stripe cosine similarity, pitch-plane reachability (`dist_m / dt_s <= 9.5 m/s`), and soft digit posteriors inside `propose_links`.
7. **U.7 Target-Anchored Dense Spotlight Re-Analysis (`render/reel.py`):**
   - Anchor `target_path()` (10 fps dense clip re-analysis) with the confirmed player's reference `DINOv2` embedding and `torso_colour` histogram (`kit_gate`), plus intermediate `follow_tracks` up to full render frame rate (`25/30/60 fps`), preventing beam/crop drift during crowded box scrambles and celebrations.
8. **U.8 Horizon-Guided Adaptive Multi-Scale Tiling (`detect/ov_rtdetr.py`, `detect/pitch.py`):**
   - Restrict `2x2` and `3x3` high-resolution tiles to the vertical band intersecting `playing_surface(bgr)` and reserve `3x3` tiles for far-side pitch zones where players are `< 45 px` tall, cutting `ULTRA_SENSITIVE` tile passes by ~40–50% while eliminating upper-stand and LED-board false positives.
9. **U.9 OpenVINO `AsyncInferQueue` (`THROUGHPUT`) + Mixed-Precision FP16/FP32 (`detect/ov_rtdetr.py`):**
   - Convert synchronous `OvRtDetr.detect_batch` tile loops to `ov.AsyncInferQueue` (`THROUGHPUT` hint, matching `ball_net.py`) and run Mixed Precision (FP16 ResNet backbone + FP32 Transformer decoder head) to preserve `ADR-026` detection parity at near-FP16 speed.
10. **U.10 Single-Pass Hardware-Accelerated Frame Decode (`analyze.py`, `follow.py`):**
    - Unify `sample_frames` and `FrameStream(FOLLOW_WIDTH)` into a single streaming decode pass with Intel QSV / D3D11VA hardware acceleration (`-hwaccel d3d11va`) and a ring-buffer for intermediate grayscale frames.
11. **U.11 Continuous Inter-Frame Pitch Calibration Propagation (`pitch_auto.py`, `camera.py`):**
    - Propagate `(pan, tilt, log f)` between `pnlcalib_sv_kp` keypoint frames using optical flow on pitch lines/turf (flagged as `CALIBRATED_PROPAGATED` vs. `CALIBRATED_DIRECT` when 1-sigma line uncertainty stays `<= 6.0 px`), lifting main-camera calibration coverage from ~70% to `> 92%`.
12. **U.12 3D Parabolic Ball Flight Separation & Tactical Pitch-Control AI (`ball.py`, `actions.py`, `possession.py`):**
    - Separate `GROUND` roll vs. `AERIAL` parabolic flight spans during `INFERRED` ball trajectories to classify ground passes, lofted passes/crosses, and clearances while preventing aerial fly-overs from triggering false `POSSESSION_CHANGE` / `INTERCEPTION` events.
    - Compute calibrated **Line-Breaking / Progressive Passes** and **Pitch Control / Voronoi Space Occupation** (strictly labelled `Inferred` when `>= 8` players per team are calibrated on the pitch; otherwise `Not measured`).

**Done when:** each `U.1`–`U.12` item passes Track G regression (`G.5`), reduces persistent identity switches and runtime on the benchmark match set, and preserves all truth labels.

## What only you can provide
| Step | What |
|---|---|
| 1 | Your walkthrough and what goes wrong |
| 2 | Marks on short stretches of several different matches, and more licensed footage (other grounds, kits, light) |
| 6 | Payment provider and prices (no monthly fee), with your written yes |
| 8 | Legal review: privacy, terms, model and codec licences, footage rights |
| 8 | Where it runs for paying customers. Today it needs this PC switched on; I will lay out the free options, nothing is bought unless you decide |

## Next action
Step 1: update the status record, then build invites, roles and 2-step sign-in. Your walkthrough can start any time on https://vie.otsi.cc.
