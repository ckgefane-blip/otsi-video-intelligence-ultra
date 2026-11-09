# ADR-104: Archive bundle with manifest, audit extract, and pack/open rights re-checks (v3 Phase C.4)

Date: 2026-11-09. Status: accepted. Migration: `0060_archive_bundles.sql`.

## Decision

A reel, a video, or a match can be packed into a portable archive bundle (`otsi-archive/v1`, `.otsi-archive.zip`) containing `manifest.json`, a chronological `audit-extract.json`, and (for a reel) its `.otsi-reel` manifest, `.otio` timeline, and newest finished render file if present on disk. Video rights and identity freshness are checked at pack time and re-checked against the live database every time an archive is opened or downloaded.

- **Shared contracts (`packages/contracts/src/archive.ts`):**
  - `checkArchiveRights` evaluates rule `archive-v1` across every source video in the archive and any followed reel targets:
    - Reuses `analysisBlock(grant, now, "PRODUCE")` per source video: requires a recorded current rights grant (`rights_grants`) that includes `"PRODUCE"` in `allowed_uses`, is valid at `now` (`valid_from` / `valid_until`, not `EXPIRED`), and has no `PENDING` or `REVOKED` guardian consent.
    - Blocks if any source video was moved to the Trash (`SOURCE_VIDEO_REMOVED`), if a match has no linked videos (`NO_VIDEOS_IN_MATCH`), or if a reel's followed track identities changed (`REEL_STALE`).
  - `ArchiveManifest` (`schema: "otsi-archive/v1"`) records the archive metadata, `rights_at_pack`, per-video evidence summary (`source_sha256`, `duration_us`, `analysed`, `tracks`, `confirmed_tracks`, `calibrated`), embedded `reel_interchange` (`.otsi-reel` + `.otio` for reels), `audit_summary`, and `files` (sizes and SHA-256 of the archived files).
- **Database (`database/migrations/0060_archive_bundles.sql`, `tools/db/db_check.py`):**
  - Forward-only table `archive_bundles` storing the packed bundle row (`subject_kind` `'REEL' | 'VIDEO' | 'MATCH'`, `subject_id`, `video_ids`, `zip_asset_id`, `manifest`, `audit_extract`, `audit_count`, `byte_size`, `sha256`, `created_by`, `created_at`).
- **API (`apps/api/src/modules/archive/archive.ts`, `core/access.ts`):**
  - `GET /v1/archives/status?subject_kind=...&subject_id=...` returns the live `rights_now` check and the item's packed archives (with live `rights_now` evaluated per archive).
  - `POST /v1/archives` (`PROJECT_WRITERS`) evaluates `archive-v1`, records a `policy_decisions` row (`action: 'PRODUCE'`, `rule_version: 'archive-v1'`), refuses with `409 ARCHIVE_RIGHTS_BLOCKED` (and audits `archive.blocked`) when blocked, or writes the stored ZIP (`writeZip`), inserts the `BUNDLE` asset and `archive_bundles` row, and audits `archive.packed`.
  - `GET /v1/archives/:id` (open) and `GET /v1/archives/:id/download` (download) re-evaluate `archive-v1` against the live database on every request, record `policy_decisions` (`VIEW` / `DOWNLOAD`, `rule_version: 'archive-v1'`), and refuse with `409 ARCHIVE_RIGHTS_BLOCKED` if a source video's rights were later withdrawn/expired or a followed track identity became stale.
  - Project access enforcement (`enforceProjectAccess` in `core/access.ts`) covers `/v1/archives/:id` and `subject_kind` / `subject_id` in `POST /v1/archives`.
- **Web (`apps/web/src/components/exportstage/ArchiveBundle.tsx`, `Interchange.tsx`, `ExportStage.tsx`, `components/library/LibraryMain.tsx`):**
  - Export & Delivery's `Interchange…` dialog adds the `Archive bundle (otsi-archive/v1)` tab (`[data-view-archive]`) showing the live rights check, `Pack reel archive`, and existing archives with `Open & verify` (`manifest.json` / `audit-extract.json` inspector) and `Download .zip`.
  - Library's row `⋯` menu on `Reel`, `Video`, and `Match` rows adds `Archive reel…`, `Archive video…`, and `Archive match…`, opening `ArchiveDialog` (`[data-dialog="archive"]`).

## Limits

Archive bundles package structured metadata (`manifest.json`, `audit-extract.json`, `reel.otsi-reel`, `timeline.otio`) and, for a reel with a finished render on disk, the rendered `reel.mp4`/`webm`. Full raw source footage is referenced by its `source_sha256` and `video_id` in `manifest.json` rather than duplicated inside the ZIP so archive bundles stay under the stored-ZIP size limit and do not duplicate multi-gigabyte camera files on local disk.

## Verification

- Contracts build and API and web type checks passed.
- API: 259 passed across 50 files using the disposable MySQL test server. `archive.api.test.ts` covers unrecorded-rights refusal (`409 ARCHIVE_RIGHTS_BLOCKED` + `PRODUCE:DENY` in `policy_decisions`), ZIP packing with `manifest.json`, `audit-extract.json`, `reel.otsi-reel`, `timeline.otio`, and `reel.mp4` verified by SHA-256, live rights re-check on every open and download (`VIEW:DENY` and `DOWNLOAD:DENY` after rights are narrowed to `ANALYSIS_ONLY`, then `ALLOW` once `PRODUCE` is restored), Match and Video archives, and tenant and restricted-project isolation (`404`).
- Web: 211 passed across 52 files. `archive.test.ts` covers `checkArchiveRights`, `describeArchiveRights`, and `formatArchiveBytes`.
- Deployment: idle check on port 3508 found zero active jobs and zero unfinished uploads. Redeployed the local stack (applied migration `0060_archive_bundles.sql`); `/v1/notifications` returned 401 without a session, and `https://vie.otsi.cc/` returned 200.
- Signed-in browser at `http://127.0.0.1:4310/exports?reel=01a199aa-08fd-740d-93a3-a27fec2d7a8b` and `http://127.0.0.1:4310/library`, view only: verified the `Archive bundle (otsi-archive/v1)` tab in `Interchange…` (`Live rights check (archive-v1) Blocked`, `Pack reel archive` disabled because `FC Ercakhu v FC Dynamo` has `UNRECORDED` rights) and verified `Archive reel…` in Library's `⋯` menu (`Archive reel “Chinazom Godwin — highlights”`), without mutating any data.
