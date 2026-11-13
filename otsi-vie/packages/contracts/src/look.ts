/**
 * E5 (ADR-068): the reel's colour look and each clip's keyframed zoom and telestration, as data with one evaluator per language
 * (this file for the editor's preview and the tests; services/worker/vie_worker/render/look.py for the render, the same formulas).
 *
 * Look: every colour value v (0..1, sRGB) of the match picture becomes
 *   lin  = clamp(slope_c * v + intercept_c)         (match to a reference, exposure, white balance, contrast, the preset)
 *   out  = lin ^ exponent_c                          (the preset's tone curve)
 *   then saturation around the luma (Rec. 709 weights, the SVG "saturate" matrix)
 * The preview draws exactly this with an SVG filter (feComponentTransfer linear, then gamma, then feColorMatrix saturate, in sRGB);
 * the render bakes it into a 33-point 3D LUT (.cube) that FFmpeg's lut3d applies to the decoded clip frames, before the spotlight.
 */
import { z } from "zod";

export const LookPreset = z.enum(["NONE", "BROADCAST", "WARM", "COOL", "PUNCHY", "FILM", "MONO"]);
export type LookPreset = z.infer<typeof LookPreset>;
/** each preset as changes to the controls (applied at its strength) and a tone curve exponent per channel */
export const LOOK_PRESETS: Record<LookPreset, { label: string; exposure: number; contrast: number; saturation: number; temperature: number; exponent: [number, number, number] }> = {
  NONE: { label: "None", exposure: 0, contrast: 1, saturation: 1, temperature: 0, exponent: [1, 1, 1] },
  BROADCAST: { label: "Broadcast", exposure: 0.05, contrast: 1.08, saturation: 1.12, temperature: 0.1, exponent: [1, 1, 1] },
  WARM: { label: "Warm sun", exposure: 0.05, contrast: 1.04, saturation: 1.08, temperature: 0.6, exponent: [0.97, 1, 1.04] },
  COOL: { label: "Cool night", exposure: -0.05, contrast: 1.06, saturation: 0.95, temperature: -0.6, exponent: [1.04, 1, 0.97] },
  PUNCHY: { label: "Punchy", exposure: 0, contrast: 1.2, saturation: 1.3, temperature: 0, exponent: [1, 1, 1] },
  FILM: { label: "Film", exposure: 0, contrast: 0.92, saturation: 0.88, temperature: 0.25, exponent: [1.06, 1.04, 1.08] },
  MONO: { label: "Black & white", exposure: 0, contrast: 1.1, saturation: 0, temperature: 0, exponent: [1, 1, 1] },
};

const Pair = z.tuple([z.number().min(0.5).max(2), z.number().min(-0.3).max(0.3)]);
export const Look = z.object({
  /** stops of light: -1 darker … +1 brighter */
  exposure: z.number().min(-1).max(1).default(0),
  contrast: z.number().min(0.5).max(1.5).default(1),
  saturation: z.number().min(0).max(2).default(1),
  /** white balance: -1 cooler (blue) … +1 warmer (orange) */
  temperature: z.number().min(-1).max(1).default(0),
  preset: LookPreset.default("NONE"),
  strength: z.number().min(0).max(1).default(1),
  /** match to a reference frame: per channel [slope, offset], from the two frames' colour statistics (computed in the editor) */
  match: z.object({ r: Pair, g: Pair, b: Pair, label: z.string().max(160) }).nullable().default(null),
});
export type Look = z.infer<typeof Look>;
export const NEUTRAL_LOOK: Look = Look.parse({});

export interface LookChannels { slope: [number, number, number]; intercept: [number, number, number]; exponent: [number, number, number]; saturation: number }

/** the look as three channel transfers and a saturation (the shared formula) */
export function lookChannels(l: Look): LookChannels {
  const p = LOOK_PRESETS[l.preset], k = l.strength;
  const mix = (base: number, preset: number, neutral: number) => base + (preset - neutral) * k;
  const exposure = mix(l.exposure, p.exposure, 0), contrast = mix(l.contrast, p.contrast, 1), temp = Math.max(-1, Math.min(1, mix(l.temperature, p.temperature, 0)));
  const gain = 2 ** exposure;
  const wb: [number, number, number] = [1 + 0.12 * temp, 1, 1 - 0.12 * temp];
  const m = l.match ? [l.match.r, l.match.g, l.match.b] : [[1, 0], [1, 0], [1, 0]];
  const slope = [0, 1, 2].map((c) => m[c]![0]! * gain * wb[c]! * contrast) as [number, number, number];
  // contrast around mid grey: (x - 0.5) * contrast + 0.5, with x = match then gain and white balance
  const intercept = [0, 1, 2].map((c) => m[c]![1]! * gain * wb[c]! * contrast + 0.5 * (1 - contrast)) as [number, number, number];
  const exponent = [0, 1, 2].map((c) => 1 + (p.exponent[c]! - 1) * k) as [number, number, number];
  return { slope, intercept, exponent, saturation: Math.max(0, mix(l.saturation, p.saturation, 1)) };
}

export const isNeutral = (l: Look) => { const c = lookChannels(l); return c.slope.every((s) => Math.abs(s - 1) < 1e-6) && c.intercept.every((s) => Math.abs(s) < 1e-6)
  && c.exponent.every((s) => Math.abs(s - 1) < 1e-6) && Math.abs(c.saturation - 1) < 1e-6; };

/** one colour (0..1 each) through the look: what the LUT stores */
export function applyLook(c: LookChannels, rgb: [number, number, number]): [number, number, number] {
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  const v = rgb.map((x, i) => cl(cl(c.slope[i]! * x + c.intercept[i]!) ** c.exponent[i]!)) as [number, number, number];
  const s = c.saturation, R = 0.2126, G = 0.7152, B = 0.0722;     // the SVG saturate matrix
  return [cl((R + (1 - R) * s) * v[0] + (G - G * s) * v[1] + (B - B * s) * v[2]),
    cl((R - R * s) * v[0] + (G + (1 - G) * s) * v[1] + (B - B * s) * v[2]),
    cl((R - R * s) * v[0] + (G - G * s) * v[1] + (B + (1 - B) * s) * v[2])];
}

/** colour statistics of a picture (mean and spread per channel, 0..1) */
export interface FrameStats { mean: [number, number, number]; std: [number, number, number] }
export function frameStats(rgba: Uint8ClampedArray | number[]): FrameStats {
  const n = rgba.length / 4, mean = [0, 0, 0], sq = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) for (let c = 0; c < 3; c++) { const v = rgba[i + c]! / 255; mean[c]! += v; sq[c]! += v * v; }
  const m = mean.map((x) => x / n) as [number, number, number];
  return { mean: m, std: sq.map((x, c) => Math.sqrt(Math.max(0, x / n - m[c]! ** 2))) as [number, number, number] };
}
/** the match that gives the source frame the reference frame's colour statistics (per channel; limited, so a dark frame is not blown out) */
export function matchFrom(src: FrameStats, ref: FrameStats, label: string): NonNullable<Look["match"]> {
  const ch = (c: 0 | 1 | 2): [number, number] => {
    const s = Math.min(2, Math.max(0.5, ref.std[c] / Math.max(0.01, src.std[c])));
    return [Math.round(s * 1000) / 1000, Math.round(Math.min(0.3, Math.max(-0.3, ref.mean[c] - s * src.mean[c])) * 1000) / 1000];
  };
  return { r: ch(0), g: ch(1), b: ch(2), label };
}

// ------------------------------------------------------------------ per clip: keyframed zoom and telestration
export const ZoomEase = z.enum(["LINEAR", "EASE", "HOLD"]);
export type ZoomEase = z.infer<typeof ZoomEase>;
/** at_ms: milliseconds into the clip as it plays in the reel (with its speed effect) */
export const ZoomKey = z.object({ at_ms: z.number().int().min(0).max(120_000), zoom: z.number().min(1).max(3), ease: ZoomEase.default("EASE") });
export type ZoomKey = z.infer<typeof ZoomKey>;
export const DrawKind = z.enum(["ARROW", "LINE", "CIRCLE", "FREEHAND", "SPOTLIGHT", "TEXT"]);
export type DrawKind = z.infer<typeof DrawKind>;
export const DrawColor = z.enum(["YELLOW", "WHITE", "CYAN", "RED"]);
export type DrawColor = z.infer<typeof DrawColor>;
export const DRAW_RGB: Record<z.infer<typeof DrawColor>, string> = { YELLOW: "#ffd400", WHITE: "#ffffff", CYAN: "#19d3ff", RED: "#ff4a4a" };
const N = z.number().min(0).max(1);
/** points normalised to the source picture (x, y of the match video); a circle is centred on (x1, y1) through (x2, y2).
 *  FREEHAND draws the polyline in points; SPOTLIGHT dims everything outside the circle centred on (x1, y1) through (x2, y2);
 *  TEXT writes text at (x1, y1). */
export const Drawing = z.object({
  kind: DrawKind, x1: N, y1: N, x2: N, y2: N, color: DrawColor.default("YELLOW"),
  points: z.array(z.tuple([N, N])).max(400).optional(),
  text: z.string().max(120).optional(),
  at_ms: z.number().int().min(0).max(120_000), draw_ms: z.number().int().min(100).max(3000).default(600), hold_ms: z.number().int().min(0).max(10_000).default(2000),
});
export type Drawing = z.infer<typeof Drawing>;
/** B.19 (ADR-094): gap_ms = a spacer, that much black and silence before the clip (0 = none, at most 10 s) */
export const MAX_GAP_MS = 10_000;
/** B.20 (ADR-095): a clip's own sound level in dB against the match sound as recorded (0 = as recorded); MUTE_DB or lower = silent */
export const MUTE_DB = -60;
export const ClipFx = z.object({ zoom: z.array(ZoomKey).max(16).default([]), drawings: z.array(Drawing).max(12).default([]),
  gap_ms: z.number().int().min(0).max(MAX_GAP_MS).default(0), gain_db: z.number().min(MUTE_DB).max(12).default(0) });
/** the linear factor of a level in dB (0 when muted) */
export const gainFactor = (db: number) => (db <= MUTE_DB ? 0 : 10 ** (db / 20));
export type ClipFx = z.infer<typeof ClipFx>;
export const NO_FX: ClipFx = { zoom: [], drawings: [], gap_ms: 0, gain_db: 0 };
export const SetClipFxRequest = ClipFx;
export type SetClipFxRequest = ClipFx;

const smooth = (f: number) => f * f * (3 - 2 * f);
/** the zoom at t_ms into the clip: before the first key its zoom, after the last its zoom, between two keys eased by the earlier one's ease */
export function zoomAt(keys: ZoomKey[], tMs: number): number {
  if (!keys.length) return 1;
  const k = [...keys].sort((a, b) => a.at_ms - b.at_ms);
  if (tMs <= k[0]!.at_ms) return k[0]!.zoom;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i]!, b = k[i + 1]!;
    if (tMs < b.at_ms) {
      const f = (tMs - a.at_ms) / Math.max(1, b.at_ms - a.at_ms);
      return a.zoom + (b.zoom - a.zoom) * (a.ease === "HOLD" ? 0 : a.ease === "EASE" ? smooth(f) : f);
    }
  }
  return k[k.length - 1]!.zoom;
}

/** the part of a w x h picture shown at a zoom, centred as near (cx, cy) as the picture allows: [x0, y0, width, height] */
export function zoomWindow(zoom: number, cx: number, cy: number, w: number, h: number): [number, number, number, number] {
  const zw = w / zoom, zh = h / zoom;
  return [Math.min(Math.max(0, cx - zw / 2), w - zw), Math.min(Math.max(0, cy - zh / 2), h - zh), zw, zh];
}

/** a drawing at t_ms: how much of it is drawn (0..1) and its opacity (fades out over the last 250 ms); null when not shown */
export function drawingAt(d: Drawing, tMs: number): { p: number; alpha: number } | null {
  const end = d.at_ms + d.draw_ms + d.hold_ms;
  if (tMs < d.at_ms || tMs > end) return null;
  return { p: Math.min(1, (tMs - d.at_ms) / d.draw_ms), alpha: Math.min(1, Math.max(0, (end - tMs) / 250)) };
}
