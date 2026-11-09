# ADR-083: Analysis player tools and snapshots (v3 Phases B.4 and B.5)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
The Analysis player could play, pause, step forward one analysed frame, seek, change speed and go full screen. A reviewer could not:
- step back;
- mark a passage and loop it;
- look closer at a player;
- fade the overlays to see the picture under them;
- take a picture of a moment.

## Decision
- **Player tools (B.4, `workspace/PlayerTools.tsx`, wired into `CentreVideo.tsx`):**
  - **Back one analysed frame** (⏮) next to forward. Both pause first.
  - **In / Out marks:** the I and O keys, or the I and O buttons. They show on the position bar as yellow ticks with the span shaded.
    - Setting a mark past the other drops the other, so In is always before Out.
    - ✕ clears both marks. They reset when the video changes.
  - **Loop** (⟲): with both marks, playback returns to In at Out, and to In after a seek before it.
  - **Zoom** 1×, 1.5×, 2× or 3×. It follows the selected player's box while he is seen, and otherwise uses the centre of the picture. The overlays zoom with the picture, so the boxes stay on the players.
  - **Overlay opacity** in the settings menu: boxes and IDs, pitch layers, ball (10–100 %). Remembered in this browser only.
  - The position bar is shorter to make room for the marks. The design is otherwise unchanged.
- **Snapshot (B.5):**
  - **Migration 0054:**
    - a `snapshots` table;
    - asset kind `SNAPSHOT`;
    - job kind `SNAPSHOT`. The media worker group handles it.
  - **API** (`analysis/snapshots.ts`):
    - `POST /v1/videos/:id/snapshots` (writers, 202);
    - `GET /v1/videos/:id/snapshots`;
    - `GET /v1/snapshots/:id`;
    - `GET /v1/snapshots/:id/image` (`?download=1` names the file after the video and the time);
    - `DELETE /v1/snapshots/:id` (the requester or an owner/admin; soft delete; audited).
  - **Rules:**
    - The video must be verified, and its current rights grant must allow **PRODUCE** (the analysis rule, generalised: `analysisBlock(…, use)`).
    - A selected track must belong to that video.
    - At most 5 snapshots can be waiting per person.
    - A snapshot stays inside the organization; sharing it outside goes through Export like any other output.
  - **Worker** (`vie_worker/snapshot_job.py`):
    - Uses the decoded frame nearest the time, from the source at full resolution. The frame's own time is stored.
    - **Boxes:** only those the latest finished analysis recorded at the analysed frame nearest the time, within half an analysis step. A box is never borrowed from another moment.
    - **Labels:** track numbers. A name and OTSI Player ID appear only for a CONFIRMED identity.
    - The selected player is drawn white.
    - An optional caption strip under the picture gives the video, the time, and "Boxes are detections, not verified identities".
    - Output is a PNG asset, audited.
  - **Screen:**
    - A 📷 button at the top right of the player pauses the video and opens the Snapshot dialog. It offers options, "Make a snapshot at <time>", the newest picture, and the list (go to its time, Save PNG, Remove).
    - Options a person cannot use are greyed with the reason: no finished analysis, or no selected player.

## Alternatives
- **Capture the browser's canvas:** rejected. The picture would come from the playback copy, not the source, and the overlays would be the page's, not a record of what was drawn.
- **Draw estimated boxes between analysed frames:** rejected. "Unknown beats wrong": a still claims a moment.

## Tests
- **Worker** `test_snapshot.py` (3):
  - labels name only confirmed identities;
  - the picture is drawn where recorded and the caption sits under it;
  - a real encoded video through the JobRunner: nearest frame, full size, two boxes at 2.0 s, none from 3.0 s, none at 1.0 s.
- **API** `snapshots.api.test.ts` (3):
  - rights none / no PRODUCE / allowed; viewer 403; past the end 422; a track from another video 422;
  - 202 with audit and outbox event; not ready 409; the PNG and its download name;
  - another organization 404; removal rules; the waiting limit 429.
- **Web** `playerTools.test.tsx` (6): marks, loop, zoom origin, opacity reading, and the Snapshot dialog (request body, greyed options, viewer).
- **Browser** (the owner's match, view only):
  - the new transport controls and the Zoom and Snapshot buttons show;
  - the opacity sliders are in the settings menu;
  - the Snapshot dialog opens with "select a player first" on the highlight;
  - no snapshot was made.
- **Totals:** API 237, web 152.
- Also found and fixed: migration 0054's first draft dropped asset kind `BUNDLE` (added in 0044). The exports test caught it before deployment.
