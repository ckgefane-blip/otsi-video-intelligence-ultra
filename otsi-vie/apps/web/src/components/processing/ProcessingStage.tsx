"use client";
/**
 * Page 03 AI Processing on the approved composition (corrected reference 03_AI_PROCESSING). The video comes from the address
 * (?video=); its data and actions come from the shared hooks (useProcessing for the run, useAnalysisWorkspace for playback, boxes and
 * tracks, ADR-035), so this page and the per-video views show the same run. Opened without a video it follows the work that is processing (else the
 * newest video); the reference's empty state shows only when there is no video at all.
 */
import type { Video } from "@otsi-vie/contracts";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AnalysisWorkspace, useAnalysisWorkspace, type AnalysisWorkspaceState } from "@/components/analysis/AnalysisWorkspace";
import { ProcessingProvider, useProcessing, type ProcessingState } from "@/components/analysis/ProcessingView";
import { DesignStage } from "@/components/stage/DesignStage";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useAuth } from "@/components/auth/AuthProvider";
import { pickVideo } from "@/lib/currentVideo";
import { DetectionTiles, eventCount } from "./DetectionTiles";
import { JobCard } from "./JobCard";
import { JOB_TABLE_EXTRA, JobTable, useVideoJobs } from "./JobTable";
import { LogPanel } from "./LogPanel";
import { ribbon } from "./model";
import { PipelineStages } from "./PipelineStages";
import { PreviewPanel } from "./PreviewPanel";
import { TimelineSummary } from "./TimelineSummary";
import { RunDialog } from "./RunDialog";
import { VideoPicker } from "./VideoPicker";

/** a count from a finished run's result, or null when it is not recorded */
const num = (r: unknown, k: string) => { const v = (r as Record<string, unknown> | null | undefined)?.[k]; return typeof v === "number" ? v : null; };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Sections({ p, ws }: { p: ProcessingState | null; ws: AnalysisWorkspaceState | null }) {
  const { t: dict } = useLocale();
  const [picking, setPicking] = useState(false);
  const [running, setRunning] = useState(false);
  const [hasVideos, setHasVideos] = useState<boolean | null>(null);
  const [logStep, setLogStep] = useState<string | null>(null);              // a ribbon click filters the log to that step (A.4)
  const jobs = useVideoJobs(p?.video?.id ?? null);
  const ev = ws?.events.data ?? null;
  const steps = ribbon({ run: p?.run ?? null, finishedRunId: ws?.run?.status === "SUCCEEDED" ? ws.run.id : null, ball: ws?.ball.path?.track ?? null,
    pitch: ws?.pitch.list ?? null, events: ev ? { state: ev.state, ball_track_id: ev.ball_track_id } : null, jobs: jobs.list?.jobs ?? null }, dict.body.processing);
  useEffect(() => {
    if (p) return;
    void api<Video[]>("/v1/videos").then((v) => setHasVideos(v.length > 0), () => setHasVideos(null));
  }, [p]);
  return (
    <DesignStage page="processing" background="#050d1c" extra={JOB_TABLE_EXTRA}>
      <JobCard p={p} hasVideos={hasVideos} onPick={() => setPicking(true)} onRun={() => setRunning(true)} />
      <PipelineStages steps={steps} selected={logStep} onSelect={setLogStep} />
      <PreviewPanel ws={ws} onPick={() => setPicking(true)} />
      <DetectionTiles run={p?.run ?? null} finishedRunId={ws?.run?.id ?? null} tracks={ws?.tracks ?? null} videoId={p?.video?.id ?? null} events={ws?.events.data ?? null}
        totals={{ people: num(ws?.run?.result, "person_tracks"), ball: num(ws?.run?.result, "ball_tracks") }} />
      <div data-pro className="contents"><LogPanel runs={p?.runs ?? null} jobs={jobs.list?.jobs ?? null} step={logStep} onStep={setLogStep} /></div>
      <TimelineSummary run={p?.run ?? null} durationUs={p?.video?.duration_us ?? null} events={eventCount(ws?.events.data ?? null)} />
      <div data-pro className="contents"><JobTable list={jobs.list} reload={jobs.reload} /></div>
      <VideoPicker open={picking} onOpenChange={setPicking} current={p?.video?.id ?? null} />
      {p && <RunDialog p={p} open={running} onOpenChange={setRunning} />}
    </DesignStage>
  );
}

function WithRun() {
  return <Sections p={useProcessing()} ws={useAnalysisWorkspace()} />;
}

/** the workspace (tracks, boxes) follows the run: a run that finishes while the page is open is read at once, not on the next visit */
function FollowRun({ videoId }: { videoId: string }) {
  const p = useProcessing();
  const done = p.runs?.find((r) => r.status === "SUCCEEDED")?.id ?? null;
  return <AnalysisWorkspace videoId={videoId} finishedRunId={done}><WithRun /></AnalysisWorkspace>;
}

export function ProcessingStage() {
  const video = useSearchParams().get("video");
  const router = useRouter();
  const valid = !!video && UUID.test(video);
  const org = useAuth().organization?.organization_id;
  // a page named Processing opens on what is processing: the video with a job or analysis moving, else the one open on another page
  // (v3 Phase 0, P9), else the newest one
  useEffect(() => {
    if (valid) return;
    let live = true;
    void api<Video[]>("/v1/videos").then((vs) => {
      if (!live || !vs.length) return;
      const busy = vs.find((v) => v.analysis?.status === "RUNNING" || v.analysis?.status === "QUEUED" || v.job?.state === "RUNNING" || v.job?.state === "QUEUED" || v.state === "VALIDATING" || v.state === "PENDING");
      router.replace(`/processing?video=${(busy ?? pickVideo(org, vs, vs[0])!).id}`, { scroll: false });
    }, () => undefined);
    return () => { live = false; };
  }, [valid, router, org]);
  if (!valid || !video) return <Sections p={null} ws={null} />;
  return (
    <ProcessingProvider key={video} videoId={video}>
      <FollowRun videoId={video} />
    </ProcessingProvider>
  );
}
