# Runbook: back up and restore OTSI VIE v2 (D.5 part 1, ADR-101)

Everything stays on this PC under `VIE-Engine-v2\.local\backups` on D:. This costs nothing and uses no cloud. Passwords stay inside the
database containers.

## Back up (run from `VIE-Engine-v2`, with TEMP and TMP under `D:\OTSI-Workspace\VIE-Engine-v2\.local\tmp`)
```
.venv/Scripts/python.exe otsi-vie/tools/db/backup.py backup                 # database dump + storage manifest
.venv/Scripts/python.exe otsi-vie/tools/db/backup.py backup --with-storage  # also copy media (unchanged files hard-linked)
```
- The database is dumped as a consistent snapshot while the app runs (`--single-transaction`; tables are InnoDB). Routines, triggers
  and events are included.
- Each backup folder holds:
  - `db.sql.gz`;
  - `manifest.json` (row count of every table, storage totals);
  - `storage-files.json` (every media file: path, size, time);
  - `storage/` when copied.
- A copy on another disk is the owner's choice: copy the whole folder. It is not done automatically.

## Prove a backup restores
```
.venv/Scripts/python.exe otsi-vie/tools/db/backup.py verify [<backup folder>]   # default: the newest
```
1. It creates a unique temporary MySQL container from the project's pinned local image (no image download). It reads the existing `.local/mysql-lint.env` through Docker without printing it.
2. It uses disk-backed data under `.local/restore-checks/verify-*` on D:, not the test server's 2 GB in-memory disk. At least 8 GiB free is required before starting; this is a minimum guard, not a size estimate for every backup.
3. The container has `--network none`, no published port, and no connection to either existing server. Neither port 3507 nor 3306 is used.
4. It restores into the fresh `otsi_restore_check`, compares every table's row count with the manifest, and counts restored routines and triggers.
5. On success or failure, it removes its own container before deleting its unique temporary directory. If removing the container fails, it retains the data and reports the path; never delete mounted data while a server may still own it.
6. Only after successful cleanup does it write `verify.json` with tables, rows, routines, triggers, mismatches, ok, and cleanup flags. A mismatch returns exit 1. A prior result is retained as `verify.previous-*.json` so it is not confused with the current attempt.

Allow time for the full restore (player-position data can occupy several GB). Do not run verification on the shared test server. A normal Python exception or Ctrl+C enters cleanup; a forced process kill or machine crash may leave a labelled `otsi.vie.purpose=backup-verify` container and its D: directory. Confirm its ownership before manual cleanup. No schedule or persistent system configuration is added.

A backup that has not been verified does not count as a backup.

## Restore for real (disaster)
The owner must approve this first: it replaces live data.
1. Stop the stack (no running jobs or uploads).
2. Restore into a **new** database and check it before switching, e.g.
   `gunzip -c db.sql.gz | docker exec -i otsi-vie-v2-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot'`.
   The dump recreates `otsi_owner_vie` itself, so only run this against an empty server or after renaming the old database.
3. Copy `storage/` back to `.local/stack/owner/storage`. Check it against `storage-files.json`.
4. Start the stack and check pages through vie.otsi.cc.

## Not done yet (D.5 part 2)
- A schedule. A Windows scheduled task is persistent configuration: it needs the owner's yes.
- Keeping only the last N backups.
- A point-in-time restore from the binary log.
- A timed full disaster drill.
