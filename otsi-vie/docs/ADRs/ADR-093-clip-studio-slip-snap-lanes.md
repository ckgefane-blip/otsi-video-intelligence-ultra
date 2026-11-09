# ADR-093: Clip Studio slip, snap, lane solo and height, project panel (v3 Phase B.19)

Date: 2026-11-07. Status: accepted (editor-only part; the spacer follows in a second B.19 commit).

## Decision
- **Slip:** Alt+drag on a clip's body, or "," / "." (Shift = 1 s, else one 40 ms frame), moves the clip's in and out together:
  the same length, another part of the source, never before 0 (`studio/editing.ts` `slipWindow`). It is saved as one trim
  (`st.trim`, one undoable change, the existing API). Escape cancels a drag.
- **Snap:** on by default ("Snap" toggle beside the timecode). A dragged edge jumps to the nearest target within 8 stage px:
  markers (reel notes), the playhead inside the clip, and for an out edge the playhead after the clip's start. Pure rule `snapTo`.
- **Lane solo:** clicking a lane name dims the other lanes to 0.3. Visual focus only; the preview's sound is not changed.
- **Lane height:** a "Tall" toggle gives the Video Clips lane 92 units (with the source in/out on a second line) and the
  other lanes 30. The default layout is the approved one (`LANE_Y`). Not stored; per visit.
- **Project panel:** with no clip chosen and no moment previewed, Clip Inspector shows the reel itself: name, confirmed player and
  OTSI ID, match, clips and length, frame, look preset, music, file state (`renderedState`). A button chooses the clip at the
  playhead. Clip Events and Adjustments still follow the playhead.
- Fixed in passing: Clip Studio's AI Highlights lane listed moments a person had rejected (B.15); it now leaves them out.

## Alternatives
Storing lane heights per user: not needed yet; it can be added with the rest of the user preferences.

## Tests
`apps/web/test/studioEditing.test.ts` (slip limits, snap, lane geometry, project rows). Web suite 182/182.
No API or database change.
