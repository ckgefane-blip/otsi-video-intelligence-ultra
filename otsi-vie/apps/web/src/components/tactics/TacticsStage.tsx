"use client";
/**
 * Page 05 Tactical Intelligence on the approved composition (corrected reference 05_TACTICAL_INTELLIGENCE), in flow (Desktop UI Drop 2).
 * The video comes from the address (?video=); its playback, tracks and boxes come from the Analysis workspace hook (ADR-035) and its linked match from
 * GET /v1/matches/:id. Tactical measurements are not built, so those panels keep the reference's truthful empty state.
 *
 * v3 B.8 (ADR-085): the address may also carry the Analysis context (?tab=, ?t= seconds, ?track=): Tactical opens on that tab, at that
 * moment, with that track selected. Malformed values are ignored.
 *
 * The overlay switches are the one shared viewer preference (lib/overlayPrefs): the sidebar toggles and the preview's Labels button
 * write the same preference, and it drives the synced preview's boxes, labels and ball.
 */
import type { Match, RunTeams, Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { OverlaySync } from "@/components/analysis/WorkspacePlayer";
import { VideoPicker } from "@/components/processing/VideoPicker";
import { api } from "@/lib/api";
import { useOverlayPrefs } from "@/lib/overlayPrefs";
import { isUuid } from "@/lib/identity";
import { readTacticsContext } from "@/lib/tacticsLink";
import { AnalysisPanels, ShapePanels } from "./Panels";
import { PlayerComparison } from "./PlayerComparison";
import { SyncedPreview } from "./SyncedPreview";
import { TransitionsPanel } from "./TransitionsPanel";
import { TABS, TacticsHeader, TacticsTitleBar, type Layers } from "./TacticsHeader";
import { useLocale } from "@/lib/i18n";
import { groupsOf, teamCounts } from "./teams";

function Sections({ ws }: { ws: AnalysisWorkspaceState | null }) {
  const { t: dict } = useLocale();
  const [prefs, savePrefs] = useOverlayPrefs();
  const layers = useMemo<Layers>(() => ({ boxes: prefs.boxes, ids: prefs.ids, ball: prefs.ball }), [prefs]);
  const setLayers = useCallback((l: Layers) => savePrefs({ ...prefs, boxes: l.boxes, ids: l.ids, ball: l.ball }), [prefs, savePrefs]);
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
    const target = TABS(dict)[i]![1];
    setFocus(target);
    document.getElementById(target)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    setTimeout(() => setFocus((f) => (f === target ? null : f)), 1600);
  };
  // B.8: the tab the link from Analysis asked for, once
  const params = useSearchParams();
  const askedTab = readTacticsContext(params).tabIndex;
  useEffect(() => { if (askedTab !== null) choose(askedTab); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [askedTab]);
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
      <OverlaySync ws={ws} />
      <TacticsTitleBar match={match} teams={teams} team={team} setTeam={setTeam} tab={tab} setTab={choose} />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="min-w-0">
          <TacticsHeader video={ws?.video ?? null} match={match} tracks={ws?.tracks ?? null} finished={!!ws?.run}
            side={side} setSide={setSide} onPick={() => setPicking(true)} teams={teams} team={team} setTeam={setTeam} />
        </div>
        <main className="flex min-w-0 flex-col gap-4">
          <SyncedPreview ws={ws} layers={layers} setLayers={setLayers} teamGroups={teamGroups} />
          <ShapePanels focus={focus === "p05-s02"} runId={runId} videoId={ws?.video?.id ?? null} kits={kits} match={match} calKey={ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join()} />
          <AnalysisPanels focus={focus} match={match} runId={runId} kits={kits} calKey={ws?.pitch.list?.map((r) => `${r.id}:${r.status}`).join()} videoId={ws?.video?.id ?? null} onSeek={(t) => ws?.seek(t)} />
          <PlayerComparison focus={focus === "p05-s09"} match={match} />
          <TransitionsPanel videoId={ws?.video?.id ?? null} focus={focus === "p05-s10"} onSeek={(t) => ws?.seek(t)} />
        </main>
      </div>
      <VideoPicker open={picking} onOpenChange={setPicking} current={ws?.video?.id ?? null} basePath="/tactics" />
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
