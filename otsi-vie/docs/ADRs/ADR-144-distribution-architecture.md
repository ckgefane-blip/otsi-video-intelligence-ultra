# ADR-144: Distribution architecture — a self-contained desktop app plus a small central server (DRAFT, owner approval pending, ultra-only)

- **Status:** Draft. This ADR records the distribution build on `muse/ultra-main` (the plan at
  `otsi-vie/docs/ULTRA_DISTRIBUTION_PLAN.md`, pasted as written by the owner on 2026-11-11, now at v3); it needs
  owner approval before it is presented as accepted. It changes no accepted ADR. **Ultra-only:** 144 is the next free
  number in ultra (ultra is at ADR-143 after passkeys). The build is written from the owner's plan and the existing
  ultra code alone — no Antigravity code was read or copied — and the two repos must never be merged (see the
  migration collision note in ADR-143 §1).
- **Date:** 2026-11-11 (Muse, `muse/ultra-main`); revised to plan v3 the same day.
- **Scope:** The owner decided (2026-11-11) that the software is to be made like DaVinci Resolve and the other
  desktop apps: one self-contained installer with everything inside, video work on the user's own PC, and accounts,
  sign-in, passkeys, licences, billing and updates on a small central server on his existing hosting. The current
  desktop app is a developer setup inside a window (it clones the repo with git and runs `pnpm install` plus a full
  build on the user's PC, keeps accounts and data only in a local MySQL on one PC, ties passkeys to `localhost`,
  and copies AI models from the developer's workspace) and cannot ship to customers. This ADR is the build order
  for replacing it. The central server's deployment (subdomain, database, any public deploy) is owner-only per
  CLAUDE.md §5 — this build writes the server code and configuration, it does not deploy anything.

## 1. Decisions

### 1.1 The installer ships pre-built code, never source — target ~500–650 MB (~750–900 MB with portable MySQL)

- The installer contains the **built** engine: the API (built, plus its production dependencies), the web app as a
  Next.js standalone server (`.next/standalone`, which needs `output: 'standalone'` in `apps/web/next.config`), the
  contracts build, the Python worker source compiled to native code (§1.8), the database migrations, and the desktop
  shell. The source tree is not shipped and no git repository is created on the user's PC.
- The app **never** runs `git`, `pnpm install`, or a build on the user's PC. The desktop shell's old flow
  (`ensureRepo`, `ensureJsDeps`, `ensureBuilds` in `apps/desktop/backend.js`) is removed and replaced by: locate
  the bundled engine inside the app's resources, start the pre-built API and web with a bundled Node runtime
  (Electron's own Node, or a bundled `node.exe`), start the bundled local database, start the bundled native
  worker. If a bundled component is missing or corrupt, the app says so plainly and stops — it never tries to
  download source or build anything.
- The workspace installs with **`node-linker=hoisted`** (`otsi-vie/.npmrc`): a real flat `node_modules`, no
  symlinks. The pnpm default (symlinked) layout breaks the Windows build two ways: the Next.js standalone
  build creates symlinks in `.next/standalone`, which Windows refuses without Developer Mode (EPERM), and
  electron-builder drops the transitive dependencies that exist only inside `.pnpm/` when it copies the
  standalone tree as extraResources, so the packaged web server would die with `Cannot find module` at
  runtime. Hoisted fixes both, and Developer Mode is not needed for the build. (Audit, 2026-11-11.)
- **Installer size, target ~500–650 MB without the portable-MySQL bundle, ~750–900 MB with it** (plan v3; the v2 estimate of ~1.0–1.3 GB is superseded). Rough component
  sizes, not a measurement: Electron runtime ~150 MB, pre-built web ~50–80 MB, pre-built API plus production
  dependencies ~100–120 MB, the single AI runtime (ONNX Runtime + DirectML + OpenVINO, §1.2) ~100–150 MB, the
  Nuitka-compiled engine ~30–60 MB, the core model pack ~50–100 MB — 480–660 MB in total, so the old ~300–400 MB
  target does not match the component math. The web figure is overstated: the built web output measures ~11 MB
  (.next 6.7 MB + static 4.6 MB, excluding the standalone tree's node_modules and public/ assets). The first real
  installer build must record the actual size. **SQLite is APPROVED (owner, 2026-11-11 — see §1.2), but the
  portable-MySQL bundle (+249 MB) stays in the installer until the staged rollout reaches the owner's PC (§1.2),
  so the ~750–900 MB figure applies until then;** the ~550–650 MB figure was the old fallback estimate, not the
  current size.
- Heavier model packs and future language packs are **not** in the installer: they install from inside the app via
  a component manager (chosen by the user, resumable, SHA-256 checked, signed manifest).

### 1.2 One AI runtime, one local database, a hardware check

- **Ship one AI runtime, not Torch/Paddle.** PyTorch and PaddlePaddle are training frameworks; they are not shipped
  to users. Every model is exported **once, at build time**, to ONNX (and OpenVINO IR). Inference on the user's PC
  runs on **ONNX Runtime + DirectML** (free, MIT) — any Windows GPU (NVIDIA, AMD, Intel) — plus the **OpenVINO**
  runtime for Intel CPUs and GPUs. CPU stays as the fallback. This cuts the ~450 MB Python AI bundle to roughly
  100–150 MB and makes analysis faster on more PCs.
- **Gate: the exported models must match the originals' accuracy on the evaluation set before switching.** The
  numbers are recorded (which model, which eval set, the original metric, the exported metric) before any switch.
  Until the gate passes, the Torch/Paddle path stays.
- **Local database: SQLite** for each user's on-PC project data — the standard for desktop creative apps.
  **MySQL stays on the central server** (accounts, licences, billing, audit). This saves ~280 MB and avoids the
  Oracle commercial terms that embedding/distributing MySQL would need (the licence register,
  `docs/legal/LICENSE_REGISTER.md`, says exactly that: MySQL 8.4 Community is GPL-2.0, cleared for network use,
  and "distributing a modified server, or embedding it, would need Oracle commercial terms — not planned").
- **SQLite APPROVED by the owner, 2026-11-11 (written approval, in chat):** the project rule says MySQL, so this
  needed the owner's written approval — now given. Reasons: the licence register says shipping MySQL inside the
  app needs Oracle's commercial terms (a legal risk carried into every sale), SQLite is public domain (nothing to
  license or pay), it makes the installer ~250 MB smaller (~500–650 MB instead of ~750–900 MB), it is how
  professional desktop apps store each user's own project data, and MySQL stays on the central server for
  accounts, licences, billing and payments either way. The conversion risk is controlled by the eight safeguards
  in the plan v4 §1d (one database layer; every test on both databases; known differences handled explicitly with
  tests; three workers writing at once with no "database is locked" allowed; same results on both; automatic
  backup before every update/migration; staged switch — MySQL keeps working until SQLite passes all, then the
  owner's PC, then beta users, then everyone; written proof in this ADR + `docs/IMPLEMENTATION_STATUS.md`). The
  portable MySQL bundle is removed once the SQLite conversion passes all eight safeguards.
- **SQLite conversion — status 2026-11-11 (built, host verification pending).** The conversion is built in the ultra repo (uncommitted at the time of writing; the coordinator verifies and the parent commits). The eight safeguards from plan v4 §1d, with evidence:
  1. **One database layer — BUILT.** The API `Db` interface (`rows`/`one`/`tx`/`retryTransient`) is unchanged; behind it a MySQL backend (mysql2, unchanged) and a new SQLite backend (`node:sqlite`, WAL, `foreign_keys=ON`, `busy_timeout=5000`, `BEGIN IMMEDIATE`, nested-tx guard). The Python worker `db.py` has the same shape (SQLite: WAL, FK on, `busy_timeout=30000`, `synchronous=NORMAL`). The canonical allocator's two stored procedures are reimplemented in TypeScript (`canonical-allocator.ts`) via `db.tx()` on both backends. Roles updated (`tools/db/roles.py`): the runtime account now gets INSERT (+UPDATE on sequences) on the allocator tables and UPDATE on the canonical `players` columns — existing installs must re-run the roles provisioning after this lands, or MySQL allocator calls fail 1142.
  2. **Every test on both databases — WIRED, SQLite half verified here.** The API dialect suite (`test/db.dialect.test.ts`, 62 tests) passes 62/62 on SQLite here; `test/run-dual-db.sh` runs the SQLite half and the MySQL half when `.local/mysql-lint.env` exists (it does not on this VM — the MySQL half is host-only, MySQL 3507). The worker suite runs 35/35 on SQLite here (`run_sqlite_tests.py`). The migration suite runs 16/16 here (`tools/db/test_sqlite_migration.py`). A SQLite-only failure blocks the release (the dual-DB script exits non-zero if a configured backend fails).
  3. **Known differences — HANDLED + TESTED.** 26 dialect rules in `apps/api/src/core/db/dialect.ts` (upsert, `INSERT IGNORE`, now-functions → bound ms params, `DATE_ADD`/`INTERVAL` → ms arithmetic, `IF` → `CASE`, `FIELD` 1-based, JSON1, `TIMESTAMPDIFF` → ms, `DATE_FORMAT` → strftime, `GROUP_CONCAT`, `FOR UPDATE` stripped, `IN (?)` expansion, `LIKE ... ESCAPE`). Dates are integer ms, booleans 0/1, DATE-only columns stay TEXT ISO. Schema: 157 tables, all STRICT, integer-ms datetimes, JSON as TEXT + JSON1, per-column collation decisions recorded (1,494 columns in `sqlite-column-collations.csv`). 34 MySQL triggers → 34 SQLite triggers (same names, exact SIGNAL messages via `RAISE(ABORT)`). Both stored procedures → app code. The retention service needs no trigger bypass (verified: it never deletes from a guarded table; the `players` guard only fires for registered players, and retention never deletes a player row). Known gaps: non-ASCII LIKE case on `display_name` (accepted for now); `analyze.py:364` still has one untranslated `ON DUPLICATE KEY UPDATE` on `video_frame_index` (follow-up).
  4. **Three workers writing at once — TESTED HERE, 0 lock errors.** Load test (`services/worker/load_test_sqlite.py`, real `db.py` functions, separate processes, claim → progress → audit+publish → track/event inserts): 1 writer 199 ops / 0.15 s, 3 writers 1,080 ops / 0.71 s, 5 writers 1,660 ops / 1.17 s, heavy 3-writer 5,400 ops / 8.6 s, heavy on real disk (btrfs) 2,700 ops / 4.97 s — **0 SQLITE_BUSY / "database is locked" in every run**. Negative control (busy_timeout 0) produced 92 lock errors, proving the test detects contention. The real-match load test (ingest + media + analysis workers on a real match) still needs the owner's host.
  5. **Same results on both — HARNESS BUILT, MySQL side host-only.** `services/worker/compare_backends.py` runs a deterministic workload on both backends and diffs the canonical dumps. Selfcheck (SQLite-vs-SQLite) MATCHES; the mutated-dump control correctly DIFFERs with exact rows. The MySQL side was NOT run here (no MySQL server, pymysql not installed) — the harness exits 2 with "MySQL side NOT RUN"; the host command is in its docstring (scratch DB on host MySQL 3507, real SQLite migrations, then diff). A real-match comparison needs the host.
  6. **Users' data protected — BUILT + TESTED.** The migration runner backs up the local database file (copy + WAL, SHA-256 in a manifest) before applying any migration, applies migrations inside a transaction, and on failure restores the backup and reports plainly. Tested (16-test suite): backup exists and matches, a deliberately failing migration leaves the DB byte-identical and the error reported. Desktop wiring: SQLite by default (`<data>/db/otsi-vie.sqlite`, D: when one exists), MySQL path kept working and selectable (`OTSI_VIE_DB_BACKEND`); the portable MySQL bundle is NOT removed yet.
  7. **Staged switch — PLAN WRITTEN, not executed.** `otsi-vie/docs/sqlite-rollout.md`: gate (all eight safeguards) → stage 1 the owner's PC (exact steps Claude Code runs) → stage 2 beta users → stage 3 everyone, with entry criteria and rollback (delete SQLite files, flip the flag back to MySQL) per stage. The rollout happens on the owner's machine, not here.
  8. **Evidence — THIS ADR + `docs/IMPLEMENTATION_STATUS.md`.** Each check above records its command and result. Host-only items (MySQL half of every suite, real-match load test, real-match comparison, desktop app starting with SQLite on Windows, installer build + clean install) are listed as NOT verified here and must be run on the owner's host before the switch.
  - **Open items from the build (for the parent/host):** (a) the `--experimental-sqlite` flag: Node 22.11–22.12 need it as the first arg when spawning the API/outbox; the owner's Node 22.23.2 does not, and the desktop shell does not pass it today — either set the engines floor to >=22.13.0 or add the flag in `backend.js` `spawnChild` for older bundled Node versions; (b) the roles provisioning must be re-run on existing installs after the roles.py change; (c) DONE — `electron-builder.yml` lists a `database/` extraResource shipping `otsi-vie/database/` (`sqlite-bootstrap.sql` + `sqlite_triggers.sql` + `migrations-sqlite/`) under `engine/otsi-vie/database/` (verified 2026-11-11; the MySQL migrations are deliberately not shipped — the desktop never runs them); (d) `analyze.py:364` `ON DUPLICATE KEY UPDATE` is the one remaining untranslated worker MySQL-ism (follow-up, not claimed done).
- **Hardware check at first run.** The app detects the GPU, RAM and disk, picks the fastest runtime automatically
  (DirectML GPU → OpenVINO → CPU), and shows the user the expected speed. It does not fail silently on a weak PC.
- **Mac later.** ONNX Runtime with CoreML runs the same models on Mac. Paths, codecs and the runtime choice are
  designed so a Mac build is possible; no Mac build is attempted now.
- **Data folder:** user-chosen, defaulting to a non-system drive when one exists (`D:\OTSI-VIE` on Windows when a
  D: drive exists, as the current app already does for the venv and pip cache). No caches go on C: unless it is the
  only drive. Videos, tracks, renders, project metadata, the local database, the runtimes, and the AI models all
  live under the data folder.

### 1.3 AI models: exported once, component-managed (encryption not built yet)

- Models are exported to ONNX (and OpenVINO IR) at build time and verified against the SHA-256 pins in
  `services/worker/vie_worker/models/registry.json`. The core model pack ships in the installer; heavier packs
  install from inside the app via the component manager (resumable, SHA-256 checked, signed manifest). Models are
  never copied from the developer's workspace (the old README claim that models are "copied from the original
  workspace's `.local/models`" was wrong and is corrected as part of this build).
- **Model files are NOT encrypted at rest yet.** Encryption at rest (decrypt in memory only with a valid licence)
  is a follow-up to the ONNX export, not built. Each model has
  a checksum. The minimum set for a first analysis is the same as before: detector `rtdetr_v2_r18vd`, embedder
  `dinov2_small`, jersey OCR `ppocr_v4_det` + `ppocr_v4_en_rec`, pitch `pnlcalib_sv_kp`, lineup OCR
  `ppocr_v5_cyrillic_rec` + `ppocr_v5_latin_rec` (deferred: `rtdetr_v2_r50vd`, `dinov2_base`, `siglip_base_224`,
  `omz_text_recognition_0014`; `ball_net` downloads nothing).
- A failed download does not stop the app from opening, but video analysis cannot run until it succeeds — the next
  launch retries.

### 1.4 Central server — the same API, deployed on the owner's hosting

- The central server is the **same API codebase** deployed on the owner's existing hosting (a subdomain plus
  MySQL), not a second codebase. It holds accounts, sign-in, passkeys, organisations and teams, licences and
  entitlements, the token wallet and seats, billing, and the audit log. It never processes video; footage stays on
  the user's PC unless they choose to share an export.
- The server runs in **central mode**: `OTSI_VIE_CENTRAL_MODE=yes`, a real domain as the JWT issuer
  (`OTSI_VIE_JWT_ISSUER=https://<subdomain>/`), secure cookies on, and the WebAuthn RP ID set to the product
  domain (`OTSI_VIE_WEBAUTHN_RP_ID=otsi.cc` or the subdomain — never `localhost`). The desktop app's local engine
  runs in **local mode** (the current behaviour) and verifies licence tokens issued by the central server (§1.5).
  MySQL stays on the central server (§1.2).
- What this build writes: the central-mode configuration, the licence module, the bank-transfer billing module,
  and a deploy checklist document. What it does **not** do: create the subdomain, the database, or any public
  deploy — those are owner-only steps (CLAUDE.md §5), and the checklist says so explicitly.

### 1.5 Sign-in, passkeys and the licence (Ed25519, checked in native code)

- The desktop app signs in against the **central server** (in-app sign-in to the server API; the sign-in page is
  served from the real domain so WebAuthn sees it). Passkeys are created against the product domain (RP ID §1.4),
  so a passkey made on one PC signs in with that PC's Windows Hello and is not tied to `localhost`. The local
  engine's `localhost` RP ID (ADR-143) stays for local-only sign-in; it is not the product sign-in.
- After sign-in the central server issues a **server-signed licence token (Ed25519)**:
  `{ organization_id, plan, features, tokens, expires_at }`. The central server holds the Ed25519 signing key
  (`OTSI_VIE_LICENCE_SIGNING_KEY`, central server only, never in the installer); the local engine verifies the
  token with the central server's Ed25519 public key (`OTSI_VIE_LICENCE_PUBLIC_KEY_PEM` or the central JWKS URL
  `OTSI_VIE_CENTRAL_JWKS_URL`). The token is **checked inside the compiled native code** (§1.8), plus tamper
  detection. **Never trust a plain flag.**
- **Offline grace: 14 days.** The app keeps working without internet while the stored licence token is no more
  than 14 days past its expiry (`OTSI_VIE_LICENCE_GRACE_DAYS`, default 14). It re-checks online periodically
  (`POST /v1/licence/refresh`) and whenever it has a connection. After the grace period, analysis stops until the
  app can reach the server again. The grace is a property of the licence, not of the network — a user who never
  goes online gets 14 days, not forever.
- API surface (the contract the desktop shell and the server build to):
  - `GET /v1/licence` (AuthGuard) — the current licence snapshot: organisation, plan, features, token balance,
    `valid_until`, `grace_until`.
  - `POST /v1/licence/refresh` (AuthGuard, refresh cookie) — a fresh signed licence token and its expiry.
  - The local engine accepts a licence token on its own API only when a central public key/JWKS is configured;
    without one it behaves exactly as today (local sign-in only).

### 1.6 Updates — small, differential, and signed

- Versioned releases via `electron-builder` + `electron-updater`, publishing to GitHub Releases (the ultra repo) —
  the update feed is the Releases feed, and the app checks on launch, downloads in the background, and installs on
  quit. Updates are **differential (blockmap)**, so a code update is megabytes, not the whole installer. Database
  migrations for the local database run inside the app on update; they are forward-only and tested (the same
  migration runner as today, `tools/db/migrate.py`).
- **Code signing:** an unsigned app triggers SmartScreen and looks amateur. **Microsoft Store (MSIX) is the
  evaluated route, where Microsoft signs the package.** The fee is **unconfirmed — sources conflict, and the
  primary source could not be re-checked from here.** Two web searches (2026-11-11) disagree: one found
  Microsoft's current docs saying the new onboarding flow at storedeveloper.microsoft.com has no registration fee
  for either account type, with later secondary sources claiming the company fee was also waived (May 2026); a
  second check against Microsoft's own Learn page found the free flow is for **individual developers only** and
  **company accounts still pay a one-time $99**. The honest recording is: **individual $0 (confirmed); company
  either $0 or $99 one-time (unconfirmed — re-verify at registration time).** A company account needs business
  verification (D-U-N-S number or official business documents) and a work email on the company domain either way;
  the owner is a company (Osio & Tee Solutions International Ltd), so a company account is the right type.
  Microsoft takes 15% on sales through Microsoft Commerce for apps, but non-game apps using their own payment
  system keep 100% — OTSI uses bank transfer (§1.7), so no commerce cut. If paid signing is ever needed instead,
  the cost is flagged for owner approval (zero-cost rule).

### 1.7 Payments — bank transfer is the main method; online is "Coming soon"

- **Bank transfer (build now), on top of the token wallet (ADR-140).** The wallet already has the pack flow
  (`wallet_pack_requests`: REQUESTED → INVOICED → PAID, owner issues the invoice, owner confirms receipt, only then
  a PURCHASE ledger row is written with the invoice reference). This build adds the missing pieces for **plans**:
  - `bank_accounts` — bank details entered by the owner in the admin console, one per currency (NGN, USD), never
    hard-coded, never in the repo.
  - `bank_transfer_orders` — a plan order with a unique reference generated by the server
    (`OTSI-INV-2026-000123`: year + a per-year sequence, never reused), amount, currency, the bank account used,
    status (`ORDERED` → `AWAITING_CONFIRMATION` → `CONFIRMED` | `REJECTED`, plus `REFUNDED` and `PARTIAL` for a
    part-payment), an optional uploaded receipt (PDF or image), and who confirmed it and when.
  - **Confirmation** is by the owner or an admin with the billing role, after checking the bank statement (amount
    received, date, bank reference). Only confirmation activates the plan: entitlement grants (the existing
    `entitlement_grants` table), the subscription row (the existing `subscriptions` table), and the token wallet
    top-up (a PURCHASE ledger row with the invoice reference, via the wallet service's `credit()`). A rejection
    carries a reason; a partial payment is recorded as such and does not activate.
  - **Renewals:** a renewal invoice with a new reference is created 7 days before expiry; after expiry a grace
    period, then the plan drops to the free tier. Projects are kept and never deleted.
  - **Audit:** every order and status change is a row in the audit log (`recordChange`, the same writer as
    ADR-140) — created, proof uploaded, confirmed by whom, amount, rejected, refunded. **Nothing activates
    without a human confirmation.**
  - Currencies: NGN for local payers, USD for foreign payers; the owner sets which bank account applies to each.
    Zero cost: no provider and no fees beyond the owner's own bank charges.
- **Online payment — "Coming soon" (design only, build later).** The plan page shows "Pay online — Coming soon":
  disabled, with no checkout code active. It must never charge or collect card data. Later: a provider with no
  monthly fee (per-sale fee only), preferably a merchant of record (Paddle or Lemon Squeezy). The owner's company
  is registered in **Nigeria** (private company limited by shares); the two candidates named in the plan are
  Paystack (USD payouts need a Zenith Bank USD domiciliary account; confirm USD recurring billing works) and
  Paddle (confirm Nigeria is accepted for sales and payouts). The provider sits behind one billing adapter so it
  can be swapped. Real billing activation needs the owner's explicit approval.
- Migration **0075** is the bank-transfer billing migration (`bank_accounts` + `bank_transfer_orders` + the
  reference sequence). It is the next number free in ultra (ultra is at 0074).

### 1.8 Native and protected — no readable source on user PCs

- **Engine (Python): compiled to native machine code with Nuitka** (free, Apache-2.0) before packaging, so no
  `.py` files ship. Speed-critical parts (tracking, spotlight compositing) move to C++ or Rust over time. The
  Nuitka build must not ship any GPL component: the installer excludes `av` (PyAV — its bundled FFmpeg is GPL-3.0;
  it is a developer-tool-only dependency, never distributed) and any other GPL code. The OTSI LGPL FFmpeg build
  needs its E3 legal review before any distribution (licence register).
- **AI inference:** ONNX Runtime and OpenVINO are native C++ already (§1.2).
- **API and UI (JavaScript):** bundled and minified, the main-process code compiled to V8 bytecode (bytenode,
  free), Electron fuses enabled (disable `RunAsNode` and the Node inspector, ASAR integrity on), everything packed
  in an integrity-checked ASAR.
- **Shell:** Electron for now (fastest path). A later move to a native shell (Qt/C++, as DaVinci uses, or
  Tauri/Rust with WebView2) is recorded as a separate ADR with a cost and effort estimate — **do not switch
  without owner approval**.
- **Clean ownership:** `docs/legal/LICENSE_REGISTER.md` is kept current. **Ship nothing AGPL or GPL** (owner
  decision 2026-10-26; Ultralytics YOLO is AGPL-3.0 and BLOCKED; libx264 is GPL-2.0 and BLOCKED inside a
  distributed product). Third-party notices (MIT/Apache attributions) ship in the app's About → Licences. A
  proprietary EULA goes in the installer, plus the copyright notice **"© Osio & Tee Solutions International Ltd"**
  in the app, the files and the exports. Every contributor (people and AI-assisted work) assigns rights to the
  company in writing (owner to arrange).
- **Legal protection (owner + counsel; may cost fees, so the owner decides):** copyright is automatic — keep dated
  records (git history, release archives); trademark "OTSI VIE" and the logo, first in Nigeria, then via WIPO
  Madrid for key markets; patent — software patents are hard to get and costly, so counsel assesses whether any
  novel method (e.g. identity-confirmed spotlight tracking) qualifies before any public disclosure, and until then
  those methods stay trade secrets (compiled, private repo, NDAs).

### 1.9 The repo is now private (done 2026-11-11, owner only)

- `ckgefane-blip/otsi-video-intelligence-ultra` was a **PUBLIC** GitHub repo (checked 2026-11-11 via the GitHub API:
  `"visibility": "public"`). The owner made it private himself the same day (~13:22, confirmed via the API:
  `"visibility": "private"`). The write token has Contents only, no Administration permission — the API flip was
  tried and failed with 403 — so this could not be done from here and no workaround was attempted.
- **Consequence the owner already accepted:** the current test app clones/pulls the repo without signing in, so it
  stopped updating once the repo went private, until the new installer (no git on user PCs) replaces it.

### 1.10 Decisions needed from the owner

1. **SQLite (written approval) — APPROVED 2026-11-11:** the owner approved SQLite on user PCs in chat (see §1.2
   for the reasons and the eight safeguards). The portable MySQL bundle is removed once the conversion passes all
   eight safeguards.
2. **Microsoft Store company account:** register at storedeveloper.microsoft.com (new flow, $0 per current docs —
   re-verify at registration); the owner supplies the business verification.
3. **Native shell later:** Qt/C++ or Tauri/Rust — a separate ADR with cost/effort; no switch without approval.
4. **Trademark / patent / EULA text:** owner + counsel; may cost fees.

## 2. Build order (from the plan, v3)

1. This ADR. 2. Self-contained installer (bundled runtimes, pre-built code, Nuitka-compiled engine, no git or build
   on the user PC; ONNX export + accuracy gate first). 3. Model download / component manager plus checksum and
   encryption on first run. 4. Central server (code + config; deploy is owner-only). 5. Desktop sign-in against the
   server, passkeys on the real domain, offline licence grace (Ed25519). 6. Auto-update feed (differential). 7.
   Bank-transfer billing. 8. "Coming soon" online-payment button (disabled). The engine work (player tracking,
   identity, tactics, spotlight reels) is what beats DaVinci on football — the packaging only makes it feel
   professional, so engine work continues alongside the packaging.

## 3. What is not verified here

- The Windows installer cannot be built on this VM (Wine cannot run the 32-bit NSIS installer to create the
  uninstaller; the local Setup.exe is a stub — see the desktop README). The installer build, the Nuitka compile,
  the ONNX export + accuracy gate, the clean-Windows test (a fresh PC with none of git, Node, pnpm or Python), the
  central-server deploy, live sign-in against the real domain, and the real bank-transfer flow all need the owner's
  machine/hosting and are recorded as not-verified, not claimed as done.
- API DB tests and migrations cannot run on this VM (no MySQL server here; they need the owner's host MySQL 3507).
  The billing and licence API tests typecheck here but have not run against a database anywhere.
- The Microsoft Store fee is unconfirmed (individual $0 confirmed; company $0 or $99 one-time — sources conflict,
  see §1.6) — re-verify at registration time.
- Code signing is not in place; SmartScreen will ask on first run until the Store/MSIX route (or paid signing the
  owner approves) is in place.
