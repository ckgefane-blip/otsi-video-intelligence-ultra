# ADR-042 — Pressing: pressures and balls won back

**Date:** 2026-11-02 · **Status:** accepted (implemented; measured on the owner's match; checked by the owner in the app) · **Owner request:** "proceed" (the next item on the list: pressing)

## Decision
The `TRACK_BALL` worker adds **PRESSURE** events to the ball track's `event_candidates` (`vie_worker/pressing.py`; no migration, no
extra model). A pressure: during a spell on the ball (ADR-040), a player of the other kit group

- comes within 2.2 body heights (~4 m) of the holder's feet in at least 2 frames,
- at least once within 60 % of that (~2.5 m),
- and got nearer while doing it (to 80 % of his first distance in the spell, or he was first seen already that near).

Distances are taken in the picture, in the two players' own height, with vertical picture distance stretched ×3 (depth seen at a slant).
Close-ups are skipped: near players taller than a quarter of the picture. `features.regain`: the presser's team won the ball within 5 s.

`GET /v1/videos/:id/events` serves `pressures` and per team `pressures` / `press_regains`; officials' kits are not teams. Page 04:
- a **Pressures** chip after Ball Won (the approved strip scrolls) with amber marks (the legend's Duels colour);
- Previous / Next through them;
- a "Pressing:" sentence in the timeline line;
- "pressures N" on the player card.

## Measured on the owner's match (2026-11-02, read-only over the existing ball track)
| Rule set | Pressures | Checked by eye |
|---|---|---|
| First rule | 86 | 2 of 6 right: 3 were close-ups of players standing round an injured man → the wide-view rule |
| Wide view only | 52 | 8 of 12 right: two were 0.9 of the reach → the 2.5 m rule |
| Plus the 2.5 m rule | 38 | Most wrong ones in one spell at 30:16: the calibrated pitch put players 3–4 body heights apart within reach → **pitch metres not used** |
| Picture only (final) | **33** | **5 of 6 right**, one doubtful |

Final split: 18 by one kit and 15 by the other; 22 won the ball back within 5 s.
- In the app after following the ball again (2026-11-02): 34 pressures in match time (19 and 15; 13 and 9 won the ball back within
  5 s). Owner's check, stepping through with Next pressure: "They look real" (`release-evidence/pressures-step-through.png`).
- The pitch calibration around 30:16 looks wrong (noted for the pitch work; it also touches heat zones and distances there).

## Limits
- Only where both players' kits are read and the ball's holder is known: "pressures found", never a total. No PPDA (needs the pitch
  zones of every defensive action and pass, and the pitch is measured in 39 % of frames).

## Tests
`services/worker/tests/test_pressing.py` (closing in + regain, standing by, running past 4 m away, behind in depth, team-mates, close-up);
`apps/api/test/events.api.test.ts` (pressures served, team counts and regains, officials excluded); API 144/144, web 56/56.
