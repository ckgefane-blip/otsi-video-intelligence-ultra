/**
 * HTML to PDF / PNG in a local headless Chromium (Playwright's, free: Apache-2.0 / BSD; ADR-030, ADR-056, ADR-058). One page at a time
 * per server (a shared chain); the page loads nothing from anywhere (every request but data: URLs is aborted), so only the escaped HTML
 * handed in is drawn. The browser lives in `.local/browsers` (PLAYWRIGHT_BROWSERS_PATH).
 */
import { ApiError } from "./problem";

let chain: Promise<unknown> = Promise.resolve();

async function withPage<T>(html: string, viewport: { width: number; height: number } | null, fn: (page: import("playwright-core").Page) => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    let chromium: typeof import("playwright-core").chromium;
    try { ({ chromium } = await import("playwright-core")); } catch { throw new ApiError(503, "PDF_ENGINE_MISSING", "The PDF engine is not installed on this server."); }
    const browser = await chromium.launch({ headless: true }).catch(() => { throw new ApiError(503, "PDF_ENGINE_MISSING", "The PDF engine (headless Chromium) is not installed on this server."); });
    try {
      const page = await browser.newPage(viewport ? { viewport } : {});
      await page.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
      await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
      return await fn(page);
    } finally { await browser.close().catch(() => undefined); }
  });
  chain = run.catch(() => undefined);
  return run;
}

/** an A4 PDF with a page-number footer naming what it is */
export function printPdf(html: string, footer: string): Promise<Buffer> {
  return withPage(html, null, (page) => page.pdf({ format: "A4", printBackground: true, margin: { top: "14mm", bottom: "16mm", left: "12mm", right: "12mm" },
    displayHeaderFooter: true, headerTemplate: "<span></span>",
    footerTemplate: `<div style="font-size:7px;width:100%;text-align:center;color:#667">${footer.replace(/[<>&]/g, "")} · page <span class="pageNumber"></span> of <span class="totalPages"></span></div>` }));
}

/** a PNG of the page at this size */
export function screenshotPng(html: string, width: number, height: number): Promise<Buffer> {
  return withPage(html, { width, height }, (page) => page.screenshot({ type: "png", fullPage: false }));
}
