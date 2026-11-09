# ADR-046 — "Is this him?": the person checks the engine's events for the player whose reel he makes

**Date:** 2026-11-02 · **Status:** implemented; API and web tests pass; seen in the browser on the owner's match; not yet used by the
owner · **Owner request:** "Yes, build it" (after ADR-045 showed look-alikes do not find a player on wide footage), then, rejecting the
first version: "User names player only when intends to create/generate reel for a particular player. The current approach is incorrect."
and "This video should box the player user selects, not randomly picking a player".

## Problem
Events (passes, balls won, pressures, shots: ADR-040–042) count for a player only on tracks a person named. On the owner's match the
engine's 121 events in match time involve 131 different unnamed tracks. Appearance cannot name them on this footage (ADR-045: 0 of 14
reviewed look-alikes were the player); shirt numbers are too small. A person recognises the player, but only the one whose reel he makes.

## Decision (replaces the first version: every unnamed player, named from the roster)
`GET /v1/videos/:id/who-is-this?player=<id>` (analysis/events.ts; the player is required): from the latest finished ball track, the events
served by `GET .../events` (same match-time and team rules), the people in them (pass: passer and receiver; ball won: the winner; pressure:
the presser; shot: the shooter), one item per unnamed person track **who could be this player**:
- not named (as him or anyone else) and not marked "not him" for him;
- his shirt colour (the kit group of most of his named tracks); before any is named, team kits only (no officials);
- never on screen at the same time as one of his named tracks.
Most alike to him first (the stored look-alike graph to his named tracks, ADR-045), then the most events; 30 at a time (`more`). Each item
has one moment (shot > pass made > ball won > pressure > pass received). Also `his_tracks`, `kit_group` and `his_events`.

Page 06 Reel Builder → **Find more of him ›** or **More moments of him: Is this him? ›** → Page 04 `?find=<player>` → Name players opens on
**4 · Is this him? (his events)** for that player (a Player menu lists the named players when opened from the Tools list). One candidate at
a time: the moment plays inside the dialog (2 s either side, looping, the candidate boxed: `MomentPreview`), then **Is this <name>?**
**Yes** = one CONFIRMED decision on that track for him (its events count for him; moments in his reel after Re-detect Player), **No** = a
REJECTED decision with his id (never offered for him again; still offered for another player), **Can't tell** = skipped for now, nothing saved.

## Move the box (owner, 2026-11-02: "we need user to be able to correct (move) the box when it's on wrong player")
The owner's first pass: 70–75% of the boxes were on someone else, while Godwin was often in the picture. In the moment, the person drags
the green box onto the right player, or clicks him: the video stops, every player's box shows, the one under the pointer turns blue, and
**Is the player in the blue box <name>? → Yes, move the box** records two decisions: the chosen track CONFIRMED for him, and the boxed
track REJECTED for him (only when it was boxed at that moment: both on screen at once, so it cannot be him). Refused when one of his
named tracks is on screen at that moment (`his_spans`); a note when the chosen player's shirt colour differs from his. Cancel saves nothing.
**Go back to the ones I said No to** (`&revisit=1`, items `said_not_him`) serves the moments already answered No, to move the box there or
say "It was him after all".

## Alternatives
- The first version, naming every unnamed player from the roster: rejected by the owner (naming for its own sake).
- Guessing the player from position or role: not measured; unknown beats wrong.

## Limits
- Tracks are short on this footage: one Yes covers a track, not the whole match. On the owner's match 79 candidates for Godwin.
- The likeness order is weak on wide footage (ADR-045); the filters (shirt colour, never with him, not "not him") do most of the work.

## Tests
API `test/events.api.test.ts` "is this him": before anything is named both teams' players (no referee), most events first, with the moment;
after one is named his kit decides and the look-alike order and his events count; a track on screen with him is left out; "not him" removes
it for him only; `revisit=1` serves only the "not him" ones, marked; `his_spans`; no player → error; another organisation 404. API 149/149; web typecheck, 56/56. In the browser on the owner's match: the
Reel Builder link opens the step for Chinazom Godwin, the candidate boxed in his shirt colour, Can't tell moves to the next (79 → 78);
after the owner's pass (20 events, 17 tracks), the revisit list (51) plays, dragging the box stops the video and draws the target blue with
the Yes / Cancel question; cancelled, nobody was named by the developer.
