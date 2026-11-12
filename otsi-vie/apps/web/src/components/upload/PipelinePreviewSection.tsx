"use client";
/**
 * Page 02 Section 10 — processing pipeline preview strip, on the Desktop UI flow layout.
 *
 * The real stages of the selected upload (or of the file uploading now):
 *   1 Uploading       this page's resumable transfer (pause / resume / cancel), then the ingest worker's check of the file
 *   2 AI Detection    the DETECT step of the video's latest analysis run; before any run, "Analyse this video" opens Processing
 *   3 Tracking        the TRACK step
 *   4 Indexing        not built yet
 *   5 Analysis Ready  the run finished: open it in the Analysis workspace
 * The live preview row shows the same progress per output (people and ball come from detection, teams from the appearance step,
 * metadata from the ingest probe) over the video's own frame.
 */
import type { AnalysisRun, Video } from "@otsi-vie/contracts";
import { CheckCircle2, CircleDashed, Loader2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";
import { notBuilt } from "@/lib/devMode";
import { useLocale, type Dictionary } from "@/lib/i18n";

/** The dictionary subsection these words come from (ADR-139 Group A). */
type UploadDict = Dictionary["body"]["upload"];

type State = "done" | "busy" | "bad" | "todo" | "unbuilt";
interface Stage { name: string; state: State; progress: number | null; status: string; action?: ReactNode }

const step = (run: AnalysisRun | null, name: string) => run?.steps.find((s) => s.name === name) ?? null;
/** a run step's stage for a dictionary (ADR-139 Group A); without one it stays English. */
function stepStage(run: AnalysisRun | null, name: string, title: string, d?: UploadDict): Stage {
  const s = step(run, name);
  if (!run || !s) return { name: title, state: "todo", progress: null, status: run ? (d?.queued ?? "Queued") : (d?.waitingDots ?? "Waiting...") };
  if (s.status === "SUCCEEDED") return { name: title, state: "done", progress: 100, status: d?.done ?? "Done" };
  if (s.status === "RUNNING") return { name: title, state: "busy", progress: s.progress, status: `${Math.round(s.progress)}%` };
  if (s.status === "FAILED") return { name: title, state: "bad", progress: s.progress, status: `${d?.failed ?? "Failed"}${s.error_code ? ` (${s.error_code})` : ""}` };
  if (s.status === "CANCELLED") return { name: title, state: "bad", progress: null, status: d?.cancelled ?? "Cancelled" };
  return { name: title, state: "todo", progress: null, status: d?.queued ?? "Queued" };
}

const STAGE_ICON = { done: <CheckCircle2 className="h-4 w-4 text-ok" />, busy: <Loader2 className="h-4 w-4 animate-spin text-cyan" />, bad: <AlertTriangle className="h-4 w-4 text-danger" />, todo: <CircleDashed className="h-4 w-4 text-muted" />, unbuilt: <CircleDashed className="h-4 w-4 text-muted/60" /> };

function StageCard({ stage, num, lines, children }: { stage: Stage; num: string; lines?: [string, string]; children?: ReactNode }) {
  return (
    <li className="rounded-ctl border border-line/70 bg-raised/40 p-3" data-stage={stage.name} data-stage-state={stage.state}>
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-panel text-sm font-semibold">
          {stage.state === "done" ? "✓" : num}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{stage.name}</span>
        {STAGE_ICON[stage.state]}
      </div>
      {lines && <p className="mt-1.5 text-xs text-muted">{lines[0]}<br />{lines[1]}</p>}
      <div className="mt-2">
        {children ?? <span className={`text-xs ${stage.state === "bad" ? "text-danger" : stage.state === "done" ? "text-ok" : stage.state === "busy" ? "text-cyan" : "text-muted"}`}>{stage.status}</span>}
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-line/60">
        <div className={`h-full rounded ${stage.state === "done" ? "bg-ok" : "bg-primary"}`} style={{ width: `${Math.min(100, stage.progress ?? 0)}%` }} />
      </div>
    </li>
  );
}

export function PipelinePreviewSection() {
  const { t: dict } = useLocale();
  const d = dict.body.upload;
  const { selected, transfers, videos, pause, resume, cancel } = useUpload();
  const { runs, reloadRuns, say } = usePage02();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const transfer = transfers.find((t) => t.state !== "done") ?? (selected ? transfers.find((t) => t.videoId === selected.id) : undefined) ?? null;
  const v: Video | null = selected ?? (transfer?.videoId ? (videos ?? []).find((x) => x.id === transfer.videoId) ?? null : null);
  const run = runs?.[0] ?? null;
  const runActive = !!run && (run.status === "QUEUED" || run.status === "RUNNING");
  // one honest overall figure: the worker's own progress on the run (detection and tracking run through the whole match), with its message
  const overall = run ? (run.status === "SUCCEEDED" ? 100 : run.status === "RUNNING" ? (run.job?.progress ?? 0) : 0) : null;
  const overallText = !run ? null
    : run.status === "RUNNING" ? (run.job?.stage_message ?? d.analysing)
    : run.status === "QUEUED" ? d.analysisWaiting
    : run.status === "SUCCEEDED" ? d.analysisFinished
    : run.status === "FAILED" ? `${d.analysisFailed}${run.failure_code ? ` (${run.failure_code})` : ""}` : d.analysisCancelled;
  const cancelRun = () => {
    setConfirmCancel(false);
    if (!run) return;
    void api(`/v1/analysis-runs/${run.id}/cancel`, { method: "POST" }).then(
      async () => { await reloadRuns(); say(d.analysisCancelledNote); },
      (x) => say(x instanceof ApiProblem ? x.message : d.couldNotCancelAnalysis, true));
  };
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    setThumb(null);
    if (!v?.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${v.id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setThumb(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [v?.id, v?.has_thumbnail]);

  // 1: uploading and the ingest check
  const tPct = transfer?.progress ? Math.floor((100 * transfer.progress.sentBytes) / transfer.progress.totalBytes) : null;
  const upload: Stage = transfer && transfer.state !== "done"
    ? { name: d.uploading, state: transfer.state === "error" ? "bad" : "busy", progress: tPct ?? 0,
        status: transfer.state === "paused" ? d.pausedAt.replace("{n}", String(tPct ?? 0)) : transfer.state === "error" ? (transfer.error ?? d.stopped) : d.uploadingPct.replace("{n}", String(tPct ?? 0)) }
    : !v ? { name: d.uploading, state: "todo", progress: null, status: d.awaitingUpload }
    : v.state === "PENDING" ? { name: d.uploading, state: "busy", progress: v.upload ? (100 * v.upload.received_bytes) / v.upload.expected_bytes : 0, status: d.uploadNotFinished }
    : v.state === "VALIDATING" ? (v.job?.state === "QUEUED"
        ? { name: d.uploading, state: "busy", progress: 0, status: d.waitingForWorker }
        : { name: d.uploading, state: "busy", progress: v.job?.progress ?? 0, status: v.job ? d.checkingFilePct.replace("{n}", String(Math.round(v.job.progress))) : d.checkingFilePct.split("{n}")[0]!.trimEnd() })
    : v.state === "INGESTED" ? { name: d.uploading, state: "done", progress: 100, status: d.uploadedVerified }
    : { name: d.uploading, state: "bad", progress: 100, status: v.failure_code ?? d.refused };

  const ready = v?.state === "INGESTED";
  const detect = ready && !run
    ? { name: d.aiDetection, state: "todo" as State, progress: null, status: d.notStarted,
        action: <Link href={`/processing?video=${v!.id}`} className="font-semibold text-primary">{d.analyseThisVideo}</Link> }
    : stepStage(run, "DETECT", d.aiDetection, d);
  const track = stepStage(run, "TRACK", d.tracking, d);
  const index: Stage = { name: d.indexing, state: "unbuilt", progress: null, status: notBuilt() };
  const done: Stage = run?.status === "SUCCEEDED"
    ? { name: d.analysisReady, state: "done", progress: 100, status: d.ready, action: <Link href={`/videos/${v!.id}/analyze`} className="font-semibold text-primary">{d.openAnalysis}</Link> }
    : { name: d.analysisReady, state: run?.status === "FAILED" ? "bad" : "todo", progress: null, status: run?.status === "FAILED" ? `${d.runFailed}${run.failure_code ? ` (${run.failure_code})` : ""}` : d.waitingDots };
  const stages = [detect, track, index, done];
  const cardLines: [string, string][] = [[d.cardDetecting, d.cardDetecting2], [d.cardTracking, d.cardTracking2], [d.cardIndexing, d.cardIndexing2], [d.cardReady, d.cardReady2]];

  const identify = stepStage(run, "IDENTIFY", d.teamIdentification, d);
  const live: [string, number | null][] = [
    [d.playerDetection, detect.progress], [d.ballTrackingLabel, detect.progress],
    [d.teamIdentification, identify.progress], [d.metadata, v ? (v.state === "INGESTED" ? 100 : v.state === "VALIDATING" ? v.job?.progress ?? 0 : 0) : null],
  ];

  const chip = "rounded-ctl border border-line px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50";
  return (
    <section aria-label={d.processingPipeline} data-section="p02-s10" className="vie-panel">
      <div className="vie-ph flex-wrap gap-2 py-2">
        <h2 className="t-panel">{d.processingPipeline}</h2>
        {run && overall !== null && (
          <div className="flex min-w-0 flex-1 items-center gap-2" role="progressbar" aria-label={d.analysisProgress} aria-valuenow={Math.round(overall)} aria-valuemin={0} aria-valuemax={100} data-analysis-status={run.status}>
            <span className={`max-w-[190px] truncate text-sm ${run.status === "FAILED" ? "text-danger" : "text-ink2"}`}>{overallText}</span>
            <span className="h-2 min-w-16 flex-1 overflow-hidden rounded bg-line/60"><i className={`block h-full rounded ${run.status === "SUCCEEDED" ? "bg-ok" : run.status === "FAILED" || run.status === "CANCELLED" ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.min(100, Math.max(run.status === "RUNNING" ? 1 : 0, overall))}%` }} /></span>
            <span className={`text-sm font-semibold ${run.status === "SUCCEEDED" ? "text-ok" : "text-primary"}`}>{run.status === "QUEUED" || run.status === "CANCELLED" ? "—" : `${overall < 10 && overall > 0 ? overall.toFixed(1) : Math.round(overall)}%`}</span>
            {v && <Link href={`/processing?video=${v.id}`} className="whitespace-nowrap text-sm font-semibold text-primary">{d.followInProcessing}</Link>}
          </div>
        )}
        {runActive && (
          <span className="flex items-center gap-2 text-sm">
            {confirmCancel ? (
              <>
                <span className="text-amber">{d.cancelAnalysisQ}</span>
                <button type="button" aria-label={d.confirmCancelAnalysis} onClick={cancelRun} className="font-semibold text-danger">{d.yes}</button>
                <button type="button" onClick={() => setConfirmCancel(false)} className="text-ink2">{d.no}</button>
              </>
            ) : (
              <button type="button" aria-label={d.cancelAnalysis} onClick={() => setConfirmCancel(true)} className="rounded-full border border-danger/50 px-3 py-1 text-danger">{d.cancelAnalysis}</button>
            )}
          </span>
        )}
      </div>
      <ol aria-label={d.processingPipeline} className="grid grid-cols-1 gap-2 p-3 sm:grid-cols-2 xl:grid-cols-5">
        <li data-stage="Uploading" data-stage-state={upload.state} data-transfer-state={transfer?.state ?? ""} className="rounded-ctl border border-primary/60 bg-primary/5 p-3">
          <div className="flex items-center gap-2">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-line bg-panel text-sm font-semibold">{upload.state === "done" ? "✓" : "1"}</span>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-primary">{d.uploading}</span>
            {STAGE_ICON[upload.state]}
          </div>
          <p className="mt-1.5 truncate text-xs text-muted">{transfer && transfer.state !== "done" ? transfer.file.name : v ? (v.title ?? v.original_filename ?? dict.body.processing.videoFallback) : d.noFileUploaded}</p>
          <p className={`mt-0.5 truncate text-xs ${upload.state === "bad" ? "text-danger" : "text-ink2"}`}>
            {transfer && transfer.state !== "done" ? `${upload.status} · ${formatBytes(transfer.file.size)}` : upload.status}
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded bg-line/60">
            <div className={`h-full rounded ${upload.state === "bad" ? "bg-danger" : "bg-primary"}`} style={{ width: `${Math.min(100, upload.progress ?? 0)}%` }} />
          </div>
          {transfer && transfer.state !== "done" && (
            <span className="mt-2 flex gap-1.5">
              {transfer.state === "sending"
                ? <button type="button" aria-label={d.pauseFile.replace("{name}", transfer.file.name)} onClick={() => pause(transfer.id)} className={chip}>{d.pause}</button>
                : <button type="button" aria-label={d.resumeFile.replace("{name}", transfer.file.name)} onClick={() => resume(transfer.id)} className={chip}>{d.resume}</button>}
              <button type="button" aria-label={d.cancelFile.replace("{name}", transfer.file.name)} onClick={() => void cancel(transfer)} className={chip}>{dict.common.cancel}</button>
            </span>
          )}
        </li>
        {stages.map((st, i) => (
          <StageCard key={st.name} stage={st} num={String(i + 2)} lines={cardLines[i]!}>
            {st.action ?? undefined}
          </StageCard>
        ))}
      </ol>
      <div className="border-t border-line/60 p-3">
        <p className="t-panel mb-2">{d.livePreview}</p>
        <ul aria-label={d.livePreview} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {live.map(([label, p]) => (
            <li key={label} data-output={label} data-progress={p === null ? "" : String(Math.round(p))} className="overflow-hidden rounded-ctl border border-line/70">
              <div className="relative h-[74px] bg-raised">
                {thumb && <img src={thumb} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                {p === 100 && <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-ok" aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-xs">{label}</span>
                <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded bg-line/60">
                  <i className={`block h-full rounded ${p === 100 ? "bg-ok" : "bg-primary"}`} style={{ width: `${Math.min(100, p ?? 0)}%` }} />
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
