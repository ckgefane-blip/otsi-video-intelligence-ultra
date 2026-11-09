# ADR-041 — Key actions: ball won, shots, key passes

**Date:** 2026-11-02 · **Status:** accepted (ball won shown; tackles/interceptions stored, not shown; shots and key passes found where measurable) · **Owner request:** "Key actions", then "Show \"ball won\""

## Decision
After possession (ADR-040), the `TRACK_BALL` worker adds key actions to the ball track's `event_candidates` (`vie_worker/actions.py`; no
new migration, no extra model):

- **TACKLE / INTERCEPTION**, told apart from a change of possession: won at the loser's feet (winner within 1.2 body heights, ball moved
  < 1.5 body heights, within 1.5 s) → tackle; won in flight (ball moved ≥ 1.5 body heights, winner ≥ 2 body heights away or out of the
  frame) → interception; anything between stays a plain change. **Stored, not served**: checked by eye on the owner's match, only about
  half were clearly the right kind.
- **SHOT**, only where the pitch is calibrated: the ball leaves a player within 32 m of a goal at ≥ 14 m/s (≥ 2 positions within 1 s),
  on a line crossing the goal line within 6.66 m of its centre (off-target shots count, crosses along the line do not).
- **KEY_PASS**: `features.key` on a pass whose receiver shoots from that spell.

`GET /v1/videos/:id/events` now also returns `shots` and `passes[].key`; officials' kits (unassigned group 2, or any kit not assigned to a
club once kits are assigned) are never a team. Page 04 (owner's choice: **show "ball won"**, not unverified tackle labels):
- The event chips filter (All Events, or one kind) and count; a **Ball Won** chip is added after Cards (the approved strip scrolls).
- Marks in the legend's colours (passes green, key passes teal, ball won red, shots cyan); Previous / Next steps through what is shown.
- Tackles / Interceptions chips say why they are empty and point to Ball Won; Shots / Key Passes say "none found yet" and why.
- The player card's line adds "ball won N".

## Measured on the owner's match (2026-11-02, read-only run over the existing ball track)
- Changes of possession between real team kits: right by eye; 43 balls won in match time once officials are excluded (passes 45 → 44:
  one was between officials' kits).
- 15 tackles and 16 interceptions by the rules; about half clearly the right kind → not shown.
- **0 shots**: 550 of 988 spells end where no pitch is measured, and the ball model rarely follows a hard-struck ball. A spell-free
  fast-ball search gave 12 candidates; none was a shot by eye, so the strict rule stays.

## Limits
- Shots need more of the ball in flight (BallNet trained on fast balls) and the pitch measured near goal; until then "none found yet".
- Telling a tackle from an interception needs the ball and both players seen through the duel; revisit when ball recall rises.

## Tests
`services/worker/tests/test_actions.py` (tackle/interception/unclear, shot vs ground pass/long ball/cross/no pitch, key pass);
`apps/api/test/events.api.test.ts` (shots served, official's shot excluded, key flag, tackles not served); web typecheck and 56/56 tests;
tried in the app: chips filter, Ball Won Next/Previous seeks and labels, chip reasons, player card line
(`release-evidence/ball-won-step-through.png`).

## Amendment 2026-11-02 — tackles and interceptions shown as "possible" (owner: "We still don't have all these working")
The rule's reading is now served as the ball won's `how` (TACKLE / INTERCEPTION / null) and shown: Page 04 chips Tackles and
Interceptions (marks say "the engine's reading, check it"), and in the reel the moment is labelled "Tackle (possible)" / "Interception
(possible)" instead of "Ball won". They stay in Ball Won. About half were the right kind by eye on the owner's match (19 / 16 there).
Tests: events.api (`how`), reels.api (a tackle moment).
