"use client";
/**
 * Page 04 Analysis Workspace, in flow (Desktop UI Drop 2). The video comes from the address (?video=); without one the page opens on
 * the newest video with a finished analysis, else the one being processed, else the newest. Its playback, tracks and boxes come from
 * the Analysis workspace hook (ADR-035), its linked match from GET /v1/matches/:id and the teams of its tracks from the run's kit
 * colour groups a person assigned. The layout is the Drop 1 flow grid (left rail | centre video + timeline | right players), not
 * the 2560-px DesignStage composition; the data layer, the routes and every control are the same.
 */
import type { Match, RunTeams, Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { VideoPicker } from "@/components/processing/VideoPicker";
import { groupsOf, teamCounts } from "@/components/tactics/teams";
import { api } from "@/lib/api";
import { isUuid } from "@/lib/identity";
import { useLocale } from "@/lib/i18n";
import { ActionsMenu } from "@/components/media/ActionsMenu";
import { copyLink, type MoreItem } from "@/components/stage/MoreMenu";
import { tacticsHref } from "@/lib/tacticsLink";
import { AnalysisCentre } from "@/components/analysis/AnalysisCentre";
import { AnalysisLeft } from "@/components/analysis/AnalysisLeft";
import { AnalysisRight } from "@/components/analysis/AnalysisRight";
import { AnalysisTimeline } from "@/components/analysis/AnalysisTimeline";
import { OverlaySync } from "@/components/analysis/WorkspacePlayer";
import type { Shared } from "@/components/workspace/shared";

function Sections({ ws }: { ws: AnalysisWorkspaceState | null }) {
  const { t: dict } = useLocale();
  const [picking, setPicking] = useState(false);
  const [match, setMatch] = useState<Match | null>(null);
  const [kits, setKits] = useState<RunTeams | null>(null);
  const [team, setTeam] = useState("all");
  const runId = ws?.run?.id ?? null, matchId = ws?.video?.match_id ?? null, videoId = ws?.video?.id ?? null;
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
  const video = ws?.video ?? null;
  const more: MoreItem[] = video ? [
    { label: dict.body.workspace.openInTactical, href: tacticsHref({ videoId: video.id, tab: "team-overview", timeUs: ws?.timeUs ?? null, trackId: ws?.selectedId ?? null }) },
    { label: dict.body.workspace.processingArrow, href: `/processing?video=${video.id}` },
    { label: dict.body.workspace.reviewIdentitiesTeams, href: `/videos/${video.id}/analyze` },
    { label: "Copy link", run: () => copyLink(`/analysis?video=${video.id}`) },
  ] : [{ label: dict.body.workspace.openInTactical, why: dict.body.analysis.chooseVideo }];
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="analysis" style={{ "--u": "1px" } as CSSProperties}>
      <OverlaySync ws={ws} />
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="t-page">{dict.nav.analysis}</h1>
        <span className="text-sm text-muted">{video ? (video.title ?? video.original_filename ?? "") : dict.body.workspace.noVideoLoaded}</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setPicking(true)} className="vie-btn vie-btn-sm">{dict.body.workspace.chooseMatchVideo}</button>
          <ActionsMenu label="More actions" items={more} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[340px_minmax(0,1fr)_360px]">
        <AnalysisLeft s={s} />
        <div className="flex min-w-0 flex-col gap-4">
          <AnalysisCentre s={s} />
          <AnalysisTimeline s={s} />
        </div>
        <AnalysisRight s={s} />
      </div>
      <VideoPicker open={picking} onOpenChange={setPicking} current={videoId} basePath="/analysis" />
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
