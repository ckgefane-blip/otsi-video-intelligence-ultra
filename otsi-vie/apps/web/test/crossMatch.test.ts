/**
 * Cross-match best moments, pure selection (ADR-131): the tier rule, the fill order, the caps, the dedupe — no API, no DB.
 * The rule is the owner's agreed rule (2026-11-10): fixed tiers filled top-down, chronological within a tier, at most 4
 * moments from one match, 5 minutes a solid cap, fewer than 3 eligible moments builds with what's there.
 */
import { describe, expect, it } from "vitest";
import {
  BEST_MOMENTS_RULE_VERSION, CROSS_MATCH_MAX_PER_MATCH, CROSS_MATCH_MOMENT_CAPS, crossMatchClipLabel, selectCrossMatchMoments,
  tierOfCandidate, type CrossMatchCandidate,
} from "@otsi-vie/contracts";

const vid = (n: number) => `00000000-0000-7000-8000-00000000000${n}`;
const cand = (o: Partial<CrossMatchCandidate> & { video: number }): CrossMatchCandidate => {
  const { video, ...rest } = o;
  return {
    video_id: vid(video), video_title: `FC Dynamo v FC Ercakhu ${video}`, home: "FC Dynamo", away: "FC Ercakhu",
    competition: "Abkhazia Premier League", kickoff_at: `2026-10-0${video}T15:00:00.000Z`, opponent: "FC Ercakhu",
    match_minute: 10, in_pts_us: 10_000_000, out_pts_us: 20_000_000, key_at_us: 12_000_000,
    events: [], pass_length_m: null, sprint: null, label: "Shot", dedupe_key: "SHOT",
    ...rest,
  };
};
const ev = (video: number, events: CrossMatchCandidate["events"], atS: number, extra: Partial<CrossMatchCandidate> = {}) =>
  cand({ video, events, in_pts_us: atS * 1_000_000, out_pts_us: (atS + 10) * 1_000_000, key_at_us: (atS + 2) * 1_000_000,
    label: events[0] ?? "Shot", dedupe_key: events[0] ?? "NONE", ...extra });
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

describe("the fill (ADR-131)", () => {
  it("fills top-down by tier — a goal always beats a key pass, a key pass always beats a dribble", () => {
    const s = selectCrossMatchMoments([
      ev(2, ["TACKLE"], 40), ev(1, ["KEY_PASS"], 30), ev(3, ["BALL_WON"], 50), ev(1, ["GOAL"], 10), ev(2, ["SHOT"], 20),
    ], 180);
    expect(s.selected.map((m) => [m.tier, m.events[0]])).toEqual([["S", "GOAL"], ["A", "KEY_PASS"], ["A", "SHOT"], ["B", "TACKLE"], ["C", "BALL_WON"]]);
    expect(s.rule_version).toBe(BEST_MOMENTS_RULE_VERSION);
    expect(s.length_s).toBe(180);
  });

  it("goes chronological within a tier, oldest match first — then match minute, then media time", () => {
    const s = selectCrossMatchMoments([
      ev(3, ["SHOT"], 10, { match_minute: 80 }), ev(1, ["SHOT"], 30, { match_minute: 20 }), ev(2, ["SHOT"], 10, { match_minute: 5 }),
      ev(1, ["SHOT"], 10, { match_minute: 20 }),
    ], 180);
    // video 1 (oldest kickoff) first, its 10 s moment before its 30 s one; then video 2, then video 3
    expect(s.selected.map((m) => [m.video_id, m.in_pts_us])).toEqual([[vid(1), 10_000_000], [vid(1), 30_000_000], [vid(2), 10_000_000], [vid(3), 10_000_000]]);
  });

  it("takes at most 4 moments from one match, however good it was", () => {
    const five = [10, 20, 30, 40, 50].map((at) => ev(1, ["GOAL"], at));
    const s = selectCrossMatchMoments([...five, ev(2, ["GOAL"], 10)], 180);
    expect(s.selected).toHaveLength(5);
    expect(s.per_match_counts).toEqual({ [vid(1)]: 4, [vid(2)]: 1 });
    expect(s.not_selected).toHaveLength(1);
    expect(s.not_selected[0]).toMatchObject({ reason: "per-match cap reached" });
    expect(CROSS_MATCH_MAX_PER_MATCH).toBe(4);
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

describe("the clip label (ADR-131)", () => {
  it("names the reason, the minute and the opponent — never inventing a minute", () => {
    const c = cand({ video: 1, match_minute: 67, opponent: "Ercakhu", key_at_us: 754_000_000 });
    expect(crossMatchClipLabel(c, "Goal")).toBe("Goal — 67' vs Ercakhu");
    expect(crossMatchClipLabel({ ...c, match_minute: null }, "Goal")).toBe("Goal — 12:34 vs Ercakhu");
    expect(crossMatchClipLabel({ ...c, opponent: null, video_title: "FC Dynamo v FC Ercakhu" }, "Goal")).toBe("Goal — 67' FC Dynamo v FC Ercakhu");
  });
});
