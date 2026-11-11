"use client";
/**
 * Page 09 left panel — match context (approved reference 09_LIBRARY_PROJECT_CENTER, "left panel"). Shows the selected asset's linked
 * match as recorded (clubs; a score only when recorded) and whether an analysis exists. No dead controls:
 *   View      the viewer's default video overlays that the Analysis page starts with (lib/overlayPrefs): people boxes, labels, ball, and
 *             the pitch-placed ones (player tracks, team shapes, heatmaps, pass arrows; drawn where the pitch is calibrated)
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
import { KIND, marksOf, type Kind } from "@/components/workspace/TimelinePanel";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { MoreMenu } from "@/components/stage/MoreMenu";
import { videoActions } from "@/lib/actions";
import { useOverlayPrefs, type OverlayPrefs } from "@/lib/overlayPrefs";
import { NOT_YET, notBuilt } from "@/lib/devMode";

const crest = { background: "radial-gradient(circle,#f2c56b 0,#6cc4ff 50%,#fff 56%)", borderRadius: "50%" };
const OVERLAYS = (d: Dictionary): [string, string, number, keyof OverlayPrefs | null, string][] => [
  ["box", d.body.library.overlayBoxes, 674, "boxes", ""], ["ids", d.body.library.overlayIds, 715, "ids", ""], ["trk", d.body.library.overlayTracks, 756, "trails", ""],
  ["shp", d.body.library.overlayShapes, 797, "shapes", ""], ["trk", d.body.library.overlayHeatmaps, 838, "heat", ""],
  ["ball", d.body.library.overlayBall, 879, "ball", ""], ["pass", d.body.library.overlayPasses, 921, "passes", ""]];
const TAB_LABELS = (d: Dictionary): [string, number, number][] => [[d.body.library.panelView, 33, 67], [d.body.library.panelFilters, 108, 76], [d.body.library.events, 197, 78], [d.body.library.panelAiTools, 290, 96]];
const plain = { position: "absolute" as const, padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" };

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
  if (msg) return <T x={37} y={668} size={18} color="#8ea3bf" style={{ maxWidth: u(345), whiteSpace: "normal" }}>{msg}</T>;
  return (
    <nav aria-label={dict.body.library.eventsFoundAria} data-events={String(total)} className="absolute" style={{ left: u(34), top: u(650 - 101), width: u(356), display: "flex", flexDirection: "column" }}>
      <span style={{ fontSize: u(16), color: "#8ea3bf", paddingBottom: u(6) }}>{dict.body.library.eventsReading.replace("{a}", rangeLabel ? `, ${rangeLabel}` : "")}</span>
      {EVENT_KINDS.map((k) => (
        <Link key={k} href={`/videos/${videoId}/analyze`} data-kind={k}
          style={{ display: "flex", alignItems: "center", gap: u(10), height: u(38), borderBottom: `${u(1)} solid #12305a`, fontSize: u(20), color: "#d6e4f7" }}>
          <span style={{ width: u(12), height: u(12), borderRadius: "50%", background: KIND(dict)[k].color, flex: "none" }} />
          <span style={{ flex: 1 }}>{KIND(dict)[k].plural}</span>
          <span style={{ fontWeight: 700, color: marks![k].length ? "#fff" : "#8ea3bf" }}>{marks![k].length}</span>
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
  const [prefs, savePrefs] = useOverlayPrefs();
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
  const teamRows: [TeamSide, string, number][] = [["all", dict.body.library.teamAllPlayers, 1025], ["home", match?.home?.name ?? dict.body.library.homeTeam, 1071], ["away", match?.away?.name ?? dict.body.library.awayTeam, 1114]];
  const teamY = teamRows.find((r) => r[0] === team)![2];
  const pickTeam = (t: TeamSide) => {
    if (t !== "all" && !match) return say(dict.body.library.saySelectLinkedFirst);
    setTeam(t);
  };
  // the tabs below the match card: View and Filters show the reference's two groups; Events and AI Tools their own content
  const TABS = TAB_LABELS(dict);
  const showView = side === 0, showFilters = side === 0 || side === 1;
  const fy = side === 1 ? -335 : 0;                                     // on the Filters tab the filters move up into the free space

  const switcher = (
    <div role="radiogroup" aria-label={dict.body.library.leftPanelAria} data-left-view={browse ? "browse" : "match"} className="absolute"
      style={{ left: u(150), top: u(139 - 101), display: "flex", gap: u(4), padding: u(3), background: "#041022", border: `${u(1.5)} solid #17406f`, borderRadius: u(8) }}>
      {([[false, dict.body.analysis.match, dict.body.library.switcherMatchTitle], [true, dict.body.library.libraryBrowse, dict.body.library.switcherBrowseTitle]] as const).map(([b, l, t]) => (
        <button key={l} type="button" role="radio" aria-checked={browse === b} title={t} onClick={() => setBrowse(b)}
          style={{ height: u(28), padding: `0 ${u(12)}`, border: 0, borderRadius: u(6), background: browse === b ? "#0f4f9a" : "transparent", color: browse === b ? "#fff" : "#cfe0f5",
            font: "inherit", fontSize: u(17), cursor: "pointer" }}>{l}</button>
      ))}
    </div>
  );
  if (browse) {
    return (
      <aside aria-label={dict.body.library.browsePanelAria}>
        <P x={20} y={121} w={381} h={1294} />
        <T x={39} y={156} size={24} weight={700} as="h2">{dict.pages.library.title}</T>
        {switcher}
        <div className="absolute" style={{ left: u(28), top: u(190 - 101), width: u(366), maxHeight: u(1210), overflowY: "auto", overflowX: "hidden" }}>{tree}</div>
      </aside>
    );
  }

  return (
    <aside aria-label={dict.body.library.matchPanelAria}>
      <P x={20} y={121} w={381} h={1294} />
      <T x={39} y={156} size={24} weight={700} as="h2">{dict.body.analysis.match}</T>
      {switcher}
      <MoreMenu x={325} y={156} k="hdots" size={24} label={dict.body.library.moreForMatch} side="right"
        items={videoId ? [...videoActions(videoId, dict), { label: dict.body.library.setScoreDetails, href: `/upload?video=${videoId}` }] : []}
        empty={dict.body.library.saySelectAssetFirst} />
      <Ic x={366} y={156} k="chev" size={20} />
      <T x={39} y={201} size={22} weight={700} style={{ maxWidth: u(340), overflow: "hidden", textOverflow: "ellipsis" }}>
        {match ? `${match.home?.name ?? "—"} vs ${match.away?.name ?? "—"}` : dict.body.library.noMatchSelected}
      </T>
      <T x={39} y={234} size={21} color="#8ea3bf">{match?.competition ?? "—"}</T>
      <B x={42} y={275} w={48} h={48} style={crest} />
      <T x={109} y={301} size={24} style={{ maxWidth: u(220), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.home?.name ?? dict.body.library.homeTeam}</T>
      <T x={363} y={300} size={32} weight={600} align="center">{score(match?.home_score)}</T>
      <B x={42} y={346} w={48} h={48} style={crest} />
      <T x={109} y={370} size={24} style={{ maxWidth: u(220), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.away?.name ?? dict.body.library.awayTeam}</T>
      <T x={363} y={370} size={32} weight={600} align="center">{score(match?.away_score)}</T>
      <B x={35} y={421} w={352} h={96} style={{ background: "#052a28", border: `${u(1.5)} solid #14705a`, borderRadius: u(10) }} />
      <Ic x={70} y={455} k="shield" size={38} color="#8ea3bf" fill="#2a4a78" />
      <T x={106} y={447} size={22} weight={600} color="#cfe0f5">{analysed ? dict.body.library.analysisAvailable : dict.body.library.analysisUnavailable}</T>
      <T x={106} y={474} size={16} color="#b9cbe2">{analysed ? dict.body.library.analysisOpen : dict.body.library.analysisProcessingLine1}</T>
      <T x={106} y={494} size={16} color="#b9cbe2">{analysed ? dict.body.library.analysisEventsLine : dict.body.library.analysisProcessingLine2}</T>

      <div role="tablist" aria-label={dict.body.library.panelTabsAria}>
        {TABS.map(([l, x, w], i) => (
          <button key={l} type="button" role="tab" aria-selected={side === i} onClick={() => setSide(i)}
            style={{ ...plain, left: u(x - 12), top: u(541 - 101), width: u(w), height: u(50) }}>
            <T o={[x - 12, 541]} x={x} y={563} size={21} weight={side === i ? 600 : 400} color={side === i ? "#33a8ff" : "#cfe0f5"} as="span">{l}</T>
          </button>
        ))}
      </div>
      <B x={21} y={594} w={380} h={1} style={{ background: "#12335f" }} />
      <B x={TABS[side]![1] - 12} y={592} w={TABS[side]![2]} h={3} style={{ background: "#1e90ff" }} />

      {showView && (
        <>
          <T x={37} y={630} size={20} weight={600} as="h3">{dict.body.analysis.visualOverlays}</T>
          {OVERLAYS(dict).map(([k, l, y, key, why]) => {
            const on = key ? prefs[key] : false;
            return (
              <button key={l} type="button" role="switch" aria-checked={on} aria-disabled={!key || undefined} aria-label={dict.body.library.overlayDefaultAria.replace("{a}", l)}
                title={key ? (["trails", "shapes", "heat", "passes"].includes(key) ? dict.body.library.overlayPitchTitle : dict.body.library.overlayVideoTitle) : why}
                onClick={() => (key ? savePrefs({ ...prefs, [key]: !on }) : say(why))}
                style={{ ...plain, left: u(34), top: u(y - 18 - 101), width: u(356), height: u(36) }}>
                <Ic o={[34, y - 18]} x={50} y={y} k={k} size={28} color={on ? "#33a8ff" : "#cfe0f5"} />
                <T o={[34, y - 18]} x={83} y={y} size={21} color={key ? "#d6e4f7" : "#8ea3bf"} as="span">{l}</T>
                <B o={[34, y - 18]} x={336} y={y - 14} w={48} h={26} style={{ background: on ? "#0481f9" : "#26364d", borderRadius: u(13), opacity: key ? 1 : 0.6 }} />
                <B o={[34, y - 18]} x={336 + (on ? 24 : 3)} y={y - 11} w={21} h={21} style={{ background: "#fff", borderRadius: "50%" }} />
              </button>
            );
          })}
        </>
      )}

      {showFilters && (
        <div style={{ transform: fy ? `translateY(${u(fy)})` : undefined }}>
          <T x={37} y={980} size={20} weight={600} as="h3">{dict.body.analysis.teamFilter}</T>
          <B x={34} y={teamY - 21} w={353} h={42} style={{ background: "#0a2b55", border: `${u(1.5)} solid #1e90ff`, borderRadius: u(8) }} />
          <div role="radiogroup" aria-label={dict.body.library.teamFilterAria}>
            {teamRows.map(([t, l, y]) => {
              const on = team === t;
              return (
                <button key={t} type="button" role="radio" aria-checked={on} onClick={() => pickTeam(t)}
                  title={t === "all" ? dict.body.library.teamShowAll : match ? dict.body.library.teamShowOnly.replace("{a}", l) : dict.body.library.teamNeedMatchTitle}
                  style={{ ...plain, left: u(34), top: u(y - 21 - 101), width: u(353), height: u(42) }}>
                  {on ? (
                    <>
                      <B o={[34, y - 21]} x={43} y={y - 10} w={22} h={22} style={{ background: "#1e90ff", borderRadius: "50%" }} />
                      <Ic o={[34, y - 21]} x={54} y={y + 1} k="chk" size={14} />
                    </>
                  ) : <Ic o={[34, y - 21]} x={52} y={y} k={t === "all" ? "cir" : "xc"} size={26} color="#8ea3bf" />}
                  <T o={[34, y - 21]} x={84} y={y} size={21} color={on ? undefined : "#d6e4f7"} as="span" style={{ maxWidth: u(240), overflow: "hidden", textOverflow: "ellipsis" }}>{l}</T>
                  <B o={[34, y - 21]} x={337} y={y - 15} w={43} h={30}
                    style={{ background: t === "all" ? "#0a2447" : "#041022", border: `${u(1.5)} solid ${t === "all" ? "#1d4f8a" : "#17406f"}`, borderRadius: u(t === "all" ? 6 : 8) }} />
                  <T o={[34, y - 21]} x={358} y={y + 1} size={19} color={t === "all" ? undefined : "#cfe0f5"} align="center" as="span">—</T>
                </button>
              );
            })}
          </div>
          <T x={37} y={1170} size={20} weight={600} as="h3">{dict.body.analysis.timeRange}</T>
          {(() => {
            const rows: [TimeRange | "custom", string, number][] = [["full", dict.body.library.rangeFull, 1218], ["h1", dict.body.library.rangeH1, 1261], ["h2", dict.body.library.rangeH2, 1302], ["custom", dict.body.library.rangeCustom, 1343]];
            const y0 = rows.find((r) => r[0] === range)![2];
            return (
              <>
                <B x={34} y={y0 - 23} w={353} h={46} style={{ background: "#0a2b55", border: `${u(1.5)} solid #1e90ff`, borderRadius: u(8) }} />
                <B x={45} y={y0 - 11} w={22} h={22} style={{ background: "#1e90ff", borderRadius: "50%" }} />
                <Ic x={56} y={y0} k="chk" size={14} />
                <div role="radiogroup" aria-label={dict.body.library.timeRangeAria} data-range={range}>
                  {rows.map(([k, l, y]) => {
                    const on = k === range, off = k === "custom" || (k !== "full" && !halfOf(periods, k));
                    const why = k === "custom" ? notBuilt("custom ranges") : off ? dict.body.library.halvesUnknown : undefined;
                    return (
                      <button key={k} type="button" role="radio" aria-checked={on} aria-disabled={off || undefined} title={why}
                        onClick={() => (k === "custom" ? say(dict.body.library.customRangeNotYet.replace("{a}", NOT_YET)) : pickRange(k, l))}
                        style={{ ...plain, left: u(34), top: u(y - 23 - 101), width: u(353), height: u(46) }}>
                        {!on && <Ic o={[34, y - 23]} x={56} y={y} k="cir" size={24} color="#8ea3bf" />}
                        <T o={[34, y - 23]} x={86} y={y} size={21} color={on ? undefined : off ? "#6a7f9c" : "#d6e4f7"} as="span">{l}{k !== "full" && k !== "custom" && proposed && !off ? dict.body.library.rangeProposed : ""}</T>
                      </button>
                    );
                  })}
                </div>
              </>
            );
          })()}
        </div>
      )}

      {side === 2 && (
        <>
          <T x={37} y={630} size={20} weight={600} as="h3">{dict.body.library.events}</T>
          <EventCounts videoId={videoId} span={span} rangeLabel={rangeLabel} />
        </>
      )}
      {side === 3 && (
        <>
        <T x={37} y={630} size={20} weight={600} as="h3">{dict.body.library.panelAiTools}</T>
        <nav aria-label={dict.body.library.openAssetAria} className="absolute" style={{ left: u(37), top: u(660 - 101), display: "flex", flexDirection: "column", gap: u(14), fontSize: u(20) }}>
          {videoId ? (
            <div style={{ display: "flex", flexDirection: "column", gap: u(12) }}>
              <Link href={`/processing?video=${videoId}`} style={{ color: "#33a8ff" }}>{dict.body.library.aiProcessing}</Link>
              <Link href={`/videos/${videoId}/analyze`} style={{ color: "#33a8ff" }}>{dict.body.library.aiAnalysis}</Link>
              <Link href={`/tactics?video=${videoId}`} style={{ color: "#33a8ff" }}>{dict.body.library.aiTactical}</Link>
              <Link href={reelId ? `/studio?reel=${reelId}` : "/reels"} style={{ color: "#33a8ff" }}>{reelId ? dict.body.library.aiClipStudio : dict.body.library.aiMakeReel}</Link>
            </div>
          ) : <span style={{ color: "#8ea3bf" }}>{dict.body.library.selectAssetVideo}</span>}
        </nav>
        </>
      )}
    </aside>
  );
});
