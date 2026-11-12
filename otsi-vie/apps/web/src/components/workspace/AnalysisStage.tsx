"use client";
/**
 * Page 06 Analysis (SOT, Analysis.dc.html).
 *
 * The video comes from the address (?video=); without one the page opens on
 * the newest video with a finished analysis, else the one being processed,
 * else the newest. Its playback, tracks and boxes come from the Analysis
 * workspace hook (ADR-035), its linked match from GET /v1/matches/:id and
 * the teams of its tracks from the run's kit colour groups. The layout is
 * the SOT three-column body (identities | video + timeline | inspector)
 * under the app shell — no page header, no video picker: the top bar's
 * Project / Match / Player pickers switch the video. The Identify and
 * Marker dialogs live here so the centre tool bar and the inspector both
 * open them.
 */
import type { Match, RunTeams, Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { groupsOf, teamCounts } from "@/components/tactics/teams";
import { api } from "@/lib/api";
import { isUuid } from "@/lib/identity";
import { AnalysisCentre, MarkerDialog } from "@/components/analysis/AnalysisCentre";
import { AnalysisLeft } from "@/components/analysis/AnalysisLeft";
import { AnalysisRight } from "@/components/analysis/AnalysisRight";
import { AnalysisTimeline } from "@/components/analysis/AnalysisTimeline";
import { OverlaySync } from "@/components/analysis/WorkspacePlayer";
import { IdentifyDialog } from "@/components/workspace/IdentifyDialog";
import type { Shared } from "@/components/workspace/shared";

function Sections({ ws }: { ws: AnalysisWorkspaceState | null }) {
  const [match, setMatch] = useState<Match | null>(null);
  const [kits, setKits] = useState<RunTeams | null>(null);
  const [team, setTeam] = useState("all");
  const [identifyOpen, setIdentifyOpen] = useState(false);
  const [markerOpen, setMarkerOpen] = useState(false);
  const [markersVersion, setMarkersVersion] = useState(0);
  const runId = ws?.run?.id ?? null, matchId = ws?.video?.match_id ?? null;
  useEffect(() => {
    setKits(null); setTeam("all");
    if (runId) void api<RunTeams>(`/v1/analysis-runs/${runId}/kit-groups`).then(setKits, () => setKits(null));
  }, [runId]);
  useEffect(() => {
    setMatch(null);
    if (matchId) void api<Match>(`/v1/matches/${matchId}`).then(setMatch, () => setMatch(null));
  }, [matchId]);
  const teams = useMemo(() => teamCounts(kits, match), [kits, match]);
  const teamGroups = useMemo(() => groupsOf(kits, team), [kits, team]);
  const s: Shared = { ws, match, setMatch, kits, team, setTeam, teams, teamGroups, onPick: () => undefined };
  const openMarker = () => setMarkerOpen(true);
  const openIdentify = () => setIdentifyOpen(true);
  return (
    <div className="flex min-h-full w-full" data-stage="analysis" data-page="analysis">
      <OverlaySync ws={ws} />
      <AnalysisLeft s={s} />
      <main className="flex min-w-0 flex-1 flex-col gap-2 overflow-y-auto bg-canvas p-2.5">
        <AnalysisCentre s={s} onMarker={openMarker} onIdentify={openIdentify} />
        <AnalysisTimeline s={s} markersVersion={markersVersion} />
      </main>
      <AnalysisRight s={s} onIdentify={openIdentify} />
      {ws?.video && (
        <IdentifyDialog open={identifyOpen} onOpenChange={setIdentifyOpen} />
      )}
      <MarkerDialog open={markerOpen} onOpenChange={setMarkerOpen} videoId={ws?.video?.id ?? null} atUs={ws?.timeUs ?? 0}
        onAdded={() => setMarkersVersion((v) => v + 1)} />
    </div>
  );
}

function WithVideo() {
  return <Sections ws={useAnalysisWorkspace()} />;
}

export function AnalysisStage() {
  const video = useSearchParams().get("video");
  const router = useRouter();
  const org = useAuth().organization?.organization_id;
  const valid = !!video && isUuid(video);
  useEffect(() => {
    if (valid) return;
    let live = true;
    void api<Video[]>("/v1/videos").then((vs) => {
      if (!live || !vs.length) return;
      const analysed = vs.find((v) => v.analysis?.status === "SUCCEEDED");
      const busy = vs.find((v) => v.analysis?.status === "RUNNING" || v.analysis?.status === "QUEUED" || v.job?.state === "RUNNING" || v.job?.state === "QUEUED");
      // the video open on another page first (v3 Phase 0, P9), else the newest analysed one
      router.replace(`/analysis?video=${pickVideo(org, vs, analysed ?? busy ?? vs[0])!.id}`, { scroll: false });
    }, () => undefined);
    return () => { live = false; };
  }, [valid, router, org]);
  if (!valid || !video) return <Sections ws={null} />;
  return <AnalysisWorkspace key={video} videoId={video}><WithVideo /></AnalysisWorkspace>;
}
