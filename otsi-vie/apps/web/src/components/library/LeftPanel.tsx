"use client";
/**
 * Page 09 left panel — match context (approved reference 09_LIBRARY_PROJECT_CENTER, "left panel"), laid out in the page's flow.
 * Shows the selected asset's linked match as recorded (clubs; a score only when recorded) and whether an analysis exists.
 * No dead controls:
 *   View      the viewer's default video overlays (the Desktop UI's eight OverlayToggles, lib/overlayPrefs): people boxes, labels,
 *             ball, and the pitch-placed ones (player tracks, team shapes, heatmaps, pass arrows, offside line; drawn where the
 *             pitch is calibrated)
 *   Filters   Team filter: limits the asset table to the selected match's home or away club; Time Range: the whole match or one
 *             half of the selected video (GET /v1/videos/:id/match-periods: confirmed by a person, or proposed by the engine and said so);
 *             it limits the Events tab to that half. A half that is not known is greyed and says why. Custom ranges are not built yet.
 *   Events    the events the engine found in the selected asset's video (GET /v1/videos/:id/events), counted by kind; a kind opens
 *             the Analysis workspace, where each one can be watched (owner 2026-11-02: "needs populating")
 *   AI Tools  opens the selected asset in Processing, Analysis, Tactical or the Reel Builder
 * v3 Phase A.14 (ADR-073): a Match / Browse switch at the top; Browse shows the Library tree (LibraryTree.tsx) in the same panel.
 */
import type { Match, MatchEvents, MatchPeriods } from "@otsi-vie/contracts";
import Link from "next/link";
import { memo, useEffect, useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { KIND, marksOf, type Kind } from "@/components/workspace/TimelinePanel";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { ActionsMenu } from "@/components/media/ActionsMenu";
import { OverlayToggles } from "@/components/media/OverlayToggles";
import { videoActions } from "@/lib/actions";
import { NOT_YET, notBuilt } from "@/lib/devMode";

export type TeamSide = "all" | "home" | "away";

const EVENT_KINDS: Kind[] = ["Goals", "Shots", "Passes", "Key Passes", "Ball Won", "Tackles", "Interceptions", "Pressures", "Set Pieces", "Fouls"];

export type TimeRange = "full" | "h1" | "h2";

/** the selected video's halves (null: not known) */
function usePeriods(videoId: string | null): MatchPeriods | null {
  const [p, setP] = useState<MatchPeriods | null>(null);
  useEffect(() => { setP(null); if (videoId) void api<MatchPeriods>(`/v1/videos/${videoId}/match-periods`).then(setP, () => setP(null)); }, [videoId]);
  return p;
}
const halfOf = (p: MatchPeriods | null, r: TimeRange) => (r === "h1" ? p?.first ?? null : r === "h2" ? p?.second ?? null : null);

/** the Events tab: what the engine found in the selected video, by kind (in one half when the Time Range says so) */
function EventCounts({ videoId, span, rangeLabel }: { videoId: string | null; span: { start_us: number; end_us: number } | null; rangeLabel: string | null }) {
  const { t: dict } = useLocale();
  const [ev, setEv] = useState<MatchEvents | null | undefined>(undefined);
  useEffect(() => { setEv(undefined); if (videoId) void api<MatchEvents>(`/v1/videos/${videoId}/events`).then(setEv, () => setEv(null)); }, [videoId]);
  const all = ev ? marksOf(ev) : null;
  const marks = all && span ? Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.filter((m) => m.at >= span.start_us && m.at < span.end_us)])) as typeof all : all;
  const total = marks ? EVENT_KINDS.filter((k) => k !== "Key Passes" && k !== "Tackles" && k !== "Interceptions" && k !== "Fouls").reduce((n, k) => n + marks[k].length, 0) : 0;
  const msg = !videoId ? dict.body.library.selectAsset : ev === undefined ? dict.body.library.eventsLoading : ev === null ? dict.body.library.eventsLoadFailed
    : !total ? dict.body.library.eventsNone : null;
  if (msg) return <p className="text-sm text-muted">{msg}</p>;
  return (
    <nav aria-label={dict.body.library.eventsFoundAria} data-events={String(total)} className="flex flex-col">
      <span className="pb-1 text-xs text-muted">{dict.body.library.eventsReading.replace("{a}", rangeLabel ? `, ${rangeLabel}` : "")}</span>
      {EVENT_KINDS.map((k) => (
        <Link key={k} href={`/videos/${videoId}/analyze`} data-kind={k}
          className="flex h-9 items-center gap-2.5 border-b border-line/60 text-sm text-ink hover:text-primary">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: KIND(dict)[k].color }} />
          <span className="flex-1">{KIND(dict)[k].plural}</span>
          <span className={`font-normal ${marks![k].length ? "text-white" : "text-muted"}`}>{marks![k].length}</span>
        </Link>
      ))}
    </nav>
  );
}

export const LeftPanel = memo(function LeftPanel({ match, analysed, side, setSide, team, setTeam, say, videoId, reelId, browse, setBrowse, tree }: {
  match: Match | null; analysed: boolean; side: number; setSide: (i: number) => void; team: TeamSide; setTeam: (t: TeamSide) => void;
  say: (t: string) => void; videoId: string | null; reelId: string | null;
  /** A.14: the panel shows the Library tree (true) or the selected asset's match (false, the approved panel) */
  browse: boolean; setBrowse: (b: boolean) => void; tree: ReactNode;
}) {
  const { t: dict } = useLocale();
  const periods = usePeriods(videoId);
  const [range, setRange] = useState<TimeRange>("full");
  useEffect(() => { setRange("full"); }, [videoId]);
  const span = halfOf(periods, range);
  const proposed = periods?.state === "PROPOSED";
  const rangeLabel = range === "full" ? null : `${range === "h1" ? dict.body.library.halfFirst : dict.body.library.halfSecond}${proposed ? dict.body.library.halfProposedSuffix : ""}`;
  const pickRange = (r: TimeRange, l: string) => {
    if (r === "full") { setRange(r); return say(dict.body.library.sayWholeMatch); }
    if (!videoId) return say(dict.body.library.saySelectAssetFirst);
    const h = halfOf(periods, r);
    if (!h) return say(dict.body.library.sayHalvesUnknown.replace("{a}", l));
    setRange(r);
    say(dict.body.library.sayHalfCounts.replace("{a}", l).replace("{b}", proposed ? dict.body.library.sayHalfProposed : ""));
  };
  const score = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));
  const teamRows: [TeamSide, string][] = [["all", dict.body.library.teamAllPlayers], ["home", match?.home?.name ?? dict.body.library.homeTeam], ["away", match?.away?.name ?? dict.body.library.awayTeam]];
  const pickTeam = (t: TeamSide) => {
    if (t !== "all" && !match) return say(dict.body.library.saySelectLinkedFirst);
    setTeam(t);
  };
  // the tabs below the match card: View and Filters show the reference's two groups; Events and AI Tools their own content
  const TABS = [dict.body.library.panelView, dict.body.library.panelFilters, dict.body.library.events, dict.body.library.panelAiTools];
  const showView = side === 0, showFilters = side === 0 || side === 1;

  const switcher = (
    <div role="radiogroup" aria-label={dict.body.library.leftPanelAria} data-left-view={browse ? "browse" : "match"}
      className="flex gap-1 rounded-md border border-line bg-canvas p-0.5">
      {([[false, dict.body.analysis.match, dict.body.library.switcherMatchTitle], [true, dict.body.library.libraryBrowse, dict.body.library.switcherBrowseTitle]] as const).map(([b, l, t]) => (
        <button key={l} type="button" role="radio" aria-checked={browse === b} title={t} onClick={() => setBrowse(b)}
          className={`h-7 rounded-md px-3 text-sm ${browse === b ? "bg-primary font-normal text-white" : "text-ink hover:bg-raised"}`}>{l}</button>
      ))}
    </div>
  );
  if (browse) {
    return (
      <aside aria-label={dict.body.library.browsePanelAria} className="vie-panel flex min-w-0 flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-panel">{dict.pages.library.title}</h2>
          {switcher}
        </div>
        <div className="min-h-0 overflow-y-auto">{tree}</div>
      </aside>
    );
  }

  return (
    <aside aria-label={dict.body.library.matchPanelAria} className="vie-panel flex min-w-0 flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="t-panel">{dict.body.analysis.match}</h2>
        {switcher}
        <ActionsMenu label={dict.body.library.moreForMatch}
          items={videoId ? [...videoActions(videoId, dict), { label: dict.body.library.setScoreDetails, href: `/upload?video=${videoId}` }] : []}
          empty={dict.body.library.saySelectAssetFirst} />
      </div>

      <div className="min-w-0">
        <p className="truncate t-panel">
          {match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : dict.body.library.noMatchSelected}
        </p>
        <p className="text-sm text-muted">{match?.competition ?? "—"}</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {([["home", match?.home?.name ?? dict.body.library.homeTeam, match?.home_score], ["away", match?.away?.name ?? dict.body.library.awayTeam, match?.away_score]] as const).map(([sideName, name, s]) => (
            <div key={sideName} className="flex items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-raised text-sm font-normal" aria-hidden>
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{name}</span>
              <span className="w-8 text-center t-metric">{score(s)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md border border-line bg-raised p-2.5">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-normal">{analysed ? dict.body.library.analysisAvailable : dict.body.library.analysisUnavailable}</p>
          <p className="text-xs text-muted">{analysed ? dict.body.library.analysisOpen : dict.body.library.analysisProcessingLine1}</p>
          <p className="text-xs text-muted">{analysed ? dict.body.library.analysisEventsLine : dict.body.library.analysisProcessingLine2}</p>
        </div>
      </div>

      <div role="tablist" aria-label={dict.body.library.panelTabsAria} className="flex flex-wrap gap-1 border-b border-line">
        {TABS.map((l, i) => (
          <button key={l} type="button" role="tab" aria-selected={side === i} onClick={() => setSide(i)}
            className={`border-b-2 px-2 py-1.5 text-sm ${side === i ? "border-primary font-normal text-primary" : "border-transparent text-ink hover:bg-raised"}`}>{l}</button>
        ))}
      </div>

      {showView && <OverlayToggles compact />}

      {showFilters && (
        <div className="flex flex-col gap-4">
          <section>
            <h3 className="mb-1.5 text-sm font-normal">{dict.body.analysis.teamFilter}</h3>
            <div role="radiogroup" aria-label={dict.body.library.teamFilterAria} className="flex flex-col gap-1">
              {teamRows.map(([t, l]) => {
                const on = team === t;
                return (
                  <button key={t} type="button" role="radio" aria-checked={on} onClick={() => pickTeam(t)}
                    title={t === "all" ? dict.body.library.teamShowAll : match ? dict.body.library.teamShowOnly.replace("{a}", l) : dict.body.library.teamNeedMatchTitle}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm ${on ? "border-primary bg-raised" : "border-line bg-transparent hover:bg-raised"}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-primary bg-primary text-white" : "border-muted text-transparent"}`} aria-hidden>
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l}</span>
                  </button>
                );
              })}
            </div>
          </section>
          <section>
            <h3 className="mb-1.5 text-sm font-normal">{dict.body.analysis.timeRange}</h3>
            <div role="radiogroup" aria-label={dict.body.library.timeRangeAria} data-range={range} className="flex flex-col gap-1">
              {(([["full", dict.body.library.rangeFull], ["h1", dict.body.library.rangeH1], ["h2", dict.body.library.rangeH2], ["custom", dict.body.library.rangeCustom]] as [TimeRange | "custom", string][])).map(([k, l]) => {
                const on = k === range, off = k === "custom" || (k !== "full" && !halfOf(periods, k));
                const why = k === "custom" ? notBuilt("custom ranges") : off ? dict.body.library.halvesUnknown : undefined;
                return (
                  <button key={k} type="button" role="radio" aria-checked={on} aria-disabled={off || undefined} title={why}
                    onClick={() => (k === "custom" ? say(dict.body.library.customRangeNotYet.replace("{a}", NOT_YET)) : pickRange(k, l))}
                    className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm ${on ? "border-primary bg-raised" : "border-line bg-transparent hover:bg-raised"} ${off ? "opacity-60" : ""}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${on ? "border-primary bg-primary text-white" : "border-muted text-transparent"}`} aria-hidden>
                      {on ? "✓" : ""}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{l}{k !== "full" && k !== "custom" && proposed && !off ? dict.body.library.rangeProposed : ""}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      )}

      {side === 2 && (
        <section>
          <h3 className="mb-1.5 text-sm font-normal">{dict.body.library.events}</h3>
          <EventCounts videoId={videoId} span={span} rangeLabel={rangeLabel} />
        </section>
      )}
      {side === 3 && (
        <section>
          <h3 className="mb-1.5 text-sm font-normal">{dict.body.library.panelAiTools}</h3>
          <nav aria-label={dict.body.library.openAssetAria} className="flex flex-col gap-2 text-sm">
            {videoId ? (
              <>
                <Link href={`/processing?video=${videoId}`} className="text-primary hover:underline">{dict.body.library.aiProcessing}</Link>
                <Link href={`/videos/${videoId}/analyze`} className="text-primary hover:underline">{dict.body.library.aiAnalysis}</Link>
                <Link href={`/tactics?video=${videoId}`} className="text-primary hover:underline">{dict.body.library.aiTactical}</Link>
                <Link href={reelId ? `/studio?reel=${reelId}` : "/reels"} className="text-primary hover:underline">{reelId ? dict.body.library.aiClipStudio : dict.body.library.aiMakeReel}</Link>
              </>
            ) : <span className="text-muted">{dict.body.library.selectAssetVideo}</span>}
          </nav>
        </section>
      )}
    </aside>
  );
});
