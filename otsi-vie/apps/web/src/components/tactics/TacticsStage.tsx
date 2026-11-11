"use client";
/**
 * Page 05 Tactical Intelligence on the approved composition (corrected reference 05_TACTICAL_INTELLIGENCE). The video comes from the
 * address (?video=); its playback, tracks and boxes come from the Analysis workspace hook (ADR-035) and its linked match from
 * GET /v1/matches/:id. Tactical measurements are not built, so those panels keep the reference's truthful empty state.
 *
 * v3 B.8 (ADR-085): the address may also carry the Analysis context (?tab=, ?t= seconds, ?track=): Tactical opens on that tab, at that
 * moment, with that track selected. Malformed values are ignored.
 */
import type { Match, RunTeams, Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { VideoPicker } from "@/components/processing/VideoPicker";
import { DesignStage } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { DEFAULT_OVERLAYS, readOverlays } from "@/lib/overlayPrefs";
import { isUuid } from "@/lib/identity";
import { readTacticsContext } from "@/lib/tacticsLink";
import { AnalysisPanels, ShapePanels } from "./Panels";
import { PlayerComparison } from "./PlayerComparison";
import { SyncedPreview } from "./SyncedPreview";
import { TransitionsPanel } from "./TransitionsPanel";
import { TABS, TacticsHeader, type Layers } from "./TacticsHeader";
import { useLocale } from "@/lib/i18n";
import { groupsOf, teamCounts } from "./teams";

function Sections({ ws }: { ws: AnalysisWorkspaceState | null }) {
  const { t: dict } = useLocale();
  const [layers, setLayers] = useState<Layers>(DEFAULT_OVERLAYS);
  useEffect(() => { setLayers(readOverlays()); }, []);                     // the viewer's default overlays (Library left panel)
  const [tab, setTab] = useState(0);
  const [side, setSide] = useState(0);
  const [picking, setPicking] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [kits, setKits] = useState<RunTeams | null>(null);
  const [team, setTeam] = useState("all");
  const runId = ws?.run?.id ?? null;
  useEffect(() => {
    setKits(null); setTeam("all");
    if (runId) void api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups`).then(setKits, () => setKits(null));
  }, [runId]);
  const matchId = ws?.video?.match_id ?? null;
  useEffect(() => {
    setMatch(null);
    if (matchId) void api<Match>(`/v1/matches/${matchId}`).then(setMatch, () => setMatch(null));
  }, [matchId]);
  const teams = useMemo(() => teamCounts(kits, match), [kits, match]);
  const teamGroups = useMemo(() => groupsOf(kits, team), [team, kits]);
  const choose = (i: number) => {
    setTab(i);
    const target = TABS(dict)[i]![2];
    setFocus(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => setFocus((f) => (f === target ? null : f)), 1600);
  };
  // B.8: the tab the link from Analysis asked for, once
  const params = useSearchParams();
  const askedTab = readTacticsContext(params).tabIndex;
  useEffect(() => { if (askedTab !== null) choose(askedTab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [askedTab]);
  return (
    <DesignStage page="tactics" background="#050d1c">
      <TacticsHeader video={ws?.video ?? null} match={match} tracks={ws?.tracks ?? null} finished={!!ws?.run} layers={layers} setLayers={setLayers}
        tab={tab} setTab={choose} side={side} setSide={setSide} onPick={() => setPicking(true)} teams={teams} team={team} setTeam={setTeam} />
      <ShapePanels focus={focus === "p05-s02"} runId={runId} videoId={ws?.video?.id ?? null} kits={kits} match={match} calKey={ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join()} />
      <SyncedPreview ws={ws} layers={layers} setLayers={setLayers} teamGroups={teamGroups} />
      <AnalysisPanels focus={focus} match={match} runId={runId} kits={kits} calKey={ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join()} videoId={ws?.video?.id ?? null} onSeek={(t) => ws?.seek(t)} />
      <PlayerComparison focus={focus === "p05-s09"} match={match} />
      <TransitionsPanel videoId={ws?.video?.id ?? null} focus={focus === "p05-s10"} onSeek={(t) => ws?.seek(t)} />
      <VideoPicker open={picking} onOpenChange={setPicking} current={ws?.video?.id ?? null} basePath="/tactics" />
    </DesignStage>
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
