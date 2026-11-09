# ADR-105: Beat grid and beat-aware cut snap (v3 Phase C.5)

Date: 2026-11-09. Status: accepted. Migration: `0061_music_beat_grids.sql`.

## Decision

Music brand assets uploaded for reels (ADR-047) can be analysed offline on this computer to detect their beat grid and tempo (`BEAT_GRID` worker job, `otsi-beat-v1`). In Clip Studio (Page 07), timeline snapping (`Snap`) uses the detected beats to snap dragged clip in/out boundaries to the nearest music beat as looped in the final render.

- **Offline analysis & counsel licence note (zero cost, local-only):**
  - Decoded using the bundled LGPL FFmpeg build (`tool("ffmpeg")`) into mono 22 050 Hz samples (`decode()`).
  - Analysed entirely with NumPy and SciPy (both BSD-3-Clause):
    - Spectral-flux onset envelope from log-compressed Hann-windowed STFT (`NFFT=2048, HOP=512`), normalized by local mean subtraction.
    - Global tempo estimation via autocorrelation lag between 60 and 200 BPM, weighted by a 120 BPM log-normal prior and refined via parabolic interpolation.
    - Dynamic-programming beat tracker based on D. P. W. Ellis (2007) with a squared log-lag interval penalty.
  - Licence recorded in `BEAT_LIBRARY_NOTE`: *"Found on this computer by OTSI's own beat analysis (NumPy and SciPy, BSD-3-Clause; the music decoded by the LGPL FFmpeg build). No music leaves the computer."*
  - Faithful evidence: beat detection is labelled **Detected (accuracy not measured)** on all UI panels, and music with periodicity < 0.10 or fewer than 4 beats records no steady beat.
- **Shared contracts (`packages/contracts/src/beats.ts`):**
  - `BeatGrid` schema (`tempo_bpm`, `beats_us`, `duration_us`, `periodicity`, `status`, `method`, `failure`).
  - `reelBeats(grid, totalUs)` projects music beats across the entire reel duration matching the render loop (`-stream_loop -1` starting at clip 0).
  - `beatSnapTargets(p, edge, beats)` calculates the exact source-time in/out points where a cut lands on a beat for normal-speed clips. Slow, frozen, or ramped clips are excluded because non-linear speed maps source to reel time unevenly.
- **Database (`database/migrations/0061_music_beat_grids.sql`, `tools/db/db_check.py`):**
  - Table `music_beat_grids` with foreign key to `brand_assets(id)` and `organizations(id)`.
  - Added `'BEAT_GRID'` to `worker_jobs` check constraint `ck_worker_jobs_kind`. Updated expected base table count to 96 in `tools/db/db_check.py`.
- **API & Worker (`apps/api/src/modules/reels/beats.ts`, `services/worker/vie_worker/beat_job.py`):**
  - `GET /v1/brand-assets/:id/beat-grid` returns `{ music_id, grid, library_note }`.
  - `POST /v1/brand-assets/:id/beat-grid` checks rights in force (`MUSIC_RIGHTS_NOT_IN_FORCE` if not), deduplicates against existing runs, creates `music_beat_grids` row, and publishes `brand_asset.beat_grid_requested` in outbox.
  - Outbox subscriber `jobs.beat_grid` creates `BEAT_GRID` worker job, handled by `jobs-media` worker group.
- **Web (`apps/web/src/components/studio/BeatGridInfo.tsx`, `Timeline.tsx`, `MediaBin.tsx`, `MusicPicker.tsx`):**
  - `useBeatGrid` hook and `BeatStatusRow` component integrated into Media Bin (Audio tab) and Reel Builder Music Picker.
  - `Timeline.tsx` automatically loads the reel music's beat grid, draws visual beat tick marks (`data-beat-tick`) along the Soundtrack lane, and includes `beatSnapTargets` when `Snap` is active.

## Limits

- Accuracy is not measured against a ground-truth dataset because no football broadcast music dataset exists in the repository. The UI displays "Detected (accuracy not measured)".
- Beat snapping applies to clips with standard playback speed (`effect.kind === "NONE"`). Slow motion, freeze frames, and ramps have variable or zero time progression, so beat snapping is bypassed on those clips.

## Verification

- Contracts build, API typecheck, and web typecheck all passed with 0 errors.
- Web unit tests: 215 tests passed across 53 files (including 4 new tests in `test/beats.test.ts`).
- API integration tests: 267 tests passed across 51 files (including 8 new tests in `test/beats.api.test.ts`).
- Worker unit tests: 3 passed in `services/worker/tests/test_beat_job.py`.
- Deployment: idle check on port 3508 passed with 0 jobs and 0 upload sessions. Redeployed stack with `0061_music_beat_grids.sql`. Verified `4310/login` -> 200, `4520/v1/notifications` -> 401, and `https://vie.otsi.cc/login` -> 200.
- View-only browser check against owner reel `01a199aa-08fd-740d-93a3-a27fec2d7a8b` verified Studio snap button, Audio list, and Music picker without mutating data.
