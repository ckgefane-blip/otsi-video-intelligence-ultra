"use client";
/**
 * Page 03 Section 02 — title and processing job card, on the Desktop UI flow layout.
 *
 * The card shows the selected video and its latest analysis run as recorded: the video's thumbnail, the run's profile and frame rate,
 * the run status and the worker's own progress. The blue line is the next real action: choose or upload a video, start the analysis,
 * cancel it while it runs, or open the finished analysis. The title opens the video chooser.
 */
import { PROFILES } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProcessingState } from "@/components/analysis/ProcessingView";
import { apiBlob, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { isActive, PILL, runLabel, runProgress, pct } from "./model";

function Thumb({ videoId, has }: { videoId: string | null; has: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!videoId || !has) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${videoId}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [videoId, has]);
  if (src) return <img src={src} alt="" className="h-[88px] w-[88px] shrink-0 rounded-full border border-line object-cover" />;
  return <div className="h-[88px] w-[88px] shrink-0 rounded-full border border-line bg-raised" />;
}

export function JobCard({ p, hasVideos, onPick, onRun }: { p: ProcessingState | null; hasVideos: boolean | null; onPick: () => void; onRun: () => void }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const up = dict.body.upload;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const video = p?.video ?? null, run = p?.run ?? null;
  const status = runLabel(run, d);
  const pillTone = run?.status === "SUCCEEDED" ? PILL.DONE : run?.status === "FAILED" ? PILL.FAILED
    : run && !isActive(run) ? PILL.WAITING : { background: "#1580ff", color: "#fff" };
  const progress = runProgress(run);

  const line1 = p?.error ? p.error : !video ? d.noJob : !run ? d.notAnalysedYet
    : d.analysisLine.replace("{profile}", run.config.profile ? PROFILES[run.config.profile].label : "custom").replace("{fps}", String(run.config.sample_fps));
  const title = video ? (video.title ?? video.original_filename ?? up.untitledVideo) : p ? dict.common.loading : up.noVideoSelected;

  const cancel = () => {
    setBusy(true); setMsg(null);
    void p!.cancel().catch((x) => setMsg(x instanceof ApiProblem ? x.message : d.couldNotCancel)).finally(() => setBusy(false));
  };

  /** the blue action line */
  let action: React.ReactNode;
  if (!p) {
    action = hasVideos
      ? <button type="button" onClick={onPick} className="text-sm font-semibold text-primary" data-action="choose">{d.chooseVideoProcess}</button>
      : <Link href="/upload" className="text-sm font-semibold text-primary" data-action="upload">{d.uploadToBegin}</Link>;
  } else if (!video) {
    action = null;
  } else if (video.state !== "INGESTED") {
    action = <p className="text-sm text-muted">{d.notVerifiedYet.replace("{state}", video.state.toLowerCase())}</p>;
  } else if (isActive(run)) {
    action = p.canRun
      ? <button type="button" disabled={busy} onClick={cancel} className="text-sm font-semibold text-primary disabled:opacity-50" data-action="cancel">{up.cancelAnalysis}</button>
      : <p className="text-sm text-muted">{d.analysisInProgress}</p>;
  } else if (run?.status === "SUCCEEDED") {
    action = (
      <span className="flex gap-3">
        <Link href={`/videos/${video.id}/analyze`} className="text-sm font-semibold text-primary" data-action="open">{d.openWorkspace}</Link>
        {p.canRun && <button type="button" onClick={onRun} className="text-sm font-semibold text-primary" data-action="rerun">{d.rerun}</button>}
      </span>
    );
  } else {
    action = p.canRun
      ? <button type="button" onClick={onRun} className="text-sm font-semibold text-primary" data-action="start">{run ? d.analyseAgain : d.startAnalysis}</button>
      : <p className="text-sm text-muted">{d.viewAnalysesOnly}</p>;
  }

  return (
    <section aria-label={d.jobCardAria} data-section="p03-s01" data-run-status={run?.status ?? "NONE"}>
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{d.heroEyebrow}</p>
      <h1 className="t-page mt-0.5">{d.heroTitle}</h1>
      <p className="mt-0.5 text-sm text-muted">{d.heroSubtitle}</p>

      <div className="vie-panel mt-3 flex flex-wrap items-center gap-4 p-3">
        <Thumb videoId={video?.id ?? null} has={!!video?.has_thumbnail} />
        <div className="min-w-0 flex-1">
          <p className={`truncate text-sm ${p?.error ? "text-danger" : "text-muted"}`}>{line1}</p>
          <button type="button" onClick={onPick} aria-label={d.chooseAnotherVideo.replace("{title}", title)} data-action="pick"
            className="t-section mt-0.5 block max-w-full truncate text-left hover:text-primary">{title}</button>
          <div className="mt-1">{action}</div>
          {msg && <p className="mt-1 text-sm text-danger">{msg}</p>}
        </div>
        <div className="w-full sm:w-64">
          <span className="inline-flex rounded-ctl px-2.5 py-1 text-sm font-semibold" data-status={status} style={pillTone}>{status}</span>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-2 flex-1 overflow-hidden rounded bg-line/60">
              <i className="block h-full rounded bg-primary" style={{ width: `${progress ?? 0}%` }} />
            </span>
            <span className="text-sm font-semibold">{pct(progress)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
