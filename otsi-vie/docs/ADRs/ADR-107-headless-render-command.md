# ADR-107: Headless render command vie-render <manifest> for batch and recovery (v3 Phase C.8)

Date: 2026-11-09. Status: accepted. Migration: None (next migration is `0062`).

## Decision

A standalone headless rendering command `vie-render` (`vie_worker.render.cli`, `vie_worker.render.headless`) is provided for batch rendering and disaster recovery.

- **Standalone headless CLI execution (`services/worker/vie_worker/render/headless.py`, `cli.py`, `tools/dev/vie_render.py`):**
  - **Zero server dependencies:** Operates directly on local manifest files (`.json`, `.otsi-reel`) without requiring an active MySQL database connection or running web/API server.
  - **Batch processing:** Accepts multiple manifest paths or wildcards (e.g. `vie-render path/to/*.manifest.json -o dist/`), processing renders in sequence with progress readouts.
  - **Disaster recovery & replay:** Allows operators to re-render corrupted or failed exports directly from the output manifest (`<file>.manifest.json`) or interchange bundle.
  - **Source resolution:** Automatically resolves the source video file from manifest paths, `--source <path>` CLI override, or `OTSI_VIE_STORAGE_DIR`.
  - **Execution modes:**
    - `--dry-run`: Parses manifest, probes source video dimensions and frame rate, verifies assets, computes geometry and planned frame count without encoding.
    - `--validate-only`: Validates an existing rendered output against the manifest's target dimensions, codec, frame count, LUFS loudness, and black frame QC criteria without re-encoding.
    - `--json`: Emits machine-readable execution summaries and validation reports.
  - **Rendering pipeline:** Composes source clips, aspect crops (16:9, 9:16, 4:5, 1:1), spacer gaps (black frames and silence), speed effects, audio slicing, music mixing with ducking, loudness normalization, and hardware/software encoding (`enc.choose()`).
  - **Integrated QC report:** Validates output bitstreams using `validate()`, recording true integrated LUFS, true peak dBTP, and black frame segment detection into `<output>.manifest.json`.
- **Contracts (`packages/contracts/src/headless-render.ts`):**
  - `HeadlessRenderClip`, `HeadlessRenderManifest`, and `HeadlessRenderResult` schemas exported in `@otsi-vie/contracts`.

## Limits

- Real-time telemetric progress callbacks report step percentages and stage summaries; per-frame terminal progress bars are suppressed in `--json` and `--quiet` modes.
- Hardware encoder availability depends on local GPU/iGPU capabilities (`intel-qsv-h264`, `openh264`, or software `libx264`).

## Verification

- Contracts build, API typecheck, and web typecheck all passed with 0 errors.
- Web unit tests: 222 tests passed across 54 files.
- Worker unit tests: 11 passed across `test_headless_render.py`, `test_validate_qc.py`, and `test_beat_job.py`.
- End-to-end execution: executed `vie-render` against real evaluation footage (`france_germany_ccbysa.ogv`):
  - Dry run computed exact 112 frames (4.48s) at 1920x1080 25 fps.
  - Full render completed on Intel QSV H.264 in 5.52s (107 fps) with QC pass (-13.8 LUFS, compliant).
  - Validation test (`--validate-only`) verified bitstream and faststart compliance.
- Deployment: stack live at `4310/login` -> 200, `4520/v1/notifications` -> 401, `https://vie.otsi.cc/login` -> 200.
