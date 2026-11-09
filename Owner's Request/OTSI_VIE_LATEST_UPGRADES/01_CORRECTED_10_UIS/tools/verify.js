// Render + verify corrected pages. Usage: node verify.js <origDir> <workDir> <outDir> [pagePrefix]
const { chromium } = require('playwright-core');
const fs = require('fs'), path = require('path');
const [origDir, workDir, outDir, only] = process.argv.slice(2).map((v, i) => i < 3 ? path.resolve(v) : v);
const NAV = ['Home','Upload','Processing','Analysis','Tactical','Reel Builder','Clip Studio','Player Report','Library','Export'];
const DENY = /(De Bruyne|Bruyne|Haaland|Foden|Grealish|Bernardo|Walker|Stones|Gvardiol|Kova[cč]i[cć]|Doku|Vin[ií]cius|Saka|Bellingham|Rodri|Ederson|Dias|Ake|AKE|Guardiola|Arsenal|Liverpool|Bayern|Dortmund|Barcelona|Atl[eé]tico|PSG|Man City|Manchester|Real Madrid|Madrid|Belgium|UEFA|FIFA|LALIGA|SERIE|Champions|CHAMPIONS|Premier League|La Liga|Bundesliga|mastercard|priceless|NVIDIA|A100|\bMCI\b|\bRMA\b|John Doe|Sarah Kim|Mike Chen|\bJD\b|\bSK\b|\bTS\b|Kevin|\.mp4|\.mp3|\bUCL\b)/;
const NUM = /(\d+:\d{2}(?!\d)(?![:]\d)|\d+(\.\d+)?\s?(%|km|km\/h|m\b|GB|MB|TB|fps|cm|kg|min)|\b\d+\.\d+\b|\b\d{2,}\b)/;
const ALLOWED_NUM = /^(16:9|9:16|1:1|4:5|H\.264|H\.265|H\.264\/H\.265|MPEG-2|MPEG-TS|VP9|0\/300|4K \(3840 × 2160\)|MP4 \(H\.264\)|50 GB|2 GB|1x)$/;
function collect() {
  const S = document.getElementById('s'), sr = S.getBoundingClientRect();
  const all = Array.from(S.querySelectorAll('*'));
  return all.map((e, i) => {
    const r = e.getBoundingClientRect(), c = getComputedStyle(e);
    const own = Array.from(e.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim();
    const bg = c.backgroundColor, hasBg = (bg && !/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) || c.backgroundImage !== 'none';
    const bw = ['Top','Right','Bottom','Left'].reduce((a, s) => a + parseFloat(c['border' + s + 'Width']), 0);
    const opaque = (/^rgb\(/.test(bg) || (c.backgroundImage.startsWith('linear') && !/transparent|rgba/.test(c.backgroundImage))) && parseFloat(c.opacity) >= .95;
    return { i, top: e.parentElement === S, tag: e.tagName.toLowerCase(), text: own, r: [r.x - sr.x, r.y - sr.y, r.width, r.height],
      hasBg, bw, opaque, svg: e.tagName.toLowerCase() === 'svg', parentIsS: e.parentElement === S, pidx: all.indexOf(e.parentElement) };
  });
}
const inter = (a, b) => Math.max(0, Math.min(a[0]+a[2], b[0]+b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[1]+a[3], b[1]+b[3]) - Math.max(a[1], b[1]));
const area = r => r[2] * r[3];
const inside = (o, r, t = 1) => r[0] >= o[0]-t && r[1] >= o[1]-t && r[0]+r[2] <= o[0]+o[2]+t && r[1]+r[3] <= o[1]+o[3]+t;
function analyze(els) {
  const f = [];
  const texts = els.filter(e => e.text && e.r[2] > 0);
  const boxes = els.filter(e => e.top && (e.hasBg || e.bw) && !e.text && area(e.r) > 400 && area(e.r) < 600000 && e.r[2] > 12 && e.r[3] > 12);
  for (let a = 0; a < texts.length; a++) for (let b = a + 1; b < texts.length; b++) {
    const A = texts[a], B = texts[b];
    if (A.pidx === B.i || B.pidx === A.i) continue;
    const ia = inter(A.r, B.r);
    if (ia > 0.12 * Math.min(area(A.r), area(B.r)) && ia > 6) f.push(['text-text overlap', A.text.slice(0, 40), B.text.slice(0, 40), Math.round(ia)]);
  }
  for (const t of texts) {
    const d = t.r;
    if (d[0] < -0.5 || d[1] < -0.5 || d[0]+d[2] > 2560.5 || d[1]+d[3] > 1440.5) f.push(['outside stage', t.text.slice(0, 40), '', d.map(Math.round).join(',')]);
    const c = [d[0]+d[2]/2, d[1]+d[3]/2];
    const host = boxes.filter(b => b.i < t.i && c[0] >= b.r[0] && c[0] <= b.r[0]+b.r[2] && c[1] >= b.r[1] && c[1] <= b.r[1]+b.r[3]).sort((x, y) => area(x.r) - area(y.r))[0];
    if (host && !inside(host.r, d, 1.5) && area(host.r) < 120000) {
      const ox = Math.max(0, d[0]+d[2]-(host.r[0]+host.r[2])) + Math.max(0, host.r[0]-d[0]);
      if (ox > 1.5) f.push(['text exceeds its box', t.text.slice(0, 40), host.r.map(Math.round).join(','), Math.round(ox)]);
    }
    for (const e of els) if (e.svg && inter(e.r, d) > Math.max(6, .15 * area(e.r)) && e.r[2] < 60) { f.push(['text-icon overlap', t.text.slice(0, 40), e.r.map(Math.round).join(','), Math.round(inter(e.r, d))]); break; }
    for (const e of els) if (e.top && e.i > t.i && e.opaque && !e.text && inter(e.r, d) > .25 * area(d)) { f.push(['text occluded', t.text.slice(0, 40), e.r.map(Math.round).join(','), Math.round(100*inter(e.r, d)/area(d)) + '%']); break; }
  }
  return f;
}
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--font-render-hinting=none', '--hide-scrollbars'] });
  const report = { chrome: browser.version(), pages: {} };
  for (const file of fs.readdirSync(workDir).filter(f => /^\d\d_.*\.html$/.test(f) && (!only || f.startsWith(only))).sort()) {
    const res = {};
    for (const [label, dir] of [['orig', origDir], ['work', workDir]]) {
      const ctx = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
      const p = await ctx.newPage(); const errs = [];
      p.on('pageerror', e => errs.push(String(e))); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
      await p.goto('file:///' + path.join(dir, file).replace(/\\/g, '/')); await p.waitForTimeout(300);
      if (label === 'work') await p.screenshot({ path: path.join(outDir, file.replace('.html', '_2560x1440.png')) });
      res[label] = { els: await p.evaluate(collect), errs };
      await ctx.close();
    }
    const W = res.work.els, O = res.orig.els;
    const findings = analyze(W);
    const struct = els => els.filter(e => e.top && !e.text && (e.hasBg || e.bw) && area(e.r) >= 1500).map(e => e.r.map(v => Math.round(v)).join(','));
    const so = new Set(struct(O)), sw = new Set(struct(W));
    const removed = [...so].filter(x => !sw.has(x)), added = [...sw].filter(x => !so.has(x));
    const navOk = NAV.every(n => W.some(e => e.text === n && e.r[1] < 100));
    const texts = [...new Set(W.filter(e => e.text).map(e => e.text))];
    const deny = texts.filter(t => DENY.test(t)), nums = texts.filter(t => NUM.test(t) && !ALLOWED_NUM.test(t));
    report.pages[file] = { errors: res.work.errs, navOk, elementCount: W.length, origElementCount: O.length,
      structural: { orig: so.size, work: sw.size, removed, added }, findings, denylistHits: deny, numericTexts: nums };
    console.log(file, '| errs', res.work.errs.length, '| nav', navOk, '| findings', findings.length, '| deny', deny.length, '| nums', nums.length, '| struct -', removed.length, '+', added.length);
  }
  const prev = fs.existsSync(path.join(outDir, 'verification.json')) ? JSON.parse(fs.readFileSync(path.join(outDir, 'verification.json'))) : { pages: {} };
  Object.assign(prev.pages, report.pages); prev.chrome = report.chrome;
  fs.writeFileSync(path.join(outDir, 'verification.json'), JSON.stringify(prev, null, 1));
  await browser.close();
})();
