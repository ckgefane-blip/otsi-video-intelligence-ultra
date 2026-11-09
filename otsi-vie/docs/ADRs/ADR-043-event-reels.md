# ADR-043 — Event reels: the player's events as suggested key moments

**Date:** 2026-11-02 · **Status:** implemented and seen in the app by the owner (event card on Page 06, see "The owner's check")
· **Owner request:** "Yes, event reels"

## Decision
Page 06 Section 08 ("Suggested key moments: server ranks evidence-backed events") is built from the engine's events (ADR-040–042).

`GET /v1/reels/:id/moments` now returns two kinds of moment.

**EVENT moments** come first. They are what the reel's **confirmed** player did on his current target tracks, taken from the video's
latest finished ball track, in match time only:

| Event | Score |
|---|---|
| Shot | 5 |
| Key pass | 4 |
| Ball won | 3 |
| Pressure that won the ball back | 3 |
| Pressure | 2 |
| Pass | 2 |
| Pass received | 1 |

- Losing the ball, or being pressed, is not his highlight.
- Each event gives a moment from 4 s before it to 3 s after.
- Events less than 1 s apart are joined, up to 20 s.
- Moments are ranked by total score, then by time. The label reads, for example, "Shot + pass received".

**VISIBLE moments** follow: the earlier stretches where he is visible on confirmed tracks, only where no event moment covers them.

The contract `ReelMoment` gains `kind`, `events` and `score`. Clips, render and delivery are unchanged: an event moment is added as an
ordinary SUGGESTED clip and rendered by the existing RENDER job (ADR-032).

**Reel Builder (Page 06).** Each moment card carries a tag with its best event, in the Analysis timeline's colours. VISIBLE moments are
tagged "Visible".

**Analysis (Page 04).** Clicking an event mark, or Previous / Next, now also selects the player who did it (the passer, the winner, the
presser or the shooter). The player card then offers **Identify ›**, the step a reel needs. Identity stays a person's decision: unknown
beats wrong, and a reel follows only CONFIRMED tracks.

## Alternatives
- Team reels (every pressure by one kit, without a player): not in the approved Page 06, which starts from "Select Player". They need a
  separate decision on scope.
- Auto-building a reel from the top moments: the approved "Duration: Auto (Best Moments)" control could do it later. Today the person
  picks the moments.

## Tests
- `apps/api/test/reels.api.test.ts`, new test: ranking, labels, join, lost ball and being pressed excluded, visible stretches dropped
  under event moments. The existing reel tests pass unchanged (5/5).
- Web typecheck; web tests 56/56.
- Tried in the app: a pressure step selects the presser (track 836: "ball won 1 · pressures 1", Identify › offered), and the Identify
  dialog opens and closes.

## The owner's check (2026-11-02)
- The owner identified track 825 as Chinazom Godwin in the app. His first attempt saved nothing: he picked the name from the browser's
  autofill list, which fills the box but sends no decision. Fix: autofill is off, and each match is one "Confirm as <name>" button
  (commit 297caa6). His second attempt saved (HUMAN, CONFIRMED, checked read-only in `track_identity_decisions`).
- He selected the player and pressed **Create Highlight Reel**. Page 06 showed four suggested moments. Card 1 is tagged **Pass**:
  "Pass received", 25:26, 8 s, engine events, track 825. That is the engine's pass to him at 25:30, from 4 s before to 3 s after. Cards
  2–4 are tagged **Visible** (25:07 on track 825; 36:22 and 36:34 on track 2633). Losing the ball at 25:13 and being pressed at 25:11
  are not offered, as specified.
