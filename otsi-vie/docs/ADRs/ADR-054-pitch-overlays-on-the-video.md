# ADR-054 Pitch-placed overlays on the Analysis video (Library View toggles)

**Date:** 2026-11-05. **Status:** accepted (owner: "Yes, next block"). **Migration:** none.

## Decisions
1. The Library left panel's Player Tracks, Team Shapes, Heatmaps and Pass Arrows switches are now the viewer's defaults (`lib/overlayPrefs`) for the
   Analysis video, next to boxes, labels and ball. The video's settings menu switches each one for that page.
2. All four are placed **on the pitch**, never in picture space: the observation window now carries its pitch calibration samples
   (`ObservationWindow.calibrations`, `H` pitch metres -> normalised picture), and the page draws through the best sample covering the moment.
   A moment with no calibration draws none of them, and a note says so. A panning camera keeps them on the grass.
3. Player Tracks: each shown person's measured pitch positions of the last 3 seconds; a gap or an unmeasured frame breaks the line.
4. Team Shapes: the convex hull (`convexHull`, contracts/pitch) of each team's players on screen whose position is measured, at least three, with the
   area in m². It is labelled "on screen": the camera never shows the whole team, so it is not the team's shape.
5. Heatmaps: the selected player's track, or else each team's, from the existing heat-zone routes (the whole video, as filmed), each zone drawn as a
   quad in the current frame.
6. Pass Arrows: passes from 0.3 s before to 2 s after, from where the ball left the passer to where it reached the receiver. The engine stores those
   ends as picture points (`PassEvent.from_xy` / `to_xy`, now returned); each is taken to the pitch through the calibration of its own moment and
   back into the current frame. Without a calibration at either end the pass is not drawn. Key passes are gold.

## Not changed
The Tactical page keeps its own pitch views; these layers are for the video.

## Tests
- `apps/api/test/pitch.api.test.ts`: the observation window returns the three calibration samples, their size and quality, and an `H` that puts the
  known pitch point at its picture position.
- `apps/api/test/events.api.test.ts`: passes return their recorded picture ends, null when not recorded.
- Type checks of contracts, api and web; API 174 and web 58 passed.
