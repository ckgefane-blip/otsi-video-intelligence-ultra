# ADR-113: Database Backups, Isolated Verification Drills, and Disaster Recovery

- **Status:** Accepted
- **Date:** 2026-11-09
- **Phase:** v3 Phase D.5: Backups and Disaster Recovery
- **Migration:** None (Operational infrastructure, tooling & administrative monitoring)

## Context

Production deployments of OTSI VIE v2 store critical business assets across relational data (`otsi_owner_vie` with 146+ tables and >4M rows), media files, and computer vision tracking manifests. Unverified backups create a false sense of security; an enterprise disaster recovery architecture requires:
1. **Consistent Snapshots:** Transactionally consistent dumps of the database (`--single-transaction`, `--routines`, `--triggers`, `--events`, `--hex-blob`) along with file manifests.
2. **Automated Verification Drills:** Proving that backups actually restore cleanly without risking production or staging databases.
3. **Keep-Last-N Retention:** Automatically pruning stale backup snapshots to prevent storage exhaustion on disk (`--keep-last`).
4. **Administrative Introspection:** Surfacing disaster recovery status, verified snapshot history, and drill metrics to organization administrators in the Admin Console.

## Decision

1. **Backup Tooling Enhancements (`tools/db/backup.py`):**
   - **`backup` with retention:** Added `--keep-last N` (default 7) to automatically clean up older backup archives following a successful dump.
   - **`list` command:** Introspects `.local/backups/`, displaying timestamps, table counts, total row counts, dump size, and verification outcomes. Supports `--json` formatting.
   - **`verify` command:** Spins up a temporary, isolated, disk-backed MySQL 8.4 container on `D:`, restores the database dump, compares post-restore table counts, routines, and triggers against the live manifest, records evidence in `verify.json`, and completely destroys the temporary container and its data directory.

2. **Contracts (`packages/contracts/src/admin.ts`):**
   - Defined `AdminBackupRecord`: `id`, `timestamp`, `db_bytes`, `tables`, `rows`, `storage_files`, `storage_bytes`, `verified`, `verified_at`, `verification_ok`.
   - Defined `AdminBackupsStatus`: `backups`, `latest_backup_at`, `latest_verified_at`, `healthy`.
   - Built and exported through `@otsi-vie/contracts`.

3. **Backend API (`apps/api/src/modules/admin/admin.ts`):**
   - Added endpoint `GET /v1/admin/backups` guarded by `@Roles("OWNER", "ADMIN")`.
   - Introspects local backup manifests and verification records, computing overall disaster recovery health.
   - Integration tests added in `apps/api/test/admin.api.test.ts`.

4. **Web UI (`apps/web/src/components/admin/AdminConsole.tsx`):**
   - Integrated the **Database Backups & Disaster Recovery** card into the `Retention & Privacy` tab.
   - Displays real-time health indicator (`Backups Healthy & Verified`), latest backup and drill timestamps, and an inventory table detailing snapshot sizes, table/row counts, and zero-mismatch verification badges.

5. **Verification & Testing:**
   - Executed live backup snapshot (`20261109T085519Z`): 96.8 MB compressed dump, 146 tables, 4,066,468 rows.
   - Executed isolated verification drill: restored cleanly with 146 tables, 4,066,468 rows, 2 routines, 32 triggers, and 0 mismatches.
   - API test suite passed (7/7 in `test/admin.api.test.ts`).
   - Web test suite passed (4/4 in `test/adminConsole.test.tsx`).

## Consequences

- Full assurance of recoverable disaster recovery state without exposing database credentials or touching the active production stack.
- Continuous visibility into backup recency and verification integrity directly within the Admin Console.
