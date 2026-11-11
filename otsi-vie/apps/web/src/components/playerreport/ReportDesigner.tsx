"use client";
/**
 * v3 Phase B.24 (ADR-099): the report designer in Export PDF. Choose the sections, an optional title and a cover note (a person's words,
 * marked so on the page); the live preview is the page the PDF will print with that design (POST /v1/players/:id/reports/preview, nothing
 * saved), shown in a sandboxed frame. The preview also says whether the report may be made: not while no track is confirmed as him.
 */
import { REPORT_SECTIONS, type ReportDesign, type ReportGate, type ReportPreviewPage, type ReportSection } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";

const field = "w-full rounded-ctl border border-line bg-canvas px-2 py-1.5";

const SECTION_LABEL = (d: Dictionary): Record<ReportSection, string> => ({ measures: d.body.reports.designSectionMeasures, heat: d.body.reports.designSectionHeat, events: d.body.reports.designSectionEvents, comparison: d.body.reports.comparisonTitle, insights: d.body.reports.designSectionInsights, assessment: d.body.reports.designSectionAssessment });

export function ReportDesigner({ playerId, design, onDesign, onGate }: { playerId: string; design: ReportDesign; onDesign(d: ReportDesign): void; onGate(g: ReportGate | null): void }) {
  const { t: dict } = useLocale();
  const [page, setPage] = useState<ReportPreviewPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = JSON.stringify(design);
  useEffect(() => {
    let live = true;
    setErr(null);
    const h = setTimeout(() => {
      api<ReportPreviewPage>(`/v1/players/${playerId}/reports/preview`, { method: "POST", json: { design } })
        .then((p) => { if (live) { setPage(p); onGate(p.gate); } }, (x) => { if (live) { setErr(x instanceof ApiProblem ? x.message : dict.body.reports.previewFailed); onGate(null); } });
    }, 350);
    return () => { live = false; clearTimeout(h); };
  }, [playerId, key]);   // eslint-disable-line react-hooks/exhaustive-deps
  const flip = (s: ReportSection) => {
    const on = design.sections.includes(s);
    if (on && design.sections.length === 1) return;                       // a report holds at least one section
    onDesign({ ...design, sections: on ? design.sections.filter((x) => x !== s) : REPORT_SECTIONS.filter((x) => x === s || design.sections.includes(x)) });
  };
  return (
    <section aria-label={dict.body.reports.designAria} className="grid gap-2" data-report-designer>
      <h3 className="font-semibold">{dict.body.reports.designTitle}</h3>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {REPORT_SECTIONS.map((s) => (
          <label key={s} className="flex items-center gap-1"><input type="checkbox" data-section-pick={s} checked={design.sections.includes(s)} onChange={() => flip(s)} />{SECTION_LABEL(dict)[s]}</label>
        ))}
      </div>
      <input aria-label={dict.body.reports.designTitleAria} value={design.title ?? ""} maxLength={120} placeholder={dict.body.reports.designTitlePlaceholder} onChange={(e) => onDesign({ ...design, title: e.target.value || null })} className={field} />
      <textarea aria-label={dict.body.reports.designNoteAria} value={design.note ?? ""} maxLength={1500} rows={2} placeholder={dict.body.reports.designNotePlaceholder} onChange={(e) => onDesign({ ...design, note: e.target.value || null })} className={field} />
      <div className="h-[340px] overflow-hidden rounded border border-line bg-white" data-live-preview>
        {err ? <p className="p-3 text-xs text-[#b00]">{err}</p>
          : !page ? <p className="p-3 text-xs text-[#555]">{dict.body.reports.buildingPreview}</p>
          : <iframe title={dict.body.reports.livePreviewTitle} sandbox="" srcDoc={page.html} className="h-full w-full" />}
      </div>
      {page && !page.gate.ok && <ul className="grid gap-1 text-xs text-amber" data-gate-reasons>{page.gate.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
    </section>
  );
}
