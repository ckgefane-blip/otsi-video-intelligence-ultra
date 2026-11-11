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
 *   http://127.0.0.1:4310.
 *
 * Everything runs through child_process directly (no shell), so there are no
 * cmd.exe quoting problems. All output goes to a caller-supplied log
 * function; nothing is printed to a console here.
 */

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const REPO_URL = 'https://github.com/ckgefane-blip/otsi-video-intelligence-ultra.git';
const BRANCH = 'muse/ultra-main';
const WEB_PORT = 4310;
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
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

function pythonCandidates(engineDir) {
  if (process.platform === 'win32') {
    // Only this project's own virtual environment. Never fall back to
    // another project's .venv (in particular never the original
    // project's VIE-Engine-v2\.venv) — ULTRA must not depend on a
    // folder outside its own repo.
    return [path.join(engineDir, '.venv', 'Scripts', 'python.exe')];
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
  const ownVenv = path.join(engineDir, '.venv').toLowerCase();
  const p = String(pythonExe).toLowerCase();
  return /\.venv[\\/]/.test(p) && !p.startsWith(ownVenv);
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
  const venvDir = path.join(engineDir, '.venv');
  try {
    if (!fs.existsSync(venvPy)) {
      await runCommand(sysPy, ['-m', 'venv', venvDir], { log });
    }
    await runCommand(venvPy, ['-m', 'pip', 'install', 'pymysql'], { log });
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
  if (fs.existsSync(path.join(otsiVieDir, 'node_modules'))) return;
  log('Installing the engine packages (first time, a few minutes)...\n');
  await resolveCorepack();
  await runCommand(corepackCmd, ['pnpm', 'install'], { cwd: otsiVieDir, log });
}

async function ensureBuilds(otsiVieDir, log) {
  const apiDist = path.join(otsiVieDir, 'apps', 'api', 'dist', 'main.js');
  const webBuild = path.join(otsiVieDir, 'apps', 'web', '.next', 'BUILD_ID');
  const contractsDist = path.join(otsiVieDir, 'packages', 'contracts', 'dist');
  if (fs.existsSync(apiDist) && fs.existsSync(webBuild) && fs.existsSync(contractsDist)) return;
  log('Building the engine (first time, a few minutes)...\n');
  await resolveCorepack();
  for (const pkg of ['packages/contracts', 'apps/api', 'apps/web']) {
    await runCommand(corepackCmd, ['pnpm', 'build'], {
      cwd: path.join(otsiVieDir, pkg),
      log,
    });
  }
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
    { cwd: engineDir, log },
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
