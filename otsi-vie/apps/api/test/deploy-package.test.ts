/**
 * Deploy package (ADR-146 step 6, staging plan B): the script writes a plain Node app folder the host can
 * install with `npm ci --omit=dev`. This test runs the script end to end and proves the package is real:
 * exact (pinned) versions, a lockfile that matches them, the built API and contracts, and a clean install
 * from the lockfile whose modules load. The contracts are NOT a dependency: they ship as an extracted
 * folder in vendor/contracts/ and a postinstall script copies them into node_modules — a `file:`
 * dependency is resolved by npm against the node_modules symlink target on cPanel, so `npm ci`
 * fails there without a hand-made vendor symlink. It needs the npm registry (for the lockfile
 * and the install).
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
      expect(pkg.scripts?.postinstall).toBe("node scripts/install-contracts.mjs");
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
      const ci = spawnSync("npm", ["ci", "--omit=dev"], { cwd: installDir, encoding: "utf8", timeout: 240_000, shell: process.platform === "win32" });
      expect(ci.status).toBe(0);
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
      const ci2 = spawnSync("npm", ["ci", "--omit=dev"], { cwd: cpanelDir, encoding: "utf8", timeout: 240_000, shell: process.platform === "win32" });
      expect(ci2.status).toBe(0);
      expect(existsSync(path.join(cpanelDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(true);
      expect(lstatSync(path.join(cpanelDir, "node_modules", "@otsi-vie", "contracts")).isSymbolicLink()).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});
