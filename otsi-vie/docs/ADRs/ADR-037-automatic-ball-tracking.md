# ADR-037: Automatic ball tracking

Status: accepted for development and local testing (2026-11-01; owner: "the engine should auto-track just as we did in pitch calibration";
"User should only use manual when view is so bad and engine can't see"). Builds on the saved detections (ADR-024 evidence Parquet), the ball
answer key (migration 0027) and ADR-030 (zero cost).

## Problem
Possession and passes need to know where the ball is. The detector (RT-DETRv2, COCO "sports ball") proposes several ball candidates per
analysed frame on broadcast footage: boots, socks, heads, a crest on a shirt in close-ups, pitch marks, the broadcaster's logo dot, seats in
the stand, and the ball. On the owner's match (56,019 analysed frames at 6 fps, 1280x720) there are 194,180 candidates; the real ball is
5-10 px wide and scores no higher than a boot (0.25-0.55). The online tracker keeps only the most confident candidate per frame and so follows
decoys.

## Decision
- **The engine follows the ball by itself** (`vie_worker/ball.py`, job `TRACK_BALL`, migration 0028) in every finished analysis: the outbox
  subscriber `jobs.auto_ball` starts it on `analysis.completed`. A person may start it again ("Follow the ball again"; "Find the ball" for runs
  that finished before this existed). No model, no decoding: it reads the saved detections and runs in about 10 s per 90-minute match.
- Rules, all generic (no club, match or picture position is named in code):
  1. drop candidates off the grass (the detector's own grass test), at a picture spot recurring across ≥ 10 shots / 2 % of shots (printed on
     the picture), or at one picture spot for ≥ 4 s within a shot (a still mark);
  2. drop candidates wider than 0.4 or narrower than 0.04 of the frame's median person height, and candidates on a person's upper body
     (above the lowest 30 % of the box: crest, head, hand); at a player's feet a candidate may be the ball;
  3. join candidates into tracklets by a constant-velocity prediction (first step within 0.6 picture widths/s, then ≤ 0.2 widths/s off the
     straight line, ≤ 3 missed frames); a kick ends a tracklet;
  4. per shot, choose the best chain of tracklets by dynamic programming: each detection earns (score − 0.12), each continuation 0.1, each
     missed frame costs 0.04; a jump must be reachable at 1.2 widths/s; after > 1 s the chain may restart anywhere at a cost; lone
     detections join only at ≥ 0.45;
  5. frames on the chain are DETECTED, gaps ≤ 0.5 s inside a chain INFERRED (straight line), everything else UNKNOWN (no row). Unknown beats
     wrong.
- A person's marks (0027) are the truth where they exist: the dialog jumps to frames the engine cannot see ("Next it can't see"), shows the
  engine's guess, and records a click, "not visible" or "the engine is right". The API compares the engine with the marks on every read
  (`checkBall`: right within 12 px, wrong, unknown, and balls invented on "not visible" marks).

## Measured (owner's match, analysis run 01a19203, 2026-11-01)
- Rules removed: off grass 29,269, printed 4,253, still 13,139, size 10,134, on a body 30,615; 106,770 candidates kept.
- Ball placed in 26,893 of 56,019 frames (48 %): 21,680 detected, 5,213 inferred; 29,126 unknown (close-ups, replays, ball hidden or not
  detected).
- Against the owner's 4 marks: 4 right (0.6-6.3 px off). By eye on 3 random samples of 12 placed frames: about 80 % on the ball; the misses were
  a crest on a shirt in a close-up (fixed by rule 2), an object on the advertising boards (fixed by the grass test), seats in a stand and a
  pre-match close-up. **Precision and recall are NOT yet measured**: that needs a few hundred owner marks across the match.

## Alternatives
- A dedicated football-ball detector: the free ones found are YOLO-based (AGPL-3.0, not usable commercially without a licence) or carry no
  weights; TrackNet-style heat-map trackers have no football weights. Revisit if the measured precision is not good enough.
- Pitch-coordinate rules (the ball within the pitch plus margin, via ADR-036's per-frame camera) would remove the stand and board decoys where
  the pitch is calibrated; planned as the next refinement once the answer key shows where it fails.

## Tests
`services/worker/tests/test_ball.py` (synthetic match scene with boots, logo, crest, stands and a hidden ball: precision ≥ 0.95, recall ≥ 0.85;
gaps; still marks; marks override; the job end to end), `apps/api/test/ball.api.test.ts` (automatic start once per run, manual start, path,
check against marks, roles, tenancy), `apps/web/test/ball.test.ts` (the ring between frames, never across long gaps; the check).

## Revision 1 (2026-11-02, after the owner's first look: "Ball not in yellow round circle")
Misses traced on the owner's match and fixed generically:
- a candidate placed on the ground outside the pitch + 6 m (where the pitch is calibrated, ADR-036) is not the ball (stands, boards): 9,283 removed;
- the size test uses the people at the candidate's depth (feet level in the picture), not the frame's median: a ball near the camera
  (25 px, score 0.91) had been thrown out next to small far players;
- the same object reported twice in a frame is kept once (7,184 duplicates): two parallel tracklets on one ball made the path detour;
- tracklets enter the path search in 1-second pieces and may hand over where they overlap: a tracklet that followed the ball and then
  drifted onto a boot no longer has to be taken or left whole;
- a candidate at a player's feet earns 0.08 less, and a piece seen only at players' feet needs a mean score of 0.35 (boots 0.2-0.5, the ball
  at a player's feet 0.6-0.9 on this match): while the ball is hidden behind players the engine says unknown instead of following a boot.
Result: 27,182 of 56,019 frames placed (23,182 detected, 4,000 inferred); owner's 4 marks right; by eye 14 of 18 random placed frames on
the ball, 2 wrong (a hand, the picture edge), 2 unsure. Synthetic scene: precision 0.96, recall 0.96, nothing invented while hidden.
Still NOT measured properly: needs the owner's marks.
