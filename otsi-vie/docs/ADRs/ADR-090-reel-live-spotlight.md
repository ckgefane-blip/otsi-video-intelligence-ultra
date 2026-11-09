# ADR-090: Live spotlight preview and coverage bar in the Reel Builder (v3 Phase B.14)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
The Reel Builder preview showed the source clip without the spotlight, so a person moved the sliders blind until a render finished. Nothing
showed how much of a clip the player is actually visible in, which is what decides whether the spotlight can follow him.

## Decision
- **Live spotlight** (`reelstage/LiveSpotlight.tsx`): over the source clip the preview draws the beam and name caption with the Clip Studio
  compositor (`studio/spotlight.ts`, ADR-064/079, the renderer's own rules), from the confirmed player's analysis positions
  (`GET /v1/reels/:id/path`, fetched again when the reel's version changes). It uses the look **being edited** (the sliders' unsaved
  values), so moving a slider changes the picture at once, paused or playing. The bridging gap follows the edited Target Lock value with
  the API's formula (`maxInterpFor`). Preview Render (the finished file) is unchanged: its spotlight is burned in.
- **Coverage bar**: a thin strip under the seek bar, light where the player has a position in the selected clip and dark where not, and a
  note in the picture's lower left: "Live spotlight · approximate · player seen in N% of this clip", or "the player was not found in this
  clip", or why there is no preview (identity changed, no confirmed player).
- Honest: "approximate", because the render's dense re-analysis (Auto Track) can light frames the analysis positions leave dark. Where
  he was not seen nothing is drawn.

## Tests
- `apps/web/test/liveSpotlight.test.tsx`: coverage share and stretches clipped to the clip, the bridging formula, the bar's stretches,
  the note's wording for seen / not found / stale / no clip.
- Web suite 171 passed; type check clean. Browser (owner's reel, view only): clip 1 (0.5 s) "not found", matching 0 recorded
  positions in the database; clip 2 "seen in 92%", with the beam and caption on him at 00:02; video left paused.

## Amendment (same day, with B.15): detected and interpolated
The plan asks the bar to be solid where detected, hatched where interpolated and empty where unseen. The path now carries each position's
recorded `observation_state`. A stretch between two positions is **detected** (solid) when both are detections and the gap is within 1.5x
the analysis's own sampling step (the median gap); a longer gap up to the bridge, or a position that is not a detection, is
**interpolated** (hatched); beyond the bridge is unseen (empty). The note adds "(N% detected, the rest bridged)" when they differ.
Tests: `liveSpotlight.test.tsx` (a 0.5 s bridged gap is hatched), `reels.api.test.ts` (the path's state).
