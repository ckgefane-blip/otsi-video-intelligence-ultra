import { describe, expect, it } from "vitest";
import {
  computeAudioLevel,
  computeHistogram,
  computeVectorscope,
  computeWaveform,
  rgbToChrominance,
  rgbToLuma,
  RenderQcReport,
} from "@otsi-vie/contracts";

describe("C.6 Player Scopes & Render QC (ADR-106)", () => {
  it("converts RGB to BT.601 luma correctly", () => {
    // Pure black
    expect(rgbToLuma(0, 0, 0)).toBe(0);
    // Pure white
    expect(rgbToLuma(255, 255, 255)).toBe(255);
    // Green dominates (0.587 * 255 = ~150)
    expect(rgbToLuma(0, 255, 0)).toBe(150);
  });

  it("converts RGB to BT.601 chrominance coordinates", () => {
    // Neutral grey gives neutral chrominance (128, 128)
    const neutral = rgbToChrominance(128, 128, 128);
    expect(neutral.cb).toBe(128);
    expect(neutral.cr).toBe(128);

    // Pure red has high Cr
    const red = rgbToChrominance(255, 0, 0);
    expect(red.cr).toBeGreaterThan(200);

    // Pure blue has high Cb
    const blue = rgbToChrominance(0, 0, 255);
    expect(blue.cb).toBeGreaterThan(200);
  });

  it("computes 256-bin histogram for red, green, blue, and luma", () => {
    // 2x2 image: [Red, Green, Blue, White]
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,    // Red
      0, 255, 0, 255,    // Green
      0, 0, 255, 255,    // Blue
      255, 255, 255, 255 // White
    ]);

    const hist = computeHistogram(pixels);
    expect(hist.r).toHaveLength(256);
    expect(hist.g).toHaveLength(256);
    expect(hist.b).toHaveLength(256);
    expect(hist.y).toHaveLength(256);

    // Two pixels have red = 255 (Red and White)
    expect(hist.r[255]).toBe(2);
    // Two pixels have red = 0 (Green and Blue)
    expect(hist.r[0]).toBe(2);
  });

  it("computes horizontal waveform data across columns", () => {
    // 4x2 image with black on left and white on right
    // col 0 & 1: black, col 2 & 3: white
    const pixels = new Uint8ClampedArray([
      0, 0, 0, 255,       0, 0, 0, 255,       255, 255, 255, 255, 255, 255, 255, 255,
      0, 0, 0, 255,       0, 0, 0, 255,       255, 255, 255, 255, 255, 255, 255, 255,
    ]);

    const wf = computeWaveform(pixels, 4, 2, 4);
    expect(wf.cols).toBe(4);
    expect(wf.y).toHaveLength(4);

    // Column 0 has luma 0
    expect(wf.y[0]![0]).toBeGreaterThan(0);
    expect(wf.y[0]![255]).toBe(0);

    // Column 3 has luma 255
    expect(wf.y[3]![255]).toBeGreaterThan(0);
    expect(wf.y[3]![0]).toBe(0);
  });

  it("computes vectorscope sample points", () => {
    const pixels = new Uint8ClampedArray([
      255, 0, 0, 255,
      0, 255, 0, 255,
      0, 0, 255, 255,
      128, 128, 128, 255,
    ]);

    const points = computeVectorscope(pixels, 10);
    expect(points.length).toBe(4);
    expect(points[3]).toEqual({ cb: 128, cr: 128 });
  });

  it("computes audio meter peak and RMS levels with clipping detection", () => {
    // Silence
    const silence = computeAudioLevel([0, 0, 0, 0]);
    expect(silence.peakDb).toBe(-60);
    expect(silence.rmsDb).toBe(-60);
    expect(silence.clip).toBe(false);

    // Full-scale sine wave / peak sample (1.0 -> 0 dB, clip)
    const clipping = computeAudioLevel([1.0, -1.0]);
    expect(clipping.peakDb).toBe(0);
    expect(clipping.clip).toBe(true);

    // Half amplitude (~ -6 dB)
    const half = computeAudioLevel([0.5, -0.5]);
    expect(half.peakDb).toBeCloseTo(-6.0, 1);
    expect(half.clip).toBe(false);
  });

  it("validates RenderQcReport schema", () => {
    const qc = {
      loudness: {
        measured_lufs: -14.2,
        true_peak_db: -1.1,
        target_lufs: -14.0,
        compliant: true,
      },
      black_frames: {
        detected_count: 0,
        spans: [],
        unintended_black: false,
      },
    };

    const parsed = RenderQcReport.safeParse(qc);
    expect(parsed.success).toBe(true);
  });
});
