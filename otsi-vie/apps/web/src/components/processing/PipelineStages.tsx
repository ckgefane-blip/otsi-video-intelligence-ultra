/**
 * Page 03 Section 03 — the pipeline ribbon, on the Desktop UI flow layout (v3 Phase A.4, ADR-061).
 *
 * The ribbon is the engine's real steps for this video, in order: the run's Shot cuts, Detection, Tracking and Identity evidence (no
 * identity is assigned; a player is named only after a person confirms it), then Ball, Pitch, Team sheets and Football facts. Each shows
 * waiting, running, done, not run, failed, cancelled or out of date (done on an older analysis). A click on a step filters the log to it.
 */
"use client";
import { useLocale } from "@/lib/i18n";
import { pct, RIBBON_PILL, type RibbonStep } from "./model";

function Ring({ s }: { s: RibbonStep }) {
  const mark = s.state === "DONE" ? "✓" : s.state === "STALE" ? "!" : s.state === "ACTIVE" ? `${Math.round(s.progress ?? 0)}%` : "";
  const colour = s.state === "DONE" ? "#19e6c0" : s.state === "STALE" ? "#ffc94d" : s.state === "ACTIVE" ? "#1a8cff" : s.state === "FAILED" ? "#ff8a8a" : "#5d7699";
  return (
    <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold"
      style={{ borderColor: colour, color: colour, borderStyle: s.state === "SKIPPED" ? "dashed" : "solid", background: s.state === "DONE" ? "#0a3a3f" : s.state === "STALE" ? "#3a2f10" : "transparent" }}>
      {mark}
    </span>
  );
}

export function PipelineStages({ steps, selected, onSelect }: { steps: RibbonStep[]; selected: string | null; onSelect: (key: string | null) => void }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  return (
    <section aria-label={d.engineStepsForVideo} data-section="p03-s02" className="vie-panel">
      <ol className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4 2xl:grid-cols-8">
        {steps.map((s, i) => {
          const on = selected === s.key;
          return (
            <li key={s.key} data-stage-step={s.key} data-stage-state={s.state}>
              <button type="button" aria-pressed={on} onClick={() => onSelect(on ? null : s.key)}
                aria-label={`${i + 1}. ${s.title}: ${s.label}${s.progress !== null ? `, ${Math.round(s.progress)}%` : ""}. ${on ? d.showEveryStep : d.showOnlyStep}`}
                title={on ? d.showingOnlyStep : d.showOnlyStep}
                className={`flex h-full w-full flex-col items-start gap-1.5 rounded-ctl border p-2.5 text-left ${on ? "border-primary bg-primary/10" : "border-line/70 hover:border-line2"}`}>
                <span className="flex w-full items-center justify-between gap-2">
                  <Ring s={s} />
                  <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={RIBBON_PILL[s.state]}>{s.label}</span>
                </span>
                <span className="text-sm font-semibold">{`${i + 1}. ${s.title}`}</span>
                <span className="block truncate text-xs text-muted" title={s.line}>{s.line}</span>
                <span className="h-1.5 w-full overflow-hidden rounded bg-line/60">
                  <i className="block h-full rounded" style={{ width: `${s.progress ?? 0}%`, background: s.state === "STALE" ? "#ffc94d" : "#1a8cff" }} />
                </span>
                <span className="text-xs font-semibold">{pct(s.progress)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
