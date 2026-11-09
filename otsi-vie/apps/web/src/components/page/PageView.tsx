import type { CSSProperties, ReactNode } from "react";
import { PAGES, pageSpec, sectionState, type PageId } from "@/lib/pages";
import { SectionCard } from "./SectionCard";

interface Props {
  id: PageId;
  /** content for sections that render something today (static product copy, working controls, route context) */
  content?: Partial<Record<number, ReactNode>>;
  /** replaces the page subtitle under the h1 (e.g. which video or player the page is about) */
  subtitle?: string;
  /** sections whose content here is connected to the real backend */
  live?: number[];
}

/**
 * Renders one approved page: every section of its specification, in specification order (reading order for assistive technology),
 * placed into the page's grid composed after the approved image. Below 1100px the sections stack in that same order.
 */
export function PageView({ id, content = {}, subtitle, live = [] }: Props) {
  const def = PAGES[id];
  const spec = pageSpec(id);
  const headingSection = id === 1 ? 2 : 1;
  const style = {
    "--cols": def.columns,
    "--areas": def.areas.map((r) => `"${r}"`).join(" "),
  } as CSSProperties;
  return (
    <div className="page-grid" style={style} data-page={String(id).padStart(2, "0")}>
      {def.areas.some((r) => r.split(" ").includes("rail")) && <MatchRail />}
      {spec.sections.map((s) => {
        const state = live.includes(s.n) ? ({ kind: "live" } as const) : sectionState(id, s.n);
        if (state.kind === "shell") return null;            // rendered once by the global header
        return (
          <SectionCard
            key={s.n}
            pageId={id}
            section={s}
            state={state}
            area={`s${s.n}`}
            heading={s.n === headingSection ? { title: spec.title, subtitle: subtitle ?? def.subtitle, visible: def.visibleHeading } : undefined}
            untitled={def.untitled?.includes(s.n) ?? false}
          >
            {content[s.n]}
          </SectionCard>
        );
      })}
    </div>
  );
}

/**
 * The left match rail the approved Tactical Intelligence and Library images share with the Analysis Workspace (its sections 1 and 5):
 * selected match, processing status, overlay toggles, team and time filters. Built with the Analysis Workspace (Blocks 04 and 06).
 */
function MatchRail() {
  return (
    <aside
      aria-label="Match rail"
      data-section="rail"
      style={{ gridArea: "rail" }}
      className="flex min-w-0 flex-col gap-2 rounded-card border border-line/80 bg-panel/85 p-4"
    >
      <h2 className="flex items-center gap-2 text-[15px] font-semibold"><span aria-hidden className="h-4 w-[3px] rounded-full bg-primary" />Match</h2>
      <p className="text-sm text-muted">No match selected. The match rail (context, overlays, team and time filters) is shared with the Analysis Workspace and is built in Blocks 04 and 06.</p>
    </aside>
  );
}
