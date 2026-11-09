/** B.21 (ADR-096): transitions on every cut (the same rule the API applies) and where a marker falls in the reel */
import { describe, expect, it } from "vitest";
import { transitionsForAll } from "@otsi-vie/contracts";
import { reelTimeOf } from "@/components/studio/editing";

describe("transitions on every cut", () => {
  it("none into the first clip or after a gap; a short clip takes half of itself; too short none", () => {
    const clips = [{ id: "a", in_pts_us: 0, out_pts_us: 4e6 }, { id: "b", in_pts_us: 5e6, out_pts_us: 9e6 }, { id: "c", in_pts_us: 10e6, out_pts_us: 10.6e6 },
      { id: "d", in_pts_us: 11e6, out_pts_us: 15e6, gap_ms: 500 }, { id: "e", in_pts_us: 20e6, out_pts_us: 20.3e6 }];
    expect(transitionsForAll(clips, 600)).toEqual([{ clip_id: "a", ms: null }, { clip_id: "b", ms: 600 }, { clip_id: "c", ms: 300 }, { clip_id: "d", ms: null }, { clip_id: "e", ms: null }]);
  });
});

describe("marker reel time", () => {
  it("on the clip that holds it, with its slow motion; null when no clip holds it", () => {
    const items = [{ clip: { in_pts_us: 10e6, out_pts_us: 12e6, effect: null }, start: 0 },
      { clip: { in_pts_us: 20e6, out_pts_us: 22e6, effect: { kind: "SLOW" as const, at_us: null, speed: 0.5, hold_ms: 0 } }, start: 2e6 }];
    expect(reelTimeOf(items, 11e6)).toBe(1e6);
    expect(reelTimeOf(items, 21e6)).toBe(4e6);                // 1 s of source at half speed is 2 s of reel
    expect(reelTimeOf(items, 15e6)).toBeNull();
  });
});
