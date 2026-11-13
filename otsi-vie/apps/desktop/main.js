'use strict';
/**
 * OTSI VIE desktop app — main process (packaged model, plan v3, ADR-144).
 *
 * The app is a window around the local engine (same engine the browser
 * version runs). On launch it shows a small loading window, checks the
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
 * First run: if no owner account exists yet, the loading window shows a
 * simple form (email, name, organisation) instead of a console prompt.
 * Updates: electron-updater checks on launch, downloads in the background
 * (differential/blockmap — a code update is megabytes, not the whole
 * installer), and installs on quit.
 */

const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const backend = require('./backend');
const components = require('./components');
const { installWindowMenu } = require('./windowmenu');
const { MENU_NAMES, menuTemplate, shortcutFor } = require('./appmenus');

// A test/staging build's own identity (resources/central.json or the environment): a different
// app name keeps its userData folder apart from the production app's, and a different Windows
// AppUserModelId keeps its taskbar identity apart, so the staging build neither replaces nor
// updates the installed app. Must run before the app is ready and before any getPath('userData').
backend.applyBuildIdentity(app);

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
let ownerResolver = null;

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

/** one start-up step, sent as a structured event so the splash renders its steps from the real stages
 *  instead of three hardcoded rows: { id, label, state }. The splash marks every earlier step done
 *  when a new one turns active, so the main process only has to announce each stage as it starts. */
function setStep(id, label, state) {
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('step', { id, label, state });
  }
}

function sendUpdateStatus(text) {
  if (text) pushLog(`-- update: ${text}\n`);
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('update-status', text);
  }
}

function sendHardware(detection) {
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('hardware', {
      summary: detection.summary,
      warnings: detection.warnings,
    });
  }
}

function showError(message) {
  const tail = logTail.join('').slice(-4000);
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('show-error', { message, log: tail });
  }
}

function showOwnerForm() {
  if (loadingWin && !loadingWin.isDestroyed()) {
    loadingWin.webContents.send('show-owner');
  }
}

/** Wait for the owner form in the loading window. Resolves with the details. */
function waitForOwner() {
  return new Promise((resolve) => {
    ownerResolver = resolve;
  });
}

/* ------------------------------------------------------------------ */
/* windows                                                             */
/* ------------------------------------------------------------------ */

function createLoadingWindow() {
  loadingWin = new BrowserWindow({
    // SOT splash: the start-up screen fills the window like the app (logo, progress, steps, footer clear of the steps)
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    minWidth: 760,
    minHeight: 620,
    center: true,
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

// The title bar (owner 2026-11-13): Windows' own title bar is hidden and only its minimise / maximise / close buttons are drawn,
// on the right, in the theme's colours. The page draws the rest of the row: the icon, "OTSI VIE" and the menus File · Edit ·
// View · Go to · Help (apps/web DesktopTitleBar). A menu name asks for its native menu (appmenus.js), shown under it. Items that
// act in the page come back to it as commands; the rest act on the window here. The Windows menu under Alt+Space has the
// extra items of windowmenu.js too. The loading window keeps a plain Windows title bar.
const TITLE_BAR_HEIGHT = 32;
const COLOR = /^#[0-9a-f]{6}$/i;

/** a command for the page's title bar (DesktopTitleBar): go to a page, or one of the app's own shortcuts */
function sendToPage(cmd) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('desktop-command', cmd);
}

function goTo(route) {
  sendToPage({ type: 'navigate', route });
}

function showAbout() {
  const win = mainWin || undefined;
  void dialog.showMessageBox(win, {
    type: 'info',
    title: 'About OTSI VIE',
    message: 'OTSI VIE',
    detail: `Video Intelligence Engine\nVersion ${app.getVersion()}\nElectron ${process.versions.electron} · Chromium ${process.versions.chrome}\n\n`
      + 'Copyright © Osio & Tee Solutions International Ltd',
    buttons: ['OK'],
    noLink: true,
  });
}

/** what the menus and the window's shortcuts do to the window */
function windowActions(win) {
  const wc = win.webContents;
  const history = wc.navigationHistory;
  const zoom = (step) => wc.setZoomLevel(step === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + step * 0.5)));
  return {
    reload: () => wc.reload(),
    zoom,
    zoomIn: () => zoom(1),
    zoomOut: () => zoom(-1),
    zoomReset: () => zoom(0),
    fullScreen: () => win.setFullScreen(!win.isFullScreen()),
    toggleFullScreen: () => win.setFullScreen(!win.isFullScreen()),
    toggleOnTop: () => win.setAlwaysOnTop(!win.isAlwaysOnTop()),
    devTools: () => wc.toggleDevTools(),
    toggleDevTools: () => wc.toggleDevTools(),
    back: () => { if (history.canGoBack()) history.goBack(); },
    forward: () => { if (history.canGoForward()) history.goForward(); },
    press: (key) => {
      wc.focus();
      wc.sendInputEvent({ type: 'keyDown', keyCode: key, modifiers: ['control'] });
      wc.sendInputEvent({ type: 'keyUp', keyCode: key, modifiers: ['control'] });
    },
    checkForUpdates: () => { if (autoUpdater) void checkForUpdates(); },
    about: showAbout,
    quit: () => win.close(),
  };
}

/** the title-bar menu `name`, built now so its ticks and greyed items are current */
function titleBarMenu(win, name) {
  const wc = win.webContents;
  const template = menuTemplate(name, {
    ...windowActions(win),
    send: sendToPage,
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    isFullScreen: win.isFullScreen(),
    isOnTop: win.isAlwaysOnTop(),
    updatesAvailable: !!autoUpdater && app.isPackaged,
  });
  return template ? Menu.buildFromTemplate(template) : null;
}

// The extra items in the Windows menu (Alt+Space; windowmenu.js): what each one does, and its tick.
function addWindowMenuItems(win) {
  const act = windowActions(win);
  const refresh = installWindowMenu(win, {
    go: (item) => goTo(item.route),
    reload: act.reload,
    zoomIn: act.zoomIn,
    zoomOut: act.zoomOut,
    zoomReset: act.zoomReset,
    fullScreen: act.toggleFullScreen,
    onTop: act.toggleOnTop,
    updates: act.checkForUpdates,
    about: showAbout,
  }, {
    checked: (name) => (name === 'fullScreen' ? win.isFullScreen() : name === 'onTop' ? win.isAlwaysOnTop() : false),
    enabled: (name) => (name === 'updates' ? !!autoUpdater && app.isPackaged : true),
  }, pushLog);
  // F11, Esc or the View menu change full screen too: keep the tick true
  win.on('enter-full-screen', refresh);
  win.on('leave-full-screen', refresh);
  win.on('always-on-top-changed', refresh);
}

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    minWidth: 1100,
    minHeight: 650,
    title: 'OTSI VIE',
    icon: windowIcon(),
    backgroundColor: '#0A0B0D',
    // the page draws the title bar and its menus; Windows draws only the window buttons, in the theme's colours
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1114', symbolColor: '#eceef1', height: TITLE_BAR_HEIGHT },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, 'preload-main.js'),
    },
  });
  mainWin.setMenu(null);
  addWindowMenuItems(mainWin);
  // Keep the window title "OTSI VIE" even when the web app sets its own.
  mainWin.on('page-title-updated', (event) => event.preventDefault());
  // The window's shortcuts for the menu items that act on the window (reload, zoom, full screen, back / forward,
  // developer tools). The page's own shortcuts (Ctrl+K, Ctrl+J, Ctrl+B, Ctrl+Z …) reach the page as before.
  const act = windowActions(mainWin);
  mainWin.webContents.on('before-input-event', (event, input) => {
    const name = shortcutFor(input);
    if (name && act[name]) {
      event.preventDefault();
      act[name]();
    }
  });
  mainWin.loadURL(backend.WEB_URL);
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

// The page's title bar asks for a menu under one of its names (DesktopTitleBar → preload-main.js).
ipcMain.on('titlebar-menu', (event, request) => {
  if (!mainWin || event.sender !== mainWin.webContents) return;
  const name = request && typeof request.name === 'string' ? request.name : '';
  if (!MENU_NAMES.includes(name)) return;
  const menu = titleBarMenu(mainWin, name);
  if (!menu) return;
  const zoom = mainWin.webContents.getZoomFactor();
  const at = (v) => (Number.isFinite(v) ? Math.round(v * zoom) : 0);
  menu.popup({
    window: mainWin,
    x: at(request.x),
    y: at(request.y),
    callback: () => sendToPage({ type: 'menu-closed' }),
  });
});

// The page's theme colours for the window buttons Windows draws on the right of the title bar.
ipcMain.on('titlebar-colors', (event, colors) => {
  if (!mainWin || event.sender !== mainWin.webContents || !colors) return;
  if (!COLOR.test(String(colors.bg)) || !COLOR.test(String(colors.fg))) return;
  try {
    mainWin.setTitleBarOverlay({ color: colors.bg, symbolColor: colors.fg, height: TITLE_BAR_HEIGHT });
  } catch (err) {
    pushLog(`Title bar colours not applied: ${String((err && err.message) || err)}\n`);
  }
});

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
  setStep('starting', 'Starting OTSI VIE', 'active');

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
  setStep('hardware', 'Checking this PC', 'active');
  const detection = await backend.hardware.detect(data);
  sendHardware(detection);
  pushLog(`Hardware: ${detection.summary}\n`);
  for (const w of detection.warnings) pushLog(`Hardware: ${w}\n`);
  checkAborted();

  setStatus('Checking the AI runtimes...');
  setStep('runtimes', 'Checking the AI runtimes', 'active');
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
  setStep('database', 'Setting up the database', 'active');
  const { env, mysqlSupervisor } = await backend.prepareDatabase(engine, data, userData, detection, log, devMode);
  checkAborted();

  setStatus('Getting the AI models ready (first time, a few minutes)...');
  setStep('models', 'Loading analysis models', 'active');
  await backend.ensureModels(engine, data, log);
  checkAborted();

  if (!backend.ownerMarkerExists(data)) {
    setStatus('One last thing: your owner account.');
    setStep('owner', 'Setting up your owner account', 'active');
    showOwnerForm();
    const details = await waitForOwner();
    checkAborted();
    if (details.haveAccount) {
      backend.writeOwnerMarker(data);
    } else {
      setStatus('Creating your owner account...');
      try {
        await backend.bootstrapOwner(engine, env, details, log);
      } catch (err) {
        // The account may already exist in this database: let the user carry
        // on instead of blocking them. Anything else is a real failure.
        const text = String((err && err.message) || err);
        if (/already exists|duplicate|UNIQUE/i.test(text)) {
          log('Owner account already exists; carrying on.\n');
        } else {
          throw err;
        }
      }
      backend.writeOwnerMarker(data);
    }
    checkAborted();
  }

  // Licence: refresh when a central server is configured and a session is
  // stored. Offline, or with no session yet, the app still opens — the
  // stored token and its grace decide what the loading window says, and
  // the compiled native engine enforces the licence. The shell never
  // treats a plain flag as proof.
  setStatus('Checking the licence...');
  setStep('licence', 'Checking licence', 'active');
  const licenceStatus = await backend.licence.refreshLicence(userData, log);
  if (licenceStatus.note) pushLog(`Licence: ${licenceStatus.note}\n`);
  if (licenceStatus.state === 'expired') {
    setStatus('Licence expired — analysis stays paused until the app can reach the server again.');
    setStep('licence', 'Checking licence', 'warn');
  }
  checkAborted();

  setStatus('Starting the engine...');
  setStep('engine', 'Starting the engine', 'active');
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
  setStep('opening', 'Opening the engine', 'active');
  createMainWindow();
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
      showError(String((err && err.message) || err));
      // Wait for the user to retry or close the app.
      const choice = await new Promise((resolve) => {
        const onRetry = () => {
          ipcMain.removeListener('retry', onRetry);
          ipcMain.removeListener('close-app', onClose);
          resolve('retry');
        };
        const onClose = () => {
          ipcMain.removeListener('retry', onRetry);
          ipcMain.removeListener('close-app', onClose);
          resolve('close');
        };
        ipcMain.once('retry', onRetry);
        ipcMain.once('close-app', onClose);
      });
      if (choice === 'close' || startupAborted) return;
      await stopEverything();
    }
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null); // the main window's menus are in its title bar (appmenus.js)
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

ipcMain.on('owner-submit', (_event, details) => {
  if (ownerResolver) {
    const resolve = ownerResolver;
    ownerResolver = null;
    resolve({
      email: String(details.email || '').trim(),
      name: String(details.name || '').trim(),
      organization: String(details.organization || '').trim(),
      password: String(details.password || ''),
    });
  }
});

ipcMain.on('owner-have-account', () => {
  if (ownerResolver) {
    const resolve = ownerResolver;
    ownerResolver = null;
    resolve({ haveAccount: true });
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
  if (!centralUrl) throw new Error('No central server is configured (OTSI_VIE_CENTRAL_SERVER_URL or resources/central.json).');
  const session = await backend.licence.signInToCentral(centralUrl, credentials || {});
  if (session.mfa_required) return { mfa_required: true, mfa_token: session.mfa_token, expires_in: session.expires_in };
  const stored = backend.licence.storeCentralSession(app.getPath('userData'), session);
  return { ok: true, organization_id: stored.organization_id || null };
});

ipcMain.handle('licence-sign-in-two-step', async (_event, details) => {
  const centralUrl = backend.licence.centralServerUrl();
  if (!centralUrl) throw new Error('No central server is configured (OTSI_VIE_CENTRAL_SERVER_URL or resources/central.json).');
  const session = await backend.licence.completeCentralTwoStep(centralUrl, details || {});
  const stored = backend.licence.storeCentralSession(app.getPath('userData'), session);
  return { ok: true, organization_id: stored.organization_id || null };
});

ipcMain.on('close-app', () => {
  startupAborted = true;
  app.quit();
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
