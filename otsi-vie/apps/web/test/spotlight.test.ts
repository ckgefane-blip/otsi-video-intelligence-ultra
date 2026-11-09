import { describe, expect, it } from "vitest";
import { boxAt, cropWidth, fitRect, renderedState, smoothPath, strengthAt, visibleRuns } from "@/components/studio/spotlight";

const pt = (s: number, x = 0.4) => ({ pts_us: s * 1e6, x, y: 0.4, w: 0.05, h: 0.15 });
const path = [pt(2), pt(2.5, 0.5), pt(3), pt(10)];
const F = 40_000;

describe("live spotlight preview (E1, ADR-064): the renderer's rules", () => {
  it("box: detected near a point, interpolated across short gaps, missing across long ones", () => {
    expect(boxAt(path, 2_010_000, F, 0.6).state).toBe("DETECTED");
    const mid = boxAt(path, 2_250_000, F, 0.6);
    expect(mid.state).toBe("INTERPOLATED");
    expect(mid.box![0]).toBeCloseTo(0.45);
    expect(boxAt(path, 6_000_000, F, 0.6)).toEqual({ box: null, state: "MISSING" });
    expect(boxAt([], 1, F, 0.6).state).toBe("MISSING");
  });
  it("strength: full inside a visible stretch, fading at its edges, nothing outside", () => {
    const runs = visibleRuns(path, F, 0.6);
    expect(runs).toEqual([[1_980_000, 3_020_000], [9_980_000, 10_020_000]]);
    expect(strengthAt(runs, 2_500_000)).toBe(1);
    expect(strengthAt(runs, 1_980_000)).toBeCloseTo(0.2);
    expect(strengthAt(runs, 6_000_000)).toBe(0);
  });
  it("crop and fit", () => {
    expect(cropWidth(1920, 1080, "9:16")).toBe(608);
    expect(cropWidth(1920, 1080, "1:1")).toBe(1080);
    expect(cropWidth(1920, 1080, "4:5")).toBe(864);                 // ADR-080
    expect(cropWidth(1920, 1080, "16:9")).toBe(1920);
    expect(fitRect(200, 100, 1920, 1080, false)).toMatchObject({ h: 100, y: 0 });
    expect(fitRect(200, 200, 1920, 1080, false).y).toBeCloseTo(43.75);
  });
  it("rendered state: matches only when clips, order, transitions and look are the same as the last good render", () => {
    const clips = [{ id: "a", in_pts_us: 0, out_pts_us: 5, sequence_index: 0 }, { id: "b", in_pts_us: 9, out_pts_us: 12, sequence_index: 1 }];
    const settings = { dim: 0.5 };
    const config = { aspect: "16:9", settings, clips: clips.map(({ id, in_pts_us, out_pts_us }) => ({ id, in_pts_us, out_pts_us })), transitions: [] };
    const base = { clips, transitions: [], aspect: "16:9", settings, stale: false, last_good_render: { config } };
    expect(renderedState({ ...base, last_good_render: null }).reel.state).toBe("NEVER");
    expect(renderedState(base).reel.state).toBe("RENDERED");
    const trimmed = renderedState({ ...base, clips: [clips[0]!, { ...clips[1]!, out_pts_us: 11 }] });
    expect(trimmed.reel.state).toBe("CHANGED");
    expect([trimmed.clip("a"), trimmed.clip("b")]).toEqual(["RENDERED", "CHANGED"]);
    expect(renderedState({ ...base, settings: { dim: 0.6 } }).clip("a")).toBe("CHANGED");
    expect(renderedState({ ...base, stale: true }).reel.state).toBe("CHANGED");
    expect(renderedState({ ...base, transitions: [{ clip_id: "b", kind: "FADE", duration_ms: 600 }] }).reel.state).toBe("CHANGED");
    expect(renderedState({ ...base, clips: [{ ...clips[0]!, sequence_index: 2 }, clips[1]!] }).reel.state).toBe("CHANGED");
  });
});
describe("steady beam (ADR-079): the path smoothed in time on both sides, as the renderer", () => {
  // a player running right at 0.2 of the width a second, sampled every 0.2 s, his box shaking by ±0.01 with his arms and legs
  const run = Array.from({ length: 21 }, (_, i) => ({ pts_us: i * 200_000, x: 0.1 + 0.04 * i + (i % 2 ? 0.01 : -0.01), y: 0.4, w: 0.05, h: 0.15 }));
  const cx = (p: { x: number; w: number }) => p.x + p.w / 2;
  it("keeps up with a running player (no lag) and takes out most of the shake", () => {
    const s = smoothPath(run, 0.6);
    expect(s[0]!.pts_us).toBe(0);
    expect(s[s.length - 1]!.pts_us).toBe(4_000_000);
    for (const p of s.filter((q) => q.pts_us >= 600_000 && q.pts_us <= 3_400_000)) {
      expect(Math.abs(cx(p) - (0.125 + 0.2 * p.pts_us / 1e6))).toBeLessThan(0.004);   // the shake was 0.01
    }
    for (let i = 1; i < s.length; i++) expect(s[i]!.pts_us - s[i - 1]!.pts_us).toBeLessThanOrEqual(40_000);
  });
  it("adds nothing outside where he was seen and does not bridge a camera cut", () => {
    const gap = [...run.slice(0, 5), { pts_us: 3_000_000, x: 0.3, y: 0.4, w: 0.05, h: 0.15 }];
    const s = smoothPath(gap, 0.6);
    expect(s.some((p) => p.pts_us > 800_000 && p.pts_us < 3_000_000)).toBe(false);
    const cut = [run[0]!, run[1]!, { pts_us: 400_000, x: 0.8, y: 0.4, w: 0.05, h: 0.15 }, { pts_us: 600_000, x: 0.81, y: 0.4, w: 0.05, h: 0.15 }];
    const c = smoothPath(cut, 0.6);
    expect(c.some((p) => p.pts_us > 200_000 && p.pts_us < 400_000)).toBe(false);
    expect(cx(c.find((p) => p.pts_us === 400_000)!)).toBeGreaterThan(0.8);
  });
});
