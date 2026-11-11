/**
 * AI Analyst guardrails (ADR-141, ultra-only; scope §5). Runs in the web suite without MySQL or a provider key —
 * the same pure functions the API uses (packages/contracts/src/ai-analyst.ts). The HTTP gates (identity refusal,
 * consent, not-configured 503, charge/refund, publish) live in apps/api/test/aiAnalyst.api.test.ts and run only
 * on the owner's host, where MySQL is.
 */
import {
  AI_ANALYST_COST_TOKENS,
  AI_ANALYST_PRIVACY_NOTE,
  AiAnalystInputSnapshot,
  analystAssessmentStale,
  buildAnalystPrompt,
  confidenceFor,
  dataBasisOf,
  extractNumbers,
  minimumDataReason,
  postCheckAssessment,
  publishedScoutBriefForPack,
  tokenPackCatalogue,
  TOKEN_COSTS,
  unmeasuredTopicNamed,
  type AiAnalystAssessmentBody,
  type AiAnalystInputEvent,
} from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";

const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const V3 = "33333333-3333-4333-8333-333333333333";
const PLAYER = "44444444-4444-4444-8444-444444444444";

function ev(videoId: string, title: string, kind: AiAnalystInputEvent["kind"], minute: number, key = false): AiAnalystInputEvent {
  return { video_id: videoId, video_title: title, kind, minute, key };
}

/** 3 matches analysed, 12 measured events, 270 minutes seen on camera. */
function input(over: Partial<AiAnalystInputSnapshot> = {}): AiAnalystInputSnapshot {
  const events = [
    ev(V1, "Nart v Ercakhu", "PASS", 12), ev(V1, "Nart v Ercakhu", "BALL_WON", 34), ev(V1, "Nart v Ercakhu", "BALL_WON", 67), ev(V1, "Nart v Ercakhu", "SHOT", 78),
    ev(V2, "Ercakhu v Dynamo", "PASS", 5), ev(V2, "Ercakhu v Dynamo", "PRESSURE", 23), ev(V2, "Ercakhu v Dynamo", "GOAL", 45, true), ev(V2, "Ercakhu v Dynamo", "PASS_RECEIVED", 56), ev(V2, "Ercakhu v Dynamo", "SHOT", 81),
    ev(V3, "Nart v Dynamo", "PASS", 15), ev(V3, "Nart v Dynamo", "PRESSURE", 44), ev(V3, "Nart v Dynamo", "PASS", 88),
  ];
  return AiAnalystInputSnapshot.parse({
    player_id: PLAYER,
    otsi_pin: "OTSI-NGA-2026-000001",
    display_name: "Test Player",
    position: "DM",
    club: "FC Ercakhu",
    club_source: "ROSTER",
    nationality: "Nigeria",
    age: 20,
    height_cm: 182,
    weight_kg: 76,
    foot: "Right",
    league: "Abkhazia Premier League",
    international: null,
    user_entered: { strengths: ["Strong in the tackle"], summary: null, club: null, league: null },
    verified: true,
    measures: {
      games_analysed: 3, minutes_seen: 270, tracks: 5, distance_m: 8200, top_speed_kmh: 31.2,
      high_speed_m: 420, sprint_m: 180, sprints: 6, mean_confidence: 0.91,
      events: { passes: 4, key_passes: 1, passes_received: 1, balls_won: 2, pressures: 2, shots: 2, goals: 1 },
    },
    per_match: [
      { video_id: V1, video_title: "Nart v Ercakhu", events: { PASS: 1, PASS_RECEIVED: 0, BALL_WON: 2, PRESSURE: 0, SHOT: 1, SET_PIECE: 0, GOAL: 0 }, events_count: 4 },
      { video_id: V2, video_title: "Ercakhu v Dynamo", events: { PASS: 1, PASS_RECEIVED: 1, BALL_WON: 0, PRESSURE: 1, SHOT: 1, SET_PIECE: 0, GOAL: 1 }, events_count: 5 },
      { video_id: V3, video_title: "Nart v Dynamo", events: { PASS: 2, PASS_RECEIVED: 0, BALL_WON: 0, PRESSURE: 1, SHOT: 0, SET_PIECE: 0, GOAL: 0 }, events_count: 3 },
    ],
    events,
    events_capped_at: 200,
    events_total: 12,
    basis: "Engine measurements on tracks a person confirmed as him: 3 videos, 270 minutes seen on camera.",
    ...over,
  });
}

/** A model output that stays inside the measured data. The model claims HIGH confidence; code must not believe it. */
function validOutput(): AiAnalystAssessmentBody {
  return {
    strengths: [{
      text: "Wins the ball high — 2 balls won in 3 matches, including 1 at 67 minutes against Ercakhu",
      confidence: "HIGH",
      evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 67, event: "BALL_WON", count: 2 }],
    }],
    development_areas: [{
      text: "Shooting is rare — 2 shots in 3 matches, with 1 goal",
      confidence: "MEDIUM",
      evidence: [{ video_id: V2, video_title: "Ercakhu v Dynamo", minute: 45, event: "GOAL", count: 1 }],
    }],
    recommendations: [{
      text: "Work on first touch under pressure — 2 pressures faced in 3 matches",
      action: "First-touch drills under pressure",
      suggestion: true as const,
      confidence: "HIGH",
      evidence: [{ video_id: V2, video_title: "Ercakhu v Dynamo", minute: 23, event: "PRESSURE", count: 2 }],
    }],
    tactical_fit: {
      text: "Fits as a defensive midfielder, winning the ball in 3 matches",
      suggestion: true as const,
      confidence: "MEDIUM",
      evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 34, event: "BALL_WON", count: 2 }],
    },
    scout_brief: {
      strengths_summary: "Wins the ball — 2 balls won in 3 matches.",
      fit_summary: "A defensive midfielder.",
      what_to_watch: "Watch his ball-winning at 67 minutes.",
      key_clips: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 67, reason: "Ball won at 67 minutes" }],
    },
    not_measured: [{ topic: "Assists", reason: "Assists are not measured: the engine does not link a pass to a goal (ADR-124)." }],
  };
}

describe("confidence is computed by code, not by the model (scope §5 Rule 3)", () => {
  it("gives HIGH only at 5+ matches with 30+ events behind the claim", () => {
    expect(confidenceFor(5, 40, 30)).toBe("HIGH");
    expect(confidenceFor(5, 40, 29)).toBe("MEDIUM");
    expect(confidenceFor(4, 40, 30)).toBe("MEDIUM");
  });
  it("gives LOW for one match or a very small sample, MEDIUM in between", () => {
    expect(confidenceFor(1, 20, 10)).toBe("LOW");
    expect(confidenceFor(3, 20, 4)).toBe("LOW");
    expect(confidenceFor(3, 20, 10)).toBe("MEDIUM");
    expect(confidenceFor(2, 12, 5)).toBe("MEDIUM");
  });
  it("gives NOT_ENOUGH_DATA below the minimum-data rule", () => {
    expect(confidenceFor(0, 0, 0)).toBe("NOT_ENOUGH_DATA");
    expect(confidenceFor(3, 4, 4)).toBe("NOT_ENOUGH_DATA");
    expect(confidenceFor(1, 3, 3)).toBe("NOT_ENOUGH_DATA");
  });
});

describe("minimum-data rule (scope §4)", () => {
  it("refuses an unconfirmed identity, a thin sample, and accepts enough data", () => {
    expect(minimumDataReason(input({ verified: false }))).toContain("identity unconfirmed");
    expect(minimumDataReason(input({ measures: { ...input().measures, games_analysed: 0 } }))).toContain("fewer than 1 full match");
    expect(minimumDataReason(input({ events_total: 4 }))).toContain("only 4 measured events");
    expect(minimumDataReason(input())).toBeNull();
  });
});

describe("deterministic post-check (scope §5 Rule 2)", () => {
  it("passes a clean output, recomputes confidence, and builds clip links by code", () => {
    const r = postCheckAssessment(input(), validOutput());
    expect(r.ok).toBe(true);
    expect(r.body).not.toBeNull();
    // the model claimed HIGH on 3 matches with 2 events behind the claim: code says LOW
    expect(r.body!.strengths[0]!.confidence).toBe("LOW");
    expect(r.body!.strengths[0]!.evidence[0]!.clip_ref).toBe(`/analysis?video=${V1}&t=${67 * 60 - 2}`);
    expect(r.body!.strengths[0]!.evidence[0]!.match).toBe("Nart v Ercakhu");
    expect(r.dropped).toEqual([]);
  });

  it("drops a claim with a number that is not in the measured input, and keeps the rest", () => {
    const out = validOutput();
    out.strengths.push({
      text: "Passing range — 47 passes in 3 matches",
      confidence: "HIGH",
      evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 12, event: "PASS", count: 1 }],
    });
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(true);
    expect(r.body!.strengths).toHaveLength(1);
    expect(r.dropped).toHaveLength(1);
    expect(r.dropped[0]!.reason).toContain("47");
  });

  it("drops a claim that names an unmeasured topic — an assist, a rating, an xG", () => {
    const out = validOutput();
    out.strengths.push({
      text: "Created 2 assists in 3 matches",
      confidence: "HIGH",
      evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 12, event: "PASS", count: 1 }],
    });
    out.development_areas.push({
      text: "His xG is low at 0.4 per match",
      confidence: "LOW",
      evidence: [{ video_id: V2, video_title: "Ercakhu v Dynamo", minute: 81, event: "SHOT", count: 1 }],
    });
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(true);
    expect(r.body!.strengths).toHaveLength(1);
    expect(r.body!.development_areas).toHaveLength(1);
    expect(r.dropped.map((d) => d.reason).join(" ")).toContain("unmeasured topic");
    expect(unmeasuredTopicNamed("Created 2 assists")).toBe("Assists");
    expect(unmeasuredTopicNamed("His xG is low")).toBe("xG / xA");
    expect(unmeasuredTopicNamed("Rated 7.8 out of 10")).toBe("Recent form / ratings");
  });

  it("drops a claim whose evidence does not match a real measured event", () => {
    const out = validOutput();
    // the brief cites 67 minutes, which only the dropped claim states — neutralise it so the brief itself passes
    out.scout_brief.what_to_watch = "Watch his ball-winning.";
    out.strengths[0] = {
      text: "Wins the ball high — 2 balls won in 3 matches",
      confidence: "MEDIUM",
      evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 99, event: "BALL_WON", count: 2 }],
    };
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(true);
    expect(r.body!.strengths).toHaveLength(0);
    expect(r.dropped[0]!.reason).toContain("does not match a measured event");
  });

  it("drops a claim whose evidence count is more than the engine measured", () => {
    const out = validOutput();
    out.scout_brief.what_to_watch = "Watch his ball-winning.";
    out.strengths[0]!.evidence = [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 67, event: "BALL_WON", count: 9 }];
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(true);
    expect(r.body!.strengths).toHaveLength(0);
    expect(r.dropped[0]!.reason).toContain("more than the 2 measured");
  });

  it("rejects the whole output when the scout brief invents a number no claim states", () => {
    const out = validOutput();
    out.scout_brief.strengths_summary = "Scored 5 goals in 3 matches.";
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(false);
    expect(r.body).toBeNull();
    expect(r.failures.join(" ")).toContain("5");
  });

  it("rejects the whole output when the brief cites a clip that is not a measured event", () => {
    const out = validOutput();
    out.scout_brief.key_clips = [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 50, reason: "A great moment" }];
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(false);
    expect(r.body).toBeNull();
  });

  it("rejects the whole output when the schema fails, and when every claim is dropped", () => {
    expect(postCheckAssessment(input(), { strengths: "not an array" }).ok).toBe(false);
    const out = validOutput();
    out.strengths = [{ text: "47 passes in 3 matches", confidence: "HIGH", evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 12, event: "PASS", count: 1 }] }];
    out.development_areas = [];
    out.recommendations = [];
    out.tactical_fit = { text: "99 goals a season", suggestion: true as const, evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", minute: 12, event: "PASS", count: 1 }] };
    // the brief carries no numbers, so its own check passes and the failure is the empty assessment itself
    out.scout_brief = { strengths_summary: "Wins the ball.", fit_summary: "A defensive midfielder.", what_to_watch: "Watch his ball-winning.", key_clips: [] };
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(false);
    expect(r.body).toBeNull();
    expect(r.failures.join(" ")).toContain("nothing verifiable remains");
  });

  it("allows numbers derived by a stated step: per-match counts and per-90 rates", () => {
    expect(extractNumbers("9 balls won in 3 matches, 3 per match")).toEqual([9, 3, 3]);
    const out = validOutput();
    // 4 passes in 270 minutes = 1.3 per 90 — a derived number the post-check must allow
    out.strengths[0]!.text = "Wins the ball high — 2 balls won in 3 matches, 1.3 passes per 90";
    // the brief's 67 minutes is stated only by the strength before this edit — neutralise it
    out.scout_brief.what_to_watch = "Watch his ball-winning.";
    const r = postCheckAssessment(input(), out);
    expect(r.ok).toBe(true);
    expect(r.body!.strengths).toHaveLength(1);
  });
});

describe("publish gate for the Scouting Pack (scope §5 Rule 4, §6)", () => {
  const brief = validOutput().scout_brief;
  it("never exports a draft, only a published assessment", () => {
    expect(publishedScoutBriefForPack({ status: "DRAFT", scout_brief: brief, published_by_name: null, published_at: null })).toBeNull();
    expect(publishedScoutBriefForPack({ status: "PUBLISHED", scout_brief: brief, published_by_name: "Owner", published_at: "2026-11-11T06:00:00.000Z" })).toEqual(brief);
    expect(publishedScoutBriefForPack({ status: "PUBLISHED", scout_brief: null, published_by_name: "Owner", published_at: "2026-11-11T06:00:00.000Z" })).toBeNull();
  });

  it("marks an assessment stale when the data it was built on changes", () => {
    const a = { data_basis: dataBasisOf(input()) };
    expect(analystAssessmentStale(a, dataBasisOf(input()))).toBe(false);
    expect(analystAssessmentStale(a, dataBasisOf(input({ measures: { ...input().measures, games_analysed: 4 } })))).toBe(true);
    expect(analystAssessmentStale(a, dataBasisOf(input({ events_total: 13 })))).toBe(true);
  });
});

describe("prompt rules and cost (scope §5 Rule 1, §8)", () => {
  it("versions the prompt and states the no-invention rules", () => {
    const p = buildAnalystPrompt(input(), "en", false);
    expect(p.version).toBe("1.0");
    expect(p.system).toContain("Never write a rating");
    expect(p.system).toContain("Not measured");
    expect(p.system).toContain("Assists are not measured");
    expect(p.user).toContain("OTSI-NGA-2026-000001");
    const strict = buildAnalystPrompt(input(), "ru", true);
    expect(strict.system).toContain("STRICT RETRY");
    expect(strict.system).toContain("Write in Russian");
  });

  it("costs 10 tokens per assessment, the same as a player report", () => {
    expect(AI_ANALYST_COST_TOKENS).toBe(10);
    expect(TOKEN_COSTS.aiAnalysis).toBe(10);
    expect(tokenPackCatalogue().costs.ai_analysis).toBe(10);
  });

  it("sends structured data only — the privacy note says no video leaves the machine", () => {
    expect(AI_ANALYST_PRIVACY_NOTE).toContain("No video");
    expect(AI_ANALYST_PRIVACY_NOTE).toContain("no raw tracking data");
    expect(AI_ANALYST_PRIVACY_NOTE).toContain("no other player's data");
  });
});
