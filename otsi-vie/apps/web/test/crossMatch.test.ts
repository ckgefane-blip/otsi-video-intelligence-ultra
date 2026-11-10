/**
 * Cross-match best moments, pure selection (ADR-131, rule v2.1): the tier rule, the fill order, the caps, the dedupe — no API, no DB.
 * The rule is the owner's agreed rule (2026-11-10) as finalised in v2.1: fixed tiers filled top-down, chains first inside a tier,
 * round-robin across matches (not pure chronological — that dropped late-season matches), per-match cap 3 / 4 / 5 by length with
 * Tier S immune, 5 minutes a solid cap, fewer than 3 eligible moments builds with what's there.
 */
import { describe, expect, it } from "vitest";
import {
  BEST_MOMENTS_RULE_VERSION, CROSS_MATCH_MOMENT_CAPS, CROSS_MATCH_PER_MATCH_CAPS, POSITION_PROMOTIONS, crossMatchChainLabel,
  crossMatchClipLabel, crossMatchClipWindow, selectCrossMatchMoments, tierOfCandidate, type CrossMatchCandidate,
} from "@otsi-vie/contracts";

const vid = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;
const cand = (o: Partial<CrossMatchCandidate> & { video: number }): CrossMatchCandidate => {
  const { video, ...rest } = o;
  return {
    video_id: vid(video), video_title: `FC Dynamo v FC Ercakhu ${video}`, home: "FC Dynamo", away: "FC Ercakhu",
    competition: "Abkhazia Premier League", kickoff_at: `2026-10-0${video}T15:00:00.000Z`, opponent: "FC Ercakhu",
    match_minute: 10, in_pts_us: 10_000_000, out_pts_us: 20_000_000, key_at_us: 12_000_000,
    events: [], pass_length_m: null, sprint: null, label: "Shot", dedupe_key: "SHOT",
    is_chain: false, sequence_label: null,
    ...rest,
  };
};
const ev = (video: number, events: CrossMatchCandidate["events"], atS: number, extra: Partial<CrossMatchCandidate> = {}) =>
  cand({ video, events, in_pts_us: atS * 1_000_000, out_pts_us: (atS + 10) * 1_000_000, key_at_us: (atS + 2) * 1_000_000,
    label: events[0] ?? "Shot", dedupe_key: events[0] ?? "NONE", is_chain: events.length >= 2, ...extra });
const reasons = (s: ReturnType<typeof selectCrossMatchMoments>) => s.not_selected.map((x) => x.reason);

describe("the tier rule (ADR-131)", () => {
  it("assigns every measured event its tier, best event first", () => {
    expect(tierOfCandidate(ev(1, ["GOAL"], 10))).toEqual({ tier: "S", reason: "Goal" });
    expect(tierOfCandidate(ev(1, ["FREE_KICK_GOAL"], 10))).toEqual({ tier: "S", reason: "Free-kick goal" });
    expect(tierOfCandidate(ev(1, ["PENALTY_GOAL"], 10))).toEqual({ tier: "S", reason: "Penalty goal" });
    expect(tierOfCandidate(ev(1, ["SHOT"], 10))).toEqual({ tier: "A", reason: "Shot" });
    expect(tierOfCandidate(ev(1, ["KEY_PASS"], 10))).toEqual({ tier: "A", reason: "Key pass" });
    expect(tierOfCandidate(ev(1, ["TACKLE"], 10))).toEqual({ tier: "B", reason: "Tackle (possible)" });
    expect(tierOfCandidate(ev(1, ["INTERCEPTION"], 10))).toEqual({ tier: "B", reason: "Interception (possible)" });
    expect(tierOfCandidate(ev(1, ["BALL_WON"], 10))).toEqual({ tier: "C", reason: "Ball won" });
    expect(tierOfCandidate(ev(1, ["PRESSURE_REGAIN"], 10))).toEqual({ tier: "C", reason: "Recovery" });
    // a moment's tier is its best event's: a shot with a long pass in it is tier A, not C
    expect(tierOfCandidate(ev(1, ["SHOT", "PASS"], 10, { pass_length_m: 30 }))).toEqual({ tier: "A", reason: "Shot" });
    expect(tierOfCandidate(ev(1, ["BALL_WON", "TACKLE"], 10))).toEqual({ tier: "B", reason: "Tackle (possible)" });
  });

  it("a long pass counts at 25 m, not at 24.9 m; a plain pass is never a best moment", () => {
    expect(tierOfCandidate(ev(1, ["PASS"], 10, { pass_length_m: 25 }))).toEqual({ tier: "C", reason: "Long pass" });
    expect(tierOfCandidate(ev(1, ["PASS"], 10, { pass_length_m: 24.9 }))).toEqual({ tier: null, reason: "not a best moment" });
    expect(tierOfCandidate(ev(1, ["PASS"], 10, { pass_length_m: null }))).toEqual({ tier: null, reason: "not a best moment" });
  });

  it("a sprint counts at 85% of the player's own top speed in that match, not below it", () => {
    const sprint = (top: number, matchTop: number | null) =>
      cand({ video: 1, sprint: { top_kmh: top, match_top_speed_kmh: matchTop }, label: `Sprint — ${top} km/h`, dedupe_key: "SPRINT" });
    expect(tierOfCandidate(sprint(25.5, 30))).toEqual({ tier: "B", reason: "Sprint — 25.5 km/h" });
    expect(tierOfCandidate(sprint(25.4, 30))).toEqual({ tier: null, reason: "sprint below 85% of match top speed" });
    expect(tierOfCandidate(sprint(28, null))).toEqual({ tier: null, reason: "top speed not measured" });
  });

  it("set pieces, receptions and pressure are in no tier — never selected, never faked", () => {
    for (const events of [["FREE_KICK"], ["CORNER"], ["PENALTY"], ["PASS_RECEIVED"], ["PRESSURE"], ["SET_PIECE"], ["THROW_IN"]] as CrossMatchCandidate["events"][]) {
      expect(tierOfCandidate(ev(1, events, 10)).tier).toBeNull();
    }
    const s = selectCrossMatchMoments([ev(1, ["FREE_KICK"], 10), ev(1, ["PASS_RECEIVED"], 20), ev(2, ["SHOT"], 10)], 180);
    expect(s.selected.map((m) => m.events)).toEqual([["SHOT"]]);
    expect(reasons(s)).toEqual(["not a best moment", "not a best moment"]);
  });
});

describe("the position promotion (ADR-131 v2.1)", () => {
  it("lifts a defender's tackle and interception to Tier A, and nothing else for a defender", () => {
    expect(tierOfCandidate(ev(1, ["TACKLE"], 10), "DEF")).toEqual({ tier: "A", reason: "Tackle (possible)" });
    expect(tierOfCandidate(ev(1, ["INTERCEPTION"], 10), "DEF")).toEqual({ tier: "A", reason: "Interception (possible)" });
    expect(tierOfCandidate(ev(1, ["BALL_WON"], 10), "DEF")).toEqual({ tier: "C", reason: "Ball won" });
  });

  it("does not promote without a position, or for another line's action", () => {
    expect(tierOfCandidate(ev(1, ["TACKLE"], 10))).toEqual({ tier: "B", reason: "Tackle (possible)" });
    expect(tierOfCandidate(ev(1, ["TACKLE"], 10), null)).toEqual({ tier: "B", reason: "Tackle (possible)" });
    expect(tierOfCandidate(ev(1, ["TACKLE"], 10), "MID")).toEqual({ tier: "B", reason: "Tackle (possible)" });
  });

  it("the midfielder, winger and goalkeeper promotions are dormant — their actions are not measured", () => {
    // no through-ball, take-on or save event exists, so nothing can be promoted: a midfielder's key pass is Tier A because
    // a key pass is Tier A, not because of the promotion — and his tackle stays Tier B
    expect(tierOfCandidate(ev(1, ["KEY_PASS"], 10), "MID")).toEqual({ tier: "A", reason: "Key pass" });
    expect(tierOfCandidate(ev(1, ["SHOT"], 10), "FWD")).toEqual({ tier: "A", reason: "Shot" });
    expect(tierOfCandidate(ev(1, ["SHOT"], 10), "GK")).toEqual({ tier: "A", reason: "Shot" });
    expect(POSITION_PROMOTIONS).toEqual({
      DEF: { TACKLE: "A", INTERCEPTION: "A" }, MID: { THROUGH_BALL: "A" }, FWD: { TAKE_ON: "A" }, GK: { SAVE: "A" },
    });
  });
});

describe("chains (ADR-131 v2.1)", () => {
  it("builds a chain label from the events in time order, distinct kinds only", () => {
    expect(crossMatchChainLabel(["TACKLE", "PASS", "KEY_PASS"], 30)).toBe("Tackle (possible) → Long pass → Key pass");
    expect(crossMatchChainLabel(["TACKLE", "PASS", "KEY_PASS"], 10)).toBe("Tackle (possible) → Pass → Key pass");
    expect(crossMatchChainLabel(["TACKLE", "TACKLE", "KEY_PASS"])).toBe("Tackle (possible) → Key pass");
    expect(crossMatchChainLabel(["SHOT"])).toBeNull();
    expect(crossMatchChainLabel([])).toBeNull();
  });

  it("a chain outranks a single action inside a tier, and ranks by its best action", () => {
    const s = selectCrossMatchMoments([
      ev(2, ["TACKLE"], 40),
      ev(1, ["BALL_WON", "TACKLE"], 10, { sequence_label: "Ball won → Tackle (possible)" }),
      ev(3, ["BALL_WON"], 50),
      ev(1, ["TACKLE", "KEY_PASS"], 30, { sequence_label: "Tackle (possible) → Key pass" }),
    ], 180);
    expect(s.selected.map((m) => [m.tier, m.reason, m.is_chain])).toEqual([
      ["A", "Tackle (possible) → Key pass", true],
      ["B", "Ball won → Tackle (possible)", true],
      ["B", "Tackle (possible)", false],
      ["C", "Ball won", false],
    ]);
  });
});

describe("clip timing (ADR-131 v2.1)", () => {
  it("windows a moment 3.0 s before the first event to 2.5 s after the last", () => {
    expect(crossMatchClipWindow(10_000_000, 15_500_000, 60_000_000)).toEqual({ in_pts_us: 7_000_000, out_pts_us: 18_000_000 });
  });

  it("clamps a clip to 12 s maximum, keeping the decisive end", () => {
    expect(crossMatchClipWindow(10_000_000, 40_000_000, 90_000_000)).toEqual({ in_pts_us: 30_500_000, out_pts_us: 42_500_000 });
  });

  it("clamps a clip to 4 s minimum, and never starts before 0 or ends after the video", () => {
    // an event half a second into the video: 3 s before it would be before 0, and the window would be under 4 s
    expect(crossMatchClipWindow(500_000, 800_000, 60_000_000)).toEqual({ in_pts_us: 0, out_pts_us: 4_000_000 });
    expect(crossMatchClipWindow(1_000_000, 1_500_000, 60_000_000)).toEqual({ in_pts_us: 0, out_pts_us: 4_000_000 });
    // an event at the end of the video: the out-point hits the duration cap, so the in-point shifts earlier to keep 4 s
    expect(crossMatchClipWindow(59_500_000, 59_800_000, 60_000_000)).toEqual({ in_pts_us: 56_000_000, out_pts_us: 60_000_000 });
    expect(crossMatchClipWindow(58_000_000, 59_000_000, 60_000_000)).toEqual({ in_pts_us: 55_000_000, out_pts_us: 60_000_000 });
  });
});

describe("the fill (ADR-131)", () => {
  it("stamps rule version 2.1", () => {
    expect(BEST_MOMENTS_RULE_VERSION).toBe("2.1");
    expect(selectCrossMatchMoments([ev(1, ["GOAL"], 10)], 180).rule_version).toBe("2.1");
  });

  it("fills top-down by tier — a goal always beats a key pass, a key pass always beats a dribble", () => {
    const s = selectCrossMatchMoments([
      ev(2, ["TACKLE"], 40), ev(1, ["KEY_PASS"], 30), ev(3, ["BALL_WON"], 50), ev(1, ["GOAL"], 10), ev(2, ["SHOT"], 20),
    ], 180);
    expect(s.selected.map((m) => [m.tier, m.events[0]])).toEqual([["S", "GOAL"], ["A", "KEY_PASS"], ["A", "SHOT"], ["B", "TACKLE"], ["C", "BALL_WON"]]);
    expect(s.rule_version).toBe(BEST_MOMENTS_RULE_VERSION);
    expect(s.length_s).toBe(180);
  });

  it("round-robins across matches inside a tier — a late-season match gets in ahead of an early match's second moment", () => {
    const s = selectCrossMatchMoments([
      ev(3, ["SHOT"], 10, { match_minute: 80 }), ev(1, ["SHOT"], 30, { match_minute: 20 }), ev(2, ["SHOT"], 10, { match_minute: 5 }),
      ev(1, ["SHOT"], 10, { match_minute: 20 }),
    ], 180);
    // round 1: video 1's 10 s moment, video 2's, video 3's; round 2: video 1's 30 s moment — chronological inside a match
    expect(s.selected.map((m) => [m.video_id, m.in_pts_us])).toEqual([[vid(1), 10_000_000], [vid(2), 10_000_000], [vid(3), 10_000_000], [vid(1), 30_000_000]]);
  });

  it("caps non-Tier-S moments per match at 3 / 4 / 5 for 90 s / 3 min / 5 min, and a cap block does not end the fill", () => {
    const five = [10, 20, 30, 40, 50].map((at) => ev(1, ["SHOT"], at));
    const withOther = [...five, ev(2, ["SHOT"], 10)];
    const s90 = selectCrossMatchMoments(withOther, 90);
    expect(s90.selected).toHaveLength(4);
    expect(s90.per_match_counts).toEqual({ [vid(1)]: 3, [vid(2)]: 1 });
    expect(s90.not_selected).toHaveLength(2);
    expect(s90.not_selected.map((x) => x.reason)).toEqual(["per-match cap reached", "per-match cap reached"]);
    const s180 = selectCrossMatchMoments(withOther, 180);
    expect(s180.selected).toHaveLength(5);
    expect(s180.per_match_counts).toEqual({ [vid(1)]: 4, [vid(2)]: 1 });
    expect(selectCrossMatchMoments(withOther, 300).selected).toHaveLength(6);
    expect(CROSS_MATCH_PER_MATCH_CAPS).toEqual({ 90: 3, 180: 4, 300: 5 });
  });

  it("Tier S is immune to the per-match cap — a hat-trick and one more all make the reel at 90 s", () => {
    const four = [10, 20, 30, 40].map((at) => ev(1, ["GOAL"], at));
    const s = selectCrossMatchMoments(four, 90);
    expect(s.selected).toHaveLength(4);
    expect(s.per_match_counts).toEqual({ [vid(1)]: 4 });
    expect(s.not_selected).toEqual([]);
  });

  it("caps the moments at 12 / 20 / 30 for 90 s / 3 min / 5 min", () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => ev((i % 4) + 1, ["GOAL"], 10 + i * 20, { out_pts_us: (15 + i * 20) * 1_000_000 }));
    expect(selectCrossMatchMoments(fifteen, 90).selected).toHaveLength(12);
    expect(selectCrossMatchMoments(fifteen, 90).not_selected.map((x) => x.reason)).toEqual(["moments cap reached", "moments cap reached", "moments cap reached"]);
    expect(selectCrossMatchMoments(fifteen, 180).selected).toHaveLength(15);
    expect(selectCrossMatchMoments(fifteen, 300).selected).toHaveLength(15);
    expect(CROSS_MATCH_MOMENT_CAPS).toEqual({ 90: 12, 180: 20, 300: 30 });
  });

  it("never exceeds 5 minutes at length 300, even with moments left", () => {
    const six = Array.from({ length: 6 }, (_, i) => ev(i + 1, ["GOAL"], 10, { out_pts_us: 70_000_000 }));
    const s = selectCrossMatchMoments(six, 300);
    expect(s.selected).toHaveLength(5);
    expect(s.total_s).toBe(300);
    expect(s.not_selected).toMatchObject([{ reason: "length cap reached" }]);
  });

  it("the first moment that does not fit ends the fill — a shorter later one stays out", () => {
    const s = selectCrossMatchMoments([
      ev(1, ["GOAL"], 10, { out_pts_us: 70_000_000 }), ev(2, ["GOAL"], 10, { out_pts_us: 70_000_000 }),
      ev(3, ["GOAL"], 10, { out_pts_us: 110_000_000 }), ev(4, ["GOAL"], 10, { out_pts_us: 20_000_000 }),
    ], 180);
    expect(s.selected.map((m) => m.video_id)).toEqual([vid(1), vid(2)]);
    expect(s.total_s).toBe(120);
    expect(reasons(s)).toEqual(["length cap reached", "length cap reached"]);
  });

  it("dedupes the same moment twice in one video, and a sprint inside a selected event moment", () => {
    const goal = ev(1, ["GOAL"], 10, { out_pts_us: 20_000_000 });
    const again = ev(1, ["GOAL"], 15, { out_pts_us: 25_000_000 });
    const sprint = cand({ video: 1, in_pts_us: 15_000_000, out_pts_us: 25_000_000, key_at_us: 16_000_000,
      sprint: { top_kmh: 28, match_top_speed_kmh: 30 }, label: "Sprint — 28 km/h", dedupe_key: "SPRINT" });
    const otherVideo = cand({ video: 2, in_pts_us: 15_000_000, out_pts_us: 25_000_000, key_at_us: 16_000_000,
      sprint: { top_kmh: 28, match_top_speed_kmh: 30 }, label: "Sprint — 28 km/h", dedupe_key: "SPRINT" });
    const s = selectCrossMatchMoments([goal, again, sprint, otherVideo], 180);
    expect(s.selected.map((m) => [m.video_id, m.reason])).toEqual([[vid(1), "Goal"], [vid(2), "Sprint — 28 km/h"]]);
    expect(reasons(s)).toEqual(["duplicate moment", "overlaps a selected moment"]);
  });

  it("fewer than 3 eligible moments builds with what's there — no filler", () => {
    const s = selectCrossMatchMoments([ev(1, ["GOAL"], 10), ev(2, ["SHOT"], 20)], 90);
    expect(s.selected).toHaveLength(2);
    expect(s.not_selected).toEqual([]);
    expect(s.total_s).toBe(20);
  });

  it("counts the moments per match", () => {
    const s = selectCrossMatchMoments([ev(1, ["GOAL"], 10), ev(1, ["SHOT"], 30), ev(2, ["GOAL"], 10)], 180);
    expect(s.per_match_counts).toEqual({ [vid(1)]: 2, [vid(2)]: 1 });
  });
});

describe("the clip label (ADR-131 v2.1)", () => {
  it("is a broadcast lower-third: tier, reason, minute and opponent — never inventing a minute", () => {
    const c = cand({ video: 1, match_minute: 67, opponent: "Ercakhu", key_at_us: 754_000_000 });
    expect(crossMatchClipLabel(c, "S", "Goal")).toBe("[Tier S] Goal · 67' vs Ercakhu");
    expect(crossMatchClipLabel({ ...c, match_minute: null }, "S", "Goal")).toBe("[Tier S] Goal · 12:34 vs Ercakhu");
    expect(crossMatchClipLabel({ ...c, opponent: null, video_title: "FC Dynamo v FC Ercakhu" }, "S", "Goal")).toBe("[Tier S] Goal · 67' FC Dynamo v FC Ercakhu");
    expect(crossMatchClipLabel(c, "B", "Tackle (possible) → Key pass")).toBe("[Tier B] Tackle (possible) → Key pass · 67' vs Ercakhu");
  });
});
