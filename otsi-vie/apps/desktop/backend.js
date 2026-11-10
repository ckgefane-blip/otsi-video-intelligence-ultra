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

function stackScript(otsiVieDir) {
  return path.join(otsiVieDir, 'tools', 'dev', 'local_stack.py');
}

/* ------------------------------------------------------------------ */
/* Python                                                              */
/* ------------------------------------------------------------------ */

function pythonCandidates(engineDir) {
  if (process.platform === 'win32') {
    return [
      path.join(engineDir, '.venv', 'Scripts', 'python.exe'),
      'D:\\OTSI-Workspace\\VIE-Engine-v2\\.venv\\Scripts\\python.exe',
      'C:\\OTSI-Workspace\\VIE-Engine-v2\\.venv\\Scripts\\python.exe',
    ];
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

/** First Python that runs and has the engine's database driver, else null. */
async function findPython(engineDir) {
  for (const cand of pythonCandidates(engineDir)) {
    if (await testPython(cand)) return cand;
  }
  // Last resort: a python on PATH.
  try {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    const { stdout } = await execFileAsync(finder, ['python']);
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && (await testPython(first))) return first;
  } catch {
    // ignore: no python on PATH
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* tools                                                               */
/* ------------------------------------------------------------------ */

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
  try {
    await runCommand('corepack', ['pnpm', '--version'], {});
  } catch {
    throw new Error(
      'pnpm was not found (it comes with Node.js).\nOpen a terminal once and run: corepack enable\nThen open OTSI VIE again.',
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
  await runCommand('corepack', ['pnpm', 'install'], { cwd: otsiVieDir, log });
}

async function ensureBuilds(otsiVieDir, log) {
  const apiDist = path.join(otsiVieDir, 'apps', 'api', 'dist', 'main.js');
  const webBuild = path.join(otsiVieDir, 'apps', 'web', '.next', 'BUILD_ID');
  const contractsDist = path.join(otsiVieDir, 'packages', 'contracts', 'dist');
  if (fs.existsSync(apiDist) && fs.existsSync(webBuild) && fs.existsSync(contractsDist)) return;
  log('Building the engine (first time, a few minutes)...\n');
  for (const pkg of ['packages/contracts', 'apps/api', 'apps/web']) {
    await runCommand('corepack', ['pnpm', 'build'], {
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
  findPython,
  pythonCandidates,
  testPython,
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
