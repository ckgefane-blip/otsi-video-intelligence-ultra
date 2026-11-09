"use client";
/**
 * Page 04 Analysis Workspace on the approved composition (corrected reference 04_ANALYSIS_WORKSPACE). The video comes from the address
 * (?video=); without one the page opens on the newest video with a finished analysis, else the one being processed, else the newest.
 * Its playback, tracks and boxes come from the Analysis workspace hook (ADR-035), its linked match from GET /v1/matches/:id and the
 * teams of its tracks from the run's kit colour groups a person assigned.
 */
import type { Match, RunTeams, Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { VideoPicker } from "@/components/processing/VideoPicker";
import { DesignStage } from "@/components/stage/DesignStage";
import { groupsOf, teamCounts } from "@/components/tactics/teams";
import { api } from "@/lib/api";
import { isUuid } from "@/lib/identity";
import { readOverlays } from "@/lib/overlayPrefs";
import { CentreVideo } from "./CentreVideo";
import { LeftRail } from "./LeftRail";
import { PlayersPanel } from "./PlayersPanel";
import { ResizableColumns } from "./ResizableColumns";
import type { Shared } from "./shared";
import { TimelinePanel } from "./TimelinePanel";

function Sections({ ws }: { ws: AnalysisWorkspaceState | null }) {
  const [picking, setPicking] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [kits, setKits] = useState<RunTeams | null>(null);
  const [team, setTeam] = useState("all");
  const runId = ws?.run?.id ?? null, matchId = ws?.video?.match_id ?? null, videoId = ws?.video?.id ?? null;
  // the viewer's default overlays (Library left panel) are this page's starting choice
  useEffect(() => {
    if (!ws) return;
    const p = readOverlays();
    ws.setLayers({ ...ws.layers, boxes: p.boxes, labels: p.ids, ball: p.ball, trails: p.trails, shapes: p.shapes, heat: p.heat, passes: p.passes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);
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
  const s: Shared = { ws, match, setMatch, kits, team, setTeam, teams, teamGroups, onPick: () => setPicking(true) };
  return (
    <DesignStage page="analysis" background="#050d1c">
      <ResizableColumns left={<LeftRail s={s} />} centre={<><CentreVideo s={s} /><TimelinePanel s={s} /></>} right={<PlayersPanel s={s} />} />
      <VideoPicker open={picking} onOpenChange={setPicking} current={videoId} basePath="/analysis" />
    </DesignStage>
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
