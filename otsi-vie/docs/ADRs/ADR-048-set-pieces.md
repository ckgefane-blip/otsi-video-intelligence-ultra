# ADR-048 — Set pieces: a dead ball, then the restart; the taker; the kind from where the ball stood

**Date:** 2026-11-02 · **Status:** implemented; worker and API tests pass; measured on the owner's match (read-only, from the stored
ball); shown after the owner follows the ball again · **Owner request:** "ALSO I TOLD YOU TO ADD SET-PIECE (FREEKICKS). User expects all
those moments to be in the reel too." (then "Yes, build all")

## Decision
`vie_worker/setpieces.py`, run with possession, key actions and pressing when the ball is followed (`possession.analyse`):
- **Dead ball:** inside one camera shot the ball is seen (DETECTED) at one spot for ≥ 2 s (within 0.25 of the near players' height, gaps
  ≤ 1 s). **Restart:** within 1.5 s, same shot, the ball moves ≥ 1 body height from the spot. A dead ball never seen leaving (a cut to a
  replay) is not counted.
- **Taker:** the person at the ball when it leaves (feet within 0.8 body heights, or the ball in the hands); two people nearly as near:
  nobody. An official's kit is never a taker (the API drops it).
- **Kind** where the pitch is calibrated: kick-off (4.5 m of the centre spot), penalty, corner (4 m of a flag), goal kick (goal area),
  throw-in (3 m of a touchline, or the ball in the hands), else free kick; margins allow the calibration's few-metre error. Not
  calibrated: throw-in when in the hands, else unknown ("set piece").
- Stored as `event_candidates` SET_PIECE (start = dead, end = restart, features kind / still_s / hands / spot).
- `GET /v1/videos/:id/events` gains `set_pieces` (restart in match time). Page 04 gains a **Set Pieces** chip (approved design extended at
  the owner's request) with marks naming the kind, the team and how long the ball was dead. Reel moments: the taker's "Free kick", "Corner",
  "Penalty", "Throw-in", "Goal kick", "Kick-off" or "Set piece", from 2 s before the kick. "Is this him?" also offers set-piece takers.

## Measured (owner's match, latest ball track, read-only)
31 set pieces (29 since ADR-049: the two "goal kicks" were the ball behind the goal line): 11 free kicks, 2 goal kicks, 1 kick-off, 17 unknown kind (close-up or uncalibrated views). Eight checked by eye on frames
with the ball circled: the kick-off at 24:46, dead balls with players set or standing; none was open play running. The kinds depend on the
calibration (one kick-off read 3.7 m from the centre spot → margins widened). No throw-in was found: the throw-in's ball is in the air
over the touchline, where the ball model rarely sees it still.

## Limits
- A ball held still by a player for 2 s in open play would count; rare on the footage checked.
- Penalties, corners and throw-ins need the ball seen still at the spot; the broadcast often cuts to a replay during the wait.

## Tests
`services/worker/tests/test_setpieces.py` (dead ball + kick with taker and kind; every kind from the spot; throw-in in the hands; rolling
ball, short stop, never seen leaving, across a cut, inferred-only, two at the ball → no taker). `apps/api/test/events.api.test.ts`
(served in match time, official taker dropped), `reels.api.test.ts` (a free kick moment from 2 s before the kick; moments outside the
video dropped). API 150/150.

## Amendment (2026-11-02): possible fouls
Page 04's **Fouls** chip (approved design) lists each free kick and penalty as a **possible foul**: play was stopped for it just before
(a foul, or an offside — the engine cannot tell which). The mark starts 6 s before the ball was first seen dead, so a person sees the
challenge, and says "check it". Nobody is named as the fouler. **Cards** stay "not measured": the engine does not see the referee's
cards and does not guess them.
