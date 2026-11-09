/** B.25 (ADR-100): suggested clip ends around his events (Inferred) */
import { describe, expect, it } from "vitest";
import { suggestBoundary } from "@otsi-vie/contracts";

const M = (a: number, b: number) => ({ in_pts_us: a * 1e6, out_pts_us: b * 1e6, events: ["PASS" as const] });
const shots = [{ start_us: 0, end_us: 20e6 }, { start_us: 20e6, end_us: 60e6 }];

describe("suggestBoundary", () => {
  it("widens a clip to hold the overlapping moments", () => {
    expect(suggestBoundary({ in_pts_us: 6e6, out_pts_us: 9e6 }, [M(4, 12)], shots, 60e6)).toMatchObject({ in_pts_us: 4e6, out_pts_us: 12e6, events: ["PASS"] });
  });
  it("never crosses a camera cut the clip does not cross already", () => {
    expect(suggestBoundary({ in_pts_us: 22e6, out_pts_us: 26e6 }, [M(17, 30)], shots, 60e6)).toMatchObject({ in_pts_us: 20e6, out_pts_us: 30e6 });
    expect(suggestBoundary({ in_pts_us: 18e6, out_pts_us: 26e6 }, [M(17, 30)], shots, 60e6)).toMatchObject({ in_pts_us: 17e6 });
  });
  it("offers nothing without events, or when the ends move less than 0.5 s", () => {
    expect(suggestBoundary({ in_pts_us: 6e6, out_pts_us: 9e6 }, [M(30, 40)], shots, 60e6)).toBeNull();
    expect(suggestBoundary({ in_pts_us: 4.2e6, out_pts_us: 11.8e6 }, [M(4, 12)], shots, 60e6)).toBeNull();
  });
  it("can shorten a long clip to the action, keeps within the video and 60 s", () => {
    expect(suggestBoundary({ in_pts_us: 0, out_pts_us: 20e6 }, [M(4, 12)], shots, 60e6)).toMatchObject({ in_pts_us: 4e6, out_pts_us: 12e6 });
    expect(suggestBoundary({ in_pts_us: 25e6, out_pts_us: 30e6 }, [M(21, 95)], [], 70e6)).toMatchObject({ in_pts_us: 21e6, out_pts_us: 70e6 });
    expect(suggestBoundary({ in_pts_us: 25e6, out_pts_us: 30e6 }, [M(0, 95)], [], 100e6)!.out_pts_us).toBe(60e6);
  });
});

describe("suggestBoundary and the reel's other clips", () => {
  it("never stretches a clip over another clip's picture", () => {
    expect(suggestBoundary({ in_pts_us: 6e6, out_pts_us: 9e6 }, [M(2, 14)], shots, 60e6, [{ in_pts_us: 0, out_pts_us: 4e6 }, { in_pts_us: 12e6, out_pts_us: 15e6 }]))
      .toMatchObject({ in_pts_us: 4e6, out_pts_us: 12e6 });
    // two clips overlapping already: neither is stretched over the other
    expect(suggestBoundary({ in_pts_us: 18e6, out_pts_us: 29e6 }, [M(7, 29.3)], [], 60e6, [{ in_pts_us: 7e6, out_pts_us: 25e6 }])).toBeNull();
  });
});
