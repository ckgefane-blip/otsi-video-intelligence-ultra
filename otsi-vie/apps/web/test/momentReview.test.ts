/** v3 Phase B.15 (ADR-091): moment coverage, rejection matching and the card badge */
import { describe, expect, it } from "vitest";
import { isRejected, momentBadge, momentCoverage } from "@otsi-vie/contracts";

describe("moment review rules", () => {
  it("coverage joins positions up to the bridge and clips to the moment", () => {
    const every200ms = Array.from({ length: 21 }, (_, i) => 2_000_000 + i * 200_000);
    expect(momentCoverage(every200ms, 1_000_000, 7_000_000)).toBeCloseTo(4.04 / 6, 3);
    expect(momentCoverage(every200ms, 3_000_000, 4_000_000)).toBe(1);
    expect(momentCoverage([1_000_000, 3_000_000], 0, 4_000_000)).toBeCloseTo(0.08 / 4, 4);    // 2 s apart: two single frames, not bridged
    expect(momentCoverage([], 0, 1)).toBe(0);
  });
  it("a moment is rejected while half of it lies in a rejected window", () => {
    const w = [{ in_pts_us: 10, out_pts_us: 20 }];
    expect(isRejected(w, 10, 20)).toBe(true);
    expect(isRejected(w, 12, 22)).toBe(true);
    expect(isRejected(w, 16, 30)).toBe(false);
  });
  it("badges say detected, possible (inferred) or on camera", () => {
    expect(momentBadge({ kind: "EVENT", events: ["SHOT"] }).word).toBe("Detected");
    expect(momentBadge({ kind: "EVENT", events: ["TACKLE"] }).word).toBe("Possible");
    expect(momentBadge({ kind: "VISIBLE", events: [] }).word).toBe("On camera");
  });
});
