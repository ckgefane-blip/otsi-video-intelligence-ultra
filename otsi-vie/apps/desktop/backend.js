'use strict';
/**
 * Backend management for the OTSI VIE desktop app.
 *
 * No Electron dependency in this module, so it can be checked and exercised
 * with plain Node. It mirrors the flow of the OTSI-VIE.exe launcher
 * (~/workspace/otsi-launcher/launcher.c):
 *
 *   find Python -> ensure the engine repo -> pnpm install -> prepare
 *   (portable MySQL, no Docker) -> build if needed -> owner account ->
 *   start `local_stack.py run --no-build --mysql portable` -> wait for
 *   http://localhost:4311. (localhost, not 127.0.0.1: the browser rejects
 *   127.0.0.1 as a WebAuthn RP ID — "127.0.0.1 is an invalid domain" —
 *   while localhost is a valid domain, so passkeys only work on localhost.)
 *
 * Everything runs through child_process directly (no shell), so there are no
 * cmd.exe quoting problems. All output goes to a caller-supplied log
 * function; nothing is printed to a console here.
 */

const { spawn, execFile } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const REPO_URL = 'https://github.com/ckgefane-blip/otsi-video-intelligence-ultra.git';
const BRANCH = 'muse/ultra-main';
// The desktop app always runs the portable stack, which uses its own ports
// (web 4311, API 4521, MySQL 3510) so it can run side by side with the
// original engine (web 4310, API 4520, MySQL 3508).
const WEB_PORT = 4311;
const API_PORT = 4521;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const DOCKER_CONTAINER = 'otsi-vie-v2-mysql';

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
 * with the exit code and the last output otherwise.
 */
function runCommand(cmd, args, options = {}) {
  const { cwd, log, env } = options;
  // On Windows, newer Node (including the Node inside this Electron
  // version) refuses to start .cmd/.bat files directly and fails with
  // `spawn EINVAL` (CVE-2024-27980). Run those through the Windows
  // command shell instead. The path AND each argument must be quoted:
  // `shell: true` alone is not enough — it leaves `C:\Program Files\...`
  // unquoted and cmd.exe then fails with `'C:\Program' is not
  // recognized`. So build the command line with every part quoted and
  // run it via cmd.exe /d /s /c (the /s strips the outer quotes,
  // leaving the quoted path + args). Pass it verbatim
  // (windowsVerbatimArguments): without that, Node adds its own
  // escaping on top of the quoted command line and cmd.exe misreads
  // the start of the path as a network path ("The network path was
  // not found"). This is the only place a .cmd is started:
  // corepack.cmd (via resolveCorepack).
  let spawnCmd = cmd;
  let spawnArgs = args;
  let spawnOpts = {};
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
    const quote = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const commandLine = [cmd, ...args].map(quote).join(' ');
    spawnCmd = process.env.ComSpec || 'cmd.exe';
    spawnArgs = ['/d', '/s', '/c', `"${commandLine}"`];
    spawnOpts.windowsVerbatimArguments = true;
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spawnCmd, spawnArgs, {
        cwd,
        env: env || process.env,
        windowsHide: true,
        ...spawnOpts,
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

function stackScript(otsiVieDir) {
  return path.join(otsiVieDir, 'tools', 'dev', 'local_stack.py');
}

/* ------------------------------------------------------------------ */
/* Python                                                              */
/* ------------------------------------------------------------------ */

// The video libraries are several GB. They must live on D: (the data
// drive), never on C: (the system drive), so a library download never
// fills C:. On Windows, when a D: drive exists, the app's own Python
// environment and pip's download cache both live there; otherwise they
// fall back to the engine folder / pip's default cache.
function venvDir(engineDir) {
  if (process.platform === 'win32') {
    try {
      if (fs.existsSync('D:\\')) return path.join('D:\\OTSI-VIE', '.venv');
    } catch { /* no D: drive */ }
  }
  return path.join(engineDir, '.venv');
}

function pipCacheDir() {
  if (process.platform === 'win32') {
    try {
      if (fs.existsSync('D:\\')) return path.join('D:\\OTSI-VIE', 'pip-cache');
    } catch { /* no D: drive */ }
  }
  return null;
}

function pythonCandidates(engineDir) {
  if (process.platform === 'win32') {
    // Only this project's own virtual environment. Never fall back to
    // another project's .venv (in particular never the original
    // project's VIE-Engine-v2\.venv) — ULTRA must not depend on a
    // folder outside its own repo.
    return [path.join(venvDir(engineDir), 'Scripts', 'python.exe')];
  }
  return [path.join(engineDir, '.venv', 'bin', 'python3'), 'python3'];
}

async function testPython(pythonExe) {
  try {
    await fs.promises.access(pythonExe, fs.constants.F_OK);
  } catch {
    return false;
  }
  try {
    await runCommand(pythonExe, ['--version'], {});
    await runCommand(pythonExe, ['-c', 'import pymysql'], {});
    return true;
  } catch {
    return false;
  }
}

/** A Python that lives inside a .venv belonging to another project. */
function isForeignVenv(pythonExe, engineDir) {
  const ownVenv = venvDir(engineDir).toLowerCase();
  const engineVenv = path.join(engineDir, '.venv').toLowerCase();
  const p = String(pythonExe).toLowerCase();
  return /\.venv[\\/]/.test(p) && !p.startsWith(ownVenv) && !p.startsWith(engineVenv);
}

/**
 * Create this project's own .venv (if it does not exist yet) with the
 * system Python and install the database driver into it, so ULTRA never
 * has to borrow a Python from another project. Returns the venv's
 * Python when it runs and has the driver, else null.
 */
async function ensureOwnVenv(engineDir, log) {
  const venvPy = pythonCandidates(engineDir)[0];
  if (await testPython(venvPy)) return venvPy;
  // Find a system python (not inside any other project's .venv).
  let sysPy = null;
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(finder, ['python']);
    for (const line of stdout.split(/\r?\n/)) {
      const cand = line.trim();
      if (!cand || isForeignVenv(cand, engineDir)) continue;
      try {
        await runCommand(cand, ['--version'], {});
        sysPy = cand;
        break;
      } catch {
        // not usable
      }
    }
  } catch {
    // no python on PATH
  }
  if (!sysPy) return null;
  const venv = venvDir(engineDir);
  const cache = pipCacheDir();
  const cacheArgs = cache ? ['--cache-dir', cache] : [];
  try {
    if (!fs.existsSync(venvPy)) {
      await runCommand(sysPy, ['-m', 'venv', venv], { log });
    }
    await runCommand(venvPy, ['-m', 'pip', 'install', ...cacheArgs, 'pymysql'], { log });
  } catch {
    return null;
  }
  return (await testPython(venvPy)) ? venvPy : null;
}

/** First Python that runs and has the engine's database driver, else null. */
async function findPython(engineDir, log) {
  for (const cand of pythonCandidates(engineDir)) {
    if (await testPython(cand)) return cand;
  }
  // Create this project's own .venv rather than borrowing another
  // project's Python.
  const own = await ensureOwnVenv(engineDir, log);
  if (own) return own;
  // Last resort: a python on PATH that is not inside another project's .venv.
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(finder, ['python']);
    for (const line of stdout.split(/\r?\n/)) {
      const cand = line.trim();
      if (!cand || isForeignVenv(cand, engineDir)) continue;
      if (await testPython(cand)) return cand;
    }
  } catch {
    // ignore: no python on PATH
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

/**
 * The corepack command to run. Resolved once to an absolute path next to
 * the Node.js executable when possible. A GUI app launched from Explorer
 * can have a stale PATH that finds `node` (and `git`) but not `corepack`,
 * so resolving it next to `node` — which the check above already proved
 * is findable — removes that whole class of failure. Falls back to the
 * bare `corepack` on PATH when the absolute path does not exist.
 */
let corepackCmd = 'corepack';
let corepackResolved = false;

async function resolveCorepack() {
  if (corepackResolved) return corepackCmd;
  corepackResolved = true;
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(finder, ['node']);
    const nodePath = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (nodePath) {
      const candidate = path.join(
        path.dirname(nodePath),
        process.platform === 'win32' ? 'corepack.cmd' : 'corepack',
      );
      if (fs.existsSync(candidate)) corepackCmd = candidate;
    }
  } catch {
    // fall back to `corepack` on PATH
  }
  return corepackCmd;
}

/** Check git, Node >= 22 and pnpm exist. Throws a plain-worded Error. */
async function checkTools() {
  try {
    await runCommand('git', ['--version'], {});
  } catch {
    throw new Error(
      'Git was not found on this machine.\nInstall it once from https://git-scm.com/download/win , then open OTSI VIE again.',
    );
  }
  let nodeOut = '';
  try {
    nodeOut = (await execFileAsync('node', ['--version'])).stdout.trim();
  } catch {
    throw new Error(
      'Node.js was not found on this machine.\nInstall Node.js 22 (LTS) once from https://nodejs.org/ , then open OTSI VIE again.',
    );
  }
  const major = parseInt(nodeOut.replace(/^v/, ''), 10);
  if (Number.isNaN(major) || major < 22) {
    throw new Error(
      `Node.js ${nodeOut} is too old. OTSI VIE needs Node.js 22 or newer.\nInstall Node.js 22 (LTS) once from https://nodejs.org/ , then open OTSI VIE again.`,
    );
  }
  await resolveCorepack();
  try {
    await runCommand(corepackCmd, ['pnpm', '--version'], {});
  } catch (err) {
    // Do not claim pnpm is missing when the real cause may be that the
    // check itself could not start (e.g. spawn EINVAL on corepack.cmd).
    // Report the actual failure so the next diagnosis starts from it.
    throw new Error(
      'Could not run pnpm, so the app cannot start.\n'
      + `(${corepackCmd} pnpm --version: ${err.message})\n`
      + 'If pnpm is missing, open a terminal once and run: corepack enable, then open OTSI VIE again.',
    );
  }
}

/* ------------------------------------------------------------------ */
/* engine repo                                                         */
/* ------------------------------------------------------------------ */

async function ensureRepo(engineDir, log) {
  if (!fs.existsSync(path.join(engineDir, '.git'))) {
    fs.mkdirSync(path.dirname(engineDir), { recursive: true });
    log(`Getting the engine (first time, a few minutes)...\n`);
    await runCommand('git', ['clone', REPO_URL, engineDir], { log });
  }
  await runCommand('git', ['fetch', 'origin'], { cwd: engineDir, log });
  try {
    await runCommand('git', ['checkout', BRANCH], { cwd: engineDir, log });
  } catch {
    await runCommand('git', ['checkout', '-b', BRANCH, `origin/${BRANCH}`], {
      cwd: engineDir,
      log,
    });
  }
  await runCommand('git', ['pull', '--ff-only'], { cwd: engineDir, log });
}

async function ensureJsDeps(otsiVieDir, log) {
  // Install whenever the dependencies changed, not only the first time.
  // The old check returned as soon as node_modules existed, so a pulled
  // update that adds a package (e.g. @simplewebauthn/server for passkeys)
  // was never installed and the build then failed with "Cannot find
  // module". Record a hash of the lockfile + the workspace package.json
  // files (.local/js-deps, git-ignored) and reinstall when it changes.
  const depFiles = ['pnpm-lock.yaml', 'package.json', 'apps/api/package.json', 'apps/web/package.json', 'apps/desktop/package.json', 'packages/contracts/package.json'];
  let depHash = null;
  try {
    const h = crypto.createHash('sha256');
    for (const f of depFiles) h.update(fs.readFileSync(path.join(otsiVieDir, f)));
    depHash = h.digest('hex');
  } catch {
    // A dependency file cannot be read: fall back to the old behaviour
    // (install only when node_modules is missing).
    depHash = null;
  }
  const marker = path.join(otsiVieDir, '.local', 'js-deps');
  let installedHash = null;
  try { installedHash = fs.readFileSync(marker, 'utf8').trim(); } catch { /* no marker yet */ }
  if (depHash && installedHash === depHash && fs.existsSync(path.join(otsiVieDir, 'node_modules'))) return;
  if (!depHash && fs.existsSync(path.join(otsiVieDir, 'node_modules'))) return;
  log(installedHash ? 'Installing the new engine packages (the dependencies changed)...\n' : 'Installing the engine packages (first time, a few minutes)...\n');
  await resolveCorepack();
  await runCommand(corepackCmd, ['pnpm', 'install'], { cwd: otsiVieDir, log });
  if (depHash) {
    fs.mkdirSync(path.join(otsiVieDir, '.local'), { recursive: true });
    fs.writeFileSync(marker, depHash + '\n', 'utf8');
  }
}

// The video workers need the full CV/AI stack (requirements.txt, ~45
// packages including the torch CPU build, OpenVINO, PaddleOCR and
// pyarrow). First-run setup only installed pymysql (the database
// driver), so the workers could never start — the Admin page showed
// "No Active Workers Detected" and no video could be processed. Install
// requirements.txt into the app's own venv on first run, and again when
// requirements.txt changes (the marker records its hash). torch is the
// CPU build, which lives on PyTorch's own index, so pass
// --extra-index-url. This is a large download (several GB) and takes a
// while; pip's output goes to the log so the loading window shows
// progress. A failure does not stop the app from opening, but the
// workers will not run until it succeeds — the marker is only written
// on success, so the next launch retries.
async function ensureWorkerDeps(otsiVieDir, venvPy, log) {
  const reqFile = path.join(otsiVieDir, 'requirements.txt');
  let reqHash = null;
  try {
    reqHash = crypto.createHash('sha256').update(fs.readFileSync(reqFile)).digest('hex');
  } catch {
    log('Could not read requirements.txt; the video libraries were not installed.\n');
    return false;
  }
  const marker = path.join(otsiVieDir, '.local', 'worker-deps');
  try {
    if (fs.readFileSync(marker, 'utf8').trim() === reqHash) return true;
  } catch {
    // No marker yet: install.
  }
  log('Installing the video libraries (first time, a few minutes — several GB)...\n');
  const cache = pipCacheDir();
  const cacheArgs = cache ? ['--cache-dir', cache] : [];
  try {
    await runCommand(venvPy, ['-m', 'pip', 'install', ...cacheArgs, '--extra-index-url', 'https://download.pytorch.org/whl/cpu', '-r', reqFile], { log });
  } catch {
    log('The video libraries could not be installed, so video analysis will not run yet.\n' +
      'Check the connection and disk space, then open OTSI VIE again to retry.\n');
    return false;
  }
  // Verify the heavy imports the workers need, so a half-installed venv
  // is not mistaken for a working one.
  try {
    await runCommand(venvPy, ['-c', 'import numpy, pyarrow, torch, openvino, PIL'], {});
  } catch {
    log('The video libraries installed but the check import failed; they will be retried next launch.\n');
    return false;
  }
  fs.mkdirSync(path.join(otsiVieDir, '.local'), { recursive: true });
  fs.writeFileSync(marker, reqHash + '\n', 'utf8');
  return true;
}

// The web build bakes the API address into its /api proxy at build time
// (next.config reads OTSI_VIE_API_INTERNAL_URL). If the baked address does
// not match this stack's API, a stale build would keep proxying sign-in
// (and every API call) to the wrong API — e.g. the original engine's on
// 4520 — which rejects the request because it comes from an unfamiliar
// origin. Rebuild the web when the baked address is wrong.
function webBuildPointsAtApi(otsiVieDir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(otsiVieDir, 'apps', 'web', '.next', 'routes-manifest.json'), 'utf8'));
    const rewrites = Array.isArray(manifest.rewrites)
      ? manifest.rewrites
      : [...(manifest.rewrites?.beforeFiles ?? []), ...(manifest.rewrites?.afterFiles ?? []), ...(manifest.rewrites?.fallback ?? [])];
    const apiRewrite = rewrites.find((r) => typeof r.source === 'string' && r.source.startsWith('/api/'));
    return !!apiRewrite && typeof apiRewrite.destination === 'string' && apiRewrite.destination.startsWith(API_URL);
  } catch {
    return false; // no readable manifest: build.
  }
}

// The builds are only valid for the commit they were built from. After
// the app downloads new code (ensureRepo pulls on every launch), a stale
// build would keep serving the old pages — a page fix in the repo would
// never reach an installed copy (that is how the Reel Builder crash kept
// showing the old bundle). So record the commit the builds were made
// from (in .local/, which is git-ignored) and rebuild whenever the
// checked-out commit changes.
async function currentCommit(otsiVieDir) {
  try {
    const { tail } = await runCommand('git', ['rev-parse', 'HEAD'], { cwd: otsiVieDir });
    const sha = tail.trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch {
    return null; // not a git checkout, or git unavailable: never skip a build on this basis.
  }
}

function builtCommit(otsiVieDir) {
  try {
    return fs.readFileSync(path.join(otsiVieDir, '.local', 'last-built-commit'), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function recordBuiltCommit(otsiVieDir, sha) {
  if (!sha) return;
  fs.mkdirSync(path.join(otsiVieDir, '.local'), { recursive: true });
  fs.writeFileSync(path.join(otsiVieDir, '.local', 'last-built-commit'), sha + '\n', 'utf8');
}

async function buildPackages(otsiVieDir, pkgs, log, buildEnv) {
  await resolveCorepack();
  for (const pkg of pkgs) {
    await runCommand(corepackCmd, ['pnpm', 'build'], {
      cwd: path.join(otsiVieDir, pkg),
      log,
      env: buildEnv,
    });
  }
}

async function ensureBuilds(otsiVieDir, log) {
  const apiDist = path.join(otsiVieDir, 'apps', 'api', 'dist', 'main.js');
  const webBuild = path.join(otsiVieDir, 'apps', 'web', '.next', 'BUILD_ID');
  const contractsDist = path.join(otsiVieDir, 'packages', 'contracts', 'dist');
  const buildsExist = fs.existsSync(apiDist) && fs.existsSync(webBuild) && fs.existsSync(contractsDist);
  const head = await currentCommit(otsiVieDir);
  const built = builtCommit(otsiVieDir);
  const manifestOk = webBuildPointsAtApi(otsiVieDir);
  // Up to date only when the builds exist, the web proxies to this
  // stack's API, AND they were built from the commit now checked out.
  // When the commit cannot be read (head null) keep the old behaviour
  // and do not rebuild on every launch.
  if (buildsExist && manifestOk && head !== null && built === head) return;
  if (buildsExist && manifestOk && head === null) return;
  // The web build must know the API address or it bakes in the default
  // (4520, the original engine's API). Pass it explicitly; runCommand
  // replaces the env when one is given, so merge with the current env.
  const buildEnv = { ...process.env, OTSI_VIE_API_INTERNAL_URL: API_URL };
  const codeChanged = head !== null && built !== null && built !== head;
  const neverRecorded = head !== null && built === null;
  if (buildsExist && (codeChanged || neverRecorded)) {
    // New code was downloaded (or this install predates the record):
    // any of the three packages could have changed, so rebuild all of
    // them, not just the web. This must run even when the baked API
    // address is also out of date: the old code required the manifest
    // to be OK here, so when the address changed at the same time as
    // the code, only the website was rebuilt, the new commit was
    // recorded as fully built, and the API kept its old build — the
    // page ran on localhost while the API still said RP ID 127.0.0.1,
    // so Windows Hello refused the passkey.
    log('Rebuilding the engine: new code was downloaded (a few minutes)...\n');
    await buildPackages(otsiVieDir, ['packages/contracts', 'apps/api', 'apps/web'], log, buildEnv);
    recordBuiltCommit(otsiVieDir, head);
    return;
  }
  if (buildsExist) {
    // Only the baked API address is wrong (the commit is unchanged):
    // rebuild the website alone, as before.
    log('Rebuilding the website: its built-in API address is out of date...\n');
    await buildPackages(otsiVieDir, ['apps/web'], log, buildEnv);
    recordBuiltCommit(otsiVieDir, head);
    return;
  }
  log('Building the engine (first time, a few minutes)...\n');
  await buildPackages(otsiVieDir, ['packages/contracts', 'apps/api', 'apps/web'], log, buildEnv);
  recordBuiltCommit(otsiVieDir, head);
}

/* ------------------------------------------------------------------ */
/* stack                                                               */
/* ------------------------------------------------------------------ */

async function prepareStack(python, otsiVieDir, engineDir, log) {
  await runCommand(
    python,
    [stackScript(otsiVieDir), 'prepare', '--mysql', 'portable'],
    { cwd: engineDir, log },
  );
}

async function bootstrapOwner(python, otsiVieDir, engineDir, details, log) {
  // The bootstrap CLI reads its password from OTSI_VIE_BOOTSTRAP_PASSWORD;
  // without it, it prompts on the terminal, which a GUI app has none of
  // (stdin is ignored), so it would fail. The owner form collects the
  // password and it is passed here only as an environment variable to
  // the child process — never written to a file or to the log.
  await runCommand(
    python,
    [
      stackScript(otsiVieDir),
      'bootstrap-owner',
      '--mysql',
      'portable',
      '--email',
      details.email,
      '--name',
      details.name,
      '--organization',
      details.organization,
    ],
    { cwd: engineDir, log, env: { ...process.env, OTSI_VIE_BOOTSTRAP_PASSWORD: details.password } },
  );
}

function ownerMarkerExists(engineDir) {
  return fs.existsSync(
    path.join(engineDir, '.local', 'stack', 'owner', 'owner-created.txt'),
  );
}

function writeOwnerMarker(engineDir) {
  const dir = path.join(engineDir, '.local', 'stack', 'owner');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'owner-created.txt'),
    'owner account created by the OTSI VIE desktop app\n',
  );
}

/**
 * Start `local_stack.py run --no-build --mysql portable` as a child process.
 * Its output goes to the given log stream. Returns the ChildProcess.
 */
function startBackend(python, otsiVieDir, engineDir, logStream) {
  return spawn(
    python,
    [stackScript(otsiVieDir), 'run', '--no-build', '--mysql', 'portable'],
    {
      cwd: engineDir,
      stdio: ['ignore', logStream, logStream],
      windowsHide: true,
    },
  );
}

/** Stop the backend child and its whole process tree. Never hangs. */
function stopBackend(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    child.once('exit', finish);
    setTimeout(finish, 8000);
    if (process.platform === 'win32') {
      // local_stack.py run starts the API, workers and web app as children;
      // /T takes the whole tree down, same as the OTSI-VIE.exe launcher.
      execFile('taskkill', ['/F', '/T', '/PID', String(child.pid)], () => finish());
    } else {
      child.kill('SIGTERM');
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        finish();
      }, 5000);
    }
  });
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

module.exports = {
  REPO_URL,
  BRANCH,
  WEB_PORT,
  WEB_URL,
  DOCKER_CONTAINER,
  checkTools,
  resolveCorepack,
  findPython,
  pythonCandidates,
  testPython,
  ensureOwnVenv,
  ensureRepo,
  ensureJsDeps,
  ensureWorkerDeps,
  ensureBuilds,
  prepareStack,
  bootstrapOwner,
  ownerMarkerExists,
  writeOwnerMarker,
  startBackend,
  stopBackend,
  waitForWeb,
  runCommand,
  execFileAsync,
};
