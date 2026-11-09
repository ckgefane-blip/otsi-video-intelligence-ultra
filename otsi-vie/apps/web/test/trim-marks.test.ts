import { describe, expect, it } from "vitest";
import { markedRange, trimEdge } from "@/components/studio/useStudio";

const c = { in_pts_us: 10_000_000, out_pts_us: 20_000_000 };

describe("edge trim and I / O marks (E1, ADR-064)", () => {
  it("an edge moves by the drag, never past 0, never shorter than 0.5 s or longer than 60 s", () => {
    expect(trimEdge(c, "in", 2_000_000)).toEqual({ in_pts_us: 12_000_000, out_pts_us: 20_000_000 });
    expect(trimEdge(c, "out", -3_000_000)).toEqual({ in_pts_us: 10_000_000, out_pts_us: 17_000_000 });
    expect(trimEdge(c, "in", 50_000_000).in_pts_us).toBe(19_500_000);
    expect(trimEdge(c, "in", -50_000_000).in_pts_us).toBe(0);
    expect(trimEdge(c, "out", -50_000_000).out_pts_us).toBe(10_500_000);
    expect(trimEdge(c, "out", 90_000_000).out_pts_us).toBe(70_000_000);
    expect(trimEdge({ in_pts_us: 80_000_000, out_pts_us: 90_000_000 }, "in", -60_000_000).in_pts_us).toBe(30_000_000);
  });
  it("marks pick the part of the moment to add; unmarked or too short adds nothing different", () => {
    expect(markedRange(c, {})).toBeNull();
    expect(markedRange(c, { in: 12_000_000 })).toEqual({ in_pts_us: 12_000_000, out_pts_us: 20_000_000 });
    expect(markedRange(c, { out: 15_000_000 })).toEqual({ in_pts_us: 10_000_000, out_pts_us: 15_000_000 });
    expect(markedRange(c, { in: 5_000_000, out: 25_000_000 })).toEqual(c);
    expect(markedRange(c, { in: 15_000_000, out: 15_200_000 })).toBeNull();
  });
});
