# ADR-034: Ultra-Sensitive Grassroots Analysis — profiles, footage assessment, multi-scale detection, temporal confirmation, evaluation

Status: accepted for development and local testing (2026-10-27; owner directive "Ultra-Sensitive Grassroots Player Detection, Tracking
and Identity Engine" and the follow-up rule below). Builds on ADR-024 (detector), ADR-025/028 (tracking, sampling), ADR-031/033 (identity
evidence). Zero-cost policy (ADR-030): only the free models already registered are used.

## The owner's rule
> Ultra-Sensitive Grassroots Analysis must not be implemented simply by lowering detection-confidence thresholds. Its objective is to
> maximize small-player detection recall while controlling false positives and maintaining strict identity-verification safeguards.
> Use multi-scale detection, temporal evidence, candidate validation and calibrated confidence thresholds. Never sacrifice player
> identity accuracy merely to increase detection counts.

How this design follows it:
1. **Look harder, not looser.** Recall on small players comes from multi-scale detection (full frame + 2x2 + 3x3 overlapping tiles: a
   3x3 tile of a 1080p frame reaches the 640-px detector input *enlarged*, so a 25-px player is seen at ~40 px) and denser sampling.
2. **Low-confidence boxes are candidates, never players.** They are kept as raw evidence and may extend an existing track (ByteTrack
   second stage) or start a tentative one, but a track survives only with **temporal confirmation**: several detections in the shot and
   at least one confident detection (`confirm.min_hits`, `confirm.min_peak`). Unconfirmed candidate tracks are dropped and counted.
3. **Thresholds are calibrated on footage, not guessed** — the first values are provisional; the study below measures them and the
   evaluation framework re-measures them on manually labelled ground truth before any accuracy claim.
4. **Identity rules are identical in every profile**: track numbers are temporary; a player is named only by a person's confirmation
   (ADR-016); shirt numbers, colours and look-alikes are suggestions (ADR-033). A more sensitive profile produces more tracks to review,
   never more automatic identities.

## Profiles (`packages/contracts/src/analysis.ts`, written out in full into each run's config)

| | Standard | High accuracy | Ultra-sensitive grassroots |
|---|---|---|---|
| for | broadcast / good footage | compressed, blurry, shaky, dark | tiny, distant players |
| frames analysed per second | 2 | 6 | 6 |
| detector passes per frame | 5 (full + 2x2) | 5 | 14 (full + 2x2 + 3x3) |
| raw detection floor (candidates) | 0.20 | 0.20 | 0.10 |
| new track needs a detection ≥ | 0.50 | 0.50 | 0.40 |
| association | IoU | IoU + centre distance (0.3) | IoU + centre distance (0.4) |
| track kept with | ≥ 2 hits, peak ≥ 0.5 | ≥ 3 hits, peak ≥ 0.5 | ≥ 4 hits, peak ≥ 0.4 |
| pitch filter | feet on grass | feet on grass | feet on grass or within a touchline margin |

The user chooses; the footage check pre-selects its recommendation; any single setting (frame rate, tiles) can be overridden.

## Footage-quality assessment (`vie_worker/quality.py`, job ASSESS, migration 0017)
Sampled bursts at 8 positions: resolution, frame rate, bitrate and bits per pixel, sharpness (Laplacian variance at 960 px), compression
blockiness, brightness and contrast, camera speed and jitter (phase correlation), grass share, and — with the analysis detector itself —
on-pitch player heights (median, 10th percentile, share under 40 px), people per frame and the measured seconds per detector pass.
Issues are reported with the measured value and the threshold; estimates of time and peak memory per profile are computed by the API
from the measured cost (labelled estimates). No enhancement (denoise, contrast, super-resolution) is applied in this stage; if one is
added later it is recorded as provenance and never used to establish identity.

## Evaluation framework (`vie_worker/evaluation.py`)
Ground truth must be labelled by people (OTSI JSON or MOTChallenge `gt.txt`, e.g. exported from the free CVAT tool); the engine's
own output is never used as ground truth. Metrics: detection precision/recall/F1 at IoU 0.5 with **recall by box height** and
precision by predicted height; CLEAR-MOT (MOTA, ID switches, fragmentations), IDF1, HOTA (TrackEval definition); identity: correct /
wrong / unassigned over matched boxes, the **wrong-identity rate** (must stay near zero), identity switches, top-k of ranked candidates.
The arithmetic is unit-tested on constructed cases (`tests/test_evaluation.py`).

## UI
Processing page: footage check (issues, recommended profile pre-selected, estimates) and the profile choice; Workspace: per-track
evidence (strongest detection, size, share of weak detections). Under the owner's visual-fidelity lock these are functional wiring;
their final placement follows the approved images (docs/visual-fidelity/VISUAL_FIDELITY_GAP_REPORT.md).

## Study (2026-10-27) — what each profile finds on real footage, and whether the extra boxes are real

Footage: `naples_amateur` (amateur match news package, 1080p, 40 s), `ocsc_wide` (professional highlights, 4K analysed at 1920 px,
40 s from 2:00), `france_germany` (stadium phone recording, 1080p, 17 s), and `france_germany_degraded_360p` (the same clip re-encoded
to 640×360 at 350 kbit/s as a stand-in for low-quality grassroots recordings — a *derived* test input, labelled as such). Same code
paths as the worker (`tools/eval/profile_study.py`; evidence: `release-evidence/profile-study/20261027/`). Intel Arc GPU, OpenVINO.

### Counts and cost (not accuracy)
Box counts are summed over each profile's own frames (Standard 2 fps, the others 6 fps); boxes/frame is comparable across profiles.

| Clip | Profile | frames | s/frame | passes | person tracks | median track s | person boxes/frame | boxes < 40 px | rejected candidates | extra boxes vs Standard |
|---|---|---|---|---|---|---|---|---|---|---|
| naples_amateur | STANDARD | 80 | 0.53 | 5 | 41 | 2.5 | 3.12 | 0 | 0 | – |
| naples_amateur | HIGH_ACCURACY | 220 | 0.53 | 5 | 50 | 3.7 | 3.95 | 10 | 3 | 40 |
| naples_amateur | ULTRA_SENSITIVE | 220 | 1.95 | 14 | 65 | 4.2 | 5.78 | 50 | 2 | 92 |
| ocsc_wide | STANDARD | 80 | 0.54 | 5 | 108 | 1.5 | 6.86 | 0 | 0 | – |
| ocsc_wide | HIGH_ACCURACY | 229 | 0.49 | 5 | 113 | 1.8 | 8.66 | 0 | 12 | 51 |
| ocsc_wide | ULTRA_SENSITIVE | 229 | 1.78 | 14 | 185 | 1.8 | 15.11 | 1 | 40 | 215 |
| france_germany | STANDARD | 34 | 0.47 | 5 | 71 | 2.0 | 16.56 | 220 | 0 | – |
| france_germany | HIGH_ACCURACY | 102 | 0.46 | 5 | 40 | 10.7 | 22.14 | 932 | 4 | 190 |
| france_germany | ULTRA_SENSITIVE | 102 | 1.77 | 14 | 86 | 6.2 | 40.80 | 2469 | 2 | 747 |
| france_germany_degraded_360p | STANDARD | 34 | 0.41 | 5 | 20 | 1.5 | 3.18 | 105 | 0 | – |
| france_germany_degraded_360p | HIGH_ACCURACY | 102 | 0.41 | 5 | 33 | 2.7 | 6.91 | 678 | 1 | 145 |
| france_germany_degraded_360p | ULTRA_SENSITIVE | 102 | 1.79 | 14 | 61 | 3.8 | 20.74 | 2040 | 5 | 588 |

### Are the extra boxes real? (developer inspection of contact sheets, not ground truth)
Up to 48 randomly sampled boxes per clip and profile that the profile has and Standard does not (same 2-fps frames), each judged by eye
(`labels.json` next to the sheets):

| Clip | Profile | sampled | footballer | other real person (spectator, staff, interviewee) | fragment of a player | not a person (board, text, ball, blur) | uncertain |
|---|---|---|---|---|---|---|---|
| naples_amateur | High accuracy | 40 | 35 (88 %) | 5 | 0 | 0 | 0 |
| naples_amateur | Ultra-sensitive | 48 | 30 (63 %) | 12 | 0 | 5 | 1 |
| ocsc_wide | High accuracy | 48 | 19 (40 %) | 22 | 4 | 2 | 1 |
| ocsc_wide | Ultra-sensitive | 48 | 21 (44 %) | 17 | 5 | 2 | 3 |
| france_germany | High accuracy | 48 | 44 (92 %) | 3 | 0 | 0 | 1 |
| france_germany | Ultra-sensitive | 48 | 19 (40 %) | 5 | 0 | 17 | 7 |
| degraded 360p | High accuracy | 48 | 37 (77 %) | 7 | 0 | 1 | 3 |
| degraded 360p | Ultra-sensitive | 48 | 17 (35 %) | 7 | 0 | 7 | 17 |

Boxes Standard had that Ultra did **not** have on the same frames: naples 119, ocsc 299, france_germany 2, degraded 7 — Ultra is not a
superset of Standard on cut-heavy edited clips (its stricter confirmation, 4 hits, drops short tracks between cuts).

### Findings
1. **High accuracy** (6 fps, distance-aware association, camera-motion compensation, same 0.5 start threshold) adds boxes that are mostly
   real footballers on match footage (88–92 % on naples and france_germany; 77 % on the degraded copy) and makes tracks longer
   (france_germany median track 2.0 s → 10.7 s). On ocsc (stadium with green seats) most of its extras are spectators: the colour-based
   pitch filter is the weak point, for every profile.
2. **Ultra-sensitive is not calibrated yet.** Its extra boxes are only 35–63 % footballers. The failure modes are specific: the 3x3
   tiles turn advertising-board lettering and pitch-side clutter into person candidates (17/48 on france_germany), and on stadium
   footage with green seats the pitch filter accepts spectators (ocsc). Temporal confirmation removed only 2–40 candidate tracks per
   clip, so it is not enough on its own against these structured false positives.
3. On the degraded 360p copy many extra boxes are 8–20 px and could not be judged reliably even by eye (17/48 uncertain): claims about
   tiny players require labelled ground truth, not inspection.
4. **No accuracy improvement is claimed** from these counts. Recall was not measured (no completely labelled frames); the precision
   figures concern the *extra* boxes only, from one developer's inspection. The precision of Standard's own boxes was not sampled.

### Decisions from the study
- The footage check recommends **High accuracy** (not Ultra) when players are small, until Ultra passes calibration on manually
  labelled grassroots footage. Ultra stays selectable and is labelled as not yet calibrated. Identity rules are unaffected either way.
- Next calibration stage (stage 2): a pitch model that does not rely on colour alone (largest connected playing-surface region, pitch
  lines, the board band above the touchline), multi-scale agreement for tile-only small detections (a box found only in a 3x3 tile
  needs support from another scale or from motion), a union of Standard and Ultra tracks instead of replacement, and calibration of
  `score_floor`, `tracker.high` and `confirm` on labelled frames (recall by box height, precision, HOTA, IDF1) — thresholds chosen there.

### Limitations
Four short clips; one is a synthetic degradation; two are edited (cuts) rather than continuous match footage; no amateur match filmed
from a single wide camera; judgements by one developer with no second annotator; GPU timings from one machine (Intel Arc).

## Status
Stage 1 implemented and tested; Ultra-sensitive calibration (stage 2) open. See `docs/IMPLEMENTATION_STATUS.md`.
