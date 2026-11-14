/**
 * Deploy-package safety net (ADR-146 step 6, cPanel): make sure the vendored
 * @otsi-vie/contracts are in node_modules BEFORE anything imports them.
 *
 * The contracts are NOT a dependency in package.json (see
 * tools/deploy/make-deploy-package.mjs): they ship in vendor/contracts/ and
 * a postinstall script copies them into node_modules. On cPanel that
 * postinstall runs with the wrong working directory (npm runs it with cwd
 * ~/nodevenv/<app>/<version>/lib, not the app folder), so `node
 * scripts/install-contracts.mjs` fails with MODULE_NOT_FOUND and the copy
 * never happens — and the server then fails to start the same way.
 *
 * This module runs on import, as the FIRST import of main.ts, so it runs
 * before any module that imports @otsi-vie/contracts. It resolves every
 * path from __dirname (this file's own location), never from process.cwd(),
 * so it works no matter how the server is started (`npm start`, `node
 * dist/main.js`, or cPanel's startup file) and no matter what the working
 * directory is. If the contracts are already in node_modules (normal
 * install, or the workspace in development), it does nothing and logs
 * nothing. If they are not there and vendor/contracts/ exists (the
 * deploy-package layout), it copies them in and the server starts.
 *
 * It checks the filesystem ONLY — it never calls require.resolve(). A failed
 * require.resolve() poisons Node's module cache for the rest of the process
 * (notably when node_modules is a symlink, as on cPanel), so the app's own
 * import of the contracts would then fail even though the files are there.
 * A filesystem check leaves the cache alone, so the app's import is the
 * first resolution and succeeds. If there is nothing to copy, this module
 * does nothing — the real import then fails with the original
 * MODULE_NOT_FOUND, not a masked error.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

// One level up from dist/ is the package root (deploy package) or the API
// folder (development checkout). Only the deploy package has a
// vendor/contracts/ folder; in development the contracts are a workspace
// dependency and already in node_modules, so this is a no-op there.
const root = path.resolve(__dirname, "..");
const src = path.join(root, "vendor", "contracts");
const dest = path.join(root, "node_modules", "@otsi-vie", "contracts");

if (!existsSync(path.join(dest, "dist", "index.js"))) {
  if (existsSync(path.join(src, "dist", "index.js"))) {
    rmSync(dest, { recursive: true, force: true });
    cpSync(src, dest, { recursive: true });
    // eslint-disable-next-line no-console
    console.log("[ensure-contracts] @otsi-vie/contracts was missing from node_modules; installed it from vendor/contracts (the postinstall did not run).");
  }
}
