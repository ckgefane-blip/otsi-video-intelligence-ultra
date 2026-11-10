# ADR-128: Track U.11 — tracklet-level identity rule at crossings (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the U.11 build on `muse/ultra-main`; it
  does not claim any real ball-tracking accuracy. No labelled Sukhum
  ball-flight segments exist yet, so no real number exists yet.
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `a721d36`)
- **Decides:** how two tracklets keep their identities when they cross, at
  the association level instead of leaving it to the path search.
- **Context:** U.10 (ADR-127) settled the bounce + occlusion scene in the
  path search, but left a known limit: the two tracklets swap identities
  once at the crossing and only the path search sorts it out afterwards.
  Reproduced on the synthetic scene V before the fix, and traced: the ball's
  tracklet is born when the ball reappears after the occlusion, with a single
  point, so its prediction is its own position - and the boot, running just
  behind the ball, sits closer to that position than the ball's new position
  does. The greedy association takes the smallest pair first, so it hands
  the boot to the ball's tracklet and the ball to the boot's tracklet, and
  the swap then holds for the rest of the shot (the boot-born tracklet
  carries the ball for 29-30 frames, the ball-born tracklet carries the
  boot). With the flight on, seed 3: 2 mixed tracklets, 19 mixed points;
  seeds 1-5: 1-3 mixed tracklets, 19-20 mixed points.

## Decision

1. **Re-pair, don't re-assign** (`vie_worker.ball._resolve_identities`,
   behind `use_identity`, off by default). After the greedy pairing of a
   frame, each pair of assignments is checked: compare the total identity
   cost of the greedy pairing with the swapped one, and take the swapped one
   only when it wins by at least IDENTITY_MARGIN = 0.002 picture widths and
   both swapped pairings are within the same reach the greedy pass allowed
   (a tracklet never takes a candidate it could not have reached). The
   candidates each tracklet gets, and which tracklets get one, never change
   - only which tracklet gets which candidate. The rule therefore cannot
   invent a position or drop a detection; it can only stop the two objects
   trading places. Repeated passes run until no swap fires; each swap
   strictly improves the total by at least the margin, so it terminates.
2. **Identity cost** (`vie_worker.ball.identity_cost`): a candidate's fit to
   a tracklet's own history, in picture widths - its motion model (distance
   from the tracklet's prediction: its parabolic arc when it is in flight,
   else the straight-line extrapolation of its last two points) plus its
   score pattern (how far the candidate's detector score lies from the
   tracklet's mean score so far, at IDENTITY_SCORE_WIDTH = 0.02 a unit,
   capped at IDENTITY_SCORE_CAP = 0.005 a candidate). The score is a
   tiebreaker, not the verdict: it can tip a close motion call (the seed-1
   crossing is won by 0.0044 and decided by the score pattern), but it can
   never override a clear motion verdict, because scores overlap in reality
   (the ball often scores no higher than a boot).
3. **A one-point tracklet has no motion evidence.** Its motion term is 0,
   whatever the candidate: with no velocity to extrapolate, its model
   predicts nothing, so the candidate's distance from its single point is
   not evidence against it. Without this, the rule acquits the swap it
   exists to fix - in seed 1 the ball's tracklet is born at k=17, its k=18
   candidate is dropped as a duplicate of the boot beside it (the two are
   within SAME_SPOT = 0.008), and at k=19 the ball is 0.022 from that single
   point while the boot tracklet's prediction sits 0.006 from it, so the raw
   distance prefers the (wrong) greedy pairing by 0.0082 and the rule
   declines. Reachability is still enforced by the tolerance guard.
4. **Decline when ambiguous.** When the two pairings cost within the margin
   of each other - the two objects indistinguishable at the crossing - the
   greedy pairing stands, unknown beats wrong, and the path search still has
   its say (tested: identical scores and symmetric geometry leave the
   pairing exactly as greedy made it).
5. **Wiring, all off by default** (run config `"ball_identity": true` in
   `ball_job.py`; reported in the job metrics as `ball_identity`). Without
   it, behaviour is exactly as before (verified: the default run reproduces
   the old output byte-for-byte on the synthetic scenes, and the U.9/U.10
   numbers are unchanged). The rule is independent of the flight and the
   handover: it also settles the crossing with the flight off (below).

## Measured (synthetic only)

`otsi-vie/tools/eval/ball_u11_compare.py` (exit 0, seeds 1-5). No footage, no
model and no labelled flights exist here, so these numbers measure the
identity logic, not a real ball-tracking accuracy. Mixed tracklets / mixed
points count tracklets whose points fall on both sides of the midpoint
between the ball's score and the boots' (V: ball 0.30, boots 0.45-0.50), and
the points on the minority side.

- Bounce + occlusion, scene V, flight on: identity off 1-3 mixed tracklets /
  19-20 mixed points on seeds 1-5; identity on **0-1 mixed tracklets / 0-1
  mixed points** (seed 3: 2/19 -> 0/0; seeds 1, 2, 5: 3/20, 2/19, 3/20 ->
  1/1; seed 4: 1/1 unchanged). The swap is settled at the association level
  on all five seeds.
- The same scene, flight off: identity on settles it to 1 mixed point on
  seeds 1, 2, 3, 5 (seed 4: 1/1 unchanged), and the final answer goes from
  precision 0.698 (right 30, wrong 13) to **0.952-1.000** - the identity
  rule alone, without the flight, gets most of the way there.
- Final answer (follow_ball, flight + handover on): identity on keeps
  precision 0.976-1.000 on scene V (seeds 2-3: one frame flips from right
  to unknown, 42 -> 41 right, wrong stays 1 - the purer tracklets cut the
  pieces slightly differently; not a regression in any material sense),
  1.000 on scene M and 0.921 on M-short, identical on all seeds - no
  regression anywhere.
- The crossing margins, measured at the swap frame: seed 3 won by 0.0185,
  seed 1 by 0.0044 (decided by the score pattern). IDENTITY_MARGIN = 0.002
  sits between the detection jitter (~0.001) and the smallest real case.

Tests: 8 new tests in `tests/test_ball_u11.py`;
`python3 ~/workspace/u11-runner/run_u11_tests.py` (a direct importer
bypassing conftest, which needs `.local/mysql-lint.env` + MySQL 3507 on the
owner's host) gives 120 passed, 8 failed across test_ball_u11, test_ball_u10,
test_ball_u9, test_ball, test_tracker, test_tracker_u2, test_tracker_u4,
test_follow, test_jersey_u6, test_tiling_u7, test_infer_queue,
test_appearance and test_geometry. The 8 failures (test_ball import, 2 in
test_appearance, 5 in test_geometry) are identical on clean HEAD via
`git stash` (missing pyarrow in this workspace and fixture arguments the
direct runner does not supply). `pytest` was not run here, for the conftest
reason above; that file was not fabricated.

## Consequences

- TRACK_BALL jobs gain a `ball_identity` run-config flag and a matching
  metrics field; the default is off, so no existing run changes until a
  caller opts in.
- One mixed point remains on seeds 1, 2, 4 and 5: a lone-candidate steal, a
  different mechanism from the swap - at k=18 the ball's candidate is
  dropped as a duplicate of the boot beside it, so only the boot exists and
  the ball-born tracklet takes it (there is no second assignment to
  re-pair). The final answer is unaffected (precision 0.976-1.000). Refusing
  an assignment when another live tracklet fits the candidate clearly
  better - an identity veto - is a follow-up, not claimed here: it would
  change which candidates get used and can fragment a tracklet, so it needs
  its own failing case and its own margin, not a ride on this one.
- The same applies to a ball trapped dead at a player's foot (ADR-127): it
  looks glued, and the identity rule cannot separate it from a boot by
  position or score alone. That distinction still has to be calibrated on
  real dribbles, not asserted here.
- A full 3D reconstruction (the ball's height above the ground) still needs
  the camera centre from a calibrated camera; that is a follow-up, not
  claimed here.

## Alternatives considered

- **Re-running the whole frame's assignment optimally (Hungarian) instead
  of greedy + 2-opt:** rejected - the greedy pass plus a re-pairing pass is
  the existing code with one added step, and the 2-opt only ever overturns
  a pairing the greedy already made. A full optimal assignment would
  change which candidates get used and would need its own proof that it
  never makes the ordinary (non-crossing) frames worse.
- **Score pattern alone, or motion alone:** rejected - motion alone acquits
  the seed-1 swap (the one-point tracklet's raw distance prefers the wrong
  pairing by 0.0082), and score alone would be a guess where scores
  overlap. The two together, with the score capped, settle all five seeds.
- **Raising IDENTITY_MARGIN so only overwhelming cases fire:** rejected -
  the margin is set by measurement (0.002, between the ~0.001 jitter and
  the 0.0044 smallest real win); a larger margin would decline seed 1,
  which is a real crossing with a real win.
- **Charging a one-point tracklet the raw distance to its point:**
  rejected, for the reason in Decision 3 - the distance measures how far
  the object moved while its candidate was dropped, not how badly it fits.
