/** v3 Phase B.14 (ADR-090): the Reel Builder's coverage bar and spotlight note */
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Reel, ReelClip, ReelPath } from "@otsi-vie/contracts";

vi.mock("@/lib/api", () => ({ api: vi.fn(async () => null) }));
import { CoverageBar, clipCoverage, maxInterpFor, spotlightNote } from "@/components/reelstage/LiveSpotlight";
import { en } from "@/lib/i18n/dictionaries";

/** a point every 40 ms from a to b (µs) */
const run = (a: number, b: number) => Array.from({ length: Math.floor((b - a) / 40_000) + 1 }, (_, i) => ({ pts_us: a + i * 40_000, x: 0.4, y: 0.4, w: 0.05, h: 0.15 }));
const clip = { id: "c1", in_pts_us: 10_000_000, out_pts_us: 20_000_000 } as ReelClip;
const path: ReelPath = { stale: false, max_interp_s: 0.6, points: [...run(9_000_000, 12_000_000), ...run(15_000_000, 17_000_000)] };
const reel = { stale: false, targets: [{}] } as unknown as Reel;

describe("coverage", () => {
  it("is the share of the clip where the player has a box, clipped to the clip", () => {
    const c = clipCoverage(path.points, clip.in_pts_us, clip.out_pts_us, 0.6);
    expect(c.parts.length).toBe(2);
    expect(c.parts[0]![0]).toBe(0);                                // seen from the clip's first frame (the run starts before it)
    expect(c.seen).toBeCloseTo(0.2 + 0.002 + 0.2 + 0.004, 2);       // 10–12 s and 15–17 s of 10 s, widened by half a frame
    expect(c.detected).toBeCloseTo(c.seen, 5);                     // every position a detection at the normal sampling
    expect(c.parts.every((p) => p[2] === "D")).toBe(true);
    expect(clipCoverage([], 0, 1e6, 0.6)).toEqual({ seen: 0, detected: 0, parts: [] });
    // a 0.5 s gap (bridged, longer than the sampling) is interpolated; a gap over the bridge is unseen
    const gap = clipCoverage([...run(0, 1_000_000), ...run(1_500_000, 2_000_000), ...run(3_000_000, 4_000_000)], 0, 4_000_000, 0.6);
    expect(gap.parts.map((p) => p[2])).toEqual(["D", "I", "D", "D"]);
    expect(gap.seen).toBeCloseTo((2_000_000 + 1_000_000 + 20_000) / 4_000_000, 3);   // 0–2.0 s (the last point 1.98 s) and 2.98–4 s
    expect(gap.detected).toBeCloseTo(gap.seen - 0.5 / 4 + 0.04 / 4, 2);
    expect(maxInterpFor(0)).toBe(0.6);
    expect(maxInterpFor(1)).toBe(0.9);
  });
  it("draws the seen stretches on the seek bar", () => {
    const { container } = render(<CoverageBar path={path} clip={clip} lock={0.5} />);
    const bar = container.querySelector("[data-coverage]")!;
    expect(bar.getAttribute("data-coverage")).toBe("41");
    expect(bar.getAttribute("data-detected")).toBe("41");
    expect(bar.querySelectorAll('[data-seen-part="D"]').length).toBe(2);
  });
  it("says what the preview shows; nothing seen is said, never drawn", () => {
    expect(spotlightNote(reel, path, clip, 0.5, en.body.reelstage)!.text).toBe("Live spotlight · approximate · player seen in 41% of this clip");
    expect(spotlightNote(reel, { ...path, points: [] }, clip, 0.5, en.body.reelstage)!.text).toBe("Live spotlight · the player was not found in this clip");
    expect(spotlightNote({ ...reel, stale: true } as Reel, path, clip, 0.5, en.body.reelstage)!.text).toMatch(/identity changed/);
    expect(spotlightNote(reel, path, null, 0.5, en.body.reelstage)).toBeNull();
  });
});
