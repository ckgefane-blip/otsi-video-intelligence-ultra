'use strict';
/**
 * OTSI VIE desktop app — main process (packaged model, plan v3, ADR-144).
 *
 * The app is a window around the local engine (same engine the browser
 * version runs). On launch it shows a full-screen loading window, checks the
 * hardware, gets the bundled engine ready (database, models, owner
 * account, licence), starts it, and then opens the main window on
 * http://localhost:4311. Closing the main window stops the engine.
 * Nothing opens in a browser.
 *
 * The installer ships pre-built code, never source: there is no git clone,
 * no pnpm install and no build on the user's PC, no system Python, and no
 * Torch/PaddlePaddle. The worker is a Nuitka-compiled native binary and
 * inference runs on the bundled ONNX Runtime + DirectML / OpenVINO
 * runtimes. If a bundled component is missing, the app says so plainly
 * and stops instead of trying to fetch or build it.
 *
 * First run: if no owner account exists yet, the main window opens on the engine's own first-run page
 * (/setup), which creates the account on the OTSI server for sign-in, licence and billing — the loading
 * window shows no account form of its own.
 * Updates: electron-updater checks on launch, downloads in the background
 * (differential/blockmap — a code update is megabytes, not the whole
 * installer), and installs on quit.
 */

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const backend = require('./backend');
const components = require('./components');

let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null; // dev checkout without the dependency: no update checks
}

const MAIN_WIDTH = 1600;
const MAIN_HEIGHT = 900;

let loadingWin = null;
let mainWin = null;
let backendHandle = null;
let backendLogStream = null;
let fileLogStream = null;
let logFile = '';
let logTail = [];
let quitting = false;
let startupAborted = false;

/* ------------------------------------------------------------------ */
/* paths                                                               */
/* ------------------------------------------------------------------ */

function engineDir() {
  return backend.engineRoot();
}

function windowIcon() {
  const ico = path.join(__dirname, 'assets', 'icon.ico');
  const png = path.join(__dirname, 'assets', 'icon.png');
  if (process.platform === 'win32') return ico;
  return fs.existsSync(png) ? png : ico;
}

/* ------------------------------------------------------------------ */
/* logging                                                             */
/* ------------------------------------------------------------------ */

function pushLog(line) {
  const text = String(line);
  logTail.push(text);
  if (logTail.length > 400) logTail = logTail.slice(-400);
  if (fileLogStream) fileLogStream.write(text);
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('log', text);
  }
}

function setStatus(text) {
  pushLog(`-- ${text}\n`);
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('status', text);
  }
}

/** The SOT splash (Splash.dc.html) has exactly three steps, in this order: "Local workspace opened",
 *  "Loading analysis models", "Checking licence". The real start-up stages map onto them:
 *    workspace — starting, this PC, the database (and the first-run owner note)
 *    models    — the AI runtimes, the analysis models
 *    licence   — the licence check
 *  The engine start and the main window opening are not steps: the splash closes as the engine opens.
 *  The splash marks every earlier step done when a new one turns active, so the steps only ever move
 *  forward: a stage that belongs to an earlier phase than the one already showing (the database, set up
 *  after the runtimes check) sends no event. The status line still narrates every real stage. */
const SPLASH_STEPS = [
  { id: 'workspace', label: 'Local workspace opened' },
  { id: 'models', label: 'Loading analysis models' },
  { id: 'licence', label: 'Checking licence' },
];
let splashStepIndex = -1;
let splashStepLast = '';
function setSplashStep(id, state) {
  const index = SPLASH_STEPS.findIndex((s) => s.id === id);
  if (index < 0 || index < splashStepIndex) return;
  splashStepIndex = index;
  const key = `${id}:${state}`;
  if (key === splashStepLast) return; // the same step in the same state: the splash already shows it
  splashStepLast = key;
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('step', { id, label: SPLASH_STEPS[index].label, state });
  }
}

function sendUpdateStatus(text) {
  if (text) pushLog(`-- update: ${text}\n`);
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('update-status', text);
  }
}

/* ------------------------------------------------------------------ */
/* windows                                                             */
/* ------------------------------------------------------------------ */

function createLoadingWindow() {
  loadingWin = new BrowserWindow({
    // SOT rebuild 2026-11-13 (Awore's report): the SOT splash is a full-screen window (the design comp is
    // 1440 × 900), not a small 480 × 480 one — in the small window the footer overlapped the steps once
    // the dynamic step list grew past the SOT's three. Full screen gives the centred content room.
    fullscreen: true,
    width: 1440,
    height: 900,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'OTSI VIE',
    icon: windowIcon(),
    backgroundColor: '#0A0B0D',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  loadingWin.setMenu(null);
  loadingWin.loadFile(path.join(__dirname, 'renderer', 'loading.html'));
  loadingWin.on('closed', () => {
    loadingWin = null;
    if (!mainWin) {
      startupAborted = true;
      app.quit();
    }
  });
}

/* ------------------------------------------------------------------ */
/* application menu                                                    */
/* ------------------------------------------------------------------ */

// The SOT has no menu bar: no application menu is built and none is set, on the loading window or on
// the main window (Menu.setApplicationMenu(null) below, mainWin.setMenu(null) in createMainWindow).
// The window keeps the bare Windows system menu (Restore / Move / Size / Minimize / Maximize /
// Close); in-page navigation moves around the app, and developer tools stay reachable on F12 /
// Ctrl+Shift+I (see createMainWindow). Update checks run on launch without a menu entry.

/** The main window: the engine itself. On a first run (no owner account yet) it opens on the engine's
 *  own first-run page (/setup), which creates the owner account on the OTSI server for sign-in, licence
 *  and billing. Once setup lands on the dashboard, the owner marker is written so later launches open
 *  the dashboard straight away; closing at /setup without finishing leaves the marker unwritten, so the
 *  next launch offers /setup again. */
function createMainWindow(firstRun, data) {
  mainWin = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    minWidth: 1100,
    minHeight: 650,
    title: 'OTSI VIE',
    icon: windowIcon(),
    backgroundColor: '#0A0B0D',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // The main window has no menu bar (SOT): Menu.setApplicationMenu(null) at startup, and none here.
  mainWin.setMenu(null);
  // Keep the window title "OTSI VIE" even when the web app sets its own.
  mainWin.on('page-title-updated', (event) => event.preventDefault());
  // Developer tools, for when something needs a closer look.
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control && input.shift && input.key.toLowerCase() === 'i')
      || input.key === 'F12'
    ) {
      mainWin.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  mainWin.loadURL(backend.WEB_URL + (firstRun ? '/setup' : ''));
  if (firstRun) {
    // /setup signs the new owner in and lands on the dashboard (or shows a sign-in link when the
    // account already exists) — either way the marker is written only on reaching the dashboard.
    const onNav = (_event, url) => {
      try {
        if (new URL(url).pathname === '/dashboard') {
          backend.writeOwnerMarker(data);
          mainWin.webContents.removeListener('did-navigate', onNav);
          mainWin.webContents.removeListener('did-navigate-in-page', onNav);
        }
      } catch { /* a URL that does not parse is not the dashboard */ }
    };
    mainWin.webContents.on('did-navigate', onNav);
    mainWin.webContents.on('did-navigate-in-page', onNav);
  }
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

/* ------------------------------------------------------------------ */
/* auto-update (differential)                                          */
/* ------------------------------------------------------------------ */

// electron-updater, publishing to GitHub Releases (the ultra repo — see
// electron-builder.yml `publish`). Updates are differential (blockmap):
// the NSIS installer is built with differentialPackage "store-asar", so a
// code update downloads megabytes, not the whole installer. The check runs
// on launch, the download happens in the background, and the update
// installs on quit. An update problem never blocks the app: it is logged
// and the app carries on.
function setupAutoUpdater() {
  if (!autoUpdater || !app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('Checking for updates…'));
  autoUpdater.on('update-available', (info) => {
    sendUpdateStatus(`Update ${info.version} available — downloading in the background…`);
  });
  autoUpdater.on('update-not-available', () => sendUpdateStatus(''));
  autoUpdater.on('download-progress', (progress) => {
    sendUpdateStatus(`Downloading update… ${Math.round(progress.percent)}%`);
  });
  autoUpdater.on('update-downloaded', () => {
    sendUpdateStatus('Update downloaded — it will install when you quit.');
  });
  autoUpdater.on('error', (err) => {
    pushLog(`Update check failed: ${String((err && err.message) || err)}\n`);
    sendUpdateStatus('');
  });
}

async function checkForUpdates() {
  if (!autoUpdater) return;
  sendUpdateStatus('Checking for updates…');
  try {
    await autoUpdater.checkForUpdatesAndNotify();
  } catch (err) {
    pushLog(`Update check failed: ${String((err && err.message) || err)}\n`);
    sendUpdateStatus('');
  }
}

/* ------------------------------------------------------------------ */
/* startup                                                             */
/* ------------------------------------------------------------------ */

function checkAborted() {
  if (startupAborted) throw new Error('__aborted__');
}

async function startup() {
  splashStepIndex = -1; // a retry after a failure restarts the three splash steps from the first
  splashStepLast = '';
  // Dev mode (running from the repo source, not from the packaged installer):
  // the packaged AI runtimes, compiled tools and Nuitka worker are not staged
  // here yet, so the packaging checks below warn instead of stopping the app.
  // The UI still opens; video analysis waits until those components exist.
  // A packaged install (app.isPackaged) keeps the strict checks — a missing
  // runtime there is a broken install.
  const devMode = !app.isPackaged;
  const engine = engineDir();
  const userData = app.getPath('userData');
  const data = backend.dataDir(userData);
  fs.mkdirSync(userData, { recursive: true });
  logFile = path.join(userData, 'backend.log');
  backendLogStream = fs.createWriteStream(logFile, { flags: 'a' });
  fileLogStream = backendLogStream;
  // Child processes inherit this stream as their stdout/stderr, which
  // needs a real file descriptor — wait until it is open.
  await new Promise((resolve) => backendLogStream.once('open', resolve));
  const log = (text) => {
    pushLog(text);
  };

  setStatus('Starting OTSI VIE...');
  setSplashStep('workspace', 'active');

  // The installer ships pre-built code. If a bundled component is missing
  // or corrupt, say so plainly and stop — never download source or build.
  const missingEngine = backend.verifyBundledEngine(engine);
  if (missingEngine.length) {
    throw new Error(
      'The installed engine is incomplete — these files are missing:\n'
      + missingEngine.join('\n')
      + '\nReinstall OTSI VIE.',
    );
  }
  checkAborted();

  setStatus('Checking this PC...');
  setSplashStep('workspace', 'active');
  const detection = await backend.hardware.detect(data);
  pushLog(`Hardware: ${detection.summary}\n`);
  for (const w of detection.warnings) pushLog(`Hardware: ${w}\n`);
  checkAborted();

  setStatus('Checking the AI runtimes...');
  setSplashStep('models', 'active');
  const runtime = backend.ensureAiRuntime(engine, log);
  if (!runtime.ok) {
    if (devMode) {
      log('Dev mode: the AI runtimes are not staged yet, so video analysis is unavailable. The UI still opens.\n');
    } else {
      throw new Error(
        'The AI runtimes are incomplete — these files are missing:\n'
        + runtime.missing.join('\n')
        + `\n(from ${runtime.dir})\nReinstall OTSI VIE.`,
      );
    }
  }
  const tools = backend.ensureToolBinaries(engine, log);
  if (!tools.ok) {
    if (devMode) {
      log('Dev mode: the compiled tools are not staged yet, so model downloads and the worker are unavailable. The UI still opens.\n');
    } else {
      throw new Error(
        `The installer is incomplete — these compiled tools are missing: ${tools.missing.join(', ')}.\nReinstall OTSI VIE.`,
      );
    }
  }
  if (!backend.nativeWorkerExe(engine)) {
    if (devMode) {
      log('Dev mode: the compiled worker is not staged yet, so video jobs will wait. The UI still opens.\n');
    } else {
      throw new Error(
        'The installer is missing the compiled worker (vie_worker.exe).\nReinstall OTSI VIE.',
      );
    }
  }
  checkAborted();

  setStatus('Setting up the database...');
  setSplashStep('workspace', 'active'); // workspace phase; suppressed while the models step already shows — the splash never moves backwards
  const { env, mysqlSupervisor } = await backend.prepareDatabase(engine, data, userData, detection, log, devMode);
  checkAborted();

  setStatus('Getting the AI models ready (first time, a few minutes)...');
  setSplashStep('models', 'active');
  await backend.ensureModels(engine, data, log);
  checkAborted();

  // First run: no owner account yet. The account is created in the engine itself, on its first-run
  // page (/setup) — the loading window embeds no form of its own. Remember it here; the main window
  // opens on /setup, and the marker is written once setup lands on the dashboard (see
  // createMainWindow). Until then the splash shows this as a stage like any other.
  const needsOwner = !backend.ownerMarkerExists(data);
  if (needsOwner) {
    // No splash step for this: the owner account is created in the engine itself, on its first-run
    // page (/setup), and the SOT splash has no owner step. The status line says it; the main window
    // opens on /setup (see createMainWindow).
    setStatus('One last thing: your owner account.');
  }
  checkAborted();

  // Licence: refresh when a central server is configured and a session is
  // stored. Offline, or with no session yet, the app still opens — the
  // stored token and its grace decide what the loading window says, and
  // the compiled native engine enforces the licence. The shell never
  // treats a plain flag as proof.
  setStatus('Checking the licence...');
  setSplashStep('licence', 'active');
  const licenceStatus = await backend.licence.refreshLicence(userData, log);
  if (licenceStatus.note) pushLog(`Licence: ${licenceStatus.note}\n`);
  if (licenceStatus.state === 'expired') {
    setStatus('Licence expired — analysis stays paused until the app can reach the server again.');
    setSplashStep('licence', 'warn');
  }
  checkAborted();

  setStatus('Starting the engine...');
  // No splash step: the engine start is not one of the SOT's three steps, and the splash closes as
  // soon as the main window opens below.
  backendHandle = backend.startBackend(engine, data, env, backendLogStream, log, mysqlSupervisor, devMode);
  // If the engine process dies, say so at once instead of waiting 4 minutes.
  const first = await Promise.race([
    backend.waitForWeb(backend.WEB_URL, 240000).then(() => 'ready'),
    backendHandle.exitPromise.then((exited) => `exited:${exited.name}:${exited.code}`),
  ]);
  if (first !== 'ready') {
    throw new Error(
      `The engine stopped while starting (${first}).\nSee the log below, or the full log at ${logFile}`,
    );
  }
  checkAborted();

  setStatus('Opening the engine...');
  // No splash step: opening is not one of the SOT's three steps; the splash closes with this call.
  createMainWindow(needsOwner, data);
  if (loadingWin && !loadingWin.isDestroyed()) loadingWin.close();

  // Update check after the window opens, so it never delays startup.
  setupAutoUpdater();
  if (autoUpdater && app.isPackaged) void checkForUpdates();
}

/* ------------------------------------------------------------------ */
/* app lifecycle                                                       */
/* ------------------------------------------------------------------ */

async function stopEverything() {
  if (backendHandle) {
    const handle = backendHandle;
    backendHandle = null;
    await backend.stopBackend(handle);
  }
  if (backendLogStream) {
    fileLogStream = null;
    backendLogStream.end();
    backendLogStream = null;
  }
}

async function runStartupWithRetry() {
  for (;;) {
    logTail = [];
    try {
      await startup();
      return;
    } catch (err) {
      if (startupAborted || (err && err.message === '__aborted__')) return;
      // The splash is the starting view only (SOT): a start-up failure is a native dialog, not an
      // extra view in the loading window. The full log is on disk; the tail is in the detail.
      const tail = logTail.join('').slice(-2000);
      const parent = loadingWin && !loadingWin.isDestroyed() ? loadingWin : null;
      const box = {
        type: 'error',
        title: 'OTSI VIE',
        message: 'Something did not work.',
        detail: `${String((err && err.message) || err)}\n\nSee the full log at ${logFile}${tail ? `\n\n${tail}` : ''}`,
        buttons: ['Try again', 'Close'],
        defaultId: 0,
        cancelId: 1,
      };
      const choice = parent ? await dialog.showMessageBox(parent, box) : await dialog.showMessageBox(box);
      if (choice.response === 1 || startupAborted) return;
      await stopEverything();
    }
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // SOT: no menu bar (no Go / View / Help)
  createLoadingWindow();
  runStartupWithRetry();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  if (backendHandle) {
    event.preventDefault();
    quitting = true;
    await stopEverything();
    app.quit();
  }
});

// Central sign-in (licence.js): the renderer collects the email/password — the central server is the API
// only, so there is no sign-in page to open in a window; the shell signs in to the API directly — and
// hands them here. The session is stored for licence refreshes; with two-step sign-in on, step 1
// returns a challenge and the renderer calls 'licence-sign-in-two-step' with the code. The live flow
// cannot be tested here (no central server is deployed yet); the first live test is on the owner's host.
ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('licence-sign-in', async (_event, credentials) => {
  const centralUrl = backend.licence.centralServerUrl();
  if (!centralUrl) throw new Error('No central server is configured (OTSI_VIE_CENTRAL_SERVER_URL).');
  const session = await backend.licence.signInToCentral(centralUrl, credentials || {});
  if (session.mfa_required) return { mfa_required: true, mfa_token: session.mfa_token, expires_in: session.expires_in };
  const stored = backend.licence.storeCentralSession(app.getPath('userData'), session);
  return { ok: true, organization_id: stored.organization_id || null };
});

ipcMain.handle('licence-sign-in-two-step', async (_event, details) => {
  const centralUrl = backend.licence.centralServerUrl();
  if (!centralUrl) throw new Error('No central server is configured (OTSI_VIE_CENTRAL_SERVER_URL).');
  const session = await backend.licence.completeCentralTwoStep(centralUrl, details || {});
  const stored = backend.licence.storeCentralSession(app.getPath('userData'), session);
  return { ok: true, organization_id: stored.organization_id || null };
});

// Component manager hook (plan v3 §1b): extra model/language packs install
// from inside the app. The list/install calls below are the shell side;
// the UI that calls them and the server side of the manifest feed are
// follow-ups. Installs are resumable, SHA-256 checked, and the manifest
// must verify against the Ed25519 public key (components.js).
ipcMain.handle('components-list', async () => components.listAvailablePacks());
ipcMain.handle('components-install', async (_event, packId) => {
  const { packs } = await components.listAvailablePacks();
  const pack = packs.find((p) => p.id === packId);
  if (!pack) throw new Error(`No pack ${packId} in the component list.`);
  const data = backend.dataDir(app.getPath('userData'));
  const destDir = pack.kind === 'model' ? backend.modelsDir(data) : backend.componentsDir(data);
  const file = await components.downloadPack(pack, destDir, {
    log: (text) => pushLog(text),
  });
  components.recordInstalled(data, pack);
  return { file, pack: pack.id };
});
