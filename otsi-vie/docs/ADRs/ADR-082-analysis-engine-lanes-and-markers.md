# ADR-082: Analysis timeline engine lanes and video markers (v3 Phase B.3)

Status: accepted. The owner said "Proceed with implementation nonstop until you finish the very last thing in our planned work" on 2026-11-07.

## Problem
The Analysis timeline showed only the players' tracks. Nobody could see:
- where the camera cuts;
- where the ball was found;
- where the pitch is measured.

People also had no way to pin a note on a video at a time.

## Decision
- **Toggle.** A "Players | Engine lanes" switch sits above the timeline. Players mode is unchanged.
- **Engine lanes** (`workspace/EngineLanes.tsx`) has five rows. Each draws only what was recorded:
  - **Shots / cuts:** the shots of the latest finished analysis, in alternating shades so each cut shows.
  - **Ball found:** where the latest finished ball track has DETECTED positions.
    - Positions under max(1 s, 1.5 × step) apart are joined into one stretch.
    - Inferred positions are not "found".
    - With no ball track, the row says so.
  - **Pitch measured:** where pitch calibrations cover the video.
    - Calibrations are often one per frame (21,910 on the test match), so pieces under 0.25 s apart are joined into one stretch.
    - Its quality is weighted by duration and shown as brightness.
  - **Selected player:** where the selected track was seen.
  - **Markers & notes:** each marker is a pin; a click on it seeks there.
- **Markers** (migration 0053, `video_markers`):
  - A note of up to 500 characters at a time on a video. It belongs to the video's organization and is removed with the video.
  - "+ Note" opens a dialog to pin one at the playhead and to list all of them.
  - Writers add markers; viewers read them.
  - The author or an owner/admin removes a marker; anyone else gets 403 NOT_YOUR_MARKER.
  - Removal is soft (`removed_at`) and audited.
  - A marker after the end of the video is refused (422).
- **API** (`analysis/lanes.ts`):
  - `GET /v1/videos/:id/lanes`;
  - `POST /v1/videos/:id/markers`;
  - `DELETE /v1/videos/:id/markers/:markerId`.
  - Hidden videos and other organizations get 404.

## Found in the browser check
On the real match, a step of 166,667 µs halved to a fraction, so the response failed its own integer schema (422). `joinSpans` now rounds. The per-frame calibrations were joined for the same check.

## Tests
- **API** `lanes.api.test.ts` (4):
  - lanes from seeded shots, ball positions and calibrations;
  - viewer 403; a marker past the end 422; author vs other member removal;
  - another organization 404;
  - calibration joining; integer spans.
- **Browser** (view only, the owner's match): 706 shots, 866 ball stretches and 244 pitch stretches drawn; no marker added.
