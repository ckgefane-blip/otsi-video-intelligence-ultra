# ADR-106: Player scopes and QC in render validation (v3 Phase C.6)

Date: 2026-11-09. Status: accepted. Migration: None (next migration is `0062`).

## Decision

Real-time video/audio quality inspection is provided directly in Clip Studio (Page 07, `Preview.tsx`), alongside automated broadcast Quality Control (QC) in render validation (`validate.py`).

- **Real-time player scopes (`packages/contracts/src/scopes.ts`, `apps/web/src/components/studio/Scopes.tsx`, `Preview.tsx`):**
  - **Zero-cost, local-only execution:** A transport bar toggle (`[data-player-scopes]`, 4 analyzer bars icon) opens an off-screen sampled inspection overlay (`ScopesPanel`) positioned cleanly in the studio preview stage.
  - **Inspection modes:**
    - **Waveform:** horizontal distribution of luminance (Y) and RGB levels (0..255) across 160 columns, computed with BT.601 luma coefficients (`rgbToLuma`).
    - **Histogram:** 256-bin frequency distribution for Red, Green, Blue, and Luma channels (`computeHistogram`).
    - **Vectorscope:** BT.601 chrominance coordinates (Cb, Cr) centered at (128, 128) plotted on a color wheel with 75% broadcast saturation reference targets for Yellow, Cyan, Green, Magenta, Red, and Blue (`computeVectorscope`).
    - **Audio meter:** Peak and RMS signal levels in decibels (-60 dB to 0 dB) with clipping warnings (`computeAudioLevel`).
  - **Channel selector:** Toggle between Luma (`luma`) and RGB parade (`rgb`) channels.
- **Render QC validation (`services/worker/vie_worker/render/validate.py`, `services/worker/vie_worker/render/reel.py`):**
  - **Loudness compliance:** Measures integrated LUFS and true peak dBTP via FFmpeg's `ebur128=peak=true` filter (`measure_loudness_qc`). Flags renders whose integrated loudness drifts beyond ±2.5 LUFS from the reel target (or if true peak exceeds 0 dBTP).
  - **Black frame detection:** Scans for unintended black segments using FFmpeg's `blackdetect` filter (`detect_black_frames`). Detects black stretches (> 1.5s) occurring inside active reel content (excluding intentional head/tail black within first/last 0.8s).
  - **QC report:** Output report contains a structured `qc` object (`RenderQcReport` schema) with loudness and black frame diagnostics, stored with the render manifest without requiring database schema changes.

## Limits

- Real-time scopes sample from `<video>` element into an off-screen 160x90 canvas to guarantee smooth 30–60 fps playback without dropping preview frames on client hardware.
- High dynamic range (HDR / 10-bit) scopes are not modeled since source ingest and playback pipelines currently normalize to standard 8-bit BT.709/sRGB rec.709.

## Verification

- Contracts build, API typecheck, and web typecheck all passed with 0 errors.
- Web unit tests: 222 tests passed across 54 files (including 7 new tests in `test/scopes.test.ts`).
- API integration tests: 267 tests passed across 51 files.
- Worker unit tests: 3 passed in `services/worker/tests/test_validate_qc.py`.
- Deployment: idle check on port 3508 passed with 0 jobs and 0 upload sessions. Redeployed stack. Verified `4310/login` -> 200, `4520/v1/notifications` -> 401, and `https://vie.otsi.cc/login` -> 200.
- View-only browser check against owner reel `01a199aa-08fd-740d-93a3-a27fec2d7a8b` verified `[data-player-scopes]` button, panel opening, mode toggling (Waveform, Histogram, Vectorscope, Audio), and clean close without mutating live data.
