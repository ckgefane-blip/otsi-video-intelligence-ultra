'use strict';
/**
 * OTSI VIE desktop app — main process.
 *
 * The app is a window around the local engine (same engine the browser
 * version runs). On launch it shows a small loading window, gets the engine
 * ready (repo, packages, database, builds, owner account), starts it, and
 * then opens the main window on http://127.0.0.1:4310. Closing the main
 * window stops the engine. Nothing opens in a browser.
 *
 * First run: if no owner account exists yet, the loading window shows a
 * simple form (email, name, organisation) instead of a console prompt.
 */

const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const backend = require('./backend');

const MAIN_WIDTH = 1600;
const MAIN_HEIGHT = 900;

let loadingWin = null;
let mainWin = null;
let backendChild = null;
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
  // Portable build: the engine checkout lives next to the exe.
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'OTSI-Ultra');
  }
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'OTSI-VIE', 'OTSI-Ultra');
  }
  if (!app.isPackaged) {
    // Development: this package lives in the ultra repo checkout itself.
    return path.resolve(__dirname, '..', '..', '..');
  }
  return path.join(app.getPath('userData'), 'OTSI-Ultra');
}

function otsiVieDir() {
  return path.join(engineDir(), 'otsi-vie');
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
    width: 480,
    height: 380,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'OTSI VIE',
    icon: windowIcon(),
    backgroundColor: '#0b1e3a',
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

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: MAIN_WIDTH,
    height: MAIN_HEIGHT,
    minWidth: 1100,
    minHeight: 650,
    title: 'OTSI VIE',
    icon: windowIcon(),
    backgroundColor: '#0b1e3a',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWin.setMenu(null);
  // Keep the window title "OTSI VIE" even when the web app sets its own.
  mainWin.on('page-title-updated', (event) => event.preventDefault());
  // Developer tools, for when something needs a closer look.
  mainWin.webContents.on('before-input-event', (event, input) => {
    if (
      (input.control && input.shift && input.key.toLowerCase() === 'i') ||
      input.key === 'F12'
    ) {
      mainWin.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
  mainWin.loadURL(backend.WEB_URL);
  mainWin.on('closed', () => {
    mainWin = null;
  });
}

/* ------------------------------------------------------------------ */
/* startup                                                             */
/* ------------------------------------------------------------------ */

function checkAborted() {
  if (startupAborted) throw new Error('__aborted__');
}

async function startup() {
  const engine = engineDir();
  const otsiVie = otsiVieDir();
  const userData = app.getPath('userData');
  fs.mkdirSync(userData, { recursive: true });
  logFile = path.join(userData, 'backend.log');
  backendLogStream = fs.createWriteStream(logFile, { flags: 'a' });
  fileLogStream = backendLogStream;
  const log = (text) => {
    pushLog(text);
  };

  setStatus('Starting OTSI VIE...');
  await backend.checkTools();
  checkAborted();

  setStatus('Finding Python...');
  const python = await backend.findPython(engine, log);
  if (!python) {
    throw new Error(
      'No Python with the engine\'s database driver (pymysql) was found.\n' +
        'Install Python 3.12 or newer from python.org (tick "Add python.exe to PATH"\n' +
        'during setup), then open OTSI VIE again. The app creates its own Python\n' +
        'environment inside the OTSI-Ultra folder; it never uses another project\'s folder.',
    );
  }
  checkAborted();

  setStatus('Getting the engine ready...');
  await backend.ensureRepo(engine, log);
  checkAborted();

  await backend.ensureJsDeps(otsiVie, log);
  checkAborted();

  setStatus('Setting up the database...');
  await backend.prepareStack(python, otsiVie, engine, log);
  checkAborted();

  await backend.ensureBuilds(otsiVie, log);
  checkAborted();

  if (!backend.ownerMarkerExists(engine)) {
    setStatus('One last thing: your owner account.');
    showOwnerForm();
    const details = await waitForOwner();
    checkAborted();
    if (details.haveAccount) {
      backend.writeOwnerMarker(engine);
    } else {
      setStatus('Creating your owner account...');
      try {
        await backend.bootstrapOwner(python, otsiVie, engine, details, log);
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
      backend.writeOwnerMarker(engine);
    }
    checkAborted();
  }

  setStatus('Starting the engine...');
  backendChild = backend.startBackend(python, otsiVie, engine, backendLogStream);
  backendChild.on('error', (err) => {
    pushLog(`The engine process could not start: ${err.message}\n`);
  });
  // If the engine process dies, say so at once instead of waiting 4 minutes.
  const childGone = new Promise((resolve) => {
    backendChild.on('exit', (code) => resolve(code));
  });
  const first = await Promise.race([
    backend.waitForWeb(backend.WEB_URL, 240000).then(() => 'ready'),
    childGone.then((code) => `exited:${code}`),
  ]);
  if (first !== 'ready') {
    throw new Error(
      `The engine stopped while starting (exit ${first.split(':')[1]}).\nSee the log below, or the full log at ${logFile}`,
    );
  }
  checkAborted();

  setStatus('Opening the engine...');
  createMainWindow();
  if (loadingWin && !loadingWin.isDestroyed()) loadingWin.close();
}

/* ------------------------------------------------------------------ */
/* app lifecycle                                                       */
/* ------------------------------------------------------------------ */

async function stopEverything() {
  if (backendChild) {
    const child = backendChild;
    backendChild = null;
    await backend.stopBackend(child);
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
  Menu.setApplicationMenu(null);
  createLoadingWindow();
  runStartupWithRetry();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  if (quitting) return;
  if (backendChild) {
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

ipcMain.on('close-app', () => {
  startupAborted = true;
  app.quit();
});
