# OTSI VIE desktop app (Windows)

A real desktop app for OTSI VIE: its own window, no browser tab — like
Filmora or DaVinci Resolve. The engine's screens (dashboard, analysis,
timeline, reel builder, reports, library, export) run inside the app's
window. The engine itself still runs on this machine, behind the window:
the web app on http://127.0.0.1:4311, the API on 4521, portable MySQL on
3510. These are the desktop app's own ports, so it can run side by side
with the original engine (web 4310, API 4520, MySQL 3508). Nothing opens in
a browser and nothing is uploaded anywhere.

© Osio & Tee Solutions International Ltd

## What it does on launch

1. Checks the bundled engine is complete (pre-built API, web, native
   worker, runtimes, tools). A missing piece stops the app with a plain
   message — it never downloads source or builds anything.
2. Checks this PC (graphics card, memory, free disk) and picks the
   fastest AI runtime automatically: DirectML on the graphics card,
   OpenVINO on Intel hardware, CPU as the fallback. The loading window
   shows what was found and what will be slow.
3. Sets up the database — bundled portable MySQL, no Docker, no download.
4. Downloads the AI models on first run (exported ONNX/OpenVINO models,
   each checked against its SHA-256 pin) into the data folder.
5. First time: a form in the window asks for the owner account
   (email, name, organisation).
6. Checks the licence against the central server when one is configured
   (14-day offline grace; the compiled native engine enforces it).
7. Starts the engine, waits for it to answer, then opens the main window
   on http://127.0.0.1:4311.
8. Closing the main window stops the engine. Updates check on launch,
   download in the background (differential — megabytes, not the whole
   installer) and install on quit.

Progress, errors and the owner form all appear in the window. There is no
console window and no checklist.

## What the installer contains — and what it does not

The installer contains the pre-built engine, never source:

- The built API (`apps/api/dist` + production dependencies) and the web
  app as a Next.js standalone server (`.next/standalone`).
- The Nuitka-compiled native worker (`vie_worker.exe`) and the compiled
  database/model tools. **No `.py` files ship.**
- One AI runtime: ONNX Runtime + DirectML + OpenVINO (~100–150 MB).
  No Torch, no PaddlePaddle — those are training frameworks and are not
  shipped to users.
- The core model pack (exported ONNX/OpenVINO models). Heavier packs
  install from inside the app via the component manager.
- The bundled portable-MySQL ZIP (~249 MB) — bundled, not downloaded at
  runtime. This stays until the SQLite decision is approved (see below).
- The Electron runtime, the desktop shell (main-process code compiled to
  V8 bytecode — no readable source), and the bundled Node runtime.

It does NOT contain git, pnpm, Node.js for the user to install, Python,
or the developer workspace. The AI model files are never copied from any
workspace folder.

**Target size ~300–400 MB.** That assumes the SQLite decision is
approved; with portable MySQL bundled the installer is roughly
~550–650 MB. The first real installer build must record the actual size.

## The data folder

Local data lives in a data folder, not in the install folder: videos,
tracks, renders, project metadata, the local database, the AI models and
the component packs. It defaults to `D:\OTSI-VIE` on Windows when a D:
drive exists, and to the app's user-data folder otherwise. No caches go
on C: unless it is the only drive.

## Local database: portable MySQL until SQLite is approved

SQLite on user PCs is the v3 direction (ADR-144 §1.2) — it saves ~280 MB
and avoids the Oracle commercial terms that embedding/distributing MySQL
would need — but it **needs the owner's written approval**, because the
project rule says MySQL. Until approved, portable MySQL stays bundled:
the ZIP is in the installer, it runs on 127.0.0.1:3510 with its own data
directory under the data folder, and it never stops another program's
database. Do NOT start a SQLite port without that approval.

## AI models: exported once, accuracy gate, component manager

Models are exported **once, at build time**, to ONNX (and OpenVINO IR).
Inference runs on ONNX Runtime + DirectML (any Windows GPU: NVIDIA, AMD,
Intel) plus OpenVINO for Intel CPUs/GPUs, CPU as fallback.

### ONNX accuracy gate (NOT verified here)

The exported models must match the originals' accuracy on the evaluation
set **before** the worker switches to them. Until the gate passes, the
Torch/Paddle path stays. The gate has not been run on this VM (no GPU,
no eval run here). Run it on a Windows machine with a GPU:

```sh
# 1. Detection accuracy, original vs exported, same footage + labels:
python otsi-vie/tools/models/benchmark_detector.py <video> --models rtdetr_v2_r18vd --labels gt.csv
# 2. End-to-end tracking, predictions from each runtime vs the same ground truth:
python otsi-vie/tools/eval/sukhum_benchmark.py --gt <gt.json> --pred <pred-original.json> --out result-original.json
python otsi-vie/tools/eval/sukhum_benchmark.py --gt <gt.json> --pred <pred-exported.json> --out result-exported.json
# Compare MOTA / IDF1 / HOTA and detection precision/recall at IoU >= 0.5;
# record the numbers (model, eval set, original metric, exported metric)
# before switching.
```

The export tooling itself is a named follow-up (not built here): a new
`otsi-vie/tools/models/export_onnx.py` that exports each registry model
to ONNX/OpenVINO IR, adds the exported files to
`otsi-vie/services/worker/vie_worker/models/registry.json` (SHA-256 pins),
and teaches `services/worker/vie_worker/detect/base.py` (+
`detect/ov_rtdetr.py`, which today converts Torch weights to OpenVINO IR
at runtime) to load the exported files instead. The desktop shell's
`ensureModels` already fetches whatever the registry lists, so no shell
change is needed when the exports land. `ball_net` already loads an ONNX
model through OpenVINO (`services/worker/vie_worker/ball_net.py`) — that
is the in-tree precedent.

### Component manager

Heavier model packs and future language packs install from inside the
app (chosen by the user, resumable, SHA-256 checked, signed manifest).
The shell side is `apps/desktop/components.js` (list / verify / download
/ install) with IPC handlers in `main.js` (`components-list`,
`components-install`); the UI that calls them and the server side of the
manifest feed are follow-ups. The manifest format is documented at the
top of `components.js`: version 1, Ed25519 signature over canonical JSON,
public key from `OTSI_VIE_COMPONENTS_PUBLIC_KEY_PEM`. A manifest that does
not verify is refused. The feed URL is `OTSI_VIE_COMPONENTS_MANIFEST_URL`
(unset = no feed).

## Updates — small, differential, signed

Versioned releases via electron-builder + electron-updater, publishing to
GitHub Releases (the ultra repo). The app checks on launch, downloads in
the background and installs on quit. Updates are **differential
(blockmap)**: the NSIS installer is built with
`differentialPackage: store-asar`, so a code update is megabytes, not the
whole installer.

**Signing / Microsoft Store (MSIX).** The app is unsigned for now, so
Windows SmartScreen will ask on first run. The evaluated route is the
Microsoft Store, where Microsoft signs the MSIX package (ADR-144 §1.6).
Checked 2026-11-11: registration is **$0 via the new flow at
storedeveloper.microsoft.com — but the sources conflict on company
accounts**. Microsoft's own Learn page says the free flow is for
individual developers only and company accounts still pay a one-time
$99; later secondary sources say the company fee was also waived (May
2026). **Re-verify at registration time.** A company account needs
business verification (D-U-N-S number or official documents) and a work
email on the company domain; the owner is a company (Osio & Tee
Solutions International Ltd), so a company account is the right type.
Microsoft takes 15% on sales through Microsoft Commerce, but non-game
apps using their own payment system keep 100% — OTSI uses bank transfer,
so no commerce cut. No MSIX build has been started; it needs owner
approval (ADR-144 §1.10 item 2). If paid signing is ever needed instead,
its cost is flagged for owner approval (zero-cost rule).

## Licence (Ed25519, checked in native code)

After sign-in the central server issues a server-signed licence token
(Ed25519): `{ organization_id, plan, features, tokens, expires_at }`.
The shell stores it in the app's userData (`licence.json`, never in the
log) and passes it to the compiled native engine, which verifies it with
the central server's Ed25519 public key and enforces it, plus tamper
detection. **Never trust a plain flag** — the shell's licence status is
display only. Offline grace is 14 days (`OTSI_VIE_LICENCE_GRACE_DAYS`,
default 14); the app re-checks (`POST /v1/licence/refresh`) whenever it
has a connection. After the grace period, analysis stops until the app
can reach the server again.

Note (2026-11-11): the licence module in the tree
(`apps/api/src/modules/licence/licence.ts`) currently signs RS256; ADR-144
v3 §1.5 says Ed25519. The shell treats the token as an opaque string, so
it works with either — the API side must be aligned to Ed25519 before the
first signed release.

## Native and protected — no readable source

- **Engine (Python):** compiled to native machine code with Nuitka (free,
  Apache-2.0) before packaging, so no `.py` files ship. The Nuitka build
  is a Windows build-machine step (see "Building the installer"); it
  cannot run on this VM.
- **AI inference:** ONNX Runtime and OpenVINO are native C++ already.
- **API and UI (JavaScript):** bundled and minified (Next.js production
  build; the API build is minified at packaging time — see below), and
  the main-process code is compiled to V8 bytecode (bytenode). Electron
  fuses are on: RunAsNode off, Node inspector off, ASAR integrity on.
  Everything is packed in an integrity-checked ASAR.
- **Shell:** Electron for now (fastest path). A later move to a native
  shell (Qt/C++ or Tauri/Rust) is a separate ADR with a cost and effort
  estimate — do not switch without owner approval.
- **Model files** are encrypted at rest (plan v3 §1c); the app decrypts
  them in memory only with a valid licence. Each model has a checksum.
  The encryption wiring is a follow-up to the ONNX export.
- **Copyright:** "© Osio & Tee Solutions International Ltd" is in the
  installer config, the loading window, the app, the files and the
  exports. A proprietary EULA for the installer and an About → Licences
  page (third-party notices) still need owner/counsel text — follow-ups
  for the parent, not built here.

## Files

- `main.js` — Electron main process: windows, startup flow, auto-update,
  quit handling.
- `backend.js` — backend management (bundled engine, database, models,
  owner account, start/stop). No Electron dependency, so it can be checked
  and exercised with plain Node.
- `licence.js` — licence storage, refresh (`GET /v1/licence`,
  `POST /v1/licence/refresh`) and the 14-day offline grace (display only;
  enforcement is in native code).
- `hardware.js` — first-run hardware check (GPU, RAM, disk) and the
  runtime pick (DirectML → OpenVINO → CPU).
- `components.js` — component manager: signed manifest, resumable
  download, SHA-256 check, install.
- `mysql-supervisor.py` — portable-MySQL supervisor (Nuitka entry point;
  compiled, never shipped as `.py`).
- `preload.js` — the small safe API the loading window uses.
- `renderer/loading.html` — the loading window: status, update + hardware
  lines, progress, log, owner form, error view.
- `electron-builder.yml` — Windows packaging: NSIS installer + portable
  exe, GitHub Releases feed, differential updates, ASAR integrity.
- `scripts/compile-bytecode.js` — bytenode compile of the main-process
  code (build machine only).
- `scripts/after-pack.js` — Electron fuses (build machine only).
- `assets/icon.ico`, `assets/icon.png` — the app icon, made from
  `apps/web/public/brand/otsi-vie-app-icon-small.png`.

## Build

```sh
cd otsi-vie/apps/desktop
npm install          # Electron + electron-builder (dev machines only)
npm run check        # node --check on the JS files
```

## Building the installer (Windows build machine only)

The NSIS installer cannot be built on the Linux VM (Wine makensis hangs),
and the Nuitka compile cannot run there either. On a Windows machine,
stage first, then build. Staging goes in `otsi-vie/.local/packaging/`
(git-ignored):

1. **Engine builds** (from the repo root):
   `pnpm --filter @otsi-vie/contracts build`,
   `pnpm --filter @otsi-vie/api build`,
   `pnpm --filter @otsi-vie/web build` with
   `OTSI_VIE_API_INTERNAL_URL=http://localhost:4521` (the web build bakes
   the API address into its `/api` proxy — it must be the desktop app's
   API port, 4521, not the original engine's 4520). Monorepo note: the
   standalone server lands at
   `.next/standalone/apps/web/server.js` (not `.next/standalone/server.js`),
   and Next does NOT copy `.next/static` or `public/` into the standalone
   tree — copy them to
   `.next/standalone/apps/web/.next/static` and
   `.next/standalone/apps/web/public` (the `electron-builder.yml`
   `extraResources` entries do exactly that).
2. **API production dependencies:**
   `pnpm --filter @otsi-vie/api deploy --prod .local/packaging/api-deploy`,
   then copy its `node_modules` to `.local/packaging/api-node_modules`.
3. **Nuitka compile** (needs a Windows machine with MSVC + Python):
   compile `services/worker/vie_worker/main.py` → `vie_worker.exe` and
   the tools (`tools/db/migrate.py`, `tools/db/roles.py`,
   `tools/db/db_setup.py`, `tools/dev/portable_mysql.py` via
   `apps/desktop/mysql-supervisor.py`, `tools/models/fetch_models.py`,
   `tools/models/fetch_url_models.py`) → `.local/packaging/native/` with
   the layout in `electron-builder.yml` (`vie_worker.exe` at
   `engine/vie_worker.exe`, tools at `engine/tools/*.exe`). Bundle
   `services/worker/vie_worker/models/registry.json` as a Nuitka data file
   at the relative path the tools expect. Exclude `av` (PyAV — GPL) and
   any other GPL code from the Nuitka build (ADR-144 §1.8).
4. **AI runtimes** into `.local/packaging/runtimes/`:
   `onnxruntime.dll`, `onnxruntime_providers_shared.dll`, `DirectML.dll`,
   `openvino.dll` (+ the OpenVINO plugin DLLs) on Windows.
5. **Bundled Node** into `.local/packaging/node/` (`node.exe`), unless
   Electron's own Node is used.
6. **MySQL ZIP** at `.local/packaging/mysql-8.4.6-winx64.zip`
   (https://cdn.mysql.com/archives/mysql-8.4/mysql-8.4.6-winx64.zip,
   260,772,595 bytes) — the bundle stays until the SQLite conversion
   passes all eight safeguards and the staged rollout reaches the
   owner's PC (ADR-144 §1.2, docs/sqlite-rollout.md); only then is it
   removed. SQLite is approved, but the bundle is still required for
   this build.
7. **Bytecode:** `npm run compile:bytecode` (bytenode, with the same
   Electron version as the packaged app, on the Windows runner —
   bytecode cannot be cross-compiled). If Electron is ever upgraded past
   42, switch the script to `electronMain: true` (see its header).
8. **Build:** `npm run dist:nsis` (or `npm run dist` for both targets).
   The afterPack hook flips the Electron fuses. Record the installer
   size — the ~300–400 MB target assumes SQLite; with MySQL expect
   ~550–650 MB.

The API build is minified at packaging time (esbuild over
`apps/api/dist`); the web is already bundled + minified by the Next.js
production build.

## Limits (honest)

- The app is a shell around the existing engine: it does not change the
  engine's UI or behaviour. The engine is still a web app + API + database
  + workers running on the same machine; the window is how you look at it.
- It is unsigned: Windows SmartScreen will ask before running it the
  first time, until the Store/MSIX route (or paid signing the owner
  approves) is in place.
- It has never been run on Windows from this packaged layout. This VM has
  no Windows, no GPU and no MySQL: the code is reviewed and syntax-checked
  here, the first live run is the owner's machine. Not verified here:
  Windows installer build, Nuitka compile, ONNX export + accuracy gate,
  clean-Windows test, live sign-in, real licence refresh.
- First run takes a while (MySQL first start, model download) and needs
  disk space: the data folder holds the models (~1–2 GB) on top of the
  install.
- Mac: ONNX Runtime with CoreML runs the same models on Mac. Paths,
  codecs and the runtime choice are designed so a Mac build is possible;
  no Mac build is attempted now.
