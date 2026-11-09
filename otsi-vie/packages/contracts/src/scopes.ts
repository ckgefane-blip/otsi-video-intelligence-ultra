/**
 * v3 Phase C.6 (ADR-106): Player scopes (waveform, histogram, vectorscope, audio meter)
 * and render QC validation schemas.
 *
 * Pure computation functions for real-time video and audio inspection in the player:
 * - Waveform: distribution of luminance (Y) and RGB levels across horizontal pixel columns (0..255).
 * - Histogram: frequency distribution of red, green, blue, and luma across 256 bins.
 * - Vectorscope: chrominance coordinates (Cb, Cr) centered at (128, 128) on the color wheel.
 * - Audio meter: peak and RMS levels in decibels (-60 dB to 0 dB, clip indicator).
 */
import { z } from "zod";

export const ScopeMode = z.enum(["waveform", "histogram", "vectorscope", "audio"]);
export type ScopeMode = z.infer<typeof ScopeMode>;

export const ScopeChannel = z.enum(["luma", "rgb", "parade"]);
export type ScopeChannel = z.infer<typeof ScopeChannel>;

export interface HistogramData {
  r: number[];
  g: number[];
  b: number[];
  y: number[];
}

export interface WaveformData {
  cols: number;
  // 2D grid: [col][level 0..255] = count or normalized intensity
  y: Uint16Array[];
  r: Uint16Array[];
  g: Uint16Array[];
  b: Uint16Array[];
}

export interface VectorscopePoint {
  cb: number; // 0..255 (centered at 128)
  cr: number; // 0..255 (centered at 128)
}

export interface AudioMeterData {
  peakDb: number;
  rmsDb: number;
  clip: boolean;
}

/** ITU-R BT.601 standard luma coefficients */
export function rgbToLuma(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** ITU-R BT.601 chrominance coordinates */
export function rgbToChrominance(r: number, g: number, b: number): { cb: number; cr: number } {
  const cb = Math.round(-0.168736 * r - 0.331264 * g + 0.5 * b + 128);
  const cr = Math.round(0.5 * r - 0.418688 * g - 0.081312 * b + 128);
  return { cb: Math.max(0, Math.min(255, cb)), cr: Math.max(0, Math.min(255, cr)) };
}

/** Compute 256-bin histogram from RGBA pixel buffer */
export function computeHistogram(rgba: Uint8ClampedArray | number[]): HistogramData {
  const r = new Array(256).fill(0);
  const g = new Array(256).fill(0);
  const b = new Array(256).fill(0);
  const y = new Array(256).fill(0);

  const len = rgba.length;
  // Sample every 4th pixel for efficiency if large
  const step = len > 250_000 ? 8 : 4;
  for (let i = 0; i < len; i += step) {
    const red = rgba[i] ?? 0;
    const green = rgba[i + 1] ?? 0;
    const blue = rgba[i + 2] ?? 0;
    const luma = rgbToLuma(red, green, blue);

    r[red] = (r[red] ?? 0) + 1;
    g[green] = (g[green] ?? 0) + 1;
    b[blue] = (b[blue] ?? 0) + 1;
    y[luma] = (y[luma] ?? 0) + 1;
  }

  return { r, g, b, y };
}

/** Compute horizontal waveform columns from RGBA pixel buffer */
export function computeWaveform(
  rgba: Uint8ClampedArray | number[],
  width: number,
  height: number,
  numCols = 160,
): WaveformData {
  const cols = Math.min(numCols, width);
  const colY: Uint16Array[] = Array.from({ length: cols }, () => new Uint16Array(256));
  const colR: Uint16Array[] = Array.from({ length: cols }, () => new Uint16Array(256));
  const colG: Uint16Array[] = Array.from({ length: cols }, () => new Uint16Array(256));
  const colB: Uint16Array[] = Array.from({ length: cols }, () => new Uint16Array(256));

  if (width <= 0 || height <= 0 || rgba.length < width * height * 4) {
    return { cols, y: colY, r: colR, g: colG, b: colB };
  }

  const yStep = Math.max(1, Math.floor(height / 120)); // vertical subsampling
  for (let py = 0; py < height; py += yStep) {
    const rowOffset = py * width * 4;
    for (let c = 0; c < cols; c++) {
      const px = Math.floor((c / cols) * width);
      const idx = rowOffset + px * 4;
      const red = rgba[idx] ?? 0;
      const green = rgba[idx + 1] ?? 0;
      const blue = rgba[idx + 2] ?? 0;
      const luma = rgbToLuma(red, green, blue);

      const cy = colY[c]!;
      const cr = colR[c]!;
      const cg = colG[c]!;
      const cb = colB[c]!;
      cy[luma] = (cy[luma] ?? 0) + 1;
      cr[red] = (cr[red] ?? 0) + 1;
      cg[green] = (cg[green] ?? 0) + 1;
      cb[blue] = (cb[blue] ?? 0) + 1;
    }
  }

  return { cols, y: colY, r: colR, g: colG, b: colB };
}

/** Compute vectorscope Cb/Cr coordinates from RGBA pixel buffer */
export function computeVectorscope(rgba: Uint8ClampedArray | number[], maxSamples = 2000): VectorscopePoint[] {
  const points: VectorscopePoint[] = [];
  const totalPixels = Math.floor(rgba.length / 4);
  if (totalPixels <= 0) return points;

  const step = Math.max(1, Math.floor(totalPixels / maxSamples));
  for (let i = 0; i < totalPixels; i += step) {
    const idx = i * 4;
    const r = rgba[idx] ?? 0;
    const g = rgba[idx + 1] ?? 0;
    const b = rgba[idx + 2] ?? 0;
    points.push(rgbToChrominance(r, g, b));
  }

  return points;
}

/** Compute decibel audio meter levels from PCM float samples (-1.0 .. 1.0) */
export function computeAudioLevel(samples: Float32Array | number[]): AudioMeterData {
  if (!samples.length) return { peakDb: -60, rmsDb: -60, clip: false };

  let maxPeak = 0;
  let sumSquares = 0;

  for (let i = 0; i < samples.length; i++) {
    const s = Math.abs(samples[i] ?? 0);
    if (s > maxPeak) maxPeak = s;
    sumSquares += s * s;
  }

  const rms = Math.sqrt(sumSquares / samples.length);
  const peakDb = maxPeak > 0.00001 ? Math.max(-60, Math.round(20 * Math.log10(maxPeak) * 10) / 10) : -60;
  const rmsDb = rms > 0.00001 ? Math.max(-60, Math.round(20 * Math.log10(rms) * 10) / 10) : -60;
  const clip = maxPeak >= 0.999;

  return { peakDb, rmsDb, clip };
}

/** Render Quality Control schema (QC in render validation) */
export const RenderQcReport = z.object({
  loudness: z.object({
    measured_lufs: z.number().nullable(),
    true_peak_db: z.number().nullable(),
    target_lufs: z.number().nullable(),
    compliant: z.boolean(),
  }),
  black_frames: z.object({
    detected_count: z.number(),
    spans: z.array(
      z.object({
        start_s: z.number(),
        end_s: z.number(),
        duration_s: z.number(),
      }),
    ),
    unintended_black: z.boolean(),
  }),
});
export type RenderQcReport = z.infer<typeof RenderQcReport>;
