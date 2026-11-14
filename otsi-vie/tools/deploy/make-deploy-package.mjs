#!/usr/bin/env node
/**
 * Deploy package for the OTSI account server (ADR-146 step 6, staging plan B).
 *
 * The repo is a pnpm workspace; the host (cPanel, shared hosting) needs a plain Node app folder.
 * This script builds the API + contracts and writes a self-contained folder:
 *
 *   <out>/
 *     package.json          @otsi-vie/api, exact (pinned) dependency versions, `npm start` runs the API
 *     package-lock.json     generated here, so the host installs exactly these versions with `npm ci --omit=dev`
 *     dist/                 the built API (node dist/main.js)
 *     vendor/contracts/       the built @otsi-vie/contracts, as an extracted folder (dist + package.json)
 *     scripts/install-contracts.mjs   postinstall: copies vendor/contracts into node_modules/@otsi-vie/contracts
 *     README.md             how to install and run it on the host
 *
 * The contracts are NOT a dependency in package.json at all. They ship as an extracted folder,
 * `vendor/contracts/` (dist + package.json), and a `postinstall` script copies them into
 * `node_modules/@otsi-vie/contracts/` after `npm ci` installs the rest. That is deliberate:
 * on the host (cPanel shared hosting) `node_modules` is itself a symlink into ~/nodevenv/...,
 * so a `file:./vendor/...` dependency — folder or tarball — is resolved against the symlink
 * target instead of this folder, and `npm ci` fails unless the vendor folder is also symlinked
 * into the nodevenv by hand. With no `file:` dependency there is nothing for npm to resolve
 * wrongly: `npm ci` installs the registry packages (removing or following the symlink as its
 * version does), then `postinstall` copies the contracts into whichever `node_modules` the app
 * actually uses. Run `npm ci --omit=dev` WITHOUT `--ignore-scripts`, so the copy runs.
 *
 * The postinstall is best-effort, not the only copy — and it is deliberately a plain
 * command, not a `node -e` one-liner: `node scripts/install-contracts.mjs || exit 0`.
 * A one-liner has to survive the shell that runs it, and on Windows that shell is
 * cmd.exe, which mangles quoted `-e` code: the 6e262c4 pathToFileURL one-liner still
 * never copied the contracts on real Windows — `npm ci` exited 0 and the contracts
 * were missing, so the failure was silent. The plain command has no inner quotes, no
 * `-e`, no path to resolve, so there is nothing for cmd (or sh) to mangle; the
 * installer script itself resolves the package root from its own file location
 * (`import.meta.url`), never from the working directory. On cPanel npm runs the
 * postinstall with the wrong working directory (~/nodevenv/<app>/<version>/lib, not
 * the app folder), so the plain `node scripts/...` cannot find the script there —
 * the `|| exit 0` makes that a no-op instead of a failed install (`npm ci` still
 * exits 0), and the server installs the contracts itself on start as a backstop:
 * apps/api/src/ensure-contracts.ts (imported first by main.ts) copies
 * vendor/contracts/ into node_modules when the contracts do not resolve, using paths
 * from its own file location, never from the working directory. So a plain
 * `npm ci --omit=dev` works on cPanel with no manual symlink and no manual step,
 * and it exits 0. The test also runs `npm ci` with `--ignore-scripts=false`, so a
 * machine whose npm config skips lifecycle scripts cannot silently skip the copy —
 * that reproduces the Windows failure exactly (install exits 0, contracts missing).
 *
 * Usage:
 *   node otsi-vie/tools/deploy/make-deploy-package.mjs [--out <dir>] [--skip-build] [--skip-lockfile]
 *
 * Defaults: --out otsi-vie/dist-deploy/otsi-vie-accounts. The output folder is wiped first, so a stale
 * build can never ship. Nothing in the repo is pushed or deployed by this script — it only writes the folder.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const API_DIR = path.join(ROOT, "otsi-vie", "apps", "api");
const CONTRACTS_DIR = path.join(ROOT, "otsi-vie", "packages", "contracts");

/** Resolve a file inside a package from a base package, following the workspace install wherever it
 *  actually put it. The repo's .npmrc uses node-linker=hoisted, so on the owner's PC the packages live
 *  in the workspace root (otsi-vie/node_modules), not under apps/api/node_modules — a plain path join
 *  misses them there, while this resolve works in either layout. Returns null when it cannot resolve. */
function resolveFrom(fromDir, spec) {
  try {
    return createRequire(path.join(fromDir, "package.json")).resolve(spec);
  } catch {
    return null;
  }
}

function log(msg) {
  console.log(`[deploy-package] ${msg}`);
}

function fail(msg) {
  console.error(`[deploy-package] ERROR: ${msg}`);
  process.exit(1);
}

function run(cmd, args, cwd) {
  log(`$ ${cmd} ${args.join(" ")}  (in ${path.relative(ROOT, cwd)})`);
  // npm is npm.cmd on Windows: execFileSync needs a shell to find it there.
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: cmd === "npm" && process.platform === "win32" });
}

function readJson(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Find a package's package.json by walking up from a base directory, checking node_modules at each
 *  level. This finds the package whether the install is hoisted (workspace root) or nested, and it does
 *  not depend on the package's exports map — some packages do not export ./package.json, so
 *  require.resolve(name + "/package.json") throws ERR_PACKAGE_PATH_NOT_EXPORTED for them. */
function findPackageJson(name, fromDir) {
  let dir = path.resolve(fromDir);
  while (true) {
    const p = path.join(dir, "node_modules", ...name.split("/"), "package.json");
    if (existsSync(p)) return p;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The exact installed version of a dependency, read from the workspace's own install — never guessed.
 *  Resolved from the package, so it works whether the install is hoisted (workspace root) or nested. */
function installedVersion(name, fromDir) {
  const p = findPackageJson(name, fromDir);
  if (!p) fail(`cannot pin ${name}: no installed copy (run the workspace install first)`);
  const v = readJson(p).version;
  if (typeof v !== "string" || !v) fail(`cannot pin ${name}: no version in ${path.relative(ROOT, p)}`);
  return v;
}

function main() {
  const args = process.argv.slice(2);
  const outArg = args.indexOf("--out");
  const out = path.resolve(outArg >= 0 && args[outArg + 1] ? args[outArg + 1] : path.join(ROOT, "otsi-vie", "dist-deploy", "otsi-vie-accounts"));
  const skipBuild = args.includes("--skip-build");
  const skipLockfile = args.includes("--skip-lockfile");
  if (outArg >= 0 && !args[outArg + 1]) fail("--out needs a directory");

  // TypeScript, resolved from the workspace install (hoisted to the workspace root on the owner's PC,
  // not under apps/api). Run it with node: the resolved file is the tsc script itself, which runs on
  // any platform — the .bin shim would not.
  const tsc = resolveFrom(API_DIR, "typescript/bin/tsc");
  if (!tsc || !existsSync(tsc)) fail("no TypeScript in the workspace install (run the workspace install first)");

  if (!skipBuild) {
    log("clean build: contracts, then the API");
    rmSync(path.join(CONTRACTS_DIR, "dist"), { recursive: true, force: true });
    rmSync(path.join(API_DIR, "dist"), { recursive: true, force: true });
    run(process.execPath, [tsc, "-p", "tsconfig.json"], CONTRACTS_DIR);
    run(process.execPath, [tsc, "-p", "tsconfig.build.json"], API_DIR);
  }
  const apiDist = path.join(API_DIR, "dist", "main.js");
  const contractsDist = path.join(CONTRACTS_DIR, "dist", "index.js");
  if (!existsSync(apiDist)) fail(`the API is not built (no ${path.relative(ROOT, apiDist)}); run without --skip-build`);
  if (!existsSync(contractsDist)) fail(`contracts are not built (no ${path.relative(ROOT, contractsDist)}); run without --skip-build`);

  const apiPkg = readJson(path.join(API_DIR, "package.json"));
  const contractsPkg = readJson(path.join(CONTRACTS_DIR, "package.json"));

  // Exact versions for every runtime dependency. The workspace package (@otsi-vie/contracts)
  // is NOT listed here at all (see below): it ships in vendor/contracts/ and is installed by
  // postinstall, because a `file:` dependency is resolved against the node_modules symlink
  // target on the host and breaks there.
  const dependencies = {};
  for (const [name] of Object.entries(apiPkg.dependencies ?? {})) {
    if (name === "@otsi-vie/contracts") continue;
    dependencies[name] = installedVersion(name, API_DIR);
  }
  const contractsDeps = {};
  for (const [name] of Object.entries(contractsPkg.dependencies ?? {})) {
    contractsDeps[name] = installedVersion(name, CONTRACTS_DIR);
  }

  log(`wiping the output folder ${path.relative(ROOT, out)}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(path.join(out, "vendor", "contracts"), { recursive: true });
  cpSync(path.join(API_DIR, "dist"), path.join(out, "dist"), { recursive: true });
  cpSync(path.join(CONTRACTS_DIR, "dist"), path.join(out, "vendor", "contracts", "dist"), { recursive: true });

  writeFileSync(path.join(out, "vendor", "contracts", "package.json"), JSON.stringify({
    name: "@otsi-vie/contracts",
    version: contractsPkg.version,
    private: true,
    description: contractsPkg.description ?? "",
    main: "dist/index.js",
    types: "dist/index.d.ts",
    dependencies: contractsDeps,
  }, null, 2) + "\n", "utf8");

  // No `file:` dependency and no tarball: `vendor/contracts/` stays an extracted folder, and the
  // postinstall script (below) copies it into node_modules after `npm ci`. A `file:` dependency —
  // folder or tarball — is resolved by npm against the node_modules symlink target on cPanel, so
  // it fails without a hand-made vendor symlink in the nodevenv. With no `file:` dependency
  // there is nothing to resolve wrongly; the copy lands in whichever node_modules the app uses.
  const contractsDir = path.join(out, "vendor", "contracts");
  if (!existsSync(path.join(contractsDir, "dist", "index.js"))) fail("verification failed: vendor/contracts/dist/index.js is missing");

  // postinstall: copy vendor/contracts into node_modules/@otsi-vie/contracts. Plain Node, no
  // shell, no tar — it runs after `npm ci` installs the rest, so `npm ci` must be run WITHOUT
  // --ignore-scripts (the README says so). Idempotent: it removes any stale copy first.
  mkdirSync(path.join(out, "scripts"), { recursive: true });
  writeFileSync(path.join(out, "scripts", "install-contracts.mjs"), [
    "#!/usr/bin/env node",
    "// postinstall for the deploy package: copy the vendored @otsi-vie/contracts into",
    "// node_modules. The contracts are NOT a dependency in package.json (see",
    "// make-deploy-package.mjs): on cPanel node_modules is a symlink into the nodevenv,",
    "// and a `file:` dependency is resolved against the symlink target, so `npm ci` fails",
    "// without a hand-made vendor symlink. This copy lands in whichever node_modules the",
    "// app actually uses, symlink or real directory.",
    "import { cpSync, existsSync, rmSync } from \"node:fs\";",
    "import path from \"node:path\";",
    "import { fileURLToPath } from \"node:url\";",
    "",
    "const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), \"..\");",
    "const src = path.join(root, \"vendor\", \"contracts\");",
    "const dest = path.join(root, \"node_modules\", \"@otsi-vie\", \"contracts\");",
    "if (!existsSync(path.join(src, \"dist\", \"index.js\"))) {",
    "  // Best-effort: never fail the install. The server installs the contracts itself",
    "  // on start (ensure-contracts.ts) when they are missing, so a missing vendor folder",
    "  // here is a warning, not an error — `npm ci` must still exit 0.",
    "  console.error(\"[install-contracts] WARNING: vendor/contracts/dist/index.js is missing; the server will install the contracts itself on start\");",
    "  process.exit(0);",
    "}",
    "rmSync(dest, { recursive: true, force: true });",
    "cpSync(src, dest, { recursive: true });",
    "console.log(\"[install-contracts] @otsi-vie/contracts installed into node_modules\");",
    "",
  ].join("\n"), "utf8");

  writeFileSync(path.join(out, "package.json"), JSON.stringify({
    name: "@otsi-vie/api",
    version: apiPkg.version,
    private: true,
    description: apiPkg.description ?? "",
    main: "dist/main.js",
    engines: { node: ">=22.11 <23" },
    // postinstall copies vendor/contracts into node_modules (see the header comment): the
    // contracts are NOT a dependency, so `npm ci` must run WITHOUT --ignore-scripts.
    // Deliberately a plain command — no `node -e` one-liner. A one-liner has to survive
    // the shell that runs it, and on Windows that shell is cmd.exe, which mangles quoted
    // `-e` code: the 6e262c4 pathToFileURL one-liner still never copied the contracts on
    // real Windows (install exits 0, contracts missing, failure silent). This command
    // has no inner quotes, no `-e`, no path to resolve, so there is nothing for cmd (or
    // sh) to mangle; the installer script resolves the package root from its own file
    // location. The `|| exit 0` is for cPanel, where npm runs postinstall with the wrong
    // working directory (~/nodevenv/<app>/<version>/lib): the script cannot be found
    // there, so without it `npm ci` would exit 1; with it the install exits 0 and the
    // server installs the contracts itself on start (ensure-contracts.ts).
    scripts: { start: "node dist/main.js", postinstall: "node scripts/install-contracts.mjs || exit 0" },
    dependencies,
  }, null, 2) + "\n", "utf8");

  writeFileSync(path.join(out, "README.md"), [
    "# OTSI account server — deploy package",
    "",
    "A plain Node app folder for the account server (ADR-146): the built API plus the built",
    "`@otsi-vie/contracts`, with every dependency pinned to an exact version.",
    "",
    "## Install (on the host, in this folder)",
    "",
    "    npm ci --omit=dev",
    "",
    "Run it WITHOUT `--ignore-scripts`: the `postinstall` step copies the vendored",
    "`@otsi-vie/contracts` (in `vendor/contracts/`) into `node_modules`. No manual symlink is",
    "needed on cPanel — the contracts are not a `file:` dependency, so there is nothing for",
    "`npm ci` to resolve against the nodevenv's `node_modules` symlink, and the copy lands in",
    "whichever `node_modules` the app actually uses.",
    "",
    "The `postinstall` step is a plain command (`node scripts/install-contracts.mjs",
    "|| exit 0`) — deliberately not a `node -e` one-liner, so there is nothing for the",
    "Windows command shell to mangle. The installer script finds the package from its",
    "own file location, never from the working directory. On cPanel npm runs it with",
    "cwd `~/nodevenv/<app>/<version>/lib`, not this folder, so the script cannot be",
    "found there — the `|| exit 0` makes that a no-op instead of a failed install,",
    "and the server installs the contracts itself the first time it starts",
    "(`apps/api/src/ensure-contracts.ts`, imported first by `dist/main.js`).",
    "A plain `npm ci --omit=dev` is the whole install; there is no manual step.",
    "",
    "## Run",
    "",
    "    npm start",
    "",
    "That runs `node dist/main.js`. Node 22.11–22.x is required.",
    "",
    "## Settings",
    "",
    "Set the environment from `otsi-vie/docs/central-server-deploy.md` step 4 (central mode,",
    "the database, the keys, the storage folder for receipts). Nothing secret is in this folder.",
    "",
    "## What is in here",
    "",
    "- `dist/` — the built API.",
    "- `vendor/contracts/` — the built `@otsi-vie/contracts`, as an extracted folder",
    "  (dist + package.json). It is NOT a dependency in package.json: the `postinstall`",
    "  script (`scripts/install-contracts.mjs`) copies it into `node_modules/@otsi-vie/contracts/`",
    "  after `npm ci`, so no `file:` dependency is ever resolved against the nodevenv symlink.",
    "- `scripts/install-contracts.mjs` — the postinstall step that installs the contracts.",
    "- `package-lock.json` — the exact versions `npm ci` installs. Do not edit it by hand;",
    "  rebuild the package instead.",
    "",
  ].join("\n"), "utf8");

  if (!skipLockfile) {
    log("generating package-lock.json (npm install --package-lock-only --omit=dev)");
    run("npm", ["install", "--package-lock-only", "--omit=dev", "--ignore-scripts"], out);
  }

  // Verify: the entry points exist, the vendored contracts folder and the postinstall script
  // are there, and the lockfile (when generated) pins exactly what package.json says.
  if (!existsSync(path.join(out, "dist", "main.js"))) fail("verification failed: dist/main.js is missing");
  if (!existsSync(path.join(out, "vendor", "contracts", "dist", "index.js"))) fail("verification failed: vendor/contracts/dist/index.js is missing");
  if (!existsSync(path.join(out, "scripts", "install-contracts.mjs"))) fail("verification failed: scripts/install-contracts.mjs is missing");
  if (!skipLockfile) {
    const lock = readJson(path.join(out, "package-lock.json"));
    const locked = lock.packages?.[""]?.dependencies ?? {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (locked[name] !== version) fail(`verification failed: package-lock.json pins ${name}@${locked[name] ?? "?"}, package.json says ${version}`);
    }
    if (lock.packages?.["node_modules/@otsi-vie/contracts"]) fail("verification failed: package-lock.json still lists @otsi-vie/contracts (it is installed by postinstall, not by npm)");
  }
  log(`package ready: ${out}`);
  log(`  API ${apiPkg.version}, contracts ${contractsPkg.version}, ${Object.keys(dependencies).length} dependencies pinned${skipLockfile ? " (no lockfile — pass no --skip-lockfile for the host)" : ""}`);
  log("no vendor symlink is needed on cPanel: the contracts are installed by postinstall, not by a `file:` dependency (see README.md).");
}

main();
