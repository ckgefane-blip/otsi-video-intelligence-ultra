# ADR-078: Media Info panel (v3 Phase A.12)

Status: accepted. The owner said "Yes, start A.12" on 2026-11-07.

## Decision
- **Where.** A "Media Info" link opens one shared dialog (`components/media/MediaInfoDialog.tsx`). The link sits in two places:
  - on Upload, beside the "Selected Item Preview" heading;
  - on Library, beside the "Selected Item" heading. For a reel or export, it shows the source video.
  - Nothing in the approved panels moves.
- **API.** `GET /v1/videos/:id/media-info` is read-only and built from recorded rows only. A video in a project hidden from the person gives 404. It returns:
  - **File:** name, size, SHA-256, type, the container signature read from the bytes, how it came in, who added it and when, and when it was verified (the `video.ingested` audit event).
  - **Streams:** what ffprobe measured, including time base, frame count and rotation.
  - **Checks**, in order: transfer, signature, malware scan, probe, test decode, policy. Each one is passed, failed (with the reason), not run, or waiting.
    - A refused file shows the check where it stopped; later checks show "not reached".
    - A scan that did not run is never shown as clean.
    - A result that was not kept says "not recorded".
  - **Copies:** the playback copy and the thumbnail.
  - **Evidence:**
    - analyses, plus the latest one's tracks and confirmed identities;
    - the footage check;
    - rights, and whether they allow analysis;
    - reels and finished renders.
- **Worker.** Ingest now also stores the decode test (`frames_decoded` of `frames_tested`) in the source asset's metadata. Videos ingested before this show "frames decoded (the count was not recorded)".
- **Code.** The check logic is one pure function in the contracts (`mediaChecks`), so the server and the tests share it. No migration.

## Alternatives
- **Keep a separate media-info table:** rejected. Everything is already recorded, and a copy could drift.

## Tests
- **API `mediaInfo.api.test.ts` (3):**
  - a verified video with all checks passed and its evidence;
  - checks that were not recorded;
  - a refused file (stops at the test decode);
  - a file still being checked;
  - another organization gives 404;
  - an unscanned file is never shown as clean.
- **Web `test/mediaInfo.test.tsx` (3):** the evidence lines, the panel content, and the dialog's read and refusal.
- **Totals:** API 226, web 139, and worker ingest 11 pass.
- **Browser (live, view only):**
  - Upload › the owner's match shows all six checks passed, with Defender clean and the decode count not recorded;
  - Library › a reel shows its source video's info.
