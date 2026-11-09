# ADR-110: Broadcast Pitch Tracker on Targeted Player

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** Highlight & Spotlight Tracker Overhaul
- **Migration:** None (Rendering & UI visual style enhancement)

## Context

The legacy spotlight implementation (ADR-064 / ADR-079) visualized targeted players using a vertical conical light shaft ("ray/beam from heaven") descending from the top of the video frame with animated light streaks, floating volumetric motes, and sky haze.

Professional broadcast television analysis (e.g. Premier League, Match TV, Champions League tactical broadcasts) uses a grounded pitch tracker to highlight targeted players without obscuring the field or imposing artificial sky lighting:
1. **Grounded Pitch Base Disc:** A soft, translucent dark elliptical pool/shadow on the grass under the player's feet, foreshortened according to the pitch perspective plane ($r_y \approx 0.36 \cdot r_x$).
2. **Concentric Glowing Cyan Ring:** A crisp, vibrant glowing ring centered at the player's feet contact point (`scx`, `sfy`), featuring a solid core line and soft outer halo in the designated accent color (`#17D1F8` cyan).
3. **Floating Broadcast Player Badge:** Positioned neatly above the player's head with an inverted triangular caret pointer, featuring:
   - Line 1: Bold uppercase crisp white player display name (e.g. `ГЛУШЕНКОВ`).
   - Line 2: Secondary KPI metric line (e.g. speed, match distance, or canonical OTSI Player ID) in clean muted silver.
4. **Natural Pitch Lighting:** Elimination of the vertical conical sky beam and streaks, keeping the rest of the pitch and stadium natural (with optional gentle ambient dimming when `dim > 0`).

## Decision

1. **Web Canvas Implementation (`apps/web/src/components/studio/spotlight.ts`):**
   - Replaced quarter-resolution pixel rendering loops (volumetric noise, streaks, motes) with native anti-aliased 2D canvas primitives.
   - `SpotlightPreview.draw` renders:
     - Ground pitch shadow ellipse at `[scx, sfy]` with fill `rgba(12, 18, 26, 0.52 * strength)`.
     - Concentric glowing cyan tracker ring (`s.ring_color`, default `#17D1F8`) with dual-pass stroke (outer soft halo and inner crisp core).
     - Additive luminance stroke on the `add` canvas layer (`mix-blend-mode: plus-lighter`) so the turf glows naturally under stadium lights.
     - Floating broadcast card above player head with inverted caret pointer, bold uppercase title, and secondary KPI / ID readout.
     - Preserves temporal smoothing (`smoothPath`, `_steady`) and aspect ratio framing.

2. **Python Worker Video Renderer (`services/worker/vie_worker/render/reel.py`):**
   - Updated `Spotlight.apply` in the worker video rendering pipeline to mirror the broadcast tracker style:
     - Pitch ground shadow ellipse rendered on turf with alpha composite.
     - Concentric glowing cyan ring with outer soft halo and inner core stroke.
     - Floating player badge rendered via PIL `ImageDraw` with bold Inter font typography for Cyrillic, Latin, and international player names.
     - Ambient dimming outside player area when `dim > 0`, keeping the player and ground tracker fully illuminated.

3. **Testing & Verification:**
   - Web unit tests in `apps/web/test/spotlight.test.ts` and `apps/web/test/liveSpotlight.test.tsx` passed. Full 56 web test files (231 tests) passed.
   - Worker unit tests in `services/worker/tests/test_render_reel.py` updated to verify the broadcast pitch tracker (`test_the_spotlight_is_a_broadcast_pitch_tracker_with_no_sky_beam`) and passed.
   - Next.js production build succeeded.
   - Stack running and verified in headless browser on owner reel `01a199aa-08fd-740d-93a3-a27fec2d7a8b` across Studio (Page 07) and Reel Builder (Page 05).

## Consequences

- The player spotlight effect looks professional and television-grade, matching real-world sports broadcast graphics.
- Web canvas rendering performance is significantly improved by eliminating per-frame quarter-resolution pixel loops.
- Exact line endings (LF for web, CRLF for Python worker) are strictly maintained.
