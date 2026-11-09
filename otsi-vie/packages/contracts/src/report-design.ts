/**
 * v3 Phase B.24 (ADR-099): Player Report designer, publish gate and KPI coverage.
 *   ReportDesign   which sections the PDF holds, an optional title and an optional cover note (a person's words, marked so). Kept with
 *                  the report job (report_jobs.config); the live preview builds the same page (POST /v1/players/:id/reports/preview).
 *   reportGate     a report is made, shared or its assessment published only while a person has confirmed at least one track as this
 *                  player. Tracking is not identity: with no confirmed track nothing about him leaves the page (IDENTITY_UNCONFIRMED).
 *   kpiCoverage    under each KPI tile, how much of what was seen the value covers (never an accuracy score).
 */
import { z } from "zod";
import type { PlayerMeasures } from "./pitch";

export const REPORT_SECTIONS = ["measures", "heat", "events", "comparison", "insights", "assessment"] as const;
export const ReportSection = z.enum(REPORT_SECTIONS);
export type ReportSection = z.infer<typeof ReportSection>;
export const REPORT_SECTION_NAMES: Record<ReportSection, string> = {
  measures: "What the footage measured", heat: "Heat map", events: "Events", comparison: "Comparison", insights: "From his measurements", assessment: "Scouting assessment",
};
export const ReportDesign = z.object({
  sections: z.array(ReportSection).min(1).max(REPORT_SECTIONS.length).refine((s) => new Set(s).size === s.length, "Each section once.").default([...REPORT_SECTIONS]),
  title: z.string().trim().max(120).nullable().default(null),
  note: z.string().trim().max(1500).nullable().default(null),
});
export type ReportDesign = z.infer<typeof ReportDesign>;
export const DEFAULT_REPORT_DESIGN: ReportDesign = { sections: [...REPORT_SECTIONS], title: null, note: null };
/** POST /v1/players/:id/reports (and its preview): the design; an empty body makes the full report as before */
export const MakeReportRequest = z.object({ design: ReportDesign.default(DEFAULT_REPORT_DESIGN) });
export type MakeReportRequest = z.infer<typeof MakeReportRequest>;

export const ReportGate = z.object({ ok: z.boolean(), reasons: z.array(z.string()) });
export type ReportGate = z.infer<typeof ReportGate>;
export const ReportPreviewPage = z.object({ html: z.string(), gate: ReportGate, generated_at: z.string() });
export type ReportPreviewPage = z.infer<typeof ReportPreviewPage>;

export function reportGate(f: { confirmed_tracks: number }): ReportGate {
  const reasons: string[] = [];
  if (f.confirmed_tracks <= 0) reasons.push("No track is confirmed as this player by a person: confirm his identity in Analysis first. Until then the report stays on this page.");
  return { ok: !reasons.length, reasons };
}

const pct = (a: number, b: number) => `${Math.round((100 * a) / b)} %`;
/** the coverage line under a KPI tile, or null where it says nothing (not measured, or nothing seen) */
export function kpiCoverage(kind: "TIME" | "MOVEMENT" | "EVENTS", m: PlayerMeasures | null): string | null {
  if (!m || !m.tracks || m.seen_s <= 0) return null;
  if (kind === "TIME") return `${m.tracks} confirmed track${m.tracks === 1 ? "" : "s"} · ${m.videos} video${m.videos === 1 ? "" : "s"}`;
  if (kind === "MOVEMENT") return m.measured_s > 0 ? `covers ${pct(Math.min(m.measured_s, m.seen_s), m.seen_s)} of time seen` : null;
  const e = m.events;
  return e ? `ball followed in ${e.videos} of ${m.videos} video${m.videos === 1 ? "" : "s"}` : null;
}
