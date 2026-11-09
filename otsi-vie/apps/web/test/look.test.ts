import { describe, expect, it } from "vitest";
import { ClipFx, Look, NEUTRAL_LOOK, applyLook, drawingAt, frameStats, isNeutral, lookChannels, matchFrom, zoomAt, zoomWindow } from "@otsi-vie/contracts";
import { SHORTCUTS } from "@/components/studio/shortcuts";
import { stable } from "@/components/studio/spotlight";
import { LAYOUTS, clipMs, reviewTime } from "@/components/studio/useStudio";

// the same sample values are checked in services/worker/tests/test_look.py (the render's LUT must give the editor's colours)
export const SAMPLES: [Partial<Look>, [number, number, number], [number, number, number]][] = [
  [{}, [0.2, 0.5, 0.8], [0.2, 0.5, 0.8]],
  [{ preset: "MONO" }, [0.2, 0.5, 0.8], [0.4537, 0.4537, 0.4537]],
  [{ exposure: 0.5, contrast: 1.2 }, [0.2, 0.5, 0.8], [0.2394, 0.7485, 1]],
  [{ preset: "WARM", strength: 0.5, temperature: 0.2 }, [0.3, 0.4, 0.5], [0.3228, 0.4056, 0.4739]],
  [{ match: { r: [1.2, -0.05], g: [1, 0], b: [0.8, 0.1], label: "ref" } }, [0.5, 0.5, 0.5], [0.55, 0.5, 0.5]],
];

describe("look (E5, ADR-068)", () => {
  it("neutral changes nothing; each sample colour comes out as the shared formula says", () => {
    expect(isNeutral(NEUTRAL_LOOK)).toBe(true);
    expect(isNeutral(Look.parse({ preset: "FILM", strength: 0 }))).toBe(true);
    for (const [l, i, o] of SAMPLES) {
      const out = applyLook(lookChannels(Look.parse(l)), i);
      out.forEach((v, c) => expect(v).toBeCloseTo(o[c]!, 3));
    }
  });

  it("match to reference: the source frame gets the reference's mean and spread, limited", () => {
    const px = (vals: number[][]) => vals.flatMap(([r, g, b]) => [r!, g!, b!, 255]);
    const src = frameStats(px([[50, 100, 150], [70, 120, 170]])), ref = frameStats(px([[100, 100, 100], [140, 120, 100]]));
    const m = matchFrom(src, ref, "ref");
    expect(m.r[0]).toBe(2);                                           // spread 20 -> 40 doubles the red
    expect(m.g).toEqual([1, 0]);                                      // green already the same
    expect(m.b[0]).toBe(0.5);                                         // a flat channel is limited to half, not flattened
    const out = applyLook(lookChannels(Look.parse({ match: m })), [60 / 255, 110 / 255, 160 / 255]);
    expect(out[0] * 255).toBeCloseTo(120, 0);                         // the source mean becomes the reference mean
    expect(Look.safeParse({ contrast: 3 }).success).toBe(false);
  });
});

describe("zoom and drawings (E5)", () => {
  const keys = ClipFx.parse({ zoom: [{ at_ms: 0, zoom: 1 }, { at_ms: 1000, zoom: 2, ease: "LINEAR" }, { at_ms: 2000, zoom: 1.5, ease: "HOLD" }, { at_ms: 3000, zoom: 3 }] }).zoom;
  it("eased, linear and held between keys; before the first and after the last their zoom", () => {
    expect(zoomAt([], 500)).toBe(1);
    expect(zoomAt(keys, 250)).toBeCloseTo(1 + 0.15625, 5);           // EASE (default): smoothstep(0.25) = 0.15625
    expect(zoomAt(keys, 1500)).toBeCloseTo(1.75, 5);                  // LINEAR
    expect(zoomAt(keys, 2500)).toBe(1.5);                             // HOLD
    expect(zoomAt(keys, 9000)).toBe(3);
    expect(zoomWindow(2, 100, 100, 1920, 1080)).toEqual([0, 0, 960, 540]);          // kept inside the picture
    expect(zoomWindow(2, 960, 540, 1920, 1080)).toEqual([480, 270, 960, 540]);
  });
  it("a drawing draws on, holds and fades over its last 250 ms", () => {
    const d = ClipFx.parse({ drawings: [{ kind: "ARROW", x1: 0.1, y1: 0.1, x2: 0.5, y2: 0.5, at_ms: 1000 }] }).drawings[0]!;
    expect(d).toMatchObject({ color: "YELLOW", draw_ms: 600, hold_ms: 2000 });
    expect(drawingAt(d, 999)).toBeNull();
    expect(drawingAt(d, 1300)).toEqual({ p: 0.5, alpha: 1 });
    expect(drawingAt(d, 3475)).toEqual({ p: 1, alpha: 0.5 });
    expect(drawingAt(d, 3601)).toBeNull();
    expect(ClipFx.safeParse({ drawings: Array(13).fill({ kind: "LINE", x1: 0, y1: 0, x2: 1, y2: 1, at_ms: 0 }) }).success).toBe(false);
  });
  it("playhead to milliseconds into a clip", () => {
    const items = [{ clip: { id: "a" }, start: 0, dur: 4e6, index: 0 }, { clip: { id: "b" }, start: 4e6, dur: 3e6, index: 1 }] as never;
    expect(clipMs(items, 5.5e6, "b")).toBe(1500);
    expect(clipMs(items, 5.5e6, "a")).toBeNull();
  });
});

describe("review comments on the timeline (E5)", () => {
  const cfg = { clips: [{ id: "c1", in_pts_us: 0, out_pts_us: 5e6 }], transitions: [], aspect: "16:9", settings: {} };
  const reel = { clips: [{ id: "c1", in_pts_us: 0, out_pts_us: 5e6, sequence_index: 0 }], transitions: [], aspect: "16:9", settings: {}, stale: false,
    last_good_render: { id: "r1", config: cfg } } as never;
  const x = { id: "x", name: "Coach", body: "Great run", at_s: 6.5, created_at: "", render_id: "r1", render_completed_at: null, lead_s: 3 };
  it("placed at its file time minus the intro and card, only on the matching render", () => {
    expect(reviewTime(x, reel, 5e6)).toEqual({ at_us: 3.5e6, why: null });
    expect(reviewTime({ ...x, render_id: "old" }, reel, 5e6).at_us).toBeNull();
    expect(reviewTime({ ...x, lead_s: null }, reel, 5e6).why).toMatch(/before review times/);
    expect(reviewTime({ ...x, at_s: 1 }, reel, 5e6).why).toMatch(/intro/);
    const changed = { ...(reel as object), clips: [{ id: "c1", in_pts_us: 0, out_pts_us: 4e6, sequence_index: 0 }] } as never;
    expect(reviewTime(x, changed, 4e6).why).toMatch(/changed/);
  });
  it("saved configs compare with their keys in any order", () => {
    expect(stable({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(stable({ a: { c: null, d: [1, { e: 3, f: 2 }] }, b: 1 }));
  });
});

describe("editor map (E5)", () => {
  it("every shortcut is listed once; the layouts open real sections", () => {
    expect(new Set(SHORTCUTS.map((s) => s.keys)).size).toBe(SHORTCUTS.length);
    for (const k of ["Space", "S", "Ctrl + Z", "I / O", "A / D / R", "J", "K", "L"]) expect(SHORTCUTS.some((s) => s.keys === k)).toBe(true);
    expect(LAYOUTS.COLOUR.open).toContain("look");
    expect(LAYOUTS.REVIEW.open).toContain("review");
  });
});
