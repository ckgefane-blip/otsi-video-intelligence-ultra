"use client";
/**
 * SOT, page 29 — Tactical (Team shape, Pass networks, Heat zones, Pressing & defence, Off-ball runs, Transitions, Compare two players).
 * Three columns: the views and what Team shape still needs (left), the view itself (centre), and the Layers, Shape metrics and
 * Compare inspector (right). The video comes from the address (?video=); its playback, tracks and boxes come from the Analysis
 * workspace hook (ADR-035) and its linked match from GET /v1/matches/:id. This page has no video of its own — the SOT shows the
 * pitch, not a player — so a moment's button opens Analysis at that moment (?video= and ?t= seconds), where the video plays.
 *
 * Team shape is measured (promise 3) at moments where at least 8 of a team stand on a measured pitch: where players stand around
 * the team's centre (the density), width, length and compactness. The formation, defensive-line height and the in/out-of-possession
 * shapes stay "Not measured" with their reason. The phase split is not detected yet, so "Out of possession" is disabled and the
 * shape shown is the whole match; the period seg (Match / 1st / 2nd) drives the formation, while the shape density is whole-match
 * (the API does not split it by half). The Team lines layer draws the measured defensive line; the Width & depth layer draws the
 * measured width × length rectangle around the team centre; the Shirt numbers layer draws nothing yet (no per-player average
 * positions are measured). Nothing is drawn that was not measured.
 *
 * v3 B.8 (ADR-085): the address may also carry the Analysis context (?tab=, ?t= seconds, ?track=): Tactical opens on that tab, at that
 * moment, with that track selected. The tab is matched by NAME, not by position — ?tab=player-comparison used to open Transitions
 * (the old stage indexed the six-name list into the seven-view list). Malformed values are ignored.
 */
import type { FormationName, Match, RunTeams, Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { VideoPicker } from "@/components/processing/VideoPicker";
import { api } from "@/lib/api";
import { isUuid } from "@/lib/identity";
import { readTacticsContext, TACTIC_TABS } from "@/lib/tacticsLink";
import { heatSides, useTeamShape, ShapePicture, useFormations, PassNetworkPanel, HeatZonesPanel, OffBallRunsPanel } from "./Panels";
import { PressingPanel } from "./PressingPanel";
import { TransitionsPanel } from "./TransitionsPanel";
import { PlayerComparison } from "./PlayerComparison";
import { useLocale } from "@/lib/i18n";

/** the seven views, in the SOT's order (the rail's "Views") */
type View = "team-overview" | "pass-network" | "heat-zones" | "pressing-defense" | "off-ball-runs" | "transitions" | "player-comparison";
const VIEWS: View[] = ["team-overview", "pass-network", "heat-zones", "pressing-defense", "off-ball-runs", "transitions", "player-comparison"];

/** the four pitch layers (the inspector's switches): a per-viewer display preference, kept in this browser only */
const LAYER_KEY = "otsi.tactics.layers";
const DEFAULT_LAYERS = { avg: true, lines: true, widthDepth: false, shirts: false };
type Layers = typeof DEFAULT_LAYERS;
function useTacticsLayers(): [Layers, (l: Layers) => void] {
  const [layers, setLayers] = useState<Layers>(DEFAULT_LAYERS);
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(LAYER_KEY) ?? "null") as Partial<Layers> | null; if (v) setLayers({ ...DEFAULT_LAYERS, ...v }); } catch { /* blocked storage: the defaults apply */ }
  }, []);
  return [layers, (l) => { setLayers(l); try { localStorage.setItem(LAYER_KEY, JSON.stringify(l)); } catch { /* blocked storage: the choice is kept for this visit only */ } }];
}

/** the SOT's dark pitch (105 × 68 m), with the measured overlays drawn over it */
function SotPitch({ children, labelledBy }: { children?: React.ReactNode; labelledBy?: string }) {
  return (
    <div className="relative mx-auto w-full max-w-[860px] overflow-hidden rounded-lg" style={{ aspectRatio: "105 / 68" }}>
      <svg viewBox="0 0 105 68" role="img" aria-label={labelledBy} className="absolute inset-0 h-full w-full">
        <rect x=".3" y=".3" width="104.4" height="67.4" rx=".8" fill="#0D1511" stroke="#2C3C33" strokeWidth=".3" />
        <g fill="#111A15"><rect x="17.5" y=".5" width="17.5" height="67" /><rect x="52.5" y=".5" width="17.5" height="67" /><rect x="87.5" y=".5" width="0" height="67" /></g>
        <g fill="none" stroke="#2C3C33" strokeWidth=".3"><path d="M52.5 .3v67.4" /><circle cx="52.5" cy="34" r="9.15" /><rect x=".3" y="13.85" width="16.5" height="40.3" /><rect x="88.2" y="13.85" width="16.5" height="40.3" /><rect x=".3" y="24.85" width="5.5" height="18.3" /><rect x="99.2" y="24.85" width="5.5" height="18.3" /><path d="M16.8 26.7a9.15 9.15 0 0 1 0 14.6M88.2 26.7a9.15 9.15 0 0 0 0 14.6" /></g>
      </svg>
      {children}
    </div>
  );
}

function Sections({ ws }: { ws: AnalysisWorkspaceState | null }) {
  const { t: dict } = useLocale();
  const router = useRouter();
  const [view, setView] = useState<View>("team-overview");
  const [side, setSide] = useState<"home" | "away" | "both">("home");
  const [period, setPeriod] = useState<"FULL" | "H1" | "H2">("FULL");
  const [layers, setLayers] = useTacticsLayers();
  const [picking, setPicking] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [kits, setKits] = useState<RunTeams | null>(null);
  const [formRefresh, setFormRefresh] = useState(0);
  const runId = ws?.run?.id ?? null;
  const videoId = ws?.video?.id ?? null;
  useEffect(() => {
    setKits(null);
    if (runId) void api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups`).then(setKits, () => setKits(null));
  }, [runId]);
  const matchId = ws?.video?.match_id ?? null;
  useEffect(() => {
    setMatch(null);
    if (matchId) void api<Match>(`/v1/matches/${matchId}`).then(setMatch, () => setMatch(null));
  }, [matchId]);
  const calKey = ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join();
  const sides = heatSides(kits, match, dict);
  const sideGroups = side === "home" ? (sides[0]?.groups ?? []) : side === "away" ? (sides[1]?.groups ?? []) : [...(sides[0]?.groups ?? []), ...(sides[1]?.groups ?? [])];
  const shape = useTeamShape(runId, sideGroups, calKey);
  const sh = shape && shape !== "loading" && shape.moments > 0 ? shape : null;
  const formationsData = useFormations(videoId, period, formRefresh);
  const currentFormation = formationsData && formationsData !== "loading"
    ? formationsData.teams.find((t) => sideGroups.includes(t.kit_group)) ?? null : null;
  // a moment's button opens Analysis at that moment, where the video plays (this page has no video of its own)
  const openAt = (us: number) => { if (videoId) router.push(`/analysis?video=${videoId}&t=${Math.round(us / 100_000) / 10}`); };
  const confirmFormation = async (name: FormationName) => {
    if (!videoId || !sideGroups.length) return;
    try {
      await api(`/v1/videos/${videoId}/formations/confirm`, { method: "POST", json: { kit_group: sideGroups[0], period, formation: name } });
      setFormRefresh((k) => k + 1);
    } catch { /* the formation stays inferred; the button stays */ }
  };
  // B.8: the tab the link from Analysis asked for, matched by NAME (not by position) — ?tab=player-comparison used to open Transitions
  const params = useSearchParams();
  const askedTab = readTacticsContext(params).tabIndex;
  useEffect(() => {
    if (askedTab === null) return;
    const name = TACTIC_TABS[askedTab]!;
    if ((VIEWS as string[]).includes(name)) setView(name as View);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [askedTab]);
  const NM = dict.body.reports.notMeasured;
  const calDone = (ws?.pitch.list ?? []).some((r) => r.status === "SUCCEEDED");
  const trackDone = !!ws?.run;
  const lineupDone = (match?.roster.length ?? 0) > 0;
  const viewLabels: Record<View, string> = { "team-overview": dict.body.tactics.teamShape, "pass-network": dict.body.tactics.viewPassNetworks,
    "heat-zones": dict.body.tactics.viewHeatZones, "pressing-defense": dict.body.tactics.viewPressingDefence, "off-ball-runs": dict.body.tactics.viewOffBallRuns,
    transitions: dict.body.tactics.transitionsMenu, "player-comparison": dict.body.tactics.viewComparePlayers };
  const focus: Record<View, string> = { "team-overview": "p05-s02", "pass-network": "p05-s05", "heat-zones": "p05-s06",
    "pressing-defense": "p05-s07", "off-ball-runs": "p05-s08", transitions: "p05-s10", "player-comparison": "p05-s09" };
  const defLineFrac = currentFormation?.defensive_line_height_pct != null ? currentFormation.defensive_line_height_pct / 100 : null;
  const defLineX = defLineFrac != null ? (side === "away" ? 105 - defLineFrac * 105 : defLineFrac * 105) : null;
  const metric = (v: string | null) => v ?? NM;
  return (
    <div className="flex min-h-full w-full">
      {/* left: the views, and what Team shape still needs */}
      <aside className="side" aria-label={dict.body.tactics.viewsLabel}>
        <div className="ph"><h2 className="h3">{dict.body.tactics.viewsLabel}</h2></div>
        <nav className="sect" aria-label={dict.body.tactics.viewsLabel}>
          {VIEWS.map((v) => (
            <button key={v} type="button" onClick={() => setView(v)} aria-current={view === v ? "page" : undefined}
              className={`flex h-[34px] w-full items-center rounded-md px-2 text-left text-sm ${view === v ? "bg-raised font-medium" : "text-muted hover:text-ink"}`}>{viewLabels[v]}</button>
          ))}
        </nav>
        <div className="ph"><h2 className="h3">{dict.body.tactics.teamShapeNeeds}</h2></div>
        <div className="sect flex flex-col gap-2">
          {([[dict.body.tactics.needPitchCalibration, calDone], [dict.body.tactics.needTracking, trackDone], [dict.body.tactics.needLineups, lineupDone]] as const).map(([label, done]) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="text-sm text-muted">{label}</span>
              <span className="tag">{done ? dict.body.tactics.needDone : dict.body.tactics.needRequired}</span>
            </div>
          ))}
        </div>
      </aside>

      {/* centre: the view itself */}
      <main className="flex min-w-0 flex-1 flex-col gap-3 px-7 py-[18px]">
        {view === "team-overview" ? (
          <>
            <div className="flex flex-col gap-1">
              <h1 className="h2">{dict.body.tactics.teamShape}</h1>
              <p className="sub">{dict.body.tactics.teamShapeSub}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="eb">{dict.body.tactics.teamSegLabel}</span>
              <div className="seg" role="group" aria-label={dict.body.tactics.teamSegLabel}>
                {(["home", "away", "both"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setSide(s)} aria-pressed={side === s} className={side === s ? "on" : ""}>
                    {s === "home" ? dict.body.tactics.teamHome : s === "away" ? dict.body.tactics.teamAway : dict.body.tactics.teamBoth}
                  </button>
                ))}
              </div>
              <span className="eb">{dict.body.tactics.phaseLabel}</span>
              <div className="seg" role="group" aria-label={dict.body.tactics.phaseLabel}>
                <button type="button" aria-pressed className="on">{dict.body.tactics.inPossessionTitle}</button>
                <button type="button" disabled title={dict.body.tactics.notDetectedYet}>{dict.body.tactics.outOfPossessionTitle}</button>
              </div>
              <span className="eb">{dict.body.tactics.periodLabel}</span>
              <div className="seg" role="group" aria-label={dict.body.tactics.periodLabel}>
                {(["FULL", "H1", "H2"] as const).map((p) => (
                  <button key={p} type="button" onClick={() => setPeriod(p)} aria-pressed={period === p} className={period === p ? "on" : ""}>
                    {p === "FULL" ? dict.body.tactics.periodMatch : p === "H1" ? dict.body.tactics.periodFirst : dict.body.tactics.periodSecond}
                  </button>
                ))}
              </div>
            </div>
            <SotPitch labelledBy={sh ? dict.body.tactics.teamShape : dict.body.tactics.noTacticalData}>
              {sh && layers.avg && <ShapePicture shape={sh} />}
              {defLineX !== null && layers.lines && (
                <svg viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full">
                  <line x1={defLineX} y1={0} x2={defLineX} y2={68} stroke="#19e6a0" strokeWidth="0.35" strokeDasharray="1.2 0.8" />
                </svg>
              )}
              {sh?.width_m && sh?.length_m && layers.widthDepth && (
                <svg viewBox="0 0 105 68" preserveAspectRatio="none" aria-hidden className="absolute inset-0 h-full w-full">
                  <rect x={52.5 - sh.length_m.mean / 2} y={34 - sh.width_m.mean / 2} width={sh.length_m.mean} height={sh.width_m.mean}
                    fill="none" stroke="#19e6a0" strokeWidth="0.35" strokeDasharray="1.2 0.8" />
                </svg>
              )}
              {!sh && (
                <div className="absolute left-1/2 top-1/2 flex max-w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 rounded-[10px] border border-line2 bg-[rgba(15,17,20,.92)] px-[22px] py-[18px] text-center">
                  <span className="h3">{dict.body.tactics.noTacticalData}</span>
                  <span className="mu sm">{dict.body.tactics.noTacticalDataWhy}</span>
                  <button type="button" onClick={() => { if (videoId) router.push(`/analysis?video=${videoId}`); }} className="btn sm">{dict.body.workspace.openAnalysis}</button>
                </div>
              )}
            </SotPitch>
            <div className="grid items-center gap-2.5 px-1 py-1.5" style={{ gridTemplateColumns: "96px minmax(0, 1fr)" }}>
              <span className="eb">{dict.body.tactics.windowLabel}</span>
              <div className="relative h-[26px] rounded border border-line bg-p0">
                <span aria-hidden className="absolute rounded border border-[rgba(43,212,176,.4)] bg-[rgba(43,212,176,.08)]"
                  style={{ top: 0, bottom: 0, left: period === "H2" ? "50%" : 0, right: period === "H1" ? "50%" : 0 }} />
                <div className="ruler absolute inset-0 items-center px-2.5"><span>0&apos;</span><span>15&apos;</span><span>30&apos;</span><span>45&apos;</span><span>60&apos;</span><span>75&apos;</span><span>90&apos;</span></div>
              </div>
            </div>
          </>
        ) : view === "pass-network" ? (
          <PassNetworkPanel focus={focus[view]} match={match} />
        ) : view === "heat-zones" ? (
          <HeatZonesPanel focus={focus[view]} runId={runId} kits={kits} match={match} calKey={calKey} />
        ) : view === "pressing-defense" ? (
          <PressingPanel videoId={videoId} focus={focus[view] === "p05-s07"} match={match} onSeek={openAt} />
        ) : view === "off-ball-runs" ? (
          <OffBallRunsPanel focus={focus[view]} match={match} />
        ) : view === "transitions" ? (
          <TransitionsPanel videoId={videoId} focus={focus[view] === "p05-s10"} onSeek={openAt} />
        ) : (
          <PlayerComparison focus={focus[view] === "p05-s09"} match={match} />
        )}
      </main>

      {/* right: the Layers, Shape metrics and Compare inspector */}
      <aside className="insp" aria-label={dict.body.tactics.layersLabel}>
        <div className="ph"><h2 className="h3">{dict.body.tactics.layersLabel}</h2></div>
        <div className="sect flex flex-col gap-2.5">
          {([[dict.body.tactics.layerAvgPositions, layers.avg, (v: boolean) => setLayers({ ...layers, avg: v })],
            [dict.body.tactics.layerTeamLines, layers.lines, (v: boolean) => setLayers({ ...layers, lines: v })],
            [dict.body.tactics.layerWidthDepth, layers.widthDepth, (v: boolean) => setLayers({ ...layers, widthDepth: v })],
            [dict.body.tactics.layerShirtNumbers, layers.shirts, (v: boolean) => setLayers({ ...layers, shirts: v })]] as const).map(([label, on, set]) => (
            <div key={label} className="flex items-center gap-2.5">
              <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={() => set(!on)} className="sw" />
              <span className="sm flex-1">{label}</span>
            </div>
          ))}
        </div>
        <div className="ph"><h2 className="h3">{dict.body.tactics.shapeMetrics}</h2></div>
        <div className="sect">
          <dl className="kv">
            <dt>{dict.body.tactics.teamWidth}</dt><dd>{metric(sh?.width_m ? `${sh.width_m.mean.toFixed(0)} m` : null)}</dd>
            <dt>{dict.body.tactics.teamDepth}</dt><dd>{metric(sh?.length_m ? `${sh.length_m.mean.toFixed(0)} m` : null)}</dd>
            <dt>{dict.body.tactics.defLineHeightFull}</dt><dd>{metric(currentFormation?.defensive_line_height_m != null ? `${currentFormation.defensive_line_height_m} m` : null)}</dd>
            <dt>{dict.body.tactics.compactness}</dt><dd>{metric(sh?.compactness_m2 ? `${Math.round(sh.compactness_m2.mean)} m²` : null)}</dd>
          </dl>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {currentFormation && currentFormation.is_calibrated ? (
              <>
                <span className="t-section">{currentFormation.formation_display}</span>
                {currentFormation.state === "CONFIRMED" ? (
                  <span className="rounded bg-[rgba(16,185,129,0.18)] px-1.5 py-0.5 text-xs font-normal text-[#10b981]"
                    title={currentFormation.decided_by_name ? dict.body.tactics.confirmedByName.replace("{a}", currentFormation.decided_by_name) : dict.body.tactics.confirmedByAnalyst}>{dict.body.tactics.confirmedCheck}</span>
                ) : (
                  <button type="button" onClick={() => void confirmFormation(currentFormation.formation)}
                    className="rounded bg-[rgba(168,85,247,0.18)] px-1.5 py-0.5 text-xs font-normal text-[#a855f7]"
                    title={dict.body.tactics.clickConfirmFormation}>{dict.body.tactics.inferredConfirm}</button>
                )}
              </>
            ) : (
              <span title={currentFormation?.not_measured_reason ?? sh?.not_measured?.formation ?? dict.body.tactics.formationNotMeasured} className="t-section">—</span>
            )}
          </div>
        </div>
        <div className="ph"><h2 className="h3">{dict.body.tactics.compareTwoPlayers}</h2></div>
        <div className="sect">
          <div className="flex gap-2">
            <button type="button" onClick={() => setView("player-comparison")}
              className="h-16 flex-1 rounded-md border border-dashed border-line2 text-sm text-muted hover:border-primary/60 hover:text-ink">+ {dict.body.tactics.playerA}</button>
            <button type="button" onClick={() => setView("player-comparison")}
              className="h-16 flex-1 rounded-md border border-dashed border-line2 text-sm text-muted hover:border-primary/60 hover:text-ink">+ {dict.body.tactics.playerB}</button>
          </div>
          <p className="hint mt-2">{dict.body.tactics.compareConfirmedOnly}</p>
        </div>
        <div className="sect mt-auto flex gap-2">
          <button type="button" disabled className="btn flex-1">{dict.body.tactics.addToReport}</button>
          <button type="button" disabled className="btn flex-1">{dict.body.tactics.exportImage}</button>
        </div>
      </aside>
      <VideoPicker open={picking} onOpenChange={setPicking} current={videoId} basePath="/tactics" />
    </div>
  );
}

function WithVideo() {
  const ws = useAnalysisWorkspace();
  const ctx = readTacticsContext(useSearchParams());
  // B.8: the track the link from Analysis carried, selected once the run's tracks are loaded (the workspace itself opens at ?t=)
  const done = useRef(false);
  const ready = !!ws.tracks;
  useEffect(() => {
    if (done.current || !ready) return;
    done.current = true;
    if (ctx.trackId && ws.tracks!.some((t) => t.track_id === ctx.trackId)) ws.select(ctx.trackId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  return <Sections ws={ws} />;
}

export function TacticsStage() {
  const video = useSearchParams().get("video");
  const router = useRouter();
  const org = useAuth().organization?.organization_id;
  const valid = !!video && isUuid(video);
  // opened without a video: the one open on another page (v3 Phase 0, P9), else the newest analysed one
  useEffect(() => {
    if (valid) return;
    let live = true;
    void api<Video[]>("/v1/videos").then((vs) => {
      if (!live || !vs.length) return;
      const pick = pickVideo(org, vs, vs.find((v) => v.analysis?.status === "SUCCEEDED"));
      if (pick) router.replace(`/tactics?video=${pick.id}`, { scroll: false });
    }, () => undefined);
    return () => { live = false; };
  }, [valid, router, org]);
  if (!valid || !video) return <Sections ws={null} />;
  return <AnalysisWorkspace key={video} videoId={video}><WithVideo /></AnalysisWorkspace>;
}
