import { describe, expect, it } from "vitest";
import {
  computeCutDiff,
  cutDurationUs,
  syncPlayhead,
  type CutClip,
} from "@otsi-vie/contracts";

describe("C.9 Dual Timeline & Cut Comparison (ADR-108)", () => {
  const sampleCutA: CutClip[] = [
    { id: "c1", in_pts_us: 1_000_000, out_pts_us: 4_000_000, label: "Tackle" }, // 3s
    { id: "c2", in_pts_us: 5_000_000, out_pts_us: 8_000_000, gap_us: 500_000, label: "Run" }, // 3.5s
    { id: "c3", in_pts_us: 10_000_000, out_pts_us: 12_000_000, label: "Shot" }, // 2s
  ]; // Total = 3 + 3.5 + 2 = 8.5s = 8_500_000 us

  it("calculates total cut duration including gaps", () => {
    expect(cutDurationUs(sampleCutA)).toBe(8_500_000);
  });

  it("detects identical cuts with zero duration difference", () => {
    const diff = computeCutDiff(sampleCutA, sampleCutA);
    expect(diff.total_a_us).toBe(8_500_000);
    expect(diff.total_b_us).toBe(8_500_000);
    expect(diff.delta_duration_us).toBe(0);
    expect(diff.matched_count).toBe(3);
    expect(diff.trimmed_count).toBe(0);
    expect(diff.added_count).toBe(0);
    expect(diff.removed_count).toBe(0);
    expect(diff.summary).toContain("All cuts identical");
  });

  it("identifies trimmed, added, and removed clips between two cuts", () => {
    const sampleCutB: CutClip[] = [
      // c1 was longer in Cut B (starts at 0.5s instead of 1.0s, out at 4.0s) -> trimmed
      { id: "c1", in_pts_us: 500_000, out_pts_us: 4_000_000, label: "Tackle" },
      // c2 is identical
      { id: "c2", in_pts_us: 5_000_000, out_pts_us: 8_000_000, gap_us: 500_000, label: "Run" },
      // c4 was in Cut B but removed in Cut A
      { id: "c4", in_pts_us: 20_000_000, out_pts_us: 24_000_000, label: "Header" },
      // c3 was not in Cut B (added in Cut A)
    ];

    const diff = computeCutDiff(sampleCutA, sampleCutB);
    expect(diff.matched_count).toBe(1); // c2
    expect(diff.trimmed_count).toBe(1); // c1
    expect(diff.added_count).toBe(1);   // c3
    expect(diff.removed_count).toBe(1); // c4

    // Check trimmed clip deltas
    const c1Diff = diff.items.find((i) => i.id === "c1");
    expect(c1Diff?.status).toBe("TRIMMED");
    expect(c1Diff?.delta_in_us).toBe(500_000); // in_pts moved later by 0.5s

    // Check added clip
    const c3Diff = diff.items.find((i) => i.id === "c3");
    expect(c3Diff?.status).toBe("ADDED");

    // Check removed clip
    const c4Diff = diff.items.find((i) => i.id === "c4");
    expect(c4Diff?.status).toBe("REMOVED");

    expect(diff.summary).toContain("1 added");
    expect(diff.summary).toContain("1 removed");
    expect(diff.summary).toContain("1 trimmed");
  });

  it("synchronizes playhead in relative mode", () => {
    const cutB: CutClip[] = [
      { id: "b1", in_pts_us: 0, out_pts_us: 10_000_000 }, // 10s
    ];
    // At halfway point of Cut A (4.25s / 8.5s = 50%), Cut B is at 5.0s
    const mapped = syncPlayhead(4_250_000, sampleCutA, cutB, "RELATIVE");
    expect(mapped).toBe(5_000_000);
  });

  it("synchronizes playhead in source-match mode to exact matching source frame", () => {
    const cutB: CutClip[] = [
      // c2 is at position 0 in cutB (starts at source time 5_000_000)
      { id: "c2", in_pts_us: 5_000_000, out_pts_us: 8_000_000, label: "Run" },
    ];

    // In Cut A, c1 is 3s, gap is 0.5s -> c2 starts at 3.5s (3_500_000 us).
    // At 4.5s in Cut A (1s into c2), source time is 5_000_000 + 1_000_000 = 6_000_000.
    // In Cut B, c2 starts at 0, so source time 6_000_000 is 1.0s (1_000_000 us).
    const mapped = syncPlayhead(4_500_000, sampleCutA, cutB, "SOURCE_MATCH");
    expect(mapped).toBe(1_000_000);
  });
});
