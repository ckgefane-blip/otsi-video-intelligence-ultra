"use client";
/**
 * The per-video identity review page (/videos/:id/analyze), Desktop UI (Drop 2): the same connected sections as before — which video and
 * run, the video with the run's boxes in the shared player, the box legend, the overlay switches, the tracks, the selected track with its
 * identity review, frame-by-frame transport and the selected track's presence — laid out as panels in the page's flow.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import { BoxLegend, MatchContext, OverlayToggles, PresenceTimeline, SelectedTrack, TrackList, Transport, useAnalysisWorkspace, VideoWithBoxes } from "./AnalysisWorkspace";
import { SideEdge, useSideWidths } from "@/components/shell/SideResize";

const SIDE_DEFAULTS = { l: 280, r: 380 };

function Panel({ title, children, section, className = "" }: { title: string; children: ReactNode; section: string; className?: string }) {
  return (
    <section className={`min-w-0 border-t border-line pt-3 ${className}`} aria-label={title} data-section={section}>
      <div className="flex items-center justify-between gap-2 pb-1"><h2 className="t-panel">{title}</h2></div>
      <div className="py-1">{children}</div>
    </section>
  );
}

export function AnalyzeLayout() {
  const sides = useSideWidths("analyze", SIDE_DEFAULTS);                     // resizable sidebars (SideResize)
  const { t: dict } = useLocale();
  const ws = useAnalysisWorkspace();
  const d = dict.body.analysis;
  return (
    <div className="flex flex-col gap-3" data-page="04">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="t-page">{dict.desktop.analysisIdentityTitle}</h1>
          <p className="t-body mt-0.5 truncate text-muted">{ws.video ? (ws.video.title ?? ws.video.original_filename) : dict.common.loading}</p>
        </div>
        {ws.video && <Link href={`/analysis?video=${ws.video.id}`} className="vie-btn">{dict.desktop.analysisOpenWorkspace}</Link>}
      </header>
      <div className="relative grid grid-cols-1 gap-3 xl:grid-cols-[var(--sl)_minmax(0,1fr)_var(--sr)]" style={sides.style}>
<SideEdge side="l" width={sides.widths.l} gap={12} show="hidden xl:block" onChange={(px) => sides.set("l", px)} />
<SideEdge side="r" width={sides.widths.r} gap={12} show="hidden xl:block" onChange={(px) => sides.set("r", px)} />
        <div className="flex flex-col gap-3">
          <Panel title={d.match} section="p04-s01"><MatchContext /></Panel>
          <Panel title={dict.desktop.overlaysTitle} section="p04-s05"><OverlayToggles /></Panel>
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <section className="min-w-0 border-t border-line pt-3" aria-label={dict.body.processing.matchVideo} data-section="p04-s03">
            <VideoWithBoxes />
            <div className="mt-2" data-section="p04-s04"><BoxLegend /></div>
          </section>
          <Panel title={dict.desktop.analysisFrameByFrame} section="p04-s08"><Transport /></Panel>
          <Panel title={d.observedSpans} section="p04-s10"><PresenceTimeline /></Panel>
        </div>
        <div className="flex flex-col gap-3">
          <Panel title={d.playersPanel} section="p04-s06"><TrackList /></Panel>
          <Panel title={d.identityReview} section="p04-s07"><SelectedTrack /></Panel>
        </div>
      </div>
    </div>
  );
}
