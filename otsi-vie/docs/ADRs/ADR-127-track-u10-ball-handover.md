# ADR-127: Track U.10 — bounce/rolling ball handover (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the U.10 build on `muse/ultra-main`; it
  does not claim any real ball-tracking accuracy. No labelled Sukhum
  ball-flight segments exist yet, so no real number exists yet.
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `a721d36`)
- **Decides:** how the ball track is handed over from flight to bounce to
  rolling, and back, without a player track (or a boot detection) stealing it.
- **Context:** U.9 (ADR-126) keeps the ball on its own track while it is in
  flight, but left a known limit: the bounce + occlusion scene (ball lands at
  a running player's feet, is hidden behind him for 4 frames, then rolls away
  just ahead of him while his boot out-scores the ball for the whole shot).
  After a bounce the ball's motion is new, so the flight model cannot vouch
  for the pieces that follow it, and the boot glued to the ball wins the path
  search on weight (precision 0.023 with the flight off, 0.279 with it on).
  The rolling phase has the same gap: once the ball is on the ground, the
  flight has nothing to say about it. Reproduced on the synthetic scene V
  before the fix, and traced: the flight tracklet ends cleanly at the bounce
  (the boot tracklet's prediction is marginally closer to the boot, so the
  greedy association leaves the flight tracklet with nothing), the rolling
  ball gets its own tracklet after the occlusion, and the two tracklets swap
  identities once at the crossing - but the path search then chains the boot
  pieces for the whole post-bounce span because each weighs ~2.15 against the
  ball's ~1.10 (boot 0.45-0.50 a point, ball 0.30).

## Decision

1. **A roll is the complement of a flight** (`vie_worker.ball_flight.is_roll`).
   A ball rolling on the ground moves at (nearly) constant velocity, so its
   quadratic fit is tight and its picture-y acceleration is ~0 - as opposed
   to a flight, whose accel_y is 0.12+. A roll needs at least 4 points, RMS
   residual at most 0.004 picture widths, and |accel_y| at most 0.05
   widths/s^2 (ROLL_MAX_ACCEL: ~2.5x above the noise scale of a quadratic
   fit over 6 points, ~2.4x below the smallest real flight here - the same
   margin as FLIGHT_MIN_ACCEL). A jittering boot passes this test too: it is
   a roll-shaped run of points. The roll test alone cannot tell a boot from a
   rolling ball, and it is not used as ball evidence on its own.
2. **The handover is a join, not a restart** (`vie_worker.ball.best_paths`,
   behind `use_handover`, off by default). When the last piece of a flight is
   followed by a roll piece that starts where the flight landed (reachable
   within JUMP_SPEED over the gap, at most JUMP_MAX_US after the flight
   ended), the join counts as a physical continuation and the roll piece earns
   HANDOVER_BONUS = 0.5 - it carries the ball's identity across the bounce
   instead of paying RESTART_COST for it. The flight's last point is the
   landing point; no ground level is assumed and no height is invented. A
   roll piece after a mid-flight piece cannot collect the bonus: only the
   flight's last piece hands over, and a roll starting mid-flight would have
   to be reachable from a point high in the air.
3. **A glued boot pays for the whole shot** (also behind `use_handover`). Each
   candidate now carries its offset from the nearest player's foot centre
   (`Cand.feet_off`, set in `ball.plausible` alongside `at_feet`). A tracklet
   is glued (`ball.is_glued`) when it has at least 12 points, at least 80% of
   them at a player's feet, and its foot offsets lie within GLUE_MAX_SPREAD =
   0.02 picture widths of each other: a boot, rigidly attached to its
   player's foot, keeps a (nearly) fixed offset (0.008-0.014 on the synthetic
   scenes here, across seeds); a rolling ball separates from the player (0.05
   over the shot in scene V). Every piece cut from a glued tracklet pays
   GLUE_PENALTY = 1.2 in the path search - about the weight a boot piece
   gains over a ball piece by detector score alone (~1.05 a 6-point piece),
   sized to cancel that advantage and leave a small margin. The verdict is
   on the parent tracklet, not the piece: a 6-frame piece is too short to
   tell drift from jitter.
4. **Wiring, all off by default** (run config `"ball_handover": true` in
   `ball_job.py`; reported in the job metrics as `ball_handover`). Without
   it, behaviour is exactly as before (verified: the default run reproduces
   the old output byte-for-byte on the synthetic scenes, and the U.9 numbers
   are unchanged). The handover uses the flight fit to find the landing, so
   the fit is built when either `ball_flight` or `ball_handover` is on; the
   flight bonus itself stays gated on `ball_flight`. The glue penalty works
   on its own: with the flight off and the handover on, scene V goes from
   0.023 to 0.698. `tracklets()` is unchanged: the greedy association already
   ends the flight tracklet at the bounce, and the identity swap at the
   crossing is left to the path search to resolve on the new weights.
5. **Tuning constants, not measured thresholds.** GLUE_MIN_POINTS = 12,
   GLUE_MIN_FEET_SHARE = 0.8, GLUE_MAX_SPREAD = 0.02, GLUE_PENALTY = 1.2,
   HANDOVER_BONUS = 0.5, ROLL_MAX_ACCEL = 0.05. All must be calibrated on
   labelled Sukhum crossings and flights, where the real detection jitter,
   the real boot/ball score distributions and the real separation rates are
   measured. A missed handover only loses the bonus (the old behaviour); a
   spurious glue verdict only costs a piece weight, never a position.

## Measured (synthetic only)

`otsi-vie/tools/eval/ball_u10_compare.py` (exit 0, seeds 1-5). No footage, no
model and no labelled flights exist here, so these numbers measure the
handover logic, not a real ball-tracking accuracy.

- Bounce + occlusion, scene V (ball 0.30, boot 0.45-0.50): flight on,
  handover off precision 0.279-0.326 / 29-31 wrong; flight on, handover on
  **0.977-1.000 / 0-1 wrong** (right 12-14 -> 42-43). The U.9 known limit is
  settled on this scene, with margin, on all five seeds. Handover alone
  (flight off): 0.698-1.000.
- Long-arc blur gap, scene M: flight on, handover off 0.886-1.000; flight on,
  handover on **1.000 / 0 wrong on all five seeds** (seed 3: 5 wrong -> 0) -
  the glue penalty helps here too, since the boot is also glued there.
- Short-arc, scene M-short: identical in all four combinations, all seeds -
  no regression, no win.
- Guardrail, the linear-ball scene from `tests/test_ball.py`: identical off
  and on in seeds 2-5; seed 1 improves slightly (wrong 1 -> 0, one frame
  becomes UNKNOWN instead of wrong). The flight does not fire where there is
  no flight, and the glue penalty does not touch the ball, which is never at
  a player's feet there.

Tests: 13 new tests in `tests/test_ball_u10.py`; `python3 /tmp/run_u10_tests.py`
(a direct importer bypassing conftest, which needs `.local/mysql-lint.env`
+ MySQL 3507 on the owner's host) gives 112 passed, 0 new failed across
test_ball_u10, test_ball_u9, test_tracker, test_tracker_u2, test_tracker_u4,
test_follow, test_jersey_u6, test_tiling_u7 and test_infer_queue, plus
test_appearance and test_geometry. The 8 failures (test_ball import, 2 in
test_appearance, 5 in test_geometry) are identical on clean HEAD via
`git stash` (missing pyarrow / pymysql / pytest in this workspace and fixture
arguments the direct runner does not supply). `pytest` was not run here, for
the conftest reason above; that file was not fabricated.

## Consequences

- TRACK_BALL jobs gain a `ball_handover` run-config flag and a matching
  metrics field; the default is off, so no existing run changes until a
  caller opts in.
- The known ambiguity stays open: a ball trapped at a player's feet, or
  dribbled without ever leaving the foot, looks glued too - its foot offsets
  do not drift, so it pays the penalty like a boot. A dribbling ball whose
  offset oscillates as it is kicked ahead is not glued (tested), but a ball
  carried dead at the foot is indistinguishable from a boot by position
  alone, and the code declines to decide it by any other means: the penalty
  only ever costs weight, never invents a position. That distinction has to
  be calibrated on real dribbles, not asserted here.
- The same applies to the tracklet identity swap at a crossing: the greedy
  association still swaps the ball and the boot when they are within a few
  pixels, and U.10 resolves it in the path search rather than in the
  association. A tracklet-level identity rule (e.g. refusing a swap when the
  incoming candidate is glued to a foot) is a follow-up, not claimed here.
- A full 3D reconstruction (the ball's height above the ground) still needs
  the camera centre from a calibrated camera; that is a follow-up, not
  claimed here.

## Alternatives considered

- **Raising GLUE_PENALTY until the boot can never win:** rejected as a
  standalone fix - the penalty is sized to the score advantage it cancels
  (1.2 vs ~1.05), and pushing it much higher would start punishing
  legitimate at-feet ball pieces (a trapped ball, a slow dribble) that the
  spread test cannot separate from a boot. The handover bonus carries the
  identity across the bounce instead; the two together settle scene V with
  margin at the current sizes.
- **Splitting the flight tracklet at the bounce in `tracklets()`:** rejected -
  the greedy association already ends the flight tracklet at the bounce (the
  boot tracklet's prediction is marginally closer to the boot), so there is
  nothing to split. Forcing an end would only re-implement what the
  association already does, and would risk fragmenting flights that merely
  graze a boot.
- **Penalising every at-feet piece, not just glued ones:** rejected - a ball
  at a player's feet is the ordinary case (a trap, a dribble, a shot), and
  the at-feet penalty (FEET_PENALTY) already prices it. The glue test is
  what separates a boot from a ball at feet: the boot never leaves the foot.
- **Estimating the ground level from the flight to require the roll to start
  on it:** rejected for now - without a calibration the ground level in the
  picture is not known, and the flight's own start height is not necessarily
  the ground (a header starts in the air). Reachability from the flight's
  last point plus the roll shape is the check that can be made from the
  observed positions alone.
