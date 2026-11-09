import { describe, expect, it } from "vitest";
import { SpotlightSettings } from "@otsi-vie/contracts";
import { CROP_DEAD_ZONE, cropAlpha, cropTarget, renderedState } from "@/components/studio/spotlight";

// the same cases as services/worker/tests/test_render_reel.py test_reframe_crop_rules (E3, ADR-066)
describe("player-following reframe (E3, ADR-066): the renderer's crop rules", () => {
  const cw = 608;
  it("first frame: straight on the player, a little ahead of him", () => {
    expect(cropTarget(null, 1000, null, cw)).toBe(1000);
    expect(cropTarget(null, 1000, 1100, cw)).toBeCloseTo(1040);
  });
  it("holds still inside the dead zone, moves only to its edge outside, holds without a player", () => {
    const lim = CROP_DEAD_ZONE * cw;
    expect(cropTarget(1000, 1000 + lim - 1, null, cw)).toBe(1000);
    expect(cropTarget(1000, 1000 + lim + 50, null, cw)).toBeCloseTo(1050);
    expect(cropTarget(1000, 1000 - lim - 30, null, cw)).toBeCloseTo(970);
    expect(cropTarget(1000, null, 1500, cw)).toBe(1000);
    expect(cropTarget(null, null, null, cw)).toBeNull();
  });
  it("follow speed: calm 0.04, normal 0.12 (as before E3), quick 0.2", () => {
    expect([cropAlpha(0), cropAlpha(0.5), cropAlpha(1), cropAlpha(3)].map((x) => +x.toFixed(3))).toEqual([0.04, 0.12, 0.2, 0.2]);
  });
});

describe("rendered state with export profiles (E3)", () => {
  const clips = [{ id: "c1", in_pts_us: 0, out_pts_us: 4e6, sequence_index: 0 }];
  const settings = SpotlightSettings.parse({});
  const cfg = (aspect: string, profile?: string, s: object = settings) => ({ clips: [{ id: "c1", in_pts_us: 0, out_pts_us: 4e6 }], transitions: [], aspect, settings: s, ...(profile ? { profile } : {}) });
  const state = (config: Record<string, unknown>) => renderedState({ clips, transitions: [], aspect: "16:9", settings, stale: false, last_good_render: { config } }).reel.state;
  it("a social 9:16 file of a 16:9 reel is still this edit; a 9:16 reel render is not", () => {
    expect(state(cfg("9:16", "SOCIAL"))).toBe("RENDERED");
    expect(state(cfg("9:16", "REEL"))).toBe("CHANGED");
    expect(state(cfg("9:16"))).toBe("CHANGED");
  });
  it("a render made before E3 (no reframe_speed / duck_music) is not flagged as changed by the new defaults", () => {
    const { reframe_speed, duck_music, ...old } = settings;
    void reframe_speed; void duck_music;
    expect(state(cfg("16:9", undefined, old))).toBe("RENDERED");
    expect(state(cfg("16:9", undefined, { ...old, reframe_speed: 0.9 }))).toBe("CHANGED");
  });
});
