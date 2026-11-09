# ADR-096: Transitions picker, marker list, compound clips (v3 Phase B.21, migration 0057)

Date: 2026-11-07. Status: accepted.

## Decision
- **Transitions picker** (Adjustments → Transitions):
  - Fade, Dissolve, Zoom and Spin each show a small moving sample. It is CSS only: it shows the kind, not the footage.
  - Lengths: 0.4, 0.6 or 1.0 s.
  - The chosen transition can go into the selected clip, or onto every cut.
  - `POST /v1/reels/:id/transitions/all` sets every cut as one change; Undo restores the earlier transitions.
  - One rule, contracts `transitionsForAll`, used by both the API and the panel's count:
    - no transition into the first clip, or into a clip that starts after a gap (ADR-094);
    - a short clip gets half its length when that is at least 0.2 s, otherwise none.
- **Marker list** (Adjustments → Markers):
  - Lists every note pinned at a time, at its reel time: the first clip holding it, with its speed effect (`editing.ts reelTimeOf`).
  - Click a marker to go there.
  - Delete uses the existing `DELETE /v1/reels/:id/notes/:noteId`: its author, or an owner or admin.
  - A marker in no clip shows "not in reel".
- **Compound clips / blocks** (Adjustments → Blocks; new table `reel_blocks`):
  - **Saving:** a person saves consecutive clips (from–to) under a name. Each clip's window, label, origin, speed effect and clip fx
    (zoom, drawings, gap, sound level) are stored.
  - **Inserting:** the block can go into any reel of the same video, as copies placed before the clip at the playhead (or at the
    end). That is one change, with Undo, within the 10-minute limit.
  - **Rules and access:**
    - Per organization and video.
    - A block from another video is refused (`BLOCK_OTHER_VIDEO`).
    - Saving, inserting and deleting need a writer role.
    - Deleting a block leaves the reels' clips as they are.
  - **Out of scope:** blocks are copies, not live links. Nesting and collapsing a block on the timeline are not part of this step.

## Alternatives
- Live (linked) compound clips: an edit to the block would change every reel that uses it. That needs per-reel overrides and a render
  path for nested sequences. Copies match the owner's "reusable intro block" with no hidden coupling.

## Tests
- `apps/api/test/blocks.api.test.ts`:
  - every cut as one change, with the short-clip and gap rules; viewer refused; Undo;
  - block save, consecutive check, list per video, insert before a position with its effects kept, Undo, insert at the end;
  - other organization 404; delete; other video refused.
- `apps/web/test/transitionsMarkers.test.ts`: `transitionsForAll`, `reelTimeOf`.
- Web 187 / API 245 green.
