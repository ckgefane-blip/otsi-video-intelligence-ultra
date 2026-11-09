# ADR-091: Reviewing suggested moments in the Reel Builder (v3 Phase B.15, migration 0056)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
Moment cards could only be added. The plan asks for a badge and coverage % per card, accept / reject / swap / reorder, and the
"Is this him?" queue inline instead of a trip to the Analysis page.

## Decision
- **Badge and coverage** (`contracts/moment-review.ts`): "Detected" (an engine event on his confirmed tracks), "Possible" (only inferred
  tackles / interceptions), "On camera" (seen, no action found); coverage = the share of the moment in which he has a recorded position,
  measured on the server from his confirmed tracks' observations (each detection widened by half a frame, gaps up to 0.6 s joined).
  `ReelMoment` gains `coverage` and `rejected`.
- **Accept** is the existing add (click or drag). **Not this one** (✕) stores a rejection for this reel (`reel_moment_rejections`,
  migration 0056); the card stays listed, dimmed and last, with **Restore**; Add all and the draft builder leave it out. A moment counts as
  rejected while half of it lies in a rejected window, so a slight shift after a refreshed analysis keeps it rejected.
- **Swap** (⇄, needs a clip selected in the timeline): `POST /v1/reels/:id/clips/:clipId/swap` gives that clip the moment's window and
  label in place (same id and position; its speed effect and drawings are dropped because they were set for the old window). One change in
  the reel's history, so Undo restores it.
- **Reorder** (◀ ▶ on a card already in the reel) moves its clip one place through the existing order endpoint; the timeline drag stays.
- **Is this him?** (`reelstage/WhoQueue.tsx`): the look-alikes of the reel's player (the existing `GET /v1/tracks/:id/look-alikes`), one at a
  time with a player to Show that moment; This is him / Not him record one identity decision by this person; Skip moves on. Only the
  reel's player is asked about. After a "This is him", "Take in his N new tracks" refreshes the reel's followed tracks.
- Endpoints: `POST /v1/reels/:id/moments/reject`, `/moments/restore`, `/clips/:clipId/swap` (project writers; audited).

## Tests
- `apps/api/test/momentReview.api.test.ts` (real API and MySQL): coverage value, reject lists last and is skipped by Add all, restore,
  swap in place and undo, a viewer gets 403, another organization 404.
- `apps/web/test/momentReview.test.ts`: coverage, the half-window rule, the badges. `assembly.test.ts` updated for the new fields.
- Suites: API 242, web 174 passed; both type checks clean. Browser (owner's reel, view only): cards show "Detected · seen 100% / 86% /
  75%…", ◀ ▶ on clips in the reel; the queue loaded 24 look-alikes (about 15 s, the existing search) and was closed without a decision.
