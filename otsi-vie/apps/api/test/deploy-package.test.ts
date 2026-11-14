/**
 * Deploy package (ADR-146 step 6, staging plan B): the script writes a plain Node app folder the host can
 * install with `npm ci --omit=dev`. This test runs the script end to end and proves the package is real:
 * exact (pinned) versions, a lockfile that matches them, the built API and contracts, and a clean install
 * from the lockfile whose modules load. The contracts are NOT a dependency: they ship as an extracted
 * folder in vendor/contracts/ and a postinstall script copies them into node_modules — a `file:`
 * dependency is resolved by npm against the node_modules symlink target on cPanel, so `npm ci`
 * fails there without a hand-made vendor symlink. It needs the npm registry (for the lockfile
 * and the install). The postinstall is a plain command, not a `node -e` one-liner, so there is
 * nothing for the Windows command shell to mangle; and the test runs `npm ci` with
 * `--ignore-scripts=false`, so a machine whose npm config skips lifecycle scripts cannot
 * silently skip the copy (that reproduces the Windows failure exactly: install exits 0,
 * contracts missing).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../../..");
const SCRIPT = path.join(ROOT, "otsi-vie", "tools", "deploy", "make-deploy-package.mjs");

describe("deploy package (staging plan B)", () => {
  it("builds a plain Node folder the host can install", async () => {
    const out = mkdtempSync(path.join(tmpdir(), "otsi-deploy-pkg-"));
    const pkgDir = path.join(out, "pkg");
    try {
      execFileSync(process.execPath, [SCRIPT, "--out", pkgDir], { stdio: "pipe", timeout: 240_000 });
      const pkg = JSON.parse(readFileSync(path.join(pkgDir, "package.json"), "utf8"));
      expect(pkg.name).toBe("@otsi-vie/api");
      expect(pkg.main).toBe("dist/main.js");
      expect(pkg.scripts?.start).toBe("node dist/main.js");
      expect(pkg.engines?.node).toBe(">=22.11 <23");
      // every dependency is pinned to an exact version; nothing is a range or a workspace link
      for (const [name, version] of Object.entries<string>(pkg.dependencies as Record<string, string>)) {
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      }
      // the contracts are NOT a dependency (no `file:` dep to resolve wrongly on cPanel):
      // they ship as an extracted folder and postinstall copies them into node_modules.
      expect(pkg.dependencies["@otsi-vie/contracts"]).toBeUndefined();
      // the postinstall is a plain command, not a `node -e` one-liner: `node
      // scripts/install-contracts.mjs || exit 0`. A one-liner has to survive the shell
      // that runs it, and on Windows that shell is cmd.exe, which mangles quoted `-e`
      // code — the 6e262c4 pathToFileURL one-liner still never copied the contracts on
      // real Windows (install exits 0, contracts missing, failure silent). This command
      // has no inner quotes, no `-e`, no path to resolve, so there is nothing for cmd
      // (or sh) to mangle; the installer script resolves the package root from its own
      // file location. The `|| exit 0` is for cPanel, where npm runs postinstall with
      // the wrong working directory (~/nodevenv/<app>/<version>/lib): the script cannot
      // be found there, so without it `npm ci` would exit 1; with it the install exits
      // 0 and the server installs the contracts itself on start as a backstop.
      expect(pkg.scripts?.postinstall).toBe("node scripts/install-contracts.mjs || exit 0");
      expect(pkg.scripts?.postinstall).not.toContain('"');
      expect(pkg.scripts?.postinstall).not.toContain("npm_package_json");
      expect(pkg.scripts?.postinstall).not.toContain("pathToFileURL");
      expect(existsSync(path.join(pkgDir, "dist", "main.js"))).toBe(true);
      expect(existsSync(path.join(pkgDir, "vendor", "contracts", "dist", "index.js"))).toBe(true);
      expect(existsSync(path.join(pkgDir, "vendor", "contracts", "package.json"))).toBe(true);
      expect(readdirSync(path.join(pkgDir, "vendor")).filter((f) => f.endsWith(".tgz"))).toHaveLength(0);
      expect(existsSync(path.join(pkgDir, "scripts", "install-contracts.mjs"))).toBe(true);
      expect(existsSync(path.join(pkgDir, "README.md"))).toBe(true);
      // the lockfile pins exactly what package.json says, and does not list the contracts
      // (postinstall installs them, not npm).
      const lock = JSON.parse(readFileSync(path.join(pkgDir, "package-lock.json"), "utf8"));
      const locked = lock.packages[""].dependencies as Record<string, string>;
      for (const [name, version] of Object.entries<string>(pkg.dependencies as Record<string, string>)) {
        expect(locked[name]).toBe(version);
      }
      expect(lock.packages["node_modules/@otsi-vie/contracts"]).toBeUndefined();

      // the host's step, on a clean copy: npm ci installs, and the API modules load from it
      // (npm is npm.cmd on Windows: spawnSync needs a shell to find it there). No
      // --ignore-scripts: postinstall is part of the install (it copies the contracts in).
      const installDir = path.join(out, "installed");
      cpSync(pkgDir, installDir, { recursive: true });
      // --ignore-scripts=false (and the env var) make this hermetic: a machine whose
      // npm config skips lifecycle scripts would otherwise install with exit 0 and no
      // contracts — exactly the Windows failure (6e262c4 did not fix it). The
      // postinstall's own success line is asserted too, so a skipped or failed
      // postinstall fails here with the install output visible, not silently later at
      // the require.
      const ci = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts=false"], { cwd: installDir, encoding: "utf8", timeout: 240_000, shell: process.platform === "win32", env: { ...process.env, npm_config_ignore_scripts: "false" } });
      expect(ci.status).toBe(0);
      expect(ci.stdout + ci.stderr).toContain("[install-contracts] @otsi-vie/contracts installed into node_modules");
      execFileSync(process.execPath, ["-e",
        "require('./dist/app.js'); require('./dist/core/config.js'); require('@otsi-vie/contracts'); console.log('ok')"],
        { cwd: installDir, stdio: "pipe", timeout: 60_000 });
      expect(existsSync(path.join(installDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(true);
      // postinstall copies the contracts as a real directory, not a symlink.
      expect(lstatSync(path.join(installDir, "node_modules", "@otsi-vie", "contracts")).isSymbolicLink()).toBe(false);

      // the cPanel layout: node_modules is a symlink into a nodevenv lib folder. `npm ci`
      // must still install (and postinstall must still copy the contracts in) with no
      // hand-made vendor symlink — that was the failure on the host.
      const cpanelDir = path.join(out, "cpanel");
      const nodevenvLib = path.join(out, "nodevenv", "otsi-vie", "22", "lib", "node_modules");
      cpSync(pkgDir, cpanelDir, { recursive: true });
      const { mkdirSync, symlinkSync } = await import("node:fs");
      mkdirSync(nodevenvLib, { recursive: true });
      symlinkSync(nodevenvLib, path.join(cpanelDir, "node_modules"), "dir");
      const ci2 = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts=false"], { cwd: cpanelDir, encoding: "utf8", timeout: 240_000, shell: process.platform === "win32", env: { ...process.env, npm_config_ignore_scripts: "false" } });
      expect(ci2.status).toBe(0);
      expect(ci2.stdout + ci2.stderr).toContain("[install-contracts] @otsi-vie/contracts installed into node_modules");
      expect(existsSync(path.join(cpanelDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(true);
      expect(lstatSync(path.join(cpanelDir, "node_modules", "@otsi-vie", "contracts")).isSymbolicLink()).toBe(false);

      // the cPanel failure (b2f0fbf): npm runs the postinstall with cwd
      // ~/nodevenv/<app>/<version>/lib, NOT the app folder, so `node
      // scripts/install-contracts.mjs` cannot find the script and the copy
      // never happens. Reproduce it: run the postinstall from a different
      // directory than the app folder and it must fail with MODULE_NOT_FOUND.
      const wrongCwd = path.join(out, "nodevenv", "otsi-vie", "22", "lib");
      const post = spawnSync(process.execPath, ["scripts/install-contracts.mjs"],
        { cwd: wrongCwd, encoding: "utf8", timeout: 60_000 });
      expect(post.status).not.toBe(0);
      expect(post.stderr).toMatch(/Cannot find module|MODULE_NOT_FOUND/);

      // the cPanel failure (f55834f): the same wrong cwd makes `npm ci` exit 1
      // ("command failed: node scripts/install-contracts.mjs"), so the install
      // looks broken even though the server self-installs on start. The plain
      // postinstall cannot find the script from the lib folder — and it must not
      // fail the install for it: run the postinstall COMMAND itself from the lib
      // folder and it must exit 0 (the `|| exit 0`) without copying anything.
      // The contracts are installed by the server on start instead — that is what
      // the missed-postinstall step below proves. Remove the copy the cPanel
      // `npm ci` above installed first, so this step proves the no-copy.
      rmSync(path.join(cpanelDir, "node_modules", "@otsi-vie", "contracts"), { recursive: true, force: true });
      const postFromLib = spawnSync(pkg.scripts.postinstall as string, [], {
        cwd: wrongCwd, encoding: "utf8", timeout: 60_000, shell: true,
      });
      expect(postFromLib.status).toBe(0);
      expect(existsSync(path.join(cpanelDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(false);

      // the Windows failure (6e262c4): the `node -e` one-liner never copied the
      // contracts on real Windows (install exits 0, contracts missing, failure
      // silent). There is no one-liner any more — the postinstall is a plain command
      // with no inner quotes, so there is nothing for cmd.exe to mangle — and this
      // step proves it runs and copies in a Windows-style layout, run from the app
      // folder. The folder is named `D_`, not `D:`: a directory literally named
      // `D:` cannot be created on Windows at all (`:` is illegal in a folder name),
      // so the step failed before it started there (ENOPROTOOPT) while passing on
      // Linux. The colon is not missed: the postinstall is a plain relative
      // command, so the path never enters it, and the installer resolves its root
      // with fileURLToPath(import.meta.url), which handles a drive letter; on real
      // Windows the temp dir is already on a drive, so the path genuinely contains
      // a colon anyway.
      const winRoot = path.join(out, "win");
      const winApp = path.join(winRoot, "D_", "otsi", "app");
      cpSync(pkgDir, winApp, { recursive: true });
      const winPost = spawnSync(pkg.scripts.postinstall as string, [], {
        cwd: winApp, encoding: "utf8", timeout: 60_000, shell: true,
      });
      expect(winPost.status).toBe(0);
      expect(existsSync(path.join(winApp, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(true);
      expect(lstatSync(path.join(winApp, "node_modules", "@otsi-vie", "contracts")).isSymbolicLink()).toBe(false);

      // The fix: the server installs the contracts itself on start
      // (apps/api/src/ensure-contracts.ts, imported first by dist/main.js),
      // using paths from its own file location, never the working directory.
      // So a missed postinstall must not stop the server. Prove it with an
      // install where the postinstall never ran at all (--ignore-scripts):
      // the contracts are absent, then the server's entry point puts them
      // there and they resolve.
      const missedDir = path.join(out, "missed-postinstall");
      cpSync(pkgDir, missedDir, { recursive: true });
      const ci3 = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts"],
        { cwd: missedDir, encoding: "utf8", timeout: 240_000, shell: process.platform === "win32" });
      expect(ci3.status).toBe(0);
      expect(existsSync(path.join(missedDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(false);
      // main.js imports the ensure module first, before anything that
      // imports @otsi-vie/contracts — that is what makes the start self-heal.
      const mainJs = readFileSync(path.join(missedDir, "dist", "main.js"), "utf8");
      expect(mainJs).toContain('require("./ensure-contracts")');
      expect(mainJs.indexOf('require("./ensure-contracts")')).toBeLessThan(mainJs.indexOf('require("./app")'));
      expect(existsSync(path.join(missedDir, "dist", "ensure-contracts.js"))).toBe(true);
      execFileSync(process.execPath, ["-e",
        "require('./dist/ensure-contracts.js'); require('@otsi-vie/contracts'); console.log('contracts ok')"],
        { cwd: missedDir, stdio: "pipe", timeout: 60_000 });
      expect(existsSync(path.join(missedDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(true);
      expect(lstatSync(path.join(missedDir, "node_modules", "@otsi-vie", "contracts")).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});
