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
 *     vendor/contracts/     the built @otsi-vie/contracts, as a file: dependency
 *     README.md             how to install and run it on the host
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

  // Exact versions for every runtime dependency; the workspace package stays a local file: folder.
  const dependencies = {};
  for (const [name] of Object.entries(apiPkg.dependencies ?? {})) {
    if (name === "@otsi-vie/contracts") continue;
    dependencies[name] = installedVersion(name, API_DIR);
  }
  const contractsDeps = {};
  for (const [name] of Object.entries(contractsPkg.dependencies ?? {})) {
    contractsDeps[name] = installedVersion(name, CONTRACTS_DIR);
  }
  dependencies["@otsi-vie/contracts"] = "file:./vendor/contracts";

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

  writeFileSync(path.join(out, "package.json"), JSON.stringify({
    name: "@otsi-vie/api",
    version: apiPkg.version,
    private: true,
    description: apiPkg.description ?? "",
    main: "dist/main.js",
    engines: { node: ">=22.11 <23" },
    scripts: { start: "node dist/main.js" },
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
    "- `vendor/contracts/` — the built `@otsi-vie/contracts`, installed as a local file: package.",
    "- `package-lock.json` — the exact versions `npm ci` installs. Do not edit it by hand;",
    "  rebuild the package instead.",
    "",
  ].join("\n"), "utf8");

  if (!skipLockfile) {
    log("generating package-lock.json (npm install --package-lock-only --omit=dev)");
    run("npm", ["install", "--package-lock-only", "--omit=dev", "--ignore-scripts"], out);
  }

  // Verify: the entry points exist, and the lockfile (when generated) pins exactly what package.json says.
  if (!existsSync(path.join(out, "dist", "main.js"))) fail("verification failed: dist/main.js is missing");
  if (!existsSync(path.join(out, "vendor", "contracts", "dist", "index.js"))) fail("verification failed: vendor/contracts/dist/index.js is missing");
  if (!skipLockfile) {
    const lock = readJson(path.join(out, "package-lock.json"));
    const locked = lock.packages?.[""]?.dependencies ?? {};
    for (const [name, version] of Object.entries(dependencies)) {
      if (locked[name] !== version) fail(`verification failed: package-lock.json pins ${name}@${locked[name] ?? "?"}, package.json says ${version}`);
    }
    if (!lock.packages?.["node_modules/@otsi-vie/contracts"]) fail("verification failed: package-lock.json has no node_modules/@otsi-vie/contracts entry");
  }
  log(`package ready: ${out}`);
  log(`  API ${apiPkg.version}, contracts ${contractsPkg.version}, ${Object.keys(dependencies).length} dependencies pinned${skipLockfile ? " (no lockfile — pass no --skip-lockfile for the host)" : ""}`);
}

main();
