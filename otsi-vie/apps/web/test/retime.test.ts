import { describe, expect, it } from "vitest";
import { NO_EFFECT, SetClipEffectRequest, clipOutputUs, effectActive, normaliseEffect, outAt, srcAt, strapStartUs, type ClipEffect } from "@otsi-vie/contracts";
import { place, locate } from "@/components/studio/useStudio";
import { renderedState } from "@/components/studio/spotlight";

const c = (effect: ClipEffect = NO_EFFECT) => ({ in_pts_us: 0, out_pts_us: 4_000_000, effect });

describe("clip speed effects (E2, ADR-065): the renderer's lengths (services/worker tests check the same numbers)", () => {
  it("lengths: slow doubles, a freeze adds its hold, the ramp adds its slowed second either side", () => {
    expect(clipOutputUs(c())).toBe(4_000_000);
    expect(clipOutputUs(c({ kind: "SLOW", at_us: null, speed: 0.5, hold_ms: 0 }))).toBe(8_000_000);
    expect(clipOutputUs(c({ kind: "FREEZE", at_us: 1_000_000, speed: 1, hold_ms: 1500 }))).toBe(5_500_000);
    expect(clipOutputUs(c({ kind: "RAMP", at_us: 2_000_000, speed: 0.35, hold_ms: 0 }))).toBe(5_380_490);       // Python 5380489.98
    expect(effectActive(c({ kind: "FREEZE", at_us: 5_000_000, speed: 1, hold_ms: 1500 }))).toBe(false);
    expect(clipOutputUs(c({ kind: "FREEZE", at_us: 5_000_000, speed: 1, hold_ms: 1500 }))).toBe(4_000_000);
  });
  it("reel time to source time and back", () => {
    const f = c({ kind: "FREEZE", at_us: 1_000_000, speed: 1, hold_ms: 1500 });
    expect(srcAt(f, 500_000)).toEqual({ src: 500_000, speed: 1 });
    expect(srcAt(f, 1_800_000)).toEqual({ src: 1_000_000, speed: 0 });
    expect(srcAt(f, 3_000_000).src).toBe(1_500_000);
    expect(outAt(f, 1_000_000)).toBe(1_000_000);
    expect(outAt(f, 1_500_000)).toBe(3_000_000);
    const s = c({ kind: "SLOW", at_us: null, speed: 0.25, hold_ms: 0 });
    expect(srcAt(s, 8_000_000)).toEqual({ src: 2_000_000, speed: 0.25 });
    expect(outAt(s, 2_000_000)).toBe(8_000_000);
    const r = c({ kind: "RAMP", at_us: 2_000_000, speed: 0.35, hold_ms: 0 });
    for (const t of [500_000, 1_200_000, 2_000_000, 2_900_000, 3_500_000]) expect(srcAt(r, outAt(r, t)).src).toBeCloseTo(t, 0);
    expect(srcAt(r, outAt(r, 2_000_000)).speed).toBeLessThan(0.4);
    expect(strapStartUs(f)).toBe(0);
    expect(strapStartUs(r)).toBeCloseTo(outAt(r, 2_000_000) - 1_000_000, 3);
    expect(strapStartUs(c())).toBe(0);
  });
  it("the request: freeze and ramp need their moment; unused fields are reset", () => {
    expect(SetClipEffectRequest.safeParse({ kind: "FREEZE", hold_ms: 1000 }).success).toBe(false);
    expect(SetClipEffectRequest.safeParse({ kind: "SLOW", speed: 0.9 }).success).toBe(false);
    expect(SetClipEffectRequest.safeParse({ kind: "FREEZE", at_us: 1, hold_ms: 100 }).success).toBe(false);
    expect(normaliseEffect(SetClipEffectRequest.parse({ kind: "SLOW", speed: 0.5, at_us: 9, hold_ms: 900 }))).toEqual({ kind: "SLOW", at_us: null, speed: 0.5, hold_ms: 0 });
  });
  it("the timeline places clips by their reel length; a speed change marks the clip as changed since the render", () => {
    const clips = [{ id: "a", sequence_index: 0, in_pts_us: 0, out_pts_us: 2_000_000, origin: "MANUAL" as const, label: null, effect: { kind: "SLOW" as const, at_us: null, speed: 0.5, hold_ms: 0 } },
      { id: "b", sequence_index: 1, in_pts_us: 5_000_000, out_pts_us: 6_000_000, origin: "MANUAL" as const, label: null, effect: NO_EFFECT }];
    const { items, total } = place({ clips } as never);
    expect(total).toBe(5_000_000);
    expect(items[1]!.start).toBe(4_000_000);
    expect(locate(items, 2_000_000)!.src).toBe(1_000_000);
    const config = { aspect: "16:9", settings: {}, transitions: [], clips: [{ id: "a", in_pts_us: 0, out_pts_us: 2_000_000 }, { id: "b", in_pts_us: 5_000_000, out_pts_us: 6_000_000 }] };
    const rs = renderedState({ clips, transitions: [], aspect: "16:9", settings: {}, stale: false, last_good_render: { config } });
    expect([rs.clip("a"), rs.clip("b")]).toEqual(["CHANGED", "RENDERED"]);                  // a render from before effects: b had none
  });
});
