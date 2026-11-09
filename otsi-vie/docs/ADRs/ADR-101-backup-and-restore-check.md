# ADR-101: Local backup and restore check (v3 Phase D.5, part 1)

Date: 2026-11-07. Status: accepted. No migration.

## Decision
- `tools/db/backup.py backup`:
  - dumps `otsi_owner_vie` with `mysqldump --single-transaction --routines --triggers --events --hex-blob` to
    `.local/backups/<UTC>/db.sql.gz`;
  - writes `manifest.json` with every table's row count and storage totals, and `storage-files.json` with each media file's path, size
    and time;
  - `--with-storage` copies media too, hard-linking files unchanged since the last backup.
- `tools/db/backup.py verify`:
  - restores the dump into `otsi_restore_check` in a unique temporary MySQL 8.4 container, using the existing pinned local image (`--pull never`);
  - stores its MySQL data on D: under `.local/restore-checks/verify-*` with a bind mount, uses `--network none`, and publishes no port; the live and test servers are never used for verification;
  - compares every table's row count with the source and counts restored routines and triggers;
  - removes its container and only its own temporary data directory on success or failure; if container removal fails, preserves the mounted data and reports failure;
  - writes `verify.json` only after comparison and successful cleanup, with cleanup flags; a mismatch returns exit 1. Previous results are archived before a fresh attempt, so an older success cannot stand in for a failed new check.
- Passwords never leave the containers: the tools run inside them with the container's own `MYSQL_ROOT_PASSWORD`.
- On the owner's server it only reads, with one consistent dump. It never touches 3306. Zero cost and local only (ADR-030): no cloud
  storage.
- Runbook: `docs/runbooks/BACKUP_RESTORE.md`. Real restore steps need the owner's approval.

## Not in part 1
- A schedule (a Windows scheduled task is persistent configuration: the owner decides).
- Keeping only the last N backups.
- Point-in-time restore from the binary log.
- A timed disaster drill.

## Evidence
- First backup 2026-11-07 14:37 UTC: 96.8 MB dump, 140 tables; storage 88,018 files (manifest only).
- Verify: see `verify.json` in that backup folder.
  - The initial restore filled the test server's 2 GB tmpfs and stalled; the developer (Claude) stopped it and reset that server. A temporary disk-backed server replaces that approach (owner approved, 2026-11-07).
  - The result is recorded in `docs/handover/HANDOVER_CURRENT.md`.

## Verification follow-up tests (Codex, 2026-11-07)
- Five focused Python regression checks passed: network/storage isolation, failure cleanup, preserving mounted data when container removal fails, capacity refusal before creation, row mismatch and result publication ordering.
- Real Docker smoke checks passed on synthetic SQL: valid rows restore and match, invalid SQL fails; both temporary servers and their data are removed. The failure path publishes no success result.
- Contracts build and API/web TypeScript checks passed. Full suites passed: API 250 tests, web 203 tests.
- Full backup `20261107T143717Z`: **OK** — 140 tables, 4,066,306 rows, 2 routines, and 32 triggers restored; no row-count mismatches. `verify.json` records success and both cleanup flags. An independent Docker/filesystem check confirmed no verifier container or temporary data remained. This is a database restore check; the storage backup is manifest-only.
- No app/UI code changed in this backup-tool correction; no live redeploy was performed.
