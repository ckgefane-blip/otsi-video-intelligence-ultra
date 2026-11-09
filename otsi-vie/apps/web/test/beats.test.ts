import { describe, expect, it } from "vitest";
import { BEAT_LIBRARY_NOTE, beatSnapTargets, beatsUsable, describeBeatGrid, reelBeats, type BeatGrid } from "@otsi-vie/contracts";

const baseGrid: BeatGrid = {
  id: "01931320-0000-7000-8000-000000000001",
  music_id: "01931320-0000-7000-8000-000000000002",
  status: "SUCCEEDED",
  method: "otsi-beat-v1",
  tempo_bpm: 120.0,
  beats_us: [500_000, 1_000_000, 1_500_000, 2_000_000],
  duration_us: 2_000_000,
  periodicity: 0.85,
  failure: null,
  requested_by: "Owner",
  created_at: "2026-11-09T00:00:00Z",
  finished_at: "2026-11-09T00:00:02Z",
};

describe("C.5 Beat grid pure functions", () => {
  it("describes beat grid state faithfully", () => {
    expect(describeBeatGrid(null)).toBe("Beat not analysed yet.");
    expect(describeBeatGrid({ ...baseGrid, status: "QUEUED" })).toBe("Waiting to find the beat…");
    expect(describeBeatGrid({ ...baseGrid, status: "RUNNING" })).toBe("Finding the beat…");
    expect(describeBeatGrid({ ...baseGrid, status: "FAILED", failure: "File unreadable." })).toBe("File unreadable.");
    expect(describeBeatGrid({ ...baseGrid, periodicity: 0.05 })).toContain("No steady beat found");
    expect(describeBeatGrid(baseGrid)).toContain("About 120 BPM · 4 beats · Detected");
    expect(BEAT_LIBRARY_NOTE).toContain("NumPy and SciPy, BSD-3-Clause");
  });

  it("checks whether a grid is usable for snapping", () => {
    expect(beatsUsable(baseGrid)).toBe(true);
    expect(beatsUsable(null)).toBe(false);
    expect(beatsUsable({ ...baseGrid, status: "RUNNING" })).toBe(false);
    expect(beatsUsable({ ...baseGrid, periodicity: 0.08 })).toBe(false);
    expect(beatsUsable({ ...baseGrid, beats_us: [500_000, 1_000_000] })).toBe(false); // < 4 beats
    expect(beatsUsable({ ...baseGrid, duration_us: 0 })).toBe(false);
  });

  it("loops beats across the reel duration", () => {
    // 2s duration looped across a 5s reel:
    // loop 0: 0.5s, 1.0s, 1.5s, 2.0s
    // loop 1: 2.5s, 3.0s, 3.5s, 4.0s
    // loop 2: 4.5s, 5.0s
    const beats = reelBeats(baseGrid, 5_000_000);
    expect(beats).toEqual([
      500_000, 1_000_000, 1_500_000, 2_000_000,
      2_500_000, 3_000_000, 3_500_000, 4_000_000,
      4_500_000, 5_000_000,
    ]);
    expect(reelBeats(null, 5_000_000)).toEqual([]);
    expect(reelBeats(baseGrid, 0)).toEqual([]);
  });

  it("calculates beat snap targets for dragging clip in and out edges", () => {
    // Clip starts at 1.0s in the reel, source in=10s, out=12s (length 2s).
    // Reel beats at [0.5s, 1.5s, 2.5s]
    const p = {
      start: 1_000_000,
      clip: { in_pts_us: 10_000_000, out_pts_us: 12_000_000, effect: { kind: "NONE" } },
    };
    const beats = [500_000, 1_500_000, 2_500_000]; // 0.5s is before clip start (skipped)

    // Out edge: beat - start = 0.5s -> in + 0.5s = 10.5s
    //           beat - start = 1.5s -> in + 1.5s = 11.5s
    const outTargets = beatSnapTargets(p, "out", beats);
    expect(outTargets).toEqual([10_500_000, 11_500_000]);

    // In edge:  beat - start = 0.5s -> out - 0.5s = 11.5s
    //           beat - start = 1.5s -> out - 1.5s = 10.5s
    const inTargets = beatSnapTargets(p, "in", beats);
    expect(inTargets).toEqual([11_500_000, 10_500_000]);

    // Slow or ramp clip: no beat targets
    const pSlow = {
      ...p,
      clip: { ...p.clip, effect: { kind: "SLOW" } },
    };
    expect(beatSnapTargets(pSlow, "out", beats)).toEqual([]);
  });
});
