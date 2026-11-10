# OTSI VIE desktop app (Windows)

A real desktop app for OTSI VIE: its own window, no browser tab — like
Filmora or DaVinci Resolve. The engine's screens (dashboard, analysis,
timeline, reel builder, reports, library, export) run inside the app's
window. The engine itself still runs on this machine, behind the window:
the web app on http://127.0.0.1:4310, the API on 4520, portable MySQL on
3508. Nothing opens in a browser and nothing is uploaded anywhere.

## What it does on launch

The same flow as the OTSI-VIE.exe launcher, but shown in a window:

1. Checks git, Node.js 22+, pnpm and Python (with the pymysql driver).
2. Gets the engine code (clones the ultra repo, or updates it).
3. Installs the engine's JavaScript packages (first time only).
4. Sets up the database — portable MySQL, no Docker (first time it
   downloads MySQL 8.4.6, ~249 MB, once).
5. Builds the engine (first time only).
6. First time: a form in the window asks for the owner account
   (email, name, organisation).
7. Starts the engine, waits for it to answer, then opens the main window
   on http://127.0.0.1:4310.
8. Closing the main window stops the engine.

Progress, errors and the owner form all appear in the window. There is no
console window and no checklist.

## What the installer contains — and what it does not

The installer (and the portable exe) contain only the Electron runtime and
this shell: `main.js`, `backend.js`, `preload.js`, the loading page and the
app icon. That is roughly 150 MB, mostly the Electron runtime.

They do NOT contain the engine, Node.js, pnpm, git, Python, the database
or the AI models. On the machine it runs on, the app uses what is already
there (same as the launcher):

- git, Node.js 22, pnpm — already on the owner's machine.
- Python — the original workspace `.venv` (torch / OpenVINO / PaddleOCR),
  found the same way the launcher finds it.
- The engine code — cloned from the ultra repo on first run (~153 MB),
  then updated on every launch.
- The database — portable MySQL, downloaded once on first run (~249 MB).
- The AI model files — copied from the original workspace's
  `.local/models` folder when analysis is needed (same as the launcher).

So the download stays small; the big parts arrive on first run, on the
user's own machine.

## Files

- `main.js` — Electron main process: windows, startup flow, quit handling.
- `backend.js` — backend management (repo, packages, database, builds,
  owner account, start/stop). No Electron dependency, so it can be checked
  and exercised with plain Node.
- `preload.js` — the small safe API the loading window uses.
- `renderer/loading.html` — the loading window: status, progress, log,
  owner form, error view.
- `electron-builder.yml` — Windows packaging: NSIS installer + portable exe.
- `assets/icon.ico`, `assets/icon.png` — the app icon, made from
  `apps/web/public/brand/otsi-vie-app-icon-small.png`.

## Build

```sh
cd otsi-vie/apps/desktop
npm install          # Electron + electron-builder (dev machines only)
npm run check        # node --check on the three JS files
npm run dist         # Windows installer + portable exe (needs electron-builder)
```

Building the Windows target on Linux works for the portable exe. The NSIS
installer needs Wine for its installer compiler (makensis). Wine was
obtained here (Kron4ek Wine 10.0, kept at `~/workspace/wine-10.0`) and
`wine64` runs, but the 32-bit makensis hangs under WoW64 in this VM, so
the NSIS installer cannot be built here. It builds on a Windows machine
(`npm run dist:nsis`) or any machine with working Wine.

## Limits (honest)

- The app is a shell around the existing engine: it does not change the
  engine's UI or behaviour. The engine is still a web app + API + database
  + workers running on the same machine; the window is how you look at it.
- It is unsigned: Windows SmartScreen will ask before running it the
  first time.
- It has never been run on Windows. This VM has no Windows, no GPU and no
  MySQL: the code is reviewed and syntax-checked here, the first live run
  is the owner's machine.
- First run takes a while (repo clone, package install, MySQL download,
  builds) and needs the model files copied for analysis, exactly like the
  launcher.
