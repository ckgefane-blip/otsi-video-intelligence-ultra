/**
 * Deploy package (ADR-146 step 6, staging plan B): the script writes a plain Node app folder the host can
 * install with `npm ci --omit=dev`. This test runs the script end to end and proves the package is real:
 * exact (pinned) versions, a lockfile that matches them, the built API and contracts, and a clean install
 * from the lockfile whose modules load. It needs the npm registry (for the lockfile and the install).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
        if (name === "@otsi-vie/contracts") { expect(version).toBe("file:./vendor/contracts"); continue; }
        expect(version).toMatch(/^\d+\.\d+\.\d+$/);
      }
      expect(existsSync(path.join(pkgDir, "dist", "main.js"))).toBe(true);
      expect(existsSync(path.join(pkgDir, "vendor", "contracts", "dist", "index.js"))).toBe(true);
      expect(existsSync(path.join(pkgDir, "vendor", "contracts", "package.json"))).toBe(true);
      expect(existsSync(path.join(pkgDir, "README.md"))).toBe(true);
      // the lockfile pins exactly what package.json says, including the local contracts folder
      const lock = JSON.parse(readFileSync(path.join(pkgDir, "package-lock.json"), "utf8"));
      const locked = lock.packages[""].dependencies as Record<string, string>;
      for (const [name, version] of Object.entries<string>(pkg.dependencies as Record<string, string>)) {
        expect(locked[name]).toBe(version);
      }
      expect(lock.packages["node_modules/@otsi-vie/contracts"]).toBeTruthy();

      // the host's step, on a clean copy: npm ci installs, and the API modules load from it
      // (npm is npm.cmd on Windows: spawnSync needs a shell to find it there)
      const installDir = path.join(out, "installed");
      cpSync(pkgDir, installDir, { recursive: true });
      const ci = spawnSync("npm", ["ci", "--omit=dev", "--ignore-scripts"], { cwd: installDir, encoding: "utf8", timeout: 240_000, shell: process.platform === "win32" });
      expect(ci.status).toBe(0);
      execFileSync(process.execPath, ["-e",
        "require('./dist/app.js'); require('./dist/core/config.js'); require('@otsi-vie/contracts'); console.log('ok')"],
        { cwd: installDir, stdio: "pipe", timeout: 60_000 });
      expect(existsSync(path.join(installDir, "node_modules", "@otsi-vie", "contracts", "dist", "index.js"))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 300_000);
});
