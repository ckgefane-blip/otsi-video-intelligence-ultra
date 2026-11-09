# ADR-097: Export preset library, batch fan-out, preflight, loudness per preset (v3 Phase B.22, migration 0058)

Date: 2026-11-07. Status: accepted.

## Decision
- **Output of a render** (`CreateRenderRequest`): two new optional fields.
  - `aspect` (null = the reel's own): only the reel profile takes a frame. Scout, social and archive keep their own frame, and a
    different one is refused (`PROFILE_HAS_ITS_FRAME`).
  - `loudness_lufs`: precedence is this file's value, then the reel's target (ADR-095), then the profile's level.
  - One open render per **file** (profile and frame), no longer per profile.
- **Batch:** `POST /v1/reels/:id/renders/batch {outputs, codec, bitrate_mbps, loudness_lufs}` with an Idempotency-Key.
  - Each distinct file is its own render, with key `key:i`. The same file asked twice is made once.
  - A file already rendering is skipped and listed in `skipped`. The request still returns 200 with the files it started.
- **Preset library** (`export_presets`):
  - Built-in presets live in code (`BUILTIN_PRESETS`): the three E3 presets plus "Every frame" (the reel in 16:9, 9:16, 1:1 and 4:5).
  - Organization presets are saved and deleted by an owner or admin.
  - Personal presets are saved by any writer and seen and deleted by their owner only.
  - A preset holds its outputs, its loudness, and optionally format and quality (null = keep what the page shows).
  - Endpoints: `GET/POST/DELETE /v1/export-presets`.
- **Preflight:** `GET /v1/reels/:id/preflight` returns checks from the shared rule `preflightChecks`, ordered BLOCK, then WARN,
  then OK, plus the files rendering now.
  - **BLOCK**, which the API refuses too: no clips; a changed identity; rights not in force (the same check the render does).
  - **WARN:** no confirmed player; under 5 s; music licence; a strap without a team-sheet entry; a match card without a linked match;
    a score bug without confirmed halves.
  - The web adds "the last file already matches this edit".
- **Export page:**
  - The Output Preset list shows every preset, and "Presets…" opens the library to choose, save or delete.
  - Export opens the preflight dialog: each file with its frame, format, bitrate and loudness, and "already rendering: skipped".
  - Start sends one batch request.

## Alternatives
- Per-aspect render profiles (new enum values): rejected. The frame is a property of the reel profile's file; the profiles stay
  what they are.

## Tests
- `apps/api/test/exportPresets.api.test.ts`:
  - scopes and roles: editor refused for organization presets, viewer refused; personal presets hidden from others; can_delete;
    another organization 404;
  - batch: files with their frame and loudness, dedupe, idempotency, skip of a running file, a new frame started;
    `PROFILE_HAS_ITS_FRAME`; viewer 403;
  - preflight: block, then fine, then open files; another organization 404.
- `apps/web/test/exportPresets.test.ts`: the output, loudness and preflight rules.
- Web 190 / API 247 green.
