// Playback compatibility of encoded files in real browsers (ADR-029): each file is played in a <video> element and must report its
// size, advance its clock and present decoded frames. Browsers: Playwright's Chromium build and the system's Microsoft Edge
// (channel "msedge"; Edge ships the platform's H.264/HEVC decoders, open-source Chromium builds may not).
//   node otsi-vie/tools/media/playback_check.mjs <dir with files> [<dir> ...]   -> prints JSON, writes <dir>/playback.json
import { createReadStream, readdirSync, statSync, writeFileSync } from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(APP, "..", "..", "_tmp", "ms-playwright");   // set before Playwright loads
const require = createRequire(path.join(APP, "apps", "web", "package.json"));
const { chromium } = require("@playwright/test");

const BROWSERS = [{ name: "chromium (Playwright build)", opts: {} },
  { name: "microsoft edge (system)", opts: { channel: "msedge", headless: false, args: ["--headless=new"] } }];   // Edge needs its new headless mode

// files are served over local HTTP with Range support, as the app's media gateway serves them (a blank page cannot load file:// media)
function serve(dir) {
  const server = http.createServer((req, res) => {
    const f = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).slice(1));
    if (req.url === "/") { res.setHeader("content-type", "text/html"); return res.end("<!doctype html><title>playback</title>"); }
    let size; try { size = statSync(f).size; } catch { res.statusCode = 404; return res.end(); }
    res.setHeader("content-type", f.endsWith(".webm") ? "video/webm" : "video/mp4"); res.setHeader("accept-ranges", "bytes");
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? "");
    if (m) { const a = Number(m[1] || 0), b = m[2] ? Number(m[2]) : size - 1; res.statusCode = 206; res.setHeader("content-range", `bytes ${a}-${b}/${size}`); res.setHeader("content-length", b - a + 1); return createReadStream(f, { start: a, end: b }).pipe(res); }
    res.setHeader("content-length", size); createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

async function check(page, base, name) {
  await page.goto(base);
  await page.setContent(`<video id="v" muted playsinline preload="auto" src="${base}${encodeURIComponent(name)}"></video>`);
  return page.evaluate(async () => {
    const v = document.getElementById("v");
    const settle = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let i = 0; i < 40 && v.readyState < 2 && !v.error; i++) await settle(100);
    try { await v.play(); } catch (e) { /* reported below */ }
    await settle(1500);
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : {};
    const ok = !v.error && v.videoWidth > 0 && v.currentTime > 0.3 && (q.totalVideoFrames ?? 1) > 0;
    return { ok, error: v.error ? v.error.code : null, width: v.videoWidth, height: v.videoHeight, current_time: Number(v.currentTime.toFixed(2)),
             frames_presented: q.totalVideoFrames ?? null, dropped: q.droppedVideoFrames ?? null };
  });
}

const out = {};
for (const dir of process.argv.slice(2)) {
  const files = readdirSync(dir).filter((f) => /\.(mp4|webm)$/.test(f));
  const server = await serve(dir);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const res = {};
  for (const b of BROWSERS) {
    let browser;
    try { browser = await chromium.launch({ headless: true, ...b.opts }); } catch (e) { res[b.name] = { unavailable: String(e).split("\n")[0] }; continue; }
    const page = await browser.newPage();
    res[b.name] = {};
    for (const f of files) res[b.name][f] = await check(page, base, f);
    await browser.close();
  }
  server.close();
  writeFileSync(path.join(dir, "playback.json"), JSON.stringify(res, null, 1));
  out[dir] = res;
}
console.log(JSON.stringify(out, null, 1));
