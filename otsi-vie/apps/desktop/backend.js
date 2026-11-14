'use strict';
/**
 * Backend management for the OTSI VIE desktop app — packaged model
 * (plan v3, ADR-144).
 *
 * The installer ships pre-built code, never source. This module locates
 * the bundled engine inside the app's resources, starts the pre-built API
 * and web with a bundled Node runtime (Electron's own Node, or a bundled
 * node.exe), starts the bundled portable MySQL, downloads the exported
 * AI models on first run, and starts the Nuitka-compiled native worker.
 *
 * It NEVER runs git, pnpm install, or a build on the user's PC. There is
 * no git clone/pull, no pnpm, no system Python, no venv build, no Torch /
 * PaddlePaddle anywhere: inference runs on the bundled ONNX Runtime +
 * DirectML / OpenVINO runtimes (§1.2), and the Python engine ships as a
 * Nuitka-compiled binary, so no .py files ship (§1.8). If a bundled
 * component is missing or corrupt, the app says so plainly and stops — it
 * never tries to download source or build anything. (One exception, set
 * by ADR-144 §1.3: a failed model download does not stop the app from
 * opening; analysis simply cannot run until it succeeds, and the next
 * launch retries.)
 *
 * No Electron dependency in this module, so it can be checked and exercised
 * with plain Node. Everything runs through child_process directly (no
 * shell), so there are no cmd.exe quoting problems. All output goes to a
 * caller-supplied log function; nothing is printed to a console here.
 * Secrets (passwords, DSNs, licence tokens) are passed to children through
 * environment variables only — never on a command line, never in a file
 * that is logged, never in the log.
 */

const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const hardware = require('./hardware');
const licence = require('./licence');
const centralConfig = require('./central-config');

// The desktop app always runs the portable stack, which uses its own ports
// (web 4311, API 4521, MySQL 3510) so it can run side by side with the
// original engine (web 4310, API 4520, MySQL 3508).
const WEB_PORT = 4311;
const API_PORT = 4521;
const MYSQL_PORT = 3510;
// The API binds 127.0.0.1 only (apps/api/src/main.ts), and the web reaches it
// through this URL as the proxy target (OTSI_VIE_API_INTERNAL_URL). It must be
// the literal 127.0.0.1, not `localhost`: under Electron 43's newer Node,
// `localhost` can resolve to IPv6 ::1 first, and nothing listens there, so the
// web logged "Failed to proxy http://localhost:4521 ... ECONNREFUSED" and the
// app closed itself. A literal address is never resolved, so it cannot fail
// this way. (The web's own default fallback already uses 127.0.0.1.)
const API_URL = `http://127.0.0.1:${API_PORT}`;
// WEB_URL stays `localhost` on purpose: the window loads this origin, and the
// passkey (WebAuthn) relying-party ID and expected origin are `localhost`
// (apps/api/src/core/config.ts, webauthn.ts). Chromium rejects 127.0.0.1 as a
// WebAuthn RP ID, so loading the window at 127.0.0.1 would break fingerprint
// sign-in in the app window. The window is a browser, not the proxy: it
// resolves `localhost` the way Chromium always has.
const WEB_URL = `http://localhost:${WEB_PORT}`;
const DB_NAME = 'otsi_owner_vie';

// One native worker process per group: a 70-minute analysis must not hold
// up the verification of a new upload (one process runs one job at a time).
const WORKER_GROUPS = {
  'jobs-ingest': 'INGEST_UPLOAD,INGEST_URL,ASSESS',
  'jobs-media': 'PROXY,RENDER,CALIBRATE_PITCH,READ_LINEUPS,SNAPSHOT,BEAT_GRID',
  'jobs-analysis': 'ANALYZE,TRACK_BALL',
};

// Minimum model set for a first analysis (ADR-144 §1.3). The registry
// currently lists the ORIGINAL weights; the ONNX export follow-up adds the
// exported ONNX/OpenVINO entries to the registry, and this same step then
// fetches them (the fetch tools verify every file against its SHA-256 pin).
// Accuracy gate: the exported models must match the originals' accuracy on
// the evaluation set before the worker switches to them — see the desktop
// README ("ONNX accuracy gate"). That gate has NOT been run here.
const MIN_MODELS = [
  'rtdetr_v2_r18vd', 'dinov2_small',
  'ppocr_v4_det', 'ppocr_v4_en_rec', 'pnlcalib_sv_kp',
  'ppocr_v5_cyrillic_rec', 'ppocr_v5_latin_rec',
];

// The bundled AI runtimes (ADR-144 §1.2): ONNX Runtime + DirectML +
// OpenVINO, ~100–150 MB. These are the marker files the shell checks;
// the full staged set is listed in the desktop README.
const RUNTIME_FILES = process.platform === 'win32'
  ? ['onnxruntime.dll', 'onnxruntime_providers_shared.dll', 'DirectML.dll', 'openvino.dll']
  : process.platform === 'darwin'
    ? ['libonnxruntime.dylib']
    : ['libonnxruntime.so', 'libopenvino.so'];

// The compiled Python tools (Nuitka; no .py ships — ADR-144 §1.8). The
// Nuitka build (a Windows build-machine step) produces one binary per
// entry point; the shell launches them by these paths. Dev/build-machine
// override: OTSI_VIE_TOOL_BIN_DIR points at a folder holding the same
// binaries (used to verify the shell without a full installer build).
const TOOL_BINARIES = [
  'migrate', 'roles', 'db-setup', 'mysql-supervisor', 'fetch-models', 'fetch-url-models',
];

/* ------------------------------------------------------------------ */
/* small helpers                                                       */
/* ------------------------------------------------------------------ */

function execFileAsync(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...options }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')}: ${err.message}`));
      else resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

/**
 * Run a command, streaming its output to `log`. Resolves on exit 0, rejects
 * with the exit code and the last output otherwise. Direct spawn, no shell.
 */
function runCommand(cmd, args, options = {}) {
  const { cwd, log, env } = options;
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: env || process.env,
        windowsHide: true,
      });
    } catch (err) {
      reject(new Error(`Could not start ${cmd}: ${err.message}`));
      return;
    }
    let tail = '';
    const feed = (data) => {
      const text = data.toString();
      tail += text;
      if (tail.length > 20000) tail = tail.slice(-20000);
      if (log) log(text);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => {
      reject(new Error(`Could not start ${cmd}: ${err.message}\n${tail}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ code, tail });
      else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}\n${tail}`));
    });
  });
}

function writeSecretFile(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
  try { fs.chmodSync(file, 0o600); } catch { /* Windows: best effort */ }
}

/* ------------------------------------------------------------------ */
/* layout: bundled engine, data folder, runtimes                       */
/* ------------------------------------------------------------------ */

/** The app's resources folder when packaged (Electron), else null (dev). */
function resourcesDir() {
  return process.resourcesPath || null;
}

/**
 * The engine root: the folder holding `otsi-vie/`. Packaged, it is
 * <resources>/engine; in development it is the ultra repo checkout.
 */
function engineRoot() {
  const resources = resourcesDir();
  if (resources) {
    const bundled = path.join(resources, 'engine');
    if (fs.existsSync(path.join(bundled, 'otsi-vie'))) return bundled;
  }
  return path.resolve(__dirname, '..', '..', '..');
}

function otsiVieDir(root) {
  return path.join(root, 'otsi-vie');
}

/**
 * The data folder: a test build's override first (OTSI_VIE_DATA_DIR or the build-time
 * resources/central.json `data_dir` — e.g. D:\OTSI-VIE-staging — so a staging build never touches
 * D:\OTSI-VIE), else user-chosen, defaulting to a non-system drive when one exists (D:\OTSI-VIE on
 * Windows when a D: drive exists). Videos, tracks, renders, project metadata, the local database,
 * the runtimes' caches and the AI models all live under it. No caches go on C: unless it is the
 * only drive. `userDataDir` is app.getPath('userData'), passed in by the main process (this module
 * has no Electron dependency). The optional `config` is the build-time file's contents (tests only).
 */
function dataDir(userDataDir, config) {
  const override = centralConfig.dataDirOverride(config);
  if (override) return override;
  if (process.platform === 'win32') {
    try {
      if (fs.existsSync('D:\\')) return path.join('D:\\OTSI-VIE');
    } catch { /* no D: drive */ }
  }
  return path.join(userDataDir, 'OTSI-VIE');
}

/**
 * Apply a test build's own identity to the Electron app object: a different app name keeps its
 * userData folder apart from the production app's, and a different Windows AppUserModelId keeps
 * its taskbar identity apart, so the staging build neither replaces nor updates the installed
 * app. A normal build has no override and is unchanged. Must run before the app is ready and
 * before any app.getPath('userData') call. `appObj` is the Electron app (a fake in tests); the
 * optional `config` is the build-time file's contents (tests only).
 */
function applyBuildIdentity(appObj, config) {
  const name = centralConfig.appName(config);
  if (name) appObj.setName(name);
  const id = centralConfig.appId(config);
  if (id && process.platform === 'win32') appObj.setAppUserModelId(id);
}

function modelsDir(data) {
  return path.join(data, 'models');
}

function componentsDir(data) {
  return path.join(data, 'components');
}

/** The bundled engine files the app cannot start without. Returns the missing ones. */
function verifyBundledEngine(root) {
  const otsiVie = otsiVieDir(root);
  const needed = [
    path.join(otsiVie, 'apps', 'api', 'dist', 'main.js'),
    path.join(otsiVie, 'apps', 'api', 'dist', 'workers', 'outbox-dispatcher.js'),
    path.join(otsiVie, 'apps', 'api', 'dist', 'cli', 'bootstrap-owner.js'),
    path.join(otsiVie, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js'),
    path.join(otsiVie, 'packages', 'contracts', 'dist'),
    path.join(otsiVie, 'services', 'worker', 'vie_worker', 'models', 'registry.json'),
  ];
  return needed.filter((p) => !fs.existsSync(p));
}

/* ------------------------------------------------------------------ */
/* bundled Node, tool binaries, native worker, AI runtimes             */
/* ------------------------------------------------------------------ */

/**
 * The Node runtime that starts the pre-built API and web. First a bundled
 * node.exe in the installer (resources/node); otherwise Electron's own
 * Node — the Electron binary run with ELECTRON_RUN_AS_NODE=1 behaves as
 * Node. No user-installed Node is required, and no version check against
 * the user's Node is done.
 */
function bundledNode() {
  const resources = resourcesDir();
  if (resources) {
    const exe = process.platform === 'win32'
      ? path.join(resources, 'node', 'node.exe')
      : path.join(resources, 'node', 'bin', 'node');
    if (fs.existsSync(exe)) return { cmd: exe, extraEnv: {} };
  }
  return { cmd: process.execPath, extraEnv: { ELECTRON_RUN_AS_NODE: '1' } };
}

function toolBinDir(root) {
  if (process.env.OTSI_VIE_TOOL_BIN_DIR) return process.env.OTSI_VIE_TOOL_BIN_DIR;
  const resources = resourcesDir();
  if (resources) return path.join(resources, 'engine', 'tools');
  return null; // dev checkout: no compiled tools exist
}

function toolBinary(root, name) {
  const dir = toolBinDir(root);
  if (!dir) return null;
  const exe = process.platform === 'win32' ? path.join(dir, `${name}.exe`) : path.join(dir, name);
  return fs.existsSync(exe) ? exe : null;
}

/**
 * The Python interpreter for dev-mode database setup. The packaged app uses
 * Nuitka-compiled tool binaries; a dev checkout runs the .py sources
 * directly (db_setup.py and migrate.py are pure stdlib for SQLite).
 * Override with OTSI_VIE_PYTHON when `python` is not on PATH.
 */
function pythonCmd() {
  return process.env.OTSI_VIE_PYTHON || 'python';
}

/** Run one of the tools/db/*.py sources directly (dev mode only). */
function runPythonTool(root, script, args, options) {
  const scriptPath = path.join(otsiVieDir(root), 'tools', 'db', script);
  return runCommand(pythonCmd(), [scriptPath, ...args], options);
}

/** The compiled tool binaries the shell needs. Returns the missing names. */
function ensureToolBinaries(root, log) {
  const missing = TOOL_BINARIES.filter((name) => !toolBinary(root, name));
  if (missing.length && log) {
    log(`The installer is missing these compiled tools: ${missing.join(', ')}.\n`);
  }
  return { ok: missing.length === 0, missing };
}

/**
 * The Nuitka-compiled worker binary (ADR-144 §1.8). The Nuitka build is a
 * Windows build-machine step and cannot run on this VM; the shell launches
 * the binary at this defined path and reports a plain error if it is not
 * there. Dev override: OTSI_VIE_WORKER_EXE.
 */
function nativeWorkerExe(root) {
  if (process.env.OTSI_VIE_WORKER_EXE) return process.env.OTSI_VIE_WORKER_EXE;
  const resources = resourcesDir();
  if (resources) {
    const exe = process.platform === 'win32'
      ? path.join(resources, 'engine', 'vie_worker.exe')
      : path.join(resources, 'engine', 'vie_worker');
    if (fs.existsSync(exe)) return exe;
  }
  return null;
}

function aiRuntimeDir(root) {
  if (process.env.OTSI_VIE_RUNTIMES_DIR) return process.env.OTSI_VIE_RUNTIMES_DIR;
  const resources = resourcesDir();
  if (resources) return path.join(resources, 'runtimes');
  return path.join(root, '.local', 'packaging', 'runtimes');
}

/** The bundled AI runtimes must all be present — a missing runtime is a broken install. */
function ensureAiRuntime(root, log) {
  const dir = aiRuntimeDir(root);
  const missing = RUNTIME_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
  if (missing.length && log) {
    log(`The AI runtimes are incomplete (missing: ${missing.join(', ')} in ${dir}).\n`);
  }
  return { ok: missing.length === 0, missing, dir };
}

/** The bundled portable-MySQL ZIP (ADR-144 §1.2), when the installer staged one. */
function bundledMysqlZip() {
  const resources = resourcesDir();
  if (!resources) return null;
  const zip = path.join(resources, 'mysql-8.4.6-winx64.zip');
  return fs.existsSync(zip) ? zip : null;
}

/* ------------------------------------------------------------------ */
/* models (exported ONNX/OpenVINO, first run)                          */
/* ------------------------------------------------------------------ */

function registryPath(root) {
  return path.join(otsiVieDir(root), 'services', 'worker', 'vie_worker', 'models', 'registry.json');
}

function registryHash(root) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(registryPath(root))).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Download the models on first run (ADR-144 §1.3): run the fetch tools
 * (compiled binaries; the .py sources are never shipped) with the models
 * directory from the data folder. Every file is verified against its
 * SHA-256 pin in the registry — the fetch tools already do this and delete
 * a file whose hash does not match. A marker records the registry hash,
 * so the fetch only re-runs when the registry changes. A failed download
 * does not stop the app from opening, but analysis cannot run until it
 * succeeds; the next launch retries. The models are NEVER copied from any
 * workspace folder.
 */
async function ensureModels(root, data, log) {
  const hash = registryHash(root);
  if (!hash) {
    if (log) log('The model registry is missing, so the AI models were not downloaded.\n');
    return false;
  }
  const models = modelsDir(data);
  const marker = path.join(models, '.registry-hash');
  try {
    if (fs.readFileSync(marker, 'utf8').trim() === hash) return true;
  } catch {
    // No marker yet: fetch.
  }
  const fetchModels = toolBinary(root, 'fetch-models');
  const fetchUrlModels = toolBinary(root, 'fetch-url-models');
  if (!fetchModels || !fetchUrlModels) {
    if (log) log('The model download tools are missing, so the AI models were not downloaded.\n');
    return false;
  }
  if (log) log('Downloading the AI models (first time, a few minutes)...\n');
  const env = {
    ...process.env,
    OTSI_VIE_MODELS_DIR: models,
    HF_HOME: path.join(data, 'hf'),
    HF_HUB_OFFLINE: '0',
  };
  try {
    await runCommand(fetchModels, MIN_MODELS, { log, env });
    await runCommand(fetchUrlModels, MIN_MODELS, { log, env });
  } catch {
    if (log) log('The AI models could not be downloaded, so video analysis will not run yet.\n' +
      'Check the connection and disk space, then open OTSI VIE again to retry.\n');
    return false;
  }
  fs.mkdirSync(models, { recursive: true });
  fs.writeFileSync(marker, `${hash}\n`, 'utf8');
  return true;
}

/* ------------------------------------------------------------------ */
/* database: SQLite by default (ADR-144 §1.2, owner-approved 2026-11-11), */
/* portable MySQL kept working and selectable (safeguard 7)             */
/* ------------------------------------------------------------------ */

// ADR-144 §1.2: SQLite on user PCs is APPROVED (owner, written approval
// 2026-11-11). The desktop app therefore uses SQLite by default for local
// data: one file under the data folder (D:\OTSI-VIE\db\otsi-vie.sqlite
// when a D: drive exists — the same rule dataDir() already uses), created
// from database/sqlite-bootstrap.sql and upgraded forward-only by
// migrate.py, which backs the file up before every migration and restores
// it if one fails (docs/sqlite-rollout.md). The portable-MySQL bundle
// stays in the installer and stays working — it is removed only once the
// SQLite conversion passes all eight safeguards (ADR-144 §1.2). Select it
// with OTSI_VIE_DB_BACKEND=mysql (or a db-backend setting, when the
// settings UI gains one); the MySQL path below is unchanged.

/** Which local database backend to use: 'sqlite' (default) or 'mysql'. */
function dbBackend() {
  const backend = (process.env.OTSI_VIE_DB_BACKEND || 'sqlite').toLowerCase();
  if (backend !== 'sqlite' && backend !== 'mysql') {
    throw new Error(
      `OTSI_VIE_DB_BACKEND must be 'sqlite' or 'mysql', not '${process.env.OTSI_VIE_DB_BACKEND}'.`,
    );
  }
  return backend;
}

/** The SQLite database file: <data>/db/otsi-vie.sqlite (D: when one exists). */
function sqliteDbPath(data) {
  return path.join(data, 'db', 'otsi-vie.sqlite');
}

/** The SQLite DSN the API adapter reads (OTSI_VIE_DB_DSN): sqlite:///<absolute path>. */
function sqliteDsn(data) {
  return `sqlite:///${sqliteDbPath(data).split(path.sep).join('/')}`;
}

function mysqlRootPasswordFile(data) {
  return path.join(data, '.local', 'mysql-portable.env');
}

function stackSecretsFile(data) {
  return path.join(data, '.local', 'stack', 'owner', 'secrets.env');
}

function signingKeyFile(data) {
  return path.join(data, '.local', 'stack', 'owner', 'signing-key.pem');
}

function storageDir(data) {
  return path.join(data, '.local', 'stack', 'owner', 'storage');
}

function envFile(path_) {
  const out = {};
  try {
    for (const line of fs.readFileSync(path_, 'utf8').split(/\r?\n/)) {
      // Split on the FIRST '=' only: values are base64 and can end in '='.
      const i = line.indexOf('=');
      if (i > 0 && !line.startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  } catch { /* no file yet */ }
  return out;
}

/**
 * Start the portable-MySQL supervisor (compiled binary) and wait until it
 * reports the server running. The supervisor owns mysqld for the whole
 * session; stopBackend kills it. Resolves with the supervisor child.
 */
function startMysqlSupervisor(root, data, log) {
  const supervisor = toolBinary(root, 'mysql-supervisor');
  if (!supervisor) {
    throw new Error(
      'The installer is missing the database supervisor (mysql-supervisor).\nReinstall OTSI VIE.',
    );
  }
  const pwFile = mysqlRootPasswordFile(data);
  let rootPw = envFile(pwFile).MYSQL_ROOT_PASSWORD || null;
  if (!rootPw) {
    rootPw = crypto.randomBytes(18).toString('base64url');
    writeSecretFile(pwFile, `MYSQL_ROOT_PASSWORD=${rootPw}\n`);
  }
  const zip = bundledMysqlZip();
  const env = {
    ...process.env,
    OTSI_VIE_DATA_DIR: data,
    OTSI_VIE_MYSQL_ROOT_PASSWORD: rootPw,
    OTSI_VIE_ENGINE_DIR: root,
    ...(zip ? { OTSI_VIE_MYSQL_ZIP: zip } : {}),
  };
  const child = spawn(supervisor, [], { env, windowsHide: true });
  let tail = '';
  let settled = false;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* already gone */ }
      reject(new Error('Portable MySQL did not start within 180 seconds.\n' + tail.slice(-2000)));
    }, 180000);
    const feed = (d) => {
      const text = d.toString();
      tail += text;
      if (tail.length > 20000) tail = tail.slice(-20000);
      if (log) log(text);
      if (!settled && /server running on 127\.0\.0\.1:3510/.test(text)) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, rootPw });
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Could not start portable MySQL: ${err.message}\n${tail}`));
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Portable MySQL stopped while starting (exit ${code}).\n${tail.slice(-2000)}`));
    });
  });
}

/**
 * Prepare the local database and return the process environment for the
 * API, web and workers, plus the MySQL supervisor child (null on SQLite).
 * Steps, in order:
 * SQLite (default): create the database file from the bootstrap schema
 *   (db-setup), run the migrations forward-only with a backup first
 *   (migrate up), create the signing key and the stack secrets. The
 *   database file already exists on later launches, so these are all
 *   no-ops except the migrations (pending ones apply).
 * MySQL (OTSI_VIE_DB_BACKEND=mysql): start portable MySQL, create the
 *   database + runtime account, run the migrations (forward-only),
 *   provision the roles, create the signing key and the stack secrets.
 */
async function prepareDatabase(root, data, userDataDir, detection, log, devMode) {
  const tools = ensureToolBinaries(root, log);
  if (!tools.ok) {
    if (devMode) {
      log('Dev mode: the compiled database tools are not staged; the Python sources in tools/db will be used instead.\n');
    } else {
      throw new Error(
        `The installer is incomplete — these compiled tools are missing: ${tools.missing.join(', ')}.\nReinstall OTSI VIE.`,
      );
    }
  }
  const backend = dbBackend();
  const sqlite = backend === 'sqlite';
  if (devMode && !sqlite) {
    throw new Error(
      'Dev mode: the database is set to MySQL, but the compiled MySQL tools are not staged here. Switch to SQLite (the default for a fresh install) or build the installer.',
    );
  }
  let mysqlSupervisor = null;
  let rootPw = null;
  let appDsn;
  if (sqlite) {
    // No server to start: the database is a file under the data folder.
    appDsn = sqliteDsn(data);
  } else {
    ({ child: mysqlSupervisor, rootPw } = await startMysqlSupervisor(root, data, log));
  }

  // Stack secrets (same format as the old local stack).
  let secrets = envFile(stackSecretsFile(data));
  if (!secrets.DB_PASSWORD) {
    secrets = {
      DB_USER: `otsi_app_${crypto.randomBytes(3).toString('hex')}`,
      DB_PASSWORD: crypto.randomBytes(18).toString('base64url'),
      MEDIA_SIGNING_KEY: crypto.randomBytes(24).toString('base64url'),
      CREDENTIAL_KEY: crypto.randomBytes(32).toString('base64'),
    };
    writeSecretFile(
      stackSecretsFile(data),
      Object.entries(secrets).map(([k, v]) => `${k}=${v}\n`).join(''),
    );
  }
  // The API's local signing key (RSA, as before).
  let keyFile = signingKeyFile(data);
  if (!fs.existsSync(keyFile)) {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 3072 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    writeSecretFile(keyFile, pem);
  }
  const storage = storageDir(data);
  fs.mkdirSync(storage, { recursive: true });

  if (sqlite) {
    // SQLite: no server, no runtime account, no MySQL roles. db-setup
    // creates the file from the bootstrap schema; migrate upgrades it
    // forward-only, backing it up first (migrate.py, safeguard 6).
    const sqliteEnv = {
      ...process.env,
      OTSI_VIE_DB_BACKEND: 'sqlite',
      OTSI_VIE_SQLITE_PATH: sqliteDbPath(data),
      OTSI_VIE_DB_DSN: appDsn,
    };
    if (devMode) {
      // Dev checkout: run the .py sources directly (pure stdlib for SQLite).
      await runPythonTool(root, 'db_setup.py', [], { log, env: sqliteEnv });
      await runPythonTool(root, 'migrate.py', ['up'], { log, env: sqliteEnv });
    } else {
      await runCommand(toolBinary(root, 'db-setup'), [], { log, env: sqliteEnv });
      await runCommand(toolBinary(root, 'migrate'), ['up'], { log, env: sqliteEnv });
    }
  } else {
    const rootDsn = `mysql://root:${rootPw}@127.0.0.1:${MYSQL_PORT}/${DB_NAME}`;
    appDsn = `mysql://${secrets.DB_USER}:${secrets.DB_PASSWORD}@127.0.0.1:${MYSQL_PORT}/${DB_NAME}`;
    const dbSetupEnv = {
      ...process.env,
      OTSI_VIE_ADMIN_HOST: '127.0.0.1',
      OTSI_VIE_ADMIN_PORT: String(MYSQL_PORT),
      OTSI_VIE_ADMIN_USER: 'root',
      OTSI_VIE_ADMIN_PASSWORD: rootPw,
      OTSI_VIE_APP_DB: DB_NAME,
      OTSI_VIE_APP_DB_USER: secrets.DB_USER,
      OTSI_VIE_APP_DB_PASSWORD: secrets.DB_PASSWORD,
    };
    // Create the database + runtime account (migrate.py needs the database
    // to exist in its DSN), then migrate, then provision the roles.
    await runCommand(toolBinary(root, 'db-setup'), [], { log, env: dbSetupEnv });
    await runCommand(toolBinary(root, 'migrate'), ['up'], {
      log,
      env: { ...process.env, OTSI_VIE_DB_DSN: rootDsn },
    });
    await runCommand(toolBinary(root, 'roles'), [], {
      log,
      env: { ...process.env, OTSI_VIE_ADMIN_DSN: rootDsn },
    });
  }

  const env = {
    OTSI_VIE_DB_DSN: appDsn,
    OTSI_VIE_DB_BACKEND: backend,
    // The API's SQLite file (OTSI_VIE_DB_PATH). loadConfig and
    // loadWorkerConfig require it when the backend is sqlite; the DSN
    // alone is not enough, and without it the API and bootstrap-owner
    // refuse to start with "missing required setting OTSI_VIE_DB_PATH".
    ...(sqlite ? { OTSI_VIE_DB_PATH: sqliteDbPath(data) } : {}),
    OTSI_VIE_JWT_ISSUER: `http://127.0.0.1:${WEB_PORT}/`,
    OTSI_VIE_JWT_AUDIENCE: 'otsi-vie-api',
    OTSI_VIE_LOCAL_SIGNING_KEY_FILE: keyFile,
    OTSI_VIE_INSECURE_COOKIES: 'yes', // plain HTTP on this machine only
    OTSI_VIE_WEB_ORIGINS: `http://127.0.0.1:${WEB_PORT},http://localhost:${WEB_PORT}`,
    OTSI_VIE_API_PORT: String(API_PORT),
    OTSI_VIE_API_INTERNAL_URL: API_URL, // the web build bakes this in at packaging time; must match
    OTSI_VIE_STORAGE_DIR: storage,
    OTSI_VIE_MEDIA_SIGNING_KEY: secrets.MEDIA_SIGNING_KEY,
    OTSI_VIE_CREDENTIAL_KEY: secrets.CREDENTIAL_KEY, // seals users' provider tokens between the API and the worker
    OTSI_VIE_MODELS_DIR: modelsDir(data),
    OTSI_VIE_AI_RUNTIME: detection.runtime,
    OTSI_VIE_INFERENCE_DEVICE: detection.inferenceDevice,
    PLAYWRIGHT_BROWSERS_PATH: path.join(data, 'browsers'), // the local headless Chromium that prints player reports to PDF (ADR-056)
    HF_HOME: path.join(data, 'hf'), // model libraries never write to C:
    HF_HUB_OFFLINE: '1', // workers load verified local weights only
    ...licence.licenceEnvForWorker(userDataDir), // token + central public key, for the native engine to verify
  };
  // Forward central-server configuration when the install has one, so the
  // local engine can verify licence tokens against the central key. The URL
  // and the key come from the environment or the build-time file
  // (resources/central.json) — env wins — so a staging build talks to the
  // staging server without any environment on the user's PC.
  const centralUrl = centralConfig.centralServerUrl();
  if (centralUrl) env.OTSI_VIE_CENTRAL_SERVER_URL = centralUrl;
  const licenceKey = centralConfig.licencePublicKeyPem();
  if (licenceKey) env.OTSI_VIE_LICENCE_PUBLIC_KEY_PEM = licenceKey;
  for (const k of ['OTSI_VIE_CENTRAL_MODE',
    'OTSI_VIE_LICENCE_GRACE_DAYS', 'OTSI_VIE_CENTRAL_JWKS_URL']) {
    if (process.env[k]) env[k] = process.env[k];
  }
  return { env, mysqlSupervisor };
}

/* ------------------------------------------------------------------ */
/* owner account                                                       */
/* ------------------------------------------------------------------ */

async function bootstrapOwner(root, env, details, log) {
  // The bootstrap CLI reads its password from OTSI_VIE_BOOTSTRAP_PASSWORD;
  // without it, it prompts on the terminal, which a GUI app has none of
  // (stdin is ignored), so it would fail. The owner form collects the
  // password and it is passed here only as an environment variable to
  // the child process — never written to a file or to the log.
  const node = bundledNode();
  await runCommand(
    node.cmd,
    [path.join(otsiVieDir(root), 'apps', 'api', 'dist', 'cli', 'bootstrap-owner.js'),
      '--email', details.email, '--name', details.name, '--organization', details.organization],
    {
      cwd: path.join(otsiVieDir(root), 'apps', 'api'),
      log,
      env: { ...process.env, ...env, ...node.extraEnv, OTSI_VIE_BOOTSTRAP_PASSWORD: details.password },
    },
  );
}

function ownerMarkerExists(data) {
  return fs.existsSync(path.join(data, '.local', 'stack', 'owner', 'owner-created.txt'));
}

function writeOwnerMarker(data) {
  const dir = path.join(data, '.local', 'stack', 'owner');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'owner-created.txt'),
    'owner account created by the OTSI VIE desktop app\n',
  );
}

/* ------------------------------------------------------------------ */
/* start / stop                                                        */
/* ------------------------------------------------------------------ */

/**
 * Start the engine: the pre-built API, the outbox dispatcher, the web app
 * (Next.js standalone server) and one Nuitka-compiled worker per group.
 * The API and web are critical — if one exits, exitPromise resolves and
 * the main process reports it at once instead of waiting. A worker that
 * exits is logged (jobs wait until it is back); it does not kill the app.
 * Returns a handle for stopBackend.
 */
function startBackend(root, data, env, logStream, log, mysqlSupervisor, devMode) {
  const otsiVie = otsiVieDir(root);
  const node = bundledNode();
  const workerExe = nativeWorkerExe(root);
  if (!workerExe) {
    if (devMode) {
      if (log) log('Dev mode: no compiled worker — the API and web still start, and video jobs will wait until a worker exists.\n');
    } else {
      throw new Error(
        'The installer is missing the compiled worker (vie_worker.exe).\nReinstall OTSI VIE.',
      );
    }
  }
  const fullEnv = { ...process.env, ...env, ...node.extraEnv, NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'production' };
  const children = [];
  let firstCriticalExit = null;
  const exitPromise = new Promise((resolve) => { firstCriticalExit = resolve; });

  const spawnChild = (name, cmd, args, options, critical) => {
    const child = spawn(cmd, args, {
      ...options,
      stdio: ['ignore', logStream, logStream],
      windowsHide: true,
    });
    children.push({ name, child, critical });
    child.on('error', (err) => {
      if (log) log(`The ${name} process could not start: ${err.message}\n`);
      if (critical) firstCriticalExit({ name, code: 'spawn-error' });
    });
    child.on('exit', (code) => {
      if (critical) {
        // Log it: without this line a critical child dying (for example the
        // API) closes the app with nothing in backend.log to say which child
        // died or why — that is how the Electron 43 shutdown went undiagnosed.
        if (log) log(`The ${name} process stopped (exit ${code}); the engine is stopping.\n`);
        firstCriticalExit({ name, code });
      } else if (log) log(`The ${name} worker stopped (exit ${code}); video jobs will wait until it is back.\n`);
    });
    return child;
  };

  spawnChild('api', node.cmd, [path.join(otsiVie, 'apps', 'api', 'dist', 'main.js')], {
    cwd: path.join(otsiVie, 'apps', 'api'), env: fullEnv,
  }, true);
  spawnChild('outbox', node.cmd, [path.join(otsiVie, 'apps', 'api', 'dist', 'workers', 'outbox-dispatcher.js')], {
    cwd: path.join(otsiVie, 'apps', 'api'), env: fullEnv,
  }, true);
  // Monorepo standalone layout: the server is at
  // .next/standalone/apps/web/server.js (run it from .next/standalone;
  // it chdirs to its own folder). It reads PORT and HOSTNAME from the
  // environment. The static assets and public folder are copied into the
  // standalone tree at packaging time (see electron-builder.yml).
  spawnChild('web', node.cmd, [path.join(otsiVie, 'apps', 'web', '.next', 'standalone', 'apps', 'web', 'server.js')], {
    cwd: path.join(otsiVie, 'apps', 'web', '.next', 'standalone'),
    env: { ...fullEnv, PORT: String(WEB_PORT), HOSTNAME: '127.0.0.1' },
  }, true);
  if (workerExe) {
    for (const [group, kinds] of Object.entries(WORKER_GROUPS)) {
      spawnChild(group, workerExe, [], {
        cwd: otsiVie,
        env: { ...fullEnv, OTSI_VIE_WORKER_KINDS: kinds },
      }, false);
    }
  }
  if (mysqlSupervisor) children.push({ name: 'mysql', child: mysqlSupervisor, critical: false });

  return { children, exitPromise };
}

/** Stop every child and its whole process tree. Never hangs. */
function stopBackend(handle) {
  if (!handle) return Promise.resolve();
  const stops = handle.children.map(({ name, child }) => new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    child.once('exit', finish);
    setTimeout(finish, 8000);
    if (process.platform === 'win32') {
      // /T takes the whole tree down — the API, the workers and their
      // ffmpeg children, and mysqld under its supervisor.
      execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], () => finish());
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already gone */ }
        finish();
      }, 5000);
    }
  }));
  return Promise.all(stops).then(() => undefined);
}

/** Poll the web app until it answers (any HTTP response counts), or time out. */
function waitForWeb(url, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(
            new Error(
              `The web app did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
            ),
          );
          return;
        }
        setTimeout(attempt, 1000);
      });
      req.setTimeout(3000, () => req.destroy(new Error('timeout')));
    };
    attempt();
  });
}

/** True when a TCP port on localhost answers (used by tests). */
function portAnswers(port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}

module.exports = {
  WEB_PORT,
  API_PORT,
  MYSQL_PORT,
  WEB_URL,
  API_URL,
  DB_NAME,
  WORKER_GROUPS,
  MIN_MODELS,
  RUNTIME_FILES,
  TOOL_BINARIES,
  resourcesDir,
  engineRoot,
  otsiVieDir,
  dataDir,
  applyBuildIdentity,
  modelsDir,
  componentsDir,
  verifyBundledEngine,
  bundledNode,
  toolBinDir,
  toolBinary,
  ensureToolBinaries,
  nativeWorkerExe,
  aiRuntimeDir,
  ensureAiRuntime,
  bundledMysqlZip,
  dbBackend,
  sqliteDbPath,
  sqliteDsn,
  registryPath,
  registryHash,
  ensureModels,
  prepareDatabase,
  bootstrapOwner,
  ownerMarkerExists,
  writeOwnerMarker,
  startBackend,
  stopBackend,
  waitForWeb,
  portAnswers,
  runCommand,
  execFileAsync,
  hardware,
  licence,
};
