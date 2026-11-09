# ADR-089: Reel Builder confirmation before rendering, and reopening at the last step (v3 Phase B.13)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
Generate Reel started a render straight away, without showing what would go into it or how long it may take. Reopening a reel always
highlighted the first unfinished step, not the one the person was working on.

## Decision
- **Confirmation dialog** (`reelstage/ConfirmRender.tsx`): Generate Reel opens "Render this reel?" with the player (and OTSI ID), clips and
  length, frame, spotlight (Auto Track, intensity), overlays, branding, music and file type, from the reel and the look about to be saved
  (`renderSummary` in `contracts/render-estimate.ts`). Unsaved changes are named ("saved first, then rendered"). Only "Start render" starts it;
  "Back to editing" changes nothing. Stopping a running render is unchanged (two clicks).
- **Estimate** `GET /v1/reels/:id/render-estimate` (`modules/reels/estimate.ts`): measured from the organization's own finished renders,
  start → finish ÷ the reel seconds the worker recorded (`result.duration_s`); the median of the 10 most recent with the same Auto Track
  setting (else any, and it says so), times this reel's length, with the fastest–slowest range, and how many renders are queued or
  running. **No finished render: no estimate** (the first render sets it), never a made-up number.
- **Reopen at the last step**: clicking one of the four steps remembers it for that reel in this browser (`otsi.reel.step.<id>`); opening
  the reel again highlights that step and scrolls to its panel. Done ticks still come only from the reel's real state.

## Alternatives
- Estimating from frame counts and a fixed speed: rejected, the speed depends on this PC, the encoder and Auto Track; measured is honest.
- Storing the step on the server: not needed; it is a per-person convenience, and the reel's real progress is already recorded.

## Tests
- `apps/api/test/renderEstimate.api.test.ts` (real API and MySQL): unknown before any finished render; median and range from the same
  Auto Track setting; queued renders counted; another organization gets 404.
- `apps/web/test/confirmRender.test.tsx`: estimate rules and words, the summary rows, the dialog (estimate shown, music named, unsaved
  note, nothing starts before Start render).
- Suites: API 241, web 168 passed; both type checks clean. Browser (owner's reel, view only): 58 clips, 9 min 57 s, "About 1 h 4 min
  (57 min–1 h 32 min), from 6 finished renders"; closed with Back to editing, no render started.
