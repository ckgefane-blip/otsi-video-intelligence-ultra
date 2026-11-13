import { CircleDashed, Lock, Paintbrush } from "lucide-react";
import type { ReactNode } from "react";
import { BLOCK_NAMES } from "@/lib/blocks";
import type { SectionState, SpecSection } from "@/lib/pages";

/** The state chip: what is true about this section today. */
function StateChip({ state }: { state: SectionState }) {
  if (state.kind === "static") return null;
  if (state.kind === "owner") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber/50 bg-amber/10 px-2 py-0.5 text-[11px] font-normal text-amber">
        <Paintbrush className="h-3 w-3" /> Owner asset needed
      </span>
    );
  }
  if (state.kind === "planned") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-line bg-raised px-2 py-0.5 text-[11px] font-normal text-muted">
        <CircleDashed className="h-3 w-3" /> Not connected · Block {String(state.block).padStart(2, "0")}
      </span>
    );
  }
  return null;
}

interface Props {
  pageId: number;
  section: SpecSection;
  state: SectionState;
  area: string;
  /** the page's h1 lives in this section */
  heading?: { title: string; subtitle: string; visible: boolean } | undefined;
  /** the approved image shows this section without a title bar */
  untitled?: boolean;
  children?: ReactNode;
}

/**
 * One approved section. Connected and static sections render their content; a section whose backend is not built yet shows its title,
 * what it will show, the API contract that will feed it and the block that builds it. It never shows sample numbers.
 */
export function SectionCard({ pageId, section, state, area, heading, untitled = false, children }: Props) {
  const id = `p${String(pageId).padStart(2, "0")}-s${String(section.n).padStart(2, "0")}`;
  return (
    <section
      aria-labelledby={`${id}-title`}
      data-section={id}
      data-state={state.kind}
      data-block={state.kind === "planned" ? state.block : undefined}
      style={{ gridArea: area }}
      className="flex min-w-0 flex-col rounded-card border border-line/80 bg-panel/85 p-4 shadow-[inset_0_1px_0_rgb(255_255_255/0.03)]"
    >
      {heading && (
        <div className={heading.visible ? "mb-3" : "sr-only"}>
          <h1 className="t-page">{heading.title}</h1>
          <p className="mt-1 text-sm text-muted">{heading.subtitle}</p>
        </div>
      )}
      <div className={untitled ? "sr-only" : "flex flex-wrap items-center justify-between gap-2"}>
        <h2 id={`${id}-title`} className="flex items-center gap-2 text-[12px] font-normal">
          <span aria-hidden className="h-4 w-[3px] rounded-full bg-primary" />
          {section.title}
        </h2>
        <StateChip state={state} />
      </div>
      {children ? <div className="mt-3 min-w-0 flex-1">{children}</div> : <PendingBody section={section} state={state} />}
    </section>
  );
}

function PendingBody({ section, state }: { section: SpecSection; state: SectionState }) {
  const endpoints = (section.contract ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  return (
    <div className="mt-2 flex flex-1 flex-col gap-2 text-sm">
      <p className="text-muted" data-spec-summary><span className="text-muted/70">Will show: </span>{section.summary}</p>
      {state.kind === "planned" && (
        <p className="flex items-start gap-1.5 text-xs text-muted/90">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Shows real data once Block {String(state.block).padStart(2, "0")} ({BLOCK_NAMES[state.block]}) is built. No sample values are shown meanwhile.</span>
        </p>
      )}
      {state.kind === "owner" && <p className="text-xs text-amber/90">{state.need}</p>}
      {endpoints.length > 0 && (
        <ul aria-label="API contract" className="mt-auto flex flex-wrap gap-1.5 pt-1">
          {endpoints.map((e) => (
            <li key={e}><code className="rounded border border-line/70 bg-canvas/60 px-1.5 py-0.5 text-[11px] text-cyan/90">{e}</code></li>
          ))}
        </ul>
      )}
    </div>
  );
}
