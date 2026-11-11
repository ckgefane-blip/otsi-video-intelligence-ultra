/**
 * Scouting Pack manifest (ADR-142, ultra-only). Runs in the web suite without MySQL — the same pure function
 * the API uses (packages/contracts/src/scouting-pack.ts). The HTTP build (charge 10, refund on failure, ZIP)
 * lives in apps/api/test/scoutingPack.api.test.ts and runs only on the owner's host, where MySQL is.
 */
import {
  BEST_MOMENTS_RULE_VERSION,
  buildScoutingPackManifest,
  SCOUTING_PACK_COST_TOKENS,
  type BuildScoutingPackManifestInput,
  type ScoutingPackAnalystInput,
} from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";

const PLAYER = "44444444-4444-4444-8444-444444444444";
const REEL = "55555555-5555-4555-8555-555555555555";

const brief = {
  strengths_summary: "Wins the ball high.",
  fit_summary: "A defensive midfielder.",
  what_to_watch: "Watch his ball-winning.",
  key_clips: [],
};

function assessment(over: Partial<NonNullable<ScoutingPackAnalystInput>> = {}): ScoutingPackAnalystInput {
  return { status: "PUBLISHED", scout_brief: brief, published_by_name: "Ada Analyst", published_at: "2026-11-11T06:00:00.000Z", ...over };
}

function input(over: Partial<BuildScoutingPackManifestInput> = {}): BuildScoutingPackManifestInput {
  return {
    player_id: PLAYER,
    display_name: "Test Player",
    otsi_pin: "OTSI-NGA-2026-000001",
    reel_id: REEL,
    reel_name: "Test Player — Nart v Ercakhu",
    reel_source: "SINGLE_MATCH",
    match_titles: ["Nart v Ercakhu"],
    reel_rendered: true,
    include_report: true,
    report: { state: "INCLUDED", reason: null },
    include_analyst_brief: true,
    analyst_assessment: assessment(),
    ...over,
  };
}

const item = (m: ReturnType<typeof buildScoutingPackManifest>, kind: string) => m.items.find((i) => i.kind === kind)!;

describe("buildScoutingPackManifest", () => {
  it("stamps the Best Moment Rule version and the 10-token Pack cost", () => {
    const m = buildScoutingPackManifest(input());
    expect(m.best_moments_rule_version).toBe(BEST_MOMENTS_RULE_VERSION);
    expect(m.best_moments_rule_version).toBe("2.1");
    expect(m.cost_tokens).toBe(10);
    expect(m.cost_tokens).toBe(SCOUTING_PACK_COST_TOKENS);
    expect(m.measured_only_statement).toContain("measured");
  });

  it("records the Single Match Spotlight source and its one match", () => {
    const m = buildScoutingPackManifest(input());
    expect(m.reel_source).toBe("SINGLE_MATCH");
    expect(m.match_titles).toEqual(["Nart v Ercakhu"]);
    expect(m.name).toContain("Nart v Ercakhu");
    expect(item(m, "REEL").detail).toContain("Player Profile Intro first");
    expect(item(m, "REEL").detail).toContain("Best Moment Rule v2.1");
  });

  it("records a cross-match Pack over all matches", () => {
    const m = buildScoutingPackManifest(input({
      reel_source: "CROSS_MATCH",
      match_titles: ["Nart v Ercakhu", "Ercakhu v Dynamo", "Nart v Dynamo"],
    }));
    expect(m.reel_source).toBe("CROSS_MATCH");
    expect(m.match_titles).toHaveLength(3);
    expect(m.name).toContain("All matches");
    expect(item(m, "REEL").detail).toContain("Scouting Pack (all matches)");
  });

  it("includes the published Analyst brief, with who published it", () => {
    const m = buildScoutingPackManifest(input());
    const b = item(m, "AI_ANALYST_BRIEF");
    expect(b.state).toBe("INCLUDED");
    expect(b.reason).toBeNull();
    expect(b.detail).toContain("Ada Analyst");
    expect(b.detail).toContain("2026-11-11");
  });

  it("never includes a draft brief — it is excluded, in words", () => {
    const m = buildScoutingPackManifest(input({ analyst_assessment: assessment({ status: "DRAFT" }) }));
    const b = item(m, "AI_ANALYST_BRIEF");
    expect(b.state).toBe("EXCLUDED");
    expect(b.reason).toBe("AI Analyst brief: not included (draft, not published).");
  });

  it("excludes the brief when there is no assessment at all", () => {
    const m = buildScoutingPackManifest(input({ analyst_assessment: null }));
    const b = item(m, "AI_ANALYST_BRIEF");
    expect(b.state).toBe("EXCLUDED");
    expect(b.reason).toBe("No AI Analyst assessment for this player yet.");
  });

  it("excludes the brief when the published assessment has no scout brief", () => {
    const m = buildScoutingPackManifest(input({ analyst_assessment: assessment({ scout_brief: null }) }));
    expect(item(m, "AI_ANALYST_BRIEF").state).toBe("EXCLUDED");
    expect(item(m, "AI_ANALYST_BRIEF").reason).toBe("The published assessment has no scout brief.");
  });

  it("excludes the brief and the report when they were not requested", () => {
    const m = buildScoutingPackManifest(input({ include_report: false, include_analyst_brief: false }));
    expect(item(m, "PLAYER_REPORT").state).toBe("EXCLUDED");
    expect(item(m, "PLAYER_REPORT").reason).toBe("Not requested for this Pack.");
    expect(item(m, "AI_ANALYST_BRIEF").state).toBe("EXCLUDED");
    expect(item(m, "AI_ANALYST_BRIEF").reason).toBe("Not requested for this Pack.");
  });

  it("records a report that could not be made as FAILED with its reason, without stopping the Pack", () => {
    const m = buildScoutingPackManifest(input({ report: { state: "FAILED", reason: "The player report could not be made." } }));
    const r = item(m, "PLAYER_REPORT");
    expect(r.state).toBe("FAILED");
    expect(r.reason).toBe("The player report could not be made.");
    expect(item(m, "REEL").state).toBe("INCLUDED");
    expect(item(m, "AI_ANALYST_BRIEF").state).toBe("INCLUDED");
  });

  it("records an unrendered reel as FAILED, never faked", () => {
    const m = buildScoutingPackManifest(input({ reel_rendered: false }));
    const r = item(m, "REEL");
    expect(r.state).toBe("FAILED");
    expect(r.reason).toContain("no finished render");
  });
});
