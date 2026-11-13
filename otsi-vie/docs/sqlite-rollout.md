# SQLite rollout plan (safeguard 7)

Owner approval: SQLite on user PCs is **approved** (owner, written approval,
2026-11-11; ADR-144 §1.2). The portable MySQL bundle stays in the installer
and stays working until the conversion passes **all eight** safeguards in
the distribution plan §1d — it is removed only then, never before.

## Where the switch lives

- The desktop app uses SQLite by default: `OTSI_VIE_DB_BACKEND` unset (or
  `sqlite`) → local file `<data>/db/otsi-vie.sqlite` (`D:\OTSI-VIE\db\`
  when a D: drive exists — the same rule the data folder already uses).
- `OTSI_VIE_DB_BACKEND=mysql` selects the portable-MySQL path, unchanged.
  That flag is the rollback switch at every stage below, and the only
  switch: no code is deleted, no database is converted in place.
- The API reads the same flag plus `OTSI_VIE_DB_DSN`
  (`sqlite:///<absolute path>` for SQLite, `mysql://...` for MySQL).
  The one-database-layer adapter (agent A) must honour both.

## Gate: the switch stays off until SQLite passes all eight safeguards

Do not start stage 1 until every line below is checked and recorded in
`docs/IMPLEMENTATION_STATUS.md` (plan §1d.8). "Passes" means the evidence
exists, not that someone believes it.

| # | Safeguard | Evidence (where it lives) |
|---|-----------|---------------------------|
| 1 | One database layer | Adapter with MySQL + SQLite backends; no raw SQL scattered through modules (agent A) |
| 2 | Every test runs on both databases | API/integration/migration suite green twice; a SQLite-only failure blocks release (agents A + C) |
| 3 | Known differences handled explicitly, each with a test | `database/sqlite-schema-mapping.md` + `database/sqlite-column-collations.csv`; tests in `otsi-vie/tools/db/test_sqlite_migration.py` (this agent) |
| 4 | Three workers writing at once | WAL mode + busy timeout + short transactions; ingest, media and analysis workers on a real match with zero "database is locked" (agent C) |
| 5 | Same results on both | Same sample match processed on the MySQL build and the SQLite build; tracks, events, identities, reel and render outputs match, comparison recorded (agent C) |
| 6 | Users' data is protected | Automatic backup before every migration, restore tested, forward-only transactional migrations (`otsi-vie/tools/db/test_sqlite_migration.py`: backup manifest matches; failing migration restores byte-identical) |
| 7 | Staged switch | This document; MySQL path kept working until the end |
| 8 | Evidence | ADR-144 + `docs/IMPLEMENTATION_STATUS.md` record each check with its command and result |

## Stage 1 — the owner's own PC

**Entry criteria:** all eight safeguards checked above; the distribution
build (installer) is built from a commit that includes the SQLite
conversion; the owner has the installer.

**What the build/test session (Claude Code, on the owner's PC) runs,
in order — one step at a time, reporting what each step prints:**

1. Install the new build (SQLite is the default; nothing to configure).
   Confirm the app opens and the owner form / sign-in appears.
2. Confirm the SQLite file exists: `D:\OTSI-VIE\db\otsi-vie.sqlite`
   (or `<data>\db\otsi-vie.sqlite` when there is no D: drive).
3. Run the database checks from the installed tools (or ask Muse for the
   exact commands for the install layout):
   `migrate status` against the SQLite file — expect all 74 migrations
   `applied`, none pending.
4. Create the owner account, upload the Nart v Ercakhu test video (the
   file, not the YouTube link — paste-link refuses YouTube), and run a
   full analysis end to end: ingest → analysis → tracks → identity →
   reel → render → export. Every step must complete; the reel must play.
5. Check the Player Profile Intro shows the tracked player's real data
   (or "Not measured" where nothing was measured) — never invented stats.
6. Check the token wallet: 100 free tokens on signup, analysis charges
   1 token per minute, a reel render charges 10.
7. Leave the app running and re-open it: the same data must be there,
   no migration re-runs, no backup folder growing on every launch
   (a backup is taken only when a migration is pending).
8. Deliberately prove the backup: copy `D:\OTSI-VIE\db\` aside, then
   delete nothing — the point is that `<data>\db\.backups\<UTC time>\`
   holds a `manifest.json` whose SHA-256 matches the database file
   (Muse can verify the hashes from the backup folder).

**Exit criteria:** the full end-to-end run in step 4 completes; steps
2–3, 5–8 all check out; no "database is locked" error anywhere in the
backend log (`%APPDATA%\OTSI VIE\backend.log`).

**Rollback:** stop the app, delete `D:\OTSI-VIE\db\otsi-vie.sqlite*`
(the `-wal` and `-shm` files too), set `OTSI_VIE_DB_BACKEND=mysql`,
start the app again. The app rebuilds its local data on portable MySQL
(a fresh local database — videos already uploaded stay as files under
`D:\OTSI-VIE` and can be re-imported; nothing on the live server is
touched). Report the failure to Muse with the backend log before
retrying.

## Stage 2 — a few beta users

**Entry criteria:** stage 1 exited cleanly; the owner names the beta
users (2–3 coaches or analysts, ideally one on a machine without a D:
drive, so the fallback data folder is exercised).

**What is tested:** each beta user installs, signs in, uploads their own
match, analyses it, builds a reel and exports it. They report: install
time, first analysis time, any error message (exact words), and whether
the app ever felt stuck. Muse collects the backend log from any failure.

**Rollback:** per machine, exactly as stage 1 (delete the SQLite files,
set `OTSI_VIE_DB_BACKEND=mysql`). A beta user who rolls back keeps using
the app on MySQL while the SQLite issue is fixed; their uploaded videos
are files on disk and are not lost.

## Stage 3 — everyone

**Entry criteria:** stage 2 ran at least one full week with no
SQLite-attributed failure, and safeguards 4 and 5 were re-run on the
release build (not an earlier one).

**What is tested:** the release goes out with SQLite as the default for
new installs. Existing MySQL installs are NOT converted automatically:
an existing install keeps its backend until the owner enables the
one-time migration (a separate, explicitly approved step — converting a
live local database is a data migration, not a flag flip, and it needs
its own plan, backup, and verification).

**Rollback:** per machine, as stage 1. If a systemic SQLite problem
appears after stage 3, the release is pulled and the installer reverts
to the MySQL default (`OTSI_VIE_DB_BACKEND=mysql`); per-machine rollback
still applies.

## What this rollout does NOT do

- It does not convert an existing portable-MySQL database to SQLite.
  There is no in-place converter in this delivery; a user who wants
  SQLite starts with a fresh local database (their videos are files and
  re-import cleanly).
- It does not remove `portable_mysql.py`, the MySQL ZIP handling, or the
  MySQL migration path. Those stay until all eight safeguards pass and
  the owner approves the removal in writing.
- It does not happen on this VM. The rollout happens on the owner's
  machine (and then beta machines) — this document is the plan, not the
  execution.

## Packaging follow-ups for the build session (not done here)

- The installer must ship `otsi-vie/database/` (the MySQL migrations,
  `database/migrations-sqlite/`, and `database/sqlite-bootstrap.sql`)
  under `engine/otsi-vie/database/`, so the compiled `migrate` binary
  finds them the way `tools/db/migrate.py` finds them in the repo.
  `electron-builder.yml` currently lists no `database/` resource — the
  build session must add it and verify the packaged `migrate up` works.
- The `ensureToolBinaries` check still requires every compiled tool,
  including `mysql-supervisor` and `roles`, even in SQLite mode. That is
  deliberate while MySQL is still bundled; relax it only when the MySQL
  bundle is removed.
- Windows paths: the SQLite DSN is `sqlite:///D:/OTSI-VIE/db/otsi-vie.sqlite`
  (forward slashes). `migrate.py` accepts that form and the
  `sqlite:////D:/...` form; verify the packaged run on Windows, since
  this VM cannot run the installer.
