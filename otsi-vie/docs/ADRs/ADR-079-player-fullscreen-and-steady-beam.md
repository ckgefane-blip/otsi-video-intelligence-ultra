# ADR-079: One full screen for every video player, and a steady beam

Status: accepted. The owner asked on 2026-11-07 for "the full screen button [to] actually work perfectly across the entire engine (all video players)", and said the beam "does not accurately follow the player and should be steady".

## Full screen
- **Problem.** Each player called `element.requestFullscreen()` on its frame. This failed in three ways:
  - The frames, pictures and overlays are sized in design units, so in full screen the picture stayed small.
  - Play, seek and exit sit outside the frame, so they disappeared.
  - Where the browser holds the request (the desktop app's pane), nothing happened at all.
- **Decision.** One shared module, `components/media/Fullscreen.tsx`:
  - `usePlayerFullscreen()`: the player's frame is a `<dialog>`. It is always open in the page; in full screen it is opened modal (`showModal`), so it sits in the top layer, above the page and outside the design stage's container.
    - It is the same `<video>` element, so playback goes on.
    - The page also asks the browser for real full screen, so the window fills the screen where the browser allows it.
    - Esc, the "Exit full screen" button or the full-screen button again leave it.
  - `frameStyle()`: the frame fills the window, on black.
  - `fitFull(w, h)`: the picture box, with its overlays (boxes, spotlight, labels), at the largest size of the video's aspect that fits, centred.
  - `FullscreenBar`: play/pause, time, position, mute and exit inside the player. It fades after 3 s without the mouse while playing.
- **Players converted (all six):**
  - Clip Studio preview;
  - Reel Builder preview;
  - Export preview;
  - Processing;
  - Analysis workspace (its native controls are replaced and the minimap is kept);
  - Tactical synced preview.
- No approved layout changes outside full screen.

## Steady beam
- **Causes:**
  - the raw detector box moves with every arm and leg;
  - straight lines between samples kink at each sample;
  - a trailing average (0.35 a frame) made the beam lag a running player;
  - the live preview read `video.currentTime`, which runs ahead of the frame actually shown.
- **Decision.** `smooth_path` (render/reel.py) and `smoothPath` (studio/spotlight.ts) use the same rule:
  - Per run of points (gap ≤ max interpolation; broken at a camera cut's jump), a Gaussian-weighted local straight-line fit over 0.15 s for the centre and feet, and a mean over 0.6 s for the size. It is resampled every 40 ms.
  - It is zero-phase, so there is no lag on a straight run.
  - The beam's own settle drops to 0.8/0.2.
  - Whether the player is shown at all is still decided by the raw path. The steady path adds nothing outside where he was seen ("unknown beats wrong").
  - The preview takes the presented frame's time from `requestVideoFrameCallback`.
- No migration.

## Alternatives
- **Fix `requestFullscreen` per player:** rejected. It still fails where the browser refuses full screen, and it keeps six copies.
- **Kalman filter on the boxes:** rejected for now. The local fit gives no lag with simpler arithmetic that is identical in both languages.

## Tests
- Web `spotlight.test.ts` (+2): no lag on a running player, shake under 40%, nothing outside the seen stretches, no bridge across a cut.
- Worker `test_render_reel.py` (+1, same cases). The "ray of light" steadiness check now runs through `smooth_path`, as compose does.
