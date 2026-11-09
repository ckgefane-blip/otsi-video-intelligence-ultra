# ADR-081: Reel edit history with compensating undo (v3 Phase B.1, S11)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
Clip Studio's Undo and Redo were a list kept in the page:
- it was lost on reload;
- Reel Builder had none;
- a removed clip came back under a new id;
- filling a template cleared the list.

## Decision
- **Table** (migration 0052): `reel_edits` has one row per change to what a reel is:
  - what it covers: name, frame, look, clips (with their effects, zoom and drawings), order, trims and transitions;
  - what it stores: the reel's editable state before and after the change, and their SHA-256 hashes.
- **Recording.** Every content method of `ReelsService` snapshots the reel first (locking its row) and calls `recordEdit` at the end of the same transaction (`reels/edit-state.ts`).
  - A request that changes nothing records nothing.
  - Template use is two entries: the look, and the filled clips.
- **Compensating undo** (`reels/edits.ts`):
  - `POST /v1/reels/:id/history/undo` writes the earlier state back with the same clip ids and adds an UNDO row; the edit becomes UNDONE.
  - `{to_edit_id}` goes back to before that edit, undoing everything after it in one step.
  - `POST .../redo` writes the later state back and adds a REDO row.
  - A new edit turns undone edits into DROPPED, so they can no longer be redone.
  - Nothing is ever deleted from the log.
- **Safety checks:**
  - Undo or redo is refused (409 REEL_CHANGED) when the reel is not what the edit left: a change that was not recorded is never overwritten.
  - A clip with review decisions cannot be taken out (409 CLIP_REVIEWED).
  - Viewers can read the history but not change it (403); another organization gets 404.
- **Screens:**
  - `ReelBuilder`'s context holds the history, so Reel Builder and Clip Studio share it.
  - Clip Studio: the Undo and Redo buttons and Ctrl+Z / Ctrl+Y use the server history, and a "History" button sits next to the shortcuts button.
  - Reel Builder: ↶, ↷ and History sit beside "Build a draft".
  - The History dialog (`reels/HistoryDialog.tsx`) lists every change newest first, with who made it and when, and offers "Back to before this".
- **Start.** History starts with this version: earlier changes were not recorded, and the panel says "No changes yet".

## Alternatives
- **Keep the page's list and add a server copy:** rejected. There would be two sources of truth.
- **Store inverse operations:** rejected. They break when clip ids change; full states are simpler and verifiable by hash.

## Tests
- **API** `reelHistory.api.test.ts` (2):
  - five different changes, then back to the start in one step: the same clips, ids, order, effects, transitions and frame;
  - redo of all five; a new edit drops redo; undoing a removal brings back the same clip in its place;
  - nothing is deleted from the log;
  - an unrecorded change blocks undo;
  - roles and organizations; an empty reel.
- **Web** `historyDialog.test.tsx` (3).
- **Totals:** API 228, web 146.
