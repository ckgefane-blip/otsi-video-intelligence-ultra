/** B.24 (ADR-099): the publish gate and the KPI tiles' coverage line */
import { describe, expect, it } from "vitest";
import { kpiCoverage, MakeReportRequest, reportGate, type PlayerMeasures } from "@otsi-vie/contracts";

const M = (o: Partial<PlayerMeasures>): PlayerMeasures => ({ player_id: "00000000-0000-4000-8000-000000000001", tracks: 2, videos: 2, seen_s: 600, measured_s: 300, distance_m: 900,
  top_speed_kmh: 28, dropped_steps: 0, high_speed_m: 50, sprint_m: 20, sprints: 1, mean_confidence: 0.8, heat: null, events: { passes: 3, key_passes: 1, passes_received: 2, balls_won: 1, pressures: 0, shots: 0, videos: 1 }, ...o });

describe("publish gate", () => {
  it("blocks only while no track is confirmed as him", () => {
    expect(reportGate({ confirmed_tracks: 0 }).ok).toBe(false);
    expect(reportGate({ confirmed_tracks: 1 })).toEqual({ ok: true, reasons: [] });
  });
  it("an empty body is the full report; a design holds each section once and at least one", () => {
    expect(MakeReportRequest.parse({}).design.sections).toHaveLength(6);
    expect(MakeReportRequest.safeParse({ design: { sections: [] } }).success).toBe(false);
    expect(MakeReportRequest.safeParse({ design: { sections: ["events", "events"] } }).success).toBe(false);
  });
});

describe("KPI coverage", () => {
  it("says what the value covers, never an accuracy", () => {
    expect(kpiCoverage("TIME", M({}))).toBe("2 confirmed tracks · 2 videos");
    expect(kpiCoverage("MOVEMENT", M({}))).toBe("covers 50 % of time seen");
    expect(kpiCoverage("EVENTS", M({}))).toBe("ball followed in 1 of 2 videos");
  });
  it("says nothing where nothing was measured or seen", () => {
    expect(kpiCoverage("MOVEMENT", M({ measured_s: 0 }))).toBeNull();
    expect(kpiCoverage("EVENTS", M({ events: null }))).toBeNull();
    expect(kpiCoverage("TIME", M({ tracks: 0 }))).toBeNull();
    expect(kpiCoverage("TIME", null)).toBeNull();
  });
});
