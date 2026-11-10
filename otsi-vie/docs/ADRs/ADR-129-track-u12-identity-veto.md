# ADR-129: Track U.12 — identity veto at crossings (DRAFT, owner approval pending)

- **Status:** Draft. This ADR records the U.12 build on `muse/ultra-main`; it
  does not claim any real ball-tracking accuracy. No labelled Sukhum
  ball-flight segments exist yet, so no real number exists yet.
- **Date:** 2026-11-10 (Muse, `muse/ultra-main`, base `a721d36`)
- **Decides:** how a lone candidate is kept from being stolen at a crossing,
  at the association level, when there is no second assignment to re-pair.
- **Context:** U.11 (ADR-128) settled the identity swap at crossings, but
  left a known limit: one mixed point remains on seeds 1, 2, 4 and 5, a
  lone-candidate steal, a different mechanism from the swap. Reproduced on
  the synthetic scene V before the fix, and traced: at k=12 the ball is
  hidden and only the boot exists, so the ball's tracklet takes the boot;
  at k=18 the ball's candidate is dropped as a duplicate of the boot beside
  it (the two within SAME_SPOT = 0.008), so again only the boot exists and
  the ball-born tracklet takes it. The final answer was unaffected
  (precision 0.976-1.000), but the tracklets were not pure. The task's
  description named only the k=18 mechanism; the probe found the k=12 steal
  is the one on seeds 1, 4 and 5, and the k=18 steal only on seed 2.

## Decision

1. **Refuse and hand over, don't re-pair** (`vie_worker.ball._veto_assignment`,
   behind `use_veto`, off by default). After the greedy pairing of a frame
   (and after U.11's re-pairing, so the veto judges the final assignment),
   each assignment is checked against the live tracklets that got no
   candidate this frame: if one fits the candidate clearly better - by at
   least VETO_MARGIN = 0.002 picture widths in identity cost - the greedy
   assignment is refused and the candidate is handed to that tracklet
   instead. Handing it over (rather than refusing it outright) is what
   keeps the tracklets whole: refusing outright would leave the candidate
   to start a new tracklet and split the rightful owner's track in two. The
   veto therefore cannot fragment a tracklet - it only ever moves a
   candidate between two live tracklets, and the tracklet that loses one
   simply misses a frame (within TRACK_MAX_MISS) and carries on. The veto
   is independent of the identity rule: it also settles the steal with
   `use_identity` off.
2. **The challenger must have a history.** It needs at least two points, so
   its prediction is an extrapolation, not its own position. A one-point
   tracklet's motion term is 0 by the U.11 rule (it has no velocity to
   extrapolate), so without this it would win every veto by default, not by
   evidence: measured on the linear-ball guardrail before this guard, 13 of
   the 14 transfers a one-point challenger would make go to a newborn
   tracklet, and one seed loses 5 right frames to unknown.
3. **The challenger must actually fit.** Its prediction must lie within
   TRACK_SLACK = 0.012 picture widths (the detection-jitter allowance) of
   the candidate - not merely fit it less badly than a tracklet whose
   prediction is far away. On the scene-V steals the rightful owner's
   prediction sits 0.003-0.005 from the candidate; on the guardrail the one
   transfer a mature challenger would still make has it 0.042 away, both
   predictions far off, and taking it costs a ball frame to unknown.
   TRACK_SLACK is stricter than the greedy reachability tolerance, so this
   also subsumes it: a tracklet never takes a candidate it could not have
   reached.
4. **Decline when ambiguous.** The veto fires only on a clear win (at least
   VETO_MARGIN); on a tie or a close call the greedy assignment stands,
   unknown beats wrong. It is a single pass over the assignments as they
   stand: a tracklet that receives a transferred candidate is no longer
   unassigned, and a tracklet that loses one is not reconsidered as a
   recipient for another candidate in the same frame - no chains, no loops,
   and at most one transfer per assignment, so the pass always terminates.
5. **Wiring, all off by default** (run config `"ball_veto": true` in
   `ball_job.py`; reported in the job metrics as `ball_veto`). Without it,
   behaviour is exactly as before (verified: the default run reproduces the
   old output byte-for-byte on the synthetic scenes, and the U.9/U.10/U.11
   numbers are unchanged).

## Measured (synthetic only)

`otsi-vie/tools/eval/ball_u12_compare.py` (exit 0, seeds 1-5). No footage,
no model and no labelled flights exist here, so these numbers measure the
veto logic, not a real ball-tracking accuracy. Mixed tracklets / mixed
points count tracklets whose points fall on both sides of the midpoint
between the ball's score and the boots' (V: ball 0.30, boots 0.45-0.50), and
the points on the minority side.

- Bounce + occlusion, scene V, flight on, identity on: veto off 1 mixed
  tracklet / 1 mixed point on seeds 1, 2, 4, 5; veto on **0/0 on seeds 1
  and 4**, 1/1 remaining on seeds 2 and 5, 0/0 on seed 3 (already clean).
  The final answer is unchanged on every seed (precision 0.976-1.000) -
  the win is at the tracklet level, and the path search no longer has to
  sort it out. The boot's tracklet becomes whole: seed 1 tracklet sizes go
  from [13, 30, 47] to [12, 30, 48] - one tracklet with a point on every
  frame.
- The same scene, flight off: veto on settles seeds 1, 3 and 4 to 0/0
  (seeds 2 and 5 stay 1/1), and on seed 3 the final answer improves from
  precision 0.952 (40 right, 2 wrong) to **0.976 (41 right, 1 wrong)**.
- Scenes M and M-short: identical with the veto off and on on all five
  seeds, flight on and off (M flight on 1.000, 44 right, 0 wrong;
  M-short 0.921, 35 right, 3 wrong) - no regression anywhere.
- Guardrail (linear ball, overlapping scores, six wandering players):
  **byte-identical** with the veto off and on on all five seeds
  (precision 0.964-1.000) - the one-point-challenger and tight-fit guards
  earn their keep here.
- The margin, measured on the failing case: the catchable steals are won
  by 0.0023-0.0029 (seeds 1 and 4 at k=12, flight on; 0.0026-0.0029 flight
  off on seeds 1, 3 and 4), while the largest advantage an unassigned
  tracklet ever holds over a *correct* assignment is 0.0011 (seed 1, k=18:
  the one-point ball-born tracklet's cost for the boot candidate, its
  motion term 0 by the U.11 rule, against the boot tracklet's 0.0046).
  VETO_MARGIN = 0.002 sits between the two - the same value as
  IDENTITY_MARGIN, but its own constant: a different mechanism (refusing an
  assignment, not re-pairing one) with its own measurement basis. A tuning
  constant, to calibrate on labelled Sukhum crossings.

Tests: 13 new tests in `tests/test_ball_u12.py`;
`python3 ~/workspace/u12-runner/run_u12_tests.py` (a direct importer
bypassing conftest, which needs `.local/mysql-lint.env` + MySQL 3507 on the
owner's host) gives 13 passed, 0 failed for the new module. `pytest` was not
run here, for the conftest reason above; that file was not fabricated.

## Consequences

- TRACK_BALL jobs gain a `ball_veto` run-config flag and a matching
  metrics field; the default is off, so no existing run changes until a
  caller opts in.
- Two mixed points remain, on seeds 2 and 5 - and the veto cannot settle
  them by identity cost, because the stealing tracklet genuinely fits the
  candidate better by that cost. Seed 2, k=18: the ball-born tracklet has
  one point, so its motion term is 0 and its cost is just its score term,
  0.0039, against the boot tracklet's 0.0076 (its two-point extrapolation
  carries the boot's detection jitter). Seed 5, k=12: the ball tracklet's
  flight parabola lands on the bounce point, where the boot stands, so its
  cost is 0.0072 against the boot tracklet's 0.0123. The score pattern
  would separate both cases (the candidate scores like a boot, 0.45-0.50,
  not like the ball, 0.30), but it is capped as a tiebreaker by U.11's
  design - using it as the verdict is a follow-up, not claimed here. The
  final answer is unaffected on both seeds (precision 0.976 and 0.977).
- Track U is now complete, U.1-U.12. What comes after is Track G (the first
  real benchmark on labelled Sukhum footage), fresh post-Phase-E CI
  evidence, ADR-001-010 + CLAUDE.md hygiene, the Option B SOP, and the
  UI/UX ultra pass - all blocked on owner inputs as recorded in the
  Blueprint.

## Alternatives considered

- **Refusing the assignment outright (leaving the candidate to start a new
  tracklet):** rejected - it would split the rightful owner's tracklet in
  two at the crossing, which is exactly the fragmentation the veto must
  not cause. Handing the candidate to the better-fitting tracklet keeps
  every tracklet whole.
- **Listening to a one-point challenger:** rejected - its motion term is 0
  by the U.11 rule, so it wins every veto by default, not by evidence
  (measured: 13 of 14 guardrail transfers go to a newborn tracklet).
- **Firing whenever the challenger fits better, however far its prediction
  lies:** rejected - a challenger 0.042 from the candidate is not fitting
  it, it is merely fitting it less badly, and taking it costs a ball frame
  to unknown on the guardrail. The tight-fit guard (TRACK_SLACK) requires
  the challenger to be where the candidate is, up to jitter.
- **Charging a one-point tracklet its raw distance from its point, so it
  could be beaten on motion:** rejected - that changes `identity_cost`
  itself, and U.11's swap fix depends on the zero-motion rule for
  one-point tracklets (ADR-128, decision 3). The veto's challenger guard
  achieves the same end without touching the shared cost.
- **Raising VETO_MARGIN so only overwhelming cases fire:** rejected - the
  margin is set by measurement (0.002, between the 0.0011 largest
  wrong-direction advantage and the 0.0023 smallest real win); a larger
  margin would decline seeds 1 and 4, which are real steals with a real
  win.
