/**
 * Page 03 Sections 08 and 09 — Processing Timeline and Output Summary, on the Desktop UI flow layout.
 *
 * The timeline spans the video's measured length. The upper bar is how far detection has gone through the video (the worker's DETECT
 * progress, which follows the frame timestamps); the lower bar shows tracking and identity suggestions. Steps that are not built
 * (events, indexing) never fill. The summary shows what the finished run measured: people tracks, ball tracks, and how much of the
 * run is processed; events are not detected yet, so "—".
 */
"use client";
import type { AnalysisRun } from "@otsi-vie/contracts";
import { Evidence } from "@/components/evidence/Evidence";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, pct, runProgress } from "./model";

const clock = (us: number | null | undefined) => {
  if (!us) return "—";
  const t = Math.floor(us / 1e6);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
};

export function TimelineSummary({ run, durationUs, events }: { run: AnalysisRun | null; durationUs: number | null; events: number | null }) {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const tag = DATE_TAG[locale];
  const step = (n: string) => {
    const s = run?.steps.find((x) => x.name === n);
    return !s ? 0 : s.status === "SUCCEEDED" ? 100 : Math.max(0, Math.min(100, s.progress));
  };
  const detect = step("DETECT"), track = step("TRACK"), ident = step("IDENTIFY");
  const r = run?.status === "SUCCEEDED" ? (run.result as Record<string, unknown> | null) : null;
  const num = (v: unknown) => (typeof v === "number" ? v.toLocaleString(tag) : "—");

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section aria-label={d.processingTimeline} data-section="p03-s10" data-detect={String(Math.round(detect))} className="vie-panel">
        <div className="vie-ph"><h2 className="t-panel">{d.processingTimeline}</h2></div>
        <div className="space-y-3 p-3">
          <p className="text-sm text-muted">{d.frameProgress}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {([["#19e6c0", d.detection], ["#1a8cff", d.tracking], ["#8a5cff", d.identity]] as const).map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5"><i className="h-3 w-3 rounded-full" style={{ background: c }} aria-hidden />{l}</span>
            ))}
          </div>
          <div className="flex justify-between text-xs text-muted"><span>0:00</span><span>{clock(durationUs)}</span></div>
          <div role="img" aria-label={d.timelineAria.replace("{d}", String(Math.round(detect))).replace("{t}", String(Math.round(track))).replace("{i}", String(Math.round(ident)))}>
            <div className="h-2.5 w-full overflow-hidden rounded bg-line/60"><div className="h-full rounded" style={{ width: `${detect}%`, background: "#19e6c0" }} /></div>
            <div className="relative mt-1.5 h-3 w-full overflow-hidden rounded bg-line/60">
              <div className="absolute inset-y-0 left-0" style={{ width: `${track}%`, background: "#1a8cff" }} />
              <div className="absolute bottom-0 left-0 h-1" style={{ width: `${ident}%`, background: "#8a5cff" }} />
            </div>
          </div>
        </div>
      </section>

      <section aria-label={d.outputSummary} data-section="p03-s11" className="vie-panel">
        <div className="vie-ph"><h2 className="t-panel">{d.outputSummary} <span className="font-normal text-muted">{d.liveSuffix}</span></h2></div>
        <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
          {([
            [r ? num(r.person_tracks) : "—", d.playersTracked, d.playersTrackedWhy],
            [r ? num(r.ball_tracks) : "—", d.ballTracked, d.ballTrackedWhy],
            [events != null ? num(events) : "—", d.eventsDetected, events != null ? d.eventsWhy : d.followBallEvents],
            [pct(runProgress(run)), d.processed, d.processedWhy],
          ] as const).map(([v, l, title]) => (
            <div key={l} role="group" aria-label={`${l}: ${v}`} title={title} className="relative rounded-ctl border border-line/70 bg-raised/40 p-2.5">
              <p className="t-metric">{v}</p>
              <p className="text-xs text-muted">{l}</p>
              {l !== d.processed && v !== "—" && (
                <span className="absolute right-2 top-2"><Evidence level="DETECTED" compact size={12} why={title} /></span>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
