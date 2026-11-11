/**
 * E1 (ADR-064): the live spotlight preview in Clip Studio. The same picture rules as the renderer (services/worker/vie_worker/render/reel.py:
 * box_at, visible_runs, strength_at, Spotlight.apply), drawn in the browser over the playback copy, so the person sees the beam while editing.
 *
 * Honest about what it is: the preview follows the analysis's own positions of the confirmed player (GET /v1/reels/:id/path); the render adds
 * a dense re-analysis of every clip, so the rendered beam can follow him on frames the preview leaves dark. Where the player was not seen,
 * neither draws anything (unknown beats wrong).
 */
import { ASPECT_RATIO, SpotlightSettings, type ReelPathPoint } from "@otsi-vie/contracts";
import { getDictionary, type Dictionary } from "@/lib/i18n";

export type Box = [number, number, number, number];                       // x, y, w, h normalised to the source frame
export type BoxState = "DETECTED" | "INTERPOLATED" | "MISSING";

export const FADE_S = 0.25;

/** the player's box at t: DETECTED (a point within half a frame), INTERPOLATED (between points at most maxInterpS apart), MISSING */
export function boxAt(path: ReelPathPoint[], t: number, frameUs: number, maxInterpS: number): { box: Box | null; state: BoxState } {
  if (!path.length) return { box: null, state: "MISSING" };
  let lo = 0, hi = path.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (path[mid]!.pts_us < t) lo = mid + 1; else hi = mid; }
  const after = path[lo], before = lo > 0 ? path[lo - 1] : undefined;
  for (const p of [before, after]) if (p && Math.abs(p.pts_us - t) <= frameUs / 2) return { box: [p.x, p.y, p.w, p.h], state: "DETECTED" };
  if (before && after && after.pts_us - before.pts_us <= maxInterpS * 1e6) {
    const f = (t - before.pts_us) / (after.pts_us - before.pts_us);
    return { box: [before.x + (after.x - before.x) * f, before.y + (after.y - before.y) * f, before.w + (after.w - before.w) * f, before.h + (after.h - before.h) * f], state: "INTERPOLATED" };
  }
  return { box: null, state: "MISSING" };
}

/** stretches where the player has a box (points at most maxInterpS apart), widened by half a frame */
export function visibleRuns(path: ReelPathPoint[], frameUs: number, maxInterpS: number): [number, number][] {
  const runs: [number, number][] = [];
  for (const p of path) {
    const last = runs[runs.length - 1];
    if (last && p.pts_us - last[1] <= maxInterpS * 1e6) last[1] = p.pts_us; else runs.push([p.pts_us, p.pts_us]);
  }
  return runs.map(([a, b]) => [a - frameUs / 2, b + frameUs / 2]);
}

/** spotlight strength 0..1: full inside a visible stretch, ramping over FADE_S at its edges, 0 outside */
export function strengthAt(runs: [number, number][], t: number): number {
  for (const [a, b] of runs) if (a <= t && t <= b) return Math.min(1, (t - a) / (FADE_S * 1e6) + 0.2, (b - t) / (FADE_S * 1e6) + 0.2);
  return 0;
}

/** ADR-079: the path steadied in time on both sides, as render/reel.py smooth_path (the same constants and arithmetic). The raw boxes move with
 *  every arm and leg and straight lines between samples kink at each one, so the beam shook; a trailing average made it lag a running player. */
export const SMOOTH_POS_S = 0.15, SMOOTH_SIZE_S = 0.6, SMOOTH_STEP_US = 40_000;

function local(ts: number[], vs: number[], t: number, sigma: number, linear: boolean): number {
  let lo = 0, hi = ts.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ts[mid]! < t) lo = mid + 1; else hi = mid; }
  let near = Infinity;
  for (const i of [lo - 1, lo]) if (i >= 0 && i < ts.length) near = Math.min(near, Math.abs(ts[i]! - t));
  const s = Math.max(sigma, near);
  let i = lo - 1;
  while (i >= 0 && t - ts[i]! <= 3 * s) i--;
  i++;
  let sw = 0, swt = 0, swv = 0;
  const rows: [number, number, number][] = [];
  for (; i < ts.length && ts[i]! - t <= 3 * s; i++) {
    const w = Math.exp(-0.5 * ((ts[i]! - t) / s) ** 2);
    rows.push([w, ts[i]!, vs[i]!]); sw += w; swt += w * ts[i]!; swv += w * vs[i]!;
  }
  if (sw <= 1e-12) { let k = 0; for (let j = 1; j < ts.length; j++) if (Math.abs(ts[j]! - t) < Math.abs(ts[k]! - t)) k = j; return vs[k]!; }
  const tm = swt / sw, vm = swv / sw;
  if (!linear) return vm;
  let den = 0, num = 0;
  for (const [w, x, v] of rows) { den += w * (x - tm) ** 2; num += w * (x - tm) * (v - vm); }
  return vm + (den > 1e-12 ? num / den : 0) * (t - tm);
}

/** per run of points (at most maxInterpS apart, broken at a camera cut's jump): centre and feet from a local straight-line fit over
 *  SMOOTH_POS_S, size from a mean over SMOOTH_SIZE_S, every SMOOTH_STEP_US from the run's first point to its last. Nothing outside the runs. */
export function smoothPath(path: ReelPathPoint[], maxInterpS: number): ReelPathPoint[] {
  const runs: ReelPathPoint[][] = [];
  for (const p of [...path].sort((a, b) => a.pts_us - b.pts_us)) {
    const run = runs[runs.length - 1], a = run?.[run.length - 1];
    if (run && a) {
      const cut = Math.abs(p.x + p.w / 2 - (a.x + a.w / 2)) > 4 * Math.max(p.w, a.w) || Math.abs(p.y + p.h - (a.y + a.h)) > 1.5 * Math.max(p.h, a.h);
      if (p.pts_us - a.pts_us <= maxInterpS * 1e6 && !cut) { run.push(p); continue; }
    }
    runs.push([p]);
  }
  const out: ReelPathPoint[] = [];
  for (const run of runs) {
    const ts = run.map((p) => p.pts_us / 1e6), cx = run.map((p) => p.x + p.w / 2), fy = run.map((p) => p.y + p.h), bw = run.map((p) => p.w), bh = run.map((p) => p.h);
    const end = run[run.length - 1]!.pts_us;
    for (let t = run[0]!.pts_us; ; t += SMOOTH_STEP_US) {
      const tt = Math.min(t, end), s = tt / 1e6;
      const x = local(ts, cx, s, SMOOTH_POS_S, true), y = local(ts, fy, s, SMOOTH_POS_S, true), w = local(ts, bw, s, SMOOTH_SIZE_S, false), h = local(ts, bh, s, SMOOTH_SIZE_S, false);
      out.push({ pts_us: Math.trunc(tt), x: x - w / 2, y: y - h, w, h });
      if (tt >= end) break;
    }
  }
  return out;
}

export const CROP_DEAD_ZONE = 0.12, CROP_LOOKAHEAD_US = 400_000;

/** E3 (ADR-066), the same as render/reel.py crop_target: where a 9:16 / 1:1 frame's centre should go (source pixels). It aims a little ahead
 *  of the player (60 % now, 40 % in 0.4 s), holds still inside the dead zone, else moves just far enough to bring him back to its edge. */
export function cropTarget(cx: number | null, boxCx: number | null, aheadCx: number | null, cw: number): number | null {
  if (boxCx === null) return cx;
  const want = aheadCx === null ? boxCx : 0.6 * boxCx + 0.4 * aheadCx;
  if (cx === null) return want;
  const d = want - cx, lim = CROP_DEAD_ZONE * cw;
  return Math.abs(d) <= lim ? cx : cx + (Math.abs(d) - lim) * Math.sign(d);
}

/** per-frame smoothing (25 fps) of the frame's movement from the person's follow speed: 0 calm (0.04) .. 1 quick (0.2) */
export function cropAlpha(speed: number): number { return 0.04 + 0.16 * Math.min(1, Math.max(0, speed)); }

/** the crop width (in source pixels) of the reel's aspect, as the renderer's _output_geometry */
export function cropWidth(w: number, h: number, aspect: string): number {
  const r = (ASPECT_RATIO as Record<string, number | null>)[aspect] ?? null;       // ADR-080: with 4:5
  let cw = r === null ? w : Math.round(h * r);
  cw = Math.min(w, cw - (cw % 2));
  return cw;
}

const BEAM = [255, 233, 182];
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function ringColorWithAlpha(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  if (c.length === 6) {
    const r = parseInt(c.slice(0, 2), 16);
    const g = parseInt(c.slice(2, 4), 16);
    const b = parseInt(c.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`;
  }
  return `rgba(23, 209, 248, ${clamp(alpha, 0, 1)})`;
}

/** One preview compositor per Preview: keeps the steadied position (as the renderer's Spotlight._steady) and the crop centre.
 *  ADR-110: renders the clean broadcast pitch tracker (feet base disc + glowing cyan ring + floating badge) without the vertical sky beam. */
export class SpotlightPreview {
  private steady: [number, number, number] | null = null;       // centre x, feet y, body height (display px)
  private cropCx: number | null = null;
  private lastT = 0;
  private born = 0;

  reset() { this.steady = null; this.cropCx = null; }

  /** Draw one frame. ctx: the normal layer (dimming, crop, tracker disc, badge); add: a canvas the page blends with CSS mix-blend-mode plus-lighter,
   *  so the glowing ring lights up the turf. rect = where the picture sits (object-fit applied); box normalised. */
  draw(ctx: CanvasRenderingContext2D, add: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, box: Box | null, strength: number,
       s: SpotlightSettings, caption: string | null, aspect: string, srcW: number, srcH: number, now: number, ahead: Box | null = null) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    add.clearRect(0, 0, add.canvas.width, add.canvas.height);
    const dt = this.lastT ? Math.min(0.2, (now - this.lastT) / 1000) : 0.04;
    this.lastT = now;
    this.drawCrop(ctx, rect, box, ahead, aspect, srcW, srcH, dt, s.reframe_speed ?? 0.5);
    if (!box || strength <= 0) { this.steady = null; return; }
    const [bx, by, bw, bh] = [rect.x + box[0] * rect.w, rect.y + box[1] * rect.h, box[2] * rect.w, box[3] * rect.h];
    // the renderer settles once per video frame (25 a second); per animation frame the same is spread over the elapsed time. ADR-079: the
    // path is already steadied (smoothPath), so only a little is left to settle and the beam does not trail a running player
    const k = 1 - Math.pow(1 - 0.8, dt * 25), kh = 1 - Math.pow(1 - 0.2, dt * 25);
    const cx = bx + bw / 2, fy = by + bh;
    const st = this.steady;
    if (!st || Math.abs(cx - st[0]) > Math.max(bh, st[2]) || Math.abs(fy - st[1]) > Math.max(bh, st[2])) { this.steady = [cx, fy, bh]; this.born = now; }
    else { st[0] += k * (cx - st[0]); st[1] += k * (fy - st[1]); st[2] += kh * (bh - st[2]); }
    const [scx, sfy, shh] = this.steady!;

    const size = clamp(s.size, 0.8, 3), dim = clamp(s.dim, 0, 0.9);
    // ADR-110: broadcast pitch tracker replaces the vertical sky beam/ray.
    // Clean grounded tracker on the pitch around player's feet + floating badge above head.
    const rx = Math.max(16, shh * 0.38 * size, bw * 0.85 * size);
    const ry = Math.max(6, rx * 0.36);

    // Subtle background dimming if dim > 0: softly shades the pitch outside the player
    if (dim > 0) {
      const darkK = (0.10 + 0.22 * dim) * strength;
      const grad = ctx.createRadialGradient(scx, sfy - shh * 0.5, Math.max(rx * 1.2, shh * 0.6), scx, sfy - shh * 0.5, Math.max(rect.w, rect.h) * 0.7);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, `rgba(0,0,0,${darkK})`);
      ctx.fillStyle = grad;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    }

    // 1. Shaded ground base disc on pitch
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(scx, sfy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(12, 18, 26, ${0.52 * strength})`;
    ctx.fill();
    ctx.restore();

    // 2. Crisp glowing cyan tracker ring on pitch
    if (s.ring !== false) {
      const ringRx = rx * 0.72;
      const ringRy = ry * 0.72;
      const color = s.ring_color || "#17D1F8";

      // Outer soft glow on ctx
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(scx, sfy, ringRx, ringRy, 0, 0, Math.PI * 2);
      ctx.strokeStyle = ringColorWithAlpha(color, 0.45 * strength);
      ctx.lineWidth = Math.max(3, 4.5 * (rect.h / 1080));
      ctx.stroke();

      // Inner crisp stroke on ctx
      ctx.beginPath();
      ctx.ellipse(scx, sfy, ringRx, ringRy, 0, 0, Math.PI * 2);
      ctx.strokeStyle = ringColorWithAlpha(color, 0.95 * strength);
      ctx.lineWidth = Math.max(1.8, 2.2 * (rect.h / 1080));
      ctx.stroke();
      ctx.restore();

      // Additive luminance on add canvas
      add.save();
      add.beginPath();
      add.ellipse(scx, sfy, ringRx, ringRy, 0, 0, Math.PI * 2);
      add.strokeStyle = ringColorWithAlpha(color, 0.55 * strength);
      add.lineWidth = Math.max(2, 3 * (rect.h / 1080));
      add.stroke();
      add.restore();
    }

    // 3. Floating broadcast badge above the player's head
    if (caption && s.name_caption && strength > 0.4) {
      const headY = sfy - shh;
      const parts = caption.includes("·")
        ? caption.split(/\s*·\s*/).filter(Boolean)
        : caption.includes("\n")
        ? caption.split("\n").filter(Boolean)
        : [caption];
      const title = parts[0]?.toUpperCase() ?? "";
      const sub = parts.length > 1 ? parts.slice(1).join("  ·  ") : "";

      const fs = Math.max(12, Math.round(15 * rect.h / 1080));
      const subFs = Math.max(10, Math.round(11 * rect.h / 1080));

      ctx.save();
      ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
      const twTitle = ctx.measureText(title).width;
      const thTitle = fs * 1.15;

      ctx.font = `500 ${subFs}px system-ui, -apple-system, sans-serif`;
      const twSub = sub ? ctx.measureText(sub).width : 0;
      const thSub = sub ? subFs * 1.15 : 0;

      const padX = Math.max(14, Math.round(16 * rect.h / 1080));
      const cardW = Math.max(twTitle, twSub) + padX * 2;
      const cardH = sub ? thTitle + thSub + 14 * (rect.h / 1080) : thTitle + 12 * (rect.h / 1080);

      const tx = clamp(scx - cardW / 2, rect.x + 8, rect.x + rect.w - cardW - 8);
      const tipY = headY - 6 * (rect.h / 1080);
      const pointerH = Math.max(4, 5 * (rect.h / 1080));
      const ty = Math.max(rect.y + 4, tipY - pointerH - cardH);

      // Card container
      ctx.fillStyle = `rgba(16, 24, 34, ${0.90 * strength})`;
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.15 * strength})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(tx, ty, cardW, cardH, 6);
      ctx.fill();
      ctx.stroke();

      // Caret pointer pointing down to head
      ctx.beginPath();
      ctx.moveTo(scx - 5, ty + cardH);
      ctx.lineTo(scx + 5, ty + cardH);
      ctx.lineTo(scx, tipY);
      ctx.closePath();
      ctx.fill();

      // Title (bold uppercase white)
      ctx.fillStyle = "#ffffff";
      ctx.font = `700 ${fs}px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const titleY = sub ? ty + cardH * 0.32 : ty + cardH * 0.5;
      ctx.fillText(title, tx + cardW / 2, titleY);

      // Subtitle (KPI / ID)
      if (sub) {
        ctx.fillStyle = "#cbd5e1";
        ctx.font = `500 ${subFs}px system-ui, -apple-system, sans-serif`;
        ctx.fillText(sub, tx + cardW / 2, ty + cardH * 0.72);
      }

      ctx.restore();
    }
  }

  /** 9:16 and 1:1 reels: the part of the picture the render keeps, following the player as the renderer's crop does; the rest shaded */
  private drawCrop(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; w: number; h: number }, box: Box | null, ahead: Box | null, aspect: string,
                   srcW: number, srcH: number, dt: number, speed: number) {
    if (aspect === "16:9" || !srcW || !srcH) return;
    const cw = cropWidth(srcW, srcH, aspect);
    if (cw >= srcW) return;
    const target = cropTarget(this.cropCx, box ? (box[0] + box[2] / 2) * srcW : null, ahead ? (ahead[0] + ahead[2] / 2) * srcW : null, cw) ?? srcW / 2;
    const k = 1 - Math.pow(1 - cropAlpha(speed), dt * 25);
    this.cropCx = this.cropCx === null ? target : this.cropCx + k * (target - this.cropCx);
    const x0 = clamp(this.cropCx - cw / 2, 0, srcW - cw) / srcW, wN = cw / srcW;
    const L = rect.x + x0 * rect.w, W = wN * rect.w;
    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(rect.x, rect.y, L - rect.x, rect.h);
    ctx.fillRect(L + W, rect.y, rect.x + rect.w - L - W, rect.h);
    ctx.strokeStyle = "rgba(255,255,255,0.7)"; ctx.lineWidth = 1.5;
    ctx.strokeRect(L, rect.y, W, rect.h);
    ctx.restore();
  }
}

/** where the picture sits inside a box of (bw, bh) for object-fit contain / cover */
export function fitRect(bw: number, bh: number, vw: number, vh: number, cover: boolean) {
  if (!vw || !vh) return { x: 0, y: 0, w: bw, h: bh };
  const k = cover ? Math.max(bw / vw, bh / vh) : Math.min(bw / vw, bh / vh);
  const w = vw * k, h = vh * k;
  return { x: (bw - w) / 2, y: (bh - h) / 2, w, h };
}

export interface RenderedState { state: "RENDERED" | "CHANGED" | "NEVER"; why: string }

/** E1: is the reel's latest playable render still this edit? Compared on what the renderer reads: clips (id, in, out, order), transitions,
 *  aspect and look settings. Per clip: RENDERED when the same clip window is in that render and the look is unchanged. */
export function renderedState(reel: { clips: { id: string; in_pts_us: number; out_pts_us: number; sequence_index: number; effect?: object; fx?: { zoom: unknown[]; drawings: unknown[] } }[]; transitions?: { clip_id: string; kind: string; duration_ms: number }[];
  aspect: string; settings: object; stale: boolean; last_good_render?: { config: Record<string, unknown> } | null | undefined }, d?: Dictionary) {
  const dict = d ?? getDictionary("en");
  const cfg = reel.last_good_render?.config as { clips?: { id: string; in_pts_us: number; out_pts_us: number; effect?: object; fx?: { zoom: unknown[]; drawings: unknown[] } }[]; transitions?: { clip_id: string; kind: string; duration_us: number }[];
    aspect?: string; settings?: object; profile?: string } | undefined;
  const clipState = new Map<string, "RENDERED" | "CHANGED">();
  if (!cfg?.clips) return { reel: { state: "NEVER", why: dict.body.studio.notRenderedExport } as RenderedState, clip: (id: string) => (void id, "CHANGED" as const) };
  // E3: a scout / social / archive file has its profile's own frame; settings compared with today's defaults filled in on both sides
  const withDefaults = (x: object) => { const p = SpotlightSettings.safeParse(x); return p.success ? p.data : x; };
  const lookSame = (!cfg.profile || cfg.profile === "REEL" ? cfg.aspect === reel.aspect : true)
    && sameSettings(withDefaults(cfg.settings ?? {}), withDefaults(reel.settings));
  const rendered = new Map(cfg.clips.map((c) => [c.id, c]));
  for (const c of reel.clips) {
    const r = rendered.get(c.id);
    // E2: a render made before speed effects had none (NONE)
    const fx = (x: object | undefined) => JSON.stringify(x && (x as { kind?: string }).kind !== "NONE" ? x : null);
    // E5: a render made before zoom and drawings had none
    // B.19 (ADR-094): and a spacer before the clip (a render made before spacers had none)
    const zd = (x: { zoom: unknown[]; drawings: unknown[]; gap_ms?: number; gain_db?: number } | undefined) =>      // B.20: and its sound level
      stable(x && (x.zoom.length || x.drawings.length || x.gap_ms || x.gain_db) ? { ...x, gap_ms: x.gap_ms ?? 0, gain_db: x.gain_db ?? 0 } : null);
    clipState.set(c.id, lookSame && r && r.in_pts_us === c.in_pts_us && r.out_pts_us === c.out_pts_us && fx(r.effect) === fx(c.effect) && zd(r.fx) === zd(c.fx) ? "RENDERED" : "CHANGED");
  }
  const order = [...reel.clips].sort((a, b) => a.sequence_index - b.sequence_index).map((c) => c.id).join(",");
  const trans = (xs: { clip_id: string; kind: string; ms: number }[]) => xs.map((t) => `${t.clip_id}:${t.kind}:${t.ms}`).sort().join(",");
  const sameTrans = trans((reel.transitions ?? []).map((t) => ({ clip_id: t.clip_id, kind: t.kind, ms: t.duration_ms })))
    === trans((cfg.transitions ?? []).map((t) => ({ clip_id: t.clip_id, kind: t.kind, ms: Math.round(t.duration_us / 1000) })));
  const all = lookSame && sameTrans && !reel.stale && order === cfg.clips.map((c) => c.id).join(",") && [...clipState.values()].every((v) => v === "RENDERED");
  const why = all ? dict.body.studio.renderedFileMatchesEdit : reel.stale ? dict.body.studio.identityChangedRender
    : !lookSame ? dict.body.studio.lookChangedRender : dict.body.studio.clipsChangedRender;
  return { reel: { state: all ? "RENDERED" : "CHANGED", why } as RenderedState, clip: (id: string) => clipState.get(id) ?? "CHANGED" };
}

function sameSettings(a: object, b: object): boolean {
  const ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  const keys = [...new Set([...ka, ...kb])];
  return keys.every((k) => stable((a as Record<string, unknown>)[k] ?? null) === stable((b as Record<string, unknown>)[k] ?? null));
}

/** JSON with object keys sorted at every level (the database may store a saved config's keys in another order) */
export function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${stable((x as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(x ?? null);
}
