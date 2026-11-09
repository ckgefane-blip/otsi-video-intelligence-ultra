# Runbook: Production Deployment, Hardening, and Rollback (D.9, ADR-116)

Step-by-step procedures for safely deploying, upgrading, hardening, and rolling back OTSI VIE v2 on this machine.
All operations maintain zero external hosting costs (ADR-030) and preserve local data integrity.

---

## 1. Pre-Deployment Verification

Before applying any code upgrades or starting services for clients:

```powershell
# 1. Run automated preflight deployment checks
.venv\Scripts\python.exe otsi-vie\tools\deploy\production_check.py --port 3508 --strict
```

The preflight check verifies:
- **CONFIG:** Python >= 3.10, Node.js >= 20, and LGPL FFmpeg binary (ADR-029).
- **SECRETS:** Cryptographic entropy for `MEDIA_SIGNING_KEY` and `CREDENTIAL_KEY` (>= 256 bits), restricted file permissions on `.local/stack/owner/secrets.env` and `.local/mysql-owner.env`, and zero unsealed tokens in `provider_connections`.
- **TUNNEL:** Cloudflare tunnel `9094b990-6c92-46e9-b9fa-31692841b062` ingress rules strictly bound to `127.0.0.1:4310` with `http_status:404` catch-all.
- **DATABASE:** Migration checksum integrity across all 63 schema migrations matching files on disk in `otsi-vie/services/db/migrations/`, and least-privilege scoping on `otsi_app_*`.
- **STORAGE:** Storage directories exist, disk space >= 10 GB free, and latest backup verified `OK`.

If any check reports `FAIL`, abort deployment and resolve remediation before proceeding.

---

## 2. Pre-Deployment Backup Snapshot

Always capture a consistent database snapshot checkpoint before applying upgrades:

```powershell
# Create instant pre-deployment backup checkpoint
.venv\Scripts\python.exe otsi-vie\tools\db/backup.py backup
```

Record the generated timestamp ID (e.g. `20261109T085519Z`) as your **Rollback Checkpoint ID**.

---

## 3. Safe Upgrade Sequence

1. **Verify In-Flight Jobs are Idle:**
   Ensure no active uploads or rendering jobs are in progress:
   ```sql
   SELECT state, count(*) FROM worker_jobs WHERE state = 'CLAIMED' GROUP BY state;
   SELECT status, count(*) FROM upload_sessions WHERE status = 'UPLOADING' GROUP BY status;
   ```
   Wait for active jobs to complete (or reach terminal status).

2. **Stop the Running Stack:**
   Stop the running `local_stack.py` background task (Ctrl+C or manage_task kill).

3. **Compile Production Builds:**
   ```powershell
   $env:COREPACK_HOME = "D:\OTSI-Workspace\VIE-Engine-v2\.local\tmp\corepack"
   # Build contracts, API, and Next.js web application
   & "C:\Program Files\nodejs\corepack.cmd" pnpm@9.15.4 --dir otsi-vie/packages/contracts build
   & "C:\Program Files\nodejs\corepack.cmd" pnpm@9.15.4 --dir otsi-vie/apps/api build
   cd otsi-vie/apps/web
   & "C:\Program Files\nodejs\corepack.cmd" pnpm@9.15.4 build
   cd ../../..
   ```

4. **Start the Stack with Fresh Build:**
   ```powershell
   .venv\Scripts\python.exe otsi-vie\tools\dev\local_stack.py run --no-build --public-origin https://vie.otsi.cc
   ```

5. **Post-Deployment Health Probe:**
   Verify both local and public tunnel routes return HTTP 200:
   ```powershell
   curl.exe -I -s http://127.0.0.1:4310/login
   curl.exe -I -s https://vie.otsi.cc/login
   ```

---

## 4. Instant Rollback Procedure

If a deployed build exhibits regressions, runtime errors, or health degradations:

1. **Stop the Process Stack:**
   Terminate the running `local_stack.py` instance.

2. **Roll Back Database Schema (if migration failed):**
   If a newly applied migration caused issues:
   - Identify the failed migration version number (e.g., `0064`).
   - Run the corresponding rollback SQL script against port 3508.
   - Delete the migration version entry from `schema_migrations`:
     ```sql
     DELETE FROM schema_migrations WHERE version = '0064';
     ```

3. **Emergency Database Snapshot Restore:**
   If database state corruption occurred:
   - Use the backup checkpoint recorded in Step 2:
     ```powershell
     # Decompress backup dump
     gzip -d -k .local/backups/<CHECKPOINT_ID>/db.sql.gz
     # Import into otsi_owner_vie (read password from mysql-owner.env)
     # Restore database from checkpoint dump
     ```

4. **Restore Previous Git Revision:**
   ```powershell
   git checkout <LAST_KNOWN_STABLE_COMMIT>
   ```

5. **Rebuild & Restart:**
   Rebuild using the stable revision and restart `local_stack.py`. Verify `https://vie.otsi.cc` answers HTTP 200.
