import { defineConfig, devices } from "@playwright/test";

/**
 * Browser end-to-end tests against the PRODUCTION build (`next build` + `next start`) and the built API, Chromium only for now.
 * Run through `python otsi-vie/tools/dev/e2e.py`, which prepares and drops the scratch stack.
 * Browsers are installed under D:\OTSI-Workspace\_tmp\ms-playwright (PLAYWRIGHT_BROWSERS_PATH; workspace rule: nothing on C:).
 * The viewport matches the approved design images (1672 x 941).
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "./.e2e-results",
  fullyParallel: false,
  workers: 1,                       // one shared scratch database: tests run in order
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:4310", viewport: { width: 1672, height: 941 }, trace: "off" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1672, height: 941 } } }],
  // the REAL stack on a scratch database prepared by tools/dev/e2e.py (it passes OTSI_VIE_* and the test owner's credentials)
  webServer: [
    { command: "node dist/main.js", cwd: "../api", url: "http://127.0.0.1:4520/v1/me", reuseExistingServer: false, timeout: 60_000 },
    { command: "corepack pnpm start", url: "http://127.0.0.1:4310/login", reuseExistingServer: false, timeout: 120_000 },
    // the outbox dispatcher and the Python ingest worker, so uploads are really verified (no URL: they start immediately; tests wait on the UI)
    { command: "node dist/workers/outbox-dispatcher.js", cwd: "../api", reuseExistingServer: false, timeout: 30_000 },
    { command: `"${process.env.OTSI_E2E_PYTHON ?? "python"}" -m vie_worker.main`, cwd: "../../services/worker", reuseExistingServer: false, timeout: 30_000 },
  ],
});
