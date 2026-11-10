# ADR-126: Track U.9 — 3D parabolic ball-flight separation (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the U.9 build on `muse/ultra-main`; it
  does not claim any real ball-tracking accuracy. No labelled Sukhum
  ball-flight segments exist yet, so no real number exists yet.
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `a721d36`)
- **Decides:** how the ball is kept on its own track when it is in flight,
  instead of handing over to a boot or a player at a crossing.
- **Context:** the ball path search (`vie_worker.ball`, ADR-037) joins
  candidates by constant-velocity prediction and chains tracklets by
  straight-line reachability. A ball in flight follows a parabola under
  gravity, not a straight line. At 6 fps the tangent is nearly the arc
  between samples, so a smooth flight survives - but when frames are missed
  or the sample rate is low (the default analysis runs at 2 fps), the
  tangent has drifted a long way from the arc, and a boot sitting near the
  tangent wins the association instead of the ball. And when the ball is
  hidden mid-flight and reappears on the same arc, the path search had no
  way to know the reappearing piece was the same ball, so a higher-scoring
  boot present for the whole shot could win the chain outright. Reproduced
  on synthetic scenes before the fix: a blurred fast ball in a long arc,
  hidden for 4 frames near the apex, with a boot out-scoring it - the old
  code followed the boot for the early spans (precision 0.568, 19 wrong);
  a ball landing at a running player's feet and hidden behind him - the old
  code followed the boot for nearly the whole shot (precision 0.023).

## Decision

1. **The flight model is a parabola in the picture** (`vie_worker/ball_flight.py`).
   A ball in flight moves at constant horizontal velocity while its height
   follows a parabola under gravity; projected into the picture, that 3D
   parabola is a conic, well approximated over one flight segment by a
   parabola in picture coordinates, whose picture-y acceleration points
   downward. The fit is done in the picture, where the ball is observed:
   recovering the ball's true height needs the camera centre, which the
   pitch homography alone does not determine, so no height is invented and
   no calibration is needed. A flight is a least-squares quadratic fit of
   x(t) and y(t) (numpy only) with at least 4 points, RMS residual at most
   0.004 picture widths, and a downward picture-y acceleration of at least
   0.05 widths/s^2. A rolling ball (~0 acceleration) and a jittering boot
   (no arc fits) are not flights.
2. **Three wirings, all behind `use_flight`, off by default** (run config
   `"ball_flight": true` in `ball_job.py`; reported in the job metrics as
   `ball_flight`). Without it, behaviour is exactly as before (verified: the
   default run reproduces the old output byte-for-byte on the synthetic
   scenes, and the linear-ball scene from `tests/test_ball.py` gives
   identical results with the flight on and off).
   - Prediction: a tracklet that is in flight predicts its next position
     from its arc (`Tracklet.predict`), refitted as it grows; a tracklet
     whose points stop fitting a flight (a kick, a bounce, a roll) falls
     back to the straight line on its own.
   - Joining: in `best_paths` a piece that continues a flight must lie on
     the flight's parabola (within 0.012 picture widths); anything else - a
     kick, a bounce, a boot at the landing spot - is a restart, not the
     same flight, so no INFERRED positions are invented across it.
   - Evidence: a piece that is itself a flight earns FLIGHT_BONUS = 1.5 in
     the path search (about five detections' net score, roughly two-thirds
     of a 6-point piece's own weight).
3. **Tuning constants, not measured thresholds.** FLIGHT_MIN_ACCEL = 0.05,
   FLIGHT_MAX_RESIDUAL = 0.004, FLIGHT_LINK_TOL = 0.012, FLIGHT_BONUS =
   1.5. The acceleration floor is the defence against spurious flights: a
   straight-line boot plus detection jitter fits some parabola, and the
   fitted acceleration of that parabola is pure noise (0.021 widths/s^2 on
   the synthetic boot, jitter sigma 0.001). 0.05 sits ~2.4x above that
   noise and ~2.4x below the smallest real flight in the synthetic scenes
   (0.12). At 0.02 the floor let a spurious boot flight through and the
   flight made one sensitivity case worse (3 wrong became 11); at 0.05
   that case is fixed (3 wrong became 0). All four constants must be
   calibrated on labelled Sukhum flights, where the real detection jitter
   and the real far-ball acceleration are measured. A missed flight only
   loses the bonus (the old behaviour); a spurious one can mislead the
   path search, so the floor errs high. The model assumes a roughly level
   broadcast camera: under a steep top-down view gravity projects mostly
   along the optical axis and little into picture-y.

## Measured (synthetic only)

`otsi-vie/tools/eval/ball_u9_compare.py` (exit 0). No footage, no model and
no labelled flights exist here, so these numbers measure the flight logic,
not a real ball-tracking accuracy.

- Long-arc blur gap (ball 0.40, boot 0.45-0.50): flight off precision
  0.568 / 19 wrong / 4 invented; flight on 0.886 / 5 wrong / 1 invented.
  Sensitivity: ball 0.35 -> wrong 44 to 14; ball 0.40 with boot 0.40-0.45
  -> wrong 3 to 0; ball 0.45 -> wrong 3 to 0.
- Short-arc gap (the ball bounces 0.4 s after it reappears, so its
  post-gap piece straddles the bounce and is not one flight): identical
  off and on, 3 wrong - no regression, no win.
- Bounce + occlusion (ball lands at a running player's feet, hidden, then
  rolls away glued to the boot): off 0.023 / 42 wrong; on 0.279 / 31
  wrong. Improved but still failing - see Consequences.
- Guardrail, the linear-ball scene from `tests/test_ball.py`: identical
  off and on (precision 0.964, 6 wrong) - the flight does not fire where
  there is no flight.
- 2 fps association: on a fast arc, the parabolic prediction is within
  0.005 widths of the ball while the linear prediction is 0.042 away; a
  boot sitting on the tangent wins the tracklet without the flight and
  loses it with the flight (tested in `tests/test_ball_u9.py`).

Tests: 9 new tests in `tests/test_ball_u9.py`; `python3 /tmp/run_u9_tests.py`
(a direct importer bypassing conftest, which needs `.local/mysql-lint.env`
+ MySQL 3507 on the owner's host) gives 69 passed, 0 failed across
test_ball_u9, test_tracker, test_tracker_u2, test_tracker_u4, test_follow,
test_jersey_u6, test_tiling_u7 and test_infer_queue. The 7 failures in
test_appearance / test_geometry are identical on clean HEAD (missing
pyarrow / pymysql / pytest in this workspace and fixture arguments the
direct runner does not supply). `pytest` was not run here, for the conftest
reason above; that file was not fabricated.

## Consequences

- TRACK_BALL jobs gain a `ball_flight` run-config flag and a matching
  metrics field; the default is off, so no existing run changes until a
  caller opts in.
- The bounce + occlusion case is a known limit: after a bounce the ball's
  motion is new, so the flight model cannot vouch for the pieces that
  follow it, and a boot that out-scores the ball for the whole shot and
  stays glued to it can still win the path search on weight. That is a
  path-search scoring question (flight evidence versus detector scores),
  not a flight-model question, and is a follow-up (U.10 candidate), not
  claimed here.
- The same applies to the rolling phase: once the ball is rolling on the
  ground next to a player, the flight has nothing to say about it, and the
  boot can still win those spans on score.
- A full 3D reconstruction (the ball's height above the ground) needs the
  camera centre from a calibrated camera; that is a follow-up, not claimed
  here. The picture parabola is the projection of the 3D parabola, and the
  downward picture-y acceleration is its surviving signature.

## Alternatives considered

- **Fitting the parabola in ground-plane metres via the pitch homography:**
  rejected for now - the ground-plane track of a flying ball is a straight
  line traversed non-uniformly, which does not by itself separate a flight
  from a roll, and the height still needs the camera centre. The picture
  parabola carries the gravity signature directly.
- **Raising the all-feet score filter (FEET_MIN_MEAN) so high-scoring
  boots are dropped:** rejected - that threshold separates balls at feet
  (0.6-0.9 on the owner's match) from boots (0.2-0.5) and changing it on
  synthetic evidence would risk dropping real balls at feet. It is a
  separate decision, to be made on real score distributions.
- **A bigger flight-break penalty instead of the bonus:** rejected - it
  would punish legitimate kicks and bounces, whose new pieces also break
  the old flight, and it would make the rolling ball's pieces pay for
  leaving the flight. The bonus rewards flight evidence instead of
  punishing its absence.
