# ADR-040 — Possession and passes from the engine's ball

**Date:** 2026-11-02 · **Status:** accepted (implemented; measured on the owner's match) · **Owner request:** "Yes please" to building possession and passes next

## Decision
After following the ball (ADR-037/038), the `TRACK_BALL` worker finds who holds it and writes the blueprint's `event_candidates`
(migration 0031 adds `ball_track_id` and `kit_group`). No person clicks, no extra model. Rules: `vie_worker/possession.py`.

1. **Holder:** the person whose feet the ball is at, within 0.6 body heights of the feet and below the waist; nobody when a second person
   is nearly as near (a duel). Distances are in the person's own height, so near and far players are treated alike.
2. **Spells:** frames held by one track in one shot, gaps up to 1 s, at least 2 frames.
3. **Hand-overs** (in one shot, within 4 s, no jump in the near players' size on screen — a cut the shot detector missed):
   same kit and the ball travelled ≥ 1.5 body heights and ≥ 4 m where the pitch is measured → **PASS**; same kit, hardly moved → one
   spell (a renumbered track); other kit → **POSSESSION_CHANGE** (tackle, interception or misplaced pass: not told apart yet).
4. **Team phases:** consecutive spells of one kit → **TEAM_POSSESSION**.

The API (`GET /v1/videos/:id/events`) reads the latest finished ball track's events in match time, names teams by the current kit → club
assignment and players by confirmed identities at read time. Once any kit is assigned, unassigned kits (officials) are not teams.
A **possession share** is given only when teams were seen on the ball for ≥ 25 % of the counted time.

## Measured on the owner's match (2026-11-02, read-only run over the existing ball track)
- 16,482 match-time frames with the ball known; held in 6,320 (3,315 by a track with a kit, 3,005 by one without).
- **45 completed passes** found in match time (38 with the ball seen at both ends, 29 with a length in metres; median 11 m).
- By eye: of 12 sampled, 2 crossed a camera change → the size-jump rule; of a fresh 10, 9 real and 1 doubtful (a panning camera) → the 4 m rule.
- Owner's check in the app (2026-11-02), stepping through with Previous / Next pass: "Everything was correct. Passes were real".
- Team seen on the ball 10 of ~105 min → **no possession share is shown** (the dark kit is read far more often than the white one: a share
  would say which kit the engine reads best).

## Limits (stated in the app)
- Recall is low: the ball is found in 31 % of frames, half of the ball-holding tracks have no kit (the analysis leaves a kit unknown
  when the shirt cannot be read clearly), and one-touch passes are missed on purpose. "Passes found", never "total passes".
- Filling the missing kits from each track's dominant colour was tested and **rejected**: it agreed with the known kit only 71–77 %.
- Raising coverage needs: more of the ball (BallNet training on more matches), kits read per frame and stored, and a confirmed end of the
  second half (post-match kick-abouts at 142:49 counted while the proposed end was 144:17).

## Alternatives
- Computing on read in the API (like heat zones): rejected — it needs the people of ~17,000 frames (millions of rows) each time.
- A separate job kind: not needed — the ball job has the ball, the shots and the pitch already; following the ball again recomputes in
  minutes from the cached ball-model answer.

## Tests
`services/worker/tests/test_possession.py` (holder, duel, header, pass, renumbered player, lost ball, cut, missed cut, rolling ball);
`test_ball.py::test_track_ball_job_end_to_end` (events stored and replaced in MySQL); `apps/api/test/events.api.test.ts` (latest track,
match time, kit → club naming, officials excluded, share threshold, tenancy).
