# ADR-064 Live spotlight preview and rendered state in Clip Studio (editor stage E1)

**Date:** 2026-11-06. **Status:** accepted (owner: "Approve editor stages E1–E5, starting with the live spotlight preview"). **Migration:** none.
Source: docs/research/filmora/11-lessons-and-roadmap-for-otsi.md, stage E1 ("approximate preview, exact export").

## Decision
- **API** `GET /v1/reels/:reelId/path` (contract `ReelPath`): the confirmed player's analysis positions (pinned target tracks only) inside the
  reel's clip windows, half a second either side; `max_interp_s` from the renderer's Target Lock rule without Auto Track
  (`max(0.3 + 0.6 * lock, 0.6)`). Empty when a target is stale, when there are no targets or no clips. Organization-scoped (404 elsewhere).
- **Web** `components/studio/spotlight.ts`: `boxAt`, `visibleRuns`, `strengthAt`, `cropWidth` mirror reel.py (`box_at`, `visible_runs`,
  `strength_at`, `_output_geometry`). `SpotlightPreview` draws the renderer's golden beam, feet pool, darkening, name caption and, for
  9:16 / 1:1 reels, shades what the crop leaves out. The beam is computed at a quarter of the display size and scaled up (one
  animation frame while playing, once per seek while paused).
- **Preview** draws it on a canvas over the playback video, only inside the reel's clips (not for a Media Bin moment). A badge says
  "Live spotlight · approximate", or why there is none (stale identity, no confirmed player, player not found).
- **Rendered state** (`renderedState`): the reel and each clip are compared with the last good render's config (clips id/in/out, order,
  transitions, aspect, settings, stale). The preview badge says "Rendered file matches", "Changed since the last render" or "Not rendered
  yet"; each timeline clip has a green (rendered) or amber (changed) top line, with a tooltip.

## Why approximate
The render re-finds the player ten times a second (Auto Track) and so can light him on frames the preview leaves dark. The preview uses
only the analysis positions and never lights anyone else. Unknown beats wrong: no position, no beam.

## Not covered
Lower third, score bug, event tags, cards, logos and transitions are still shown only in the rendered file. Clip label changes are not
counted in the rendered state. Frame duration is taken as 40 ms (25 fps) for the DETECTED window.

## Tests
`apps/api/test/reels.api.test.ts` "live preview path" (clip windows only, other tracks excluded, lock rule, stale, other organization);
`apps/web/test/spotlight.test.ts` (box states, fade, crop, fit, rendered state).

## Addendum (2026-11-06): the rest of E1, trims and marks
- **Edge-drag trim** (Timeline): each clip has a handle on its left and right edge. Dragging shows the new length on the clip; releasing
  saves one trim (`PATCH /v1/reels/:id/clips/:clipId`, undoable); Escape cancels. `trimEdge` keeps the clip at 0.5 to 60 s and never
  before 0; the API still refuses a clip that ends after the video.
- **Alt+[ / Alt+]** trim the start / end of the clip under the playhead to the playhead (Alt+] does what Cut (C) does).
- **I / O marks** (Preview): on a Media Bin moment in the preview, I and O mark the part to add, Alt+X clears them. The marks show in
  amber on the position slider. +, double-click or drag then add only the marked part (`markedRange`), saved as a MANUAL clip because a
  person chose the range. On the timeline, I / O say to use the edge drag or Alt+[ / Alt+].
- Tests: `apps/web/test/trim-marks.test.ts`. Browser check: drag, then Escape left the clip unchanged; I at 2 s and O at 6 s marked 4.0 s
  (release-evidence/e1-live-spotlight/io-marks.png). The owner's reel was not changed.
