# ADR-094: A spacer (gap) before a clip (v3 Phase B.19, part 2)

Date: 2026-11-07. Status: accepted.

## Decision
- A clip may have a spacer before it: `clip_fx.gap_ms` (0 to 10 000 ms; 0 = none). This is black picture and silence in the reel.
  It is stored in the existing `reel_clips.clip_fx` JSON, so there is **no migration**. It is set with the existing
  `PATCH /v1/reels/:id/clips/:clipId/fx` call and is one undoable edit. The reel must still be 10 minutes or less (`REEL_TOO_LONG`).
- One rule for the length in both places:
  - contracts `gapUs` / `slotUs` (gap plus the retimed clip);
  - worker `gap_frames` (round(gap × fps)).
- Uses of the length:
  - The API's `duration_us` includes the gaps.
  - The Studio timeline places each clip after its gap, so the gap shows as empty space.
  - Reel Builder's timeline and bars count the gaps.
  - Export chapters start after a clip's gap.
- Render: the worker writes black frames before the clip (no overlays) and silence in its audio track. `reel_s` and the planned frame
  count include the gaps, so picture and sound stay the same length.
- No transition goes into a clip that has a gap: the clip starts from black.
- Preview: with the playhead in a gap, the picture is black ("Gap · 1.0 s"). Playback holds there for the gap's length, then plays the clip.
- "Changed since the last file" also notices a gap that was added or changed.
- Adjustments, Speed section: "Gap before" offers None, 0.5, 1, 2 or 3 s.

## Alternatives
- A separate "black clip" row in `reel_clips`. Rejected: it needs a migration, a non-video clip kind in every module
  (moments, swap, identity, coverage, reports) and new render paths. A property of the next clip covers the use case.

## Tests
- `apps/web/test/spacer.test.ts`: lengths, placement, locate in a gap, rendered state.
- `apps/api/test/reels.api.test.ts`: the gap adds to `duration_us`, limits, role, undo.
- `services/worker/tests/test_render_reel.py`:
  - `gap_frames`;
  - a real render: frame count, black middle of the gap, sound length equal to the picture, transition into the gapped clip dropped.
