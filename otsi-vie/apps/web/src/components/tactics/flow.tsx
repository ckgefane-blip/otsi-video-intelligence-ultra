/**
 * Tactical Intelligence — Desktop UI building blocks in the page's flow (Drop 2): a panel with its heading and the circled "i" that says
 * what it needs, the pitch outline (lines only — no turf picture), the "Not measured" chip, and a native select whose options without data
 * stay listed, greyed, with their reason. The stage versions in ./kit stay for the pages not yet re-laid out.
 */
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import type { Opt } from "./kit";

export function Panel({ id, title, info, right, focus = false, children, className = "", label, section, data }: {
  id?: string; title: ReactNode; info?: string | undefined; right?: ReactNode; focus?: boolean; children: ReactNode; className?: string;
  label?: string; section?: string; data?: Record<string, string>;
}) {
  return (
    <section id={id} aria-label={label} data-section={section} {...data}
      className={`vie-panel flex min-w-0 flex-col ${focus ? "ring-2 ring-primary ring-offset-2 ring-offset-canvas" : ""} ${className}`}>
      <div className="vie-ph gap-2">
        <h2 className="t-panel flex min-w-0 items-center gap-1.5">
          <span className="truncate">{title}</span>
          {info && <span tabIndex={0} role="note" aria-label={info} title={info} className="cursor-help text-muted"><Info className="h-3.5 w-3.5" aria-hidden /></span>}
        </h2>
        {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
      </div>
      {children}
    </section>
  );
}

/** a full pitch (105 × 68 m) drawn as lines; `children` are placed over it in % of the pitch */
export function PitchBox({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`relative w-full overflow-hidden rounded border border-line2 bg-p0 ${className}`} style={{ aspectRatio: "105 / 68" }} data-pitch>
      <svg aria-hidden viewBox="0 0 105 68" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" fill="none"
        stroke="rgb(var(--line2))" strokeWidth={0.35}>
        <rect x={0.2} y={0.2} width={104.6} height={67.6} />
        <line x1={52.5} y1={0} x2={52.5} y2={68} />
        <circle cx={52.5} cy={34} r={9.15} />
        <rect x={0.2} y={13.85} width={16.5} height={40.3} />
        <rect x={88.3} y={13.85} width={16.5} height={40.3} />
        <rect x={0.2} y={24.85} width={5.5} height={18.3} />
        <rect x={99.3} y={24.85} width={5.5} height={18.3} />
      </svg>
      {children}
    </div>
  );
}

export function NotMeasuredChip({ children }: { children?: ReactNode }) {
  const { t } = useLocale();
  return (
    <div className="absolute inset-0 grid place-items-center p-3">
      <span className="t-small max-w-[90%] rounded border border-line2 bg-panel/90 px-2.5 py-1 text-center text-ink2">{children ?? t.body.reports.notMeasured}</span>
    </div>
  );
}

/** a native select; options with a reason are listed greyed and cannot be chosen */
export function Select<V extends string>({ label, value, options, onChange, className = "" }: {
  label: string; value: V; options: Opt<V>[]; onChange: (v: V) => void; className?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as V)}
      className={`h-7 max-w-[220px] rounded border border-line2 bg-raised px-1.5 t-small text-ink ${className}`}>
      {options.map(([v, l, why]) => <option key={v} value={v} disabled={!!why}>{why ? `${l.trim()} — ${why}` : l.trim()}</option>)}
    </select>
  );
}

/** a label · value row; `why` explains a value that is not measured */
export function Metric({ label, value, why, frac, data }: { label: string; value: string; why?: string | undefined; frac?: number | null; data?: string }) {
  return (
    <div className="flex items-center gap-2 py-1" title={why} data-metric={data ?? label}>
      <span className="t-small min-w-0 flex-1 truncate text-ink2">{label}</span>
      {frac !== undefined && (
        <span className="h-1.5 w-20 shrink-0 overflow-hidden rounded bg-line">
          {frac != null && <i className="block h-full rounded bg-primary" style={{ width: `${Math.max(2, Math.min(100, frac * 100))}%` }} />}
        </span>
      )}
      <span className={`t-mono w-24 shrink-0 text-right ${value === "—" ? "text-muted" : "text-ink"}`}>{value}</span>
    </div>
  );
}
