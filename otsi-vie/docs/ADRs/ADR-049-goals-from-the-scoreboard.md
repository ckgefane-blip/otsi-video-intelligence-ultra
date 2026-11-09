# ADR-049 — Goals from the broadcast scoreboard: the score changing by one, placed on the last live play before it

**Date:** 2026-11-02 · **Status:** implemented; worker and API tests pass; measured on the owner's match (read-only); stored when the
owner follows the ball again · **Owner request:** "We still don't have all these working: Goals—…" (then "Yes, build all")

## Decision
A goal is **INFERRED** from the broadcaster's own scoreboard, read with the free text readers already in the engine (PaddleOCR detector
and recognisers on OpenVINO / Paddle Inference, ADR-033/039; Apache-2.0). Nothing is claimed from the picture of the ball in the net.
`vie_worker/scoreboard.py`, run by the ball job (`ball_job.read_goals`) after possession, cached per run next to the detections:
- **Locate:** 40 frames across the video; the top and bottom quarters read in full. The match clock (m:ss, read confidently) anchors the
  graphic; the score is the 1-2 digit texts on the clock's row within 12 clock heights, at positions recurring in ≥ 30 % of the frames
  with a clock (one box per team, or one box over both). No clock or no recurring score: no scoreboard, no goals.
- **Read:** every 5 s, only those boxes (digits, confidence ≥ 0.7). One box over both numbers: "1-0", "1 0", "0j1" (the gap read as a
  letter) or two single digits "01"; anything ambiguous ("101") is not a reading.
- **Settle:** a score counts once read ≥ 3 times within 90 s and more often than any other there (single misreads never count).
- **Goal:** consecutive settled scores where one side went up by exactly one. A drop, both sides or +2 is a misread or a correction: no
  goal claimed.
- **Where:** the last camera shot of live play (≥ 4 ball points seen) that began before the score changed; the clip is 15 s of attack
  up to the end of that shot and 4 s after (the first celebration). **Possible scorer:** the last holder in that shot, if within 10 s of
  its end; else unknown. A free kick / penalty / corner / throw-in restarted within 20 s before is recorded (goal kicks and kick-offs are
  not: they do not lead to a goal that fast, and a ball in the net looks like one).
- Stored as `event_candidates` GOAL (INFERRED, features side / score / when the scoreboard changed / set piece and its taker).
- `GET /v1/videos/:id/events` gains `goals`. Page 04's **Goals** chip (already in the approved design) lists them with the score, the set
  piece and the possible scorer's team. Reel moments: "Goal", "Free-kick goal" or "Penalty goal" (he took the kick and was the last on the
  ball) for the possible scorer, ranked first.

Set pieces (ADR-048) changed with this: a ball still more than 1.5 m behind the goal line is out of play (on the owner's match, the ball
lying in the net after the goal, picked out 3 s later, was read as a "goal kick"): not a set piece.

## Measured (owner's match, read-only)
Score boxes found (one box over both numbers, top left). 1,876 frames read in 77 s (locate 49 s, CPU); 976 clean readings: 0-0 (313)
then 0-1 (663). One goal: the second team, the scoreboard changing between 56:40 and 56:50 of the video. Placed at 56:30-56:46: checked
by eye on a frame strip — the attack on the left goal at 56:37-56:42, the celebration at 56:43, the graphic updated at 56:44. Scorer
unknown (nobody clearly on the ball in the last 10 s of the far wide shot): unknown beats wrong. Set pieces now 29 (the two "goal kicks"
were the ball behind the goal line).

## Limits
- No scoreboard on screen (many amateur videos): no goals. The person can still add a clip of a goal by hand.
- When the broadcaster updates the score only after the replays, the last live play before the change may be a replay's close-up; the
  rule takes the last shot with the ball seen, which can then be a replay of the goal (still the goal).
- Which club the side is comes from the match record, not from the graphic.

## Tests
`services/worker/tests/test_scoreboard.py` (locate the boxes on the clock's row; one box per team or both; settling; only +1 is a goal;
placement with the possible scorer and the free kick; no live play → not placed), `test_setpieces.py` (the ball behind the goal line).
`apps/api/test/events.api.test.ts` (goals served with score, side, set piece by the scorer), `reels.api.test.ts` ("Free-kick goal"
moment ranked first).
