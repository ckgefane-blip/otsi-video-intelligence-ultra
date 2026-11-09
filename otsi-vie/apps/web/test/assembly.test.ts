import { describe, expect, it } from "vitest";
import { buildCandidates, clipOutputUs, familyOf, fillSlots, fitMoment, slotsFromClips, summarise, NO_EFFECT, type MomentEvent, type ReelMoment } from "@otsi-vie/contracts";

const S = 1e6;
const SCORE: Partial<Record<MomentEvent, number>> = { GOAL: 10, SHOT: 5, KEY_PASS: 4, TACKLE: 3, PRESSURE: 2, PASS: 2, CORNER: 3 };
const ev = (a: number, b: number, events: MomentEvent[], key = (a + b) / 2): ReelMoment => ({
  kind: "EVENT", events, score: events.reduce((s, e) => s + (SCORE[e] ?? 1), 0), in_pts_us: a * S, out_pts_us: b * S, visible_us: (b - a) * S,
  observations: 5, track_numbers: [1], in_reel: false, label: events.join(" + "), key_at_us: key * S, coverage: null, rejected: false });
const vis = (a: number, b: number): ReelMoment => ({ kind: "VISIBLE", events: [], score: 0, in_pts_us: a * S, out_pts_us: b * S, visible_us: (b - a) * S,
  observations: 5, track_numbers: [1], in_reel: false, label: "On camera, no action found", key_at_us: null, coverage: null, rejected: false });

// a match: a goal, two shots, defending, passes and a corner, spread over 90 minutes, plus stretches on camera
const moments = [ev(100, 118, ["GOAL", "SHOT"], 110), ev(600, 612, ["SHOT"], 605), ev(1500, 1510, ["TACKLE"]), ev(2400, 2408, ["KEY_PASS"]),
  ev(3000, 3008, ["PASS"]), ev(3600, 3609, ["PRESSURE"]), ev(4200, 4212, ["CORNER"]), ev(5000, 5012, ["SHOT"], 5006), ev(5300, 5306, ["PASS"]),
  vis(200, 210), vis(4000, 4010)];

describe("draft reels (E4, ADR-067)", () => {
  it("a long moment is cut around its key time, a little more before it than after", () => {
    expect(fitMoment(moments[0]!, 10 * S)).toEqual([104.5 * S, 114.5 * S]);
    expect(fitMoment(moments[1]!, 15 * S)).toEqual([600 * S, 612 * S]);
    expect(fitMoment({ in_pts_us: 0, out_pts_us: 20 * S, key_at_us: 1 * S }, 5 * S)).toEqual([0, 5 * S]);       // kept inside the moment
  });

  it("three drafts, each in match order, never more than 10 % over the length; the best one has the goal with a hero ramp", () => {
    const c = buildCandidates(moments, 60 * S, "BEST");
    expect(c.map((x) => x.key)).toEqual(["TOP", "STORY", "EVERY"]);
    for (const d of c) {
      expect(d.duration_us).toBeLessThanOrEqual(66 * S);
      expect(d.duration_us).toBe(d.clips.reduce((s, x) => s + clipOutputUs(x), 0));
      expect(d.clips.map((x) => x.in_pts_us)).toEqual([...d.clips.map((x) => x.in_pts_us)].sort((a, b) => a - b));
      expect(d.clips.every((x) => x.kind === "EVENT")).toBe(true);                 // BEST: only his actions, no "on camera" stretches
    }
    const top = c[0]!;
    expect(top.clips[0]).toMatchObject({ events: ["GOAL", "SHOT"], effect: { kind: "RAMP", at_us: 110 * S, speed: 0.35 } });
    expect(top.why).toMatch(/^\d+ clips: 1 goal, /);
    expect(c[2]!.clips.every((x) => x.out_pts_us - x.in_pts_us <= 5 * S)).toBe(true);        // every touch: quick cuts
    expect(c[2]!.clips.length).toBeGreaterThan(top.clips.length);
  });

  it("the match story reaches across the match; themes keep to their kind; ALL may use on-camera stretches", () => {
    const story = buildCandidates(moments, 60 * S, "BEST").find((x) => x.key === "STORY")!;
    expect(story.clips[0]!.in_pts_us).toBeLessThan(700 * S);
    expect(story.clips[story.clips.length - 1]!.in_pts_us).toBeGreaterThan(4000 * S);
    const def = buildCandidates(moments, 60 * S, "DEFENCE");
    expect(def.flatMap((d) => d.clips).every((x) => ["TACKLE", "PRESSURE"].includes(x.events[0]!))).toBe(true);
    expect(def[0]!.short).toBe(true);                                             // two defending moments cannot fill a minute
    expect(def[0]!.why).toMatch(/not enough of his play/);
    expect(buildCandidates([vis(0, 10)], 60 * S, "BEST")).toEqual([]);            // nothing he did: no draft (unknown beats wrong)
    expect(buildCandidates([vis(0, 10)], 60 * S, "ALL")[0]!.clips[0]!.kind).toBe("VISIBLE");
  });

  it("identical drafts are shown once", () => {
    const few = buildCandidates([ev(10, 14, ["SHOT"])], 30 * S, "BEST");
    expect(few.map((x) => x.key)).toEqual(["TOP"]);
  });

  it("summary words", () => {
    expect(summarise([{ kind: "EVENT", events: ["SHOT"] }, { kind: "EVENT", events: ["SHOT"] }, { kind: "EVENT", events: ["KEY_PASS"] }, { kind: "VISIBLE", events: [] }]))
      .toBe("2 shots, 1 key pass, 1 on camera");
    expect(summarise([{ kind: "EVENT", events: ["PASS"] }, { kind: "EVENT", events: ["PASS_RECEIVED"] }, { kind: "EVENT", events: ["KEY_PASS"] }, { kind: "EVENT", events: ["KEY_PASS"] }]))
      .toBe("2 key passes, 2 passes");
  });
});

describe("template slots (E4, ADR-067)", () => {
  it("a reel's clips become slots: kind of moment, length, speed effect", () => {
    const clips = [{ in_pts_us: 104 * S, out_pts_us: 114 * S, effect: { kind: "RAMP" as const, at_us: 110 * S, speed: 0.35, hold_ms: 0 } },
      { in_pts_us: 1500 * S, out_pts_us: 1506 * S, effect: NO_EFFECT }, { in_pts_us: 9000 * S, out_pts_us: 9004 * S, effect: NO_EFFECT }];
    expect(slotsFromClips(clips, moments)).toEqual([
      { family: "GOAL", max_s: 10, effect: "RAMP", speed: 0.35, hold_ms: 0 },
      { family: "DEFENDING", max_s: 6, effect: "NONE", speed: 1, hold_ms: 0 },
      { family: "ANY_ACTION", max_s: 4, effect: "NONE", speed: 1, hold_ms: 0 }]);
    expect(familyOf(moments[9]!)).toBe("ON_CAMERA");
  });

  it("filled with another player's best moment of each kind, in the template's order; a kind he has none of is left out and named", () => {
    const other = [ev(50, 60, ["SHOT"], 57), ev(300, 306, ["SHOT"]), ev(800, 806, ["PRESSURE"]), ev(900, 905, ["PASS"])];
    const { clips, left_out } = fillSlots([
      { family: "GOAL", max_s: 10, effect: "RAMP", speed: 0.35, hold_ms: 0 },
      { family: "SHOT", max_s: 8, effect: "FREEZE", speed: 1, hold_ms: 1000 },
      { family: "SHOT", max_s: 8, effect: "NONE", speed: 1, hold_ms: 0 },
      { family: "DEFENDING", max_s: 6, effect: "SLOW", speed: 0.5, hold_ms: 0 }], other, 600 * S);
    expect(left_out).toEqual(["slot 1 (a goal): none of his in this match"]);
    // the 10 s shot cut to 8 s around its key time (57 s), kept inside the moment: 52-60 s
    expect(clips.map((c) => [c.in_pts_us / S, c.out_pts_us / S, c.effect.kind])).toEqual([[52, 60, "FREEZE"], [300, 306, "NONE"], [800, 806, "SLOW"]]);
    expect(clips[0]!.effect).toEqual({ kind: "FREEZE", at_us: 57 * S, speed: 1, hold_ms: 1000 });
  });

  it("a freeze or ramp without its key moment in the clip is left at normal speed, and said", () => {
    const { clips, left_out } = fillSlots([{ family: "PASSING", max_s: 3, effect: "RAMP", speed: 0.35, hold_ms: 0 }], [ev(0, 10, ["PASS"], 0)], 600 * S);
    expect(clips[0]!.effect.kind).toBe("NONE");
    expect(left_out[0]).toMatch(/no key moment/);
  });
});
