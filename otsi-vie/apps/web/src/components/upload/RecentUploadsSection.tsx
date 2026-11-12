"use client";
/**
 * Page 02 Section 08 — recent uploads panel, on the Desktop UI flow layout.
 *
 * The organization's five newest videos (GET /v1/videos, followed every few seconds while anything uploads or is being checked): the
 * frame decoded from the file, measured length, date and size, and the real state — uploading with this page's own progress, checked by
 * the ingest worker with its progress, ready, quarantined or failed. A row selects the video for the preview and the pipeline; ⋮ opens
 * it in Processing, the Analysis workspace or the Tactical view. View All opens the Library.
 */
import type { RemovalPreview, Video } from "@otsi-vie/contracts";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { MoreVertical } from "lucide-react";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, mmss, usePage02 } from "./page02";
import { useUpload, videoStatusText } from "./UploadWorkspace";

const TONE: Record<string, string> = { ok: "text-ok border-ok/40 bg-ok/10", busy: "text-cyan border-cyan/40 bg-cyan/10", warn: "text-amber border-amber/40 bg-amber/10", bad: "text-danger border-danger/40 bg-danger/10", idle: "text-muted border-line" };

function Thumb({ v }: { v: Video | undefined }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!v?.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${v.id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [v?.id, v?.has_thumbnail]);
  if (src) return <img src={src} alt="" className="h-[88px] w-[153px] shrink-0 rounded border border-line object-cover" />;
  return <div className="grid h-[88px] w-[153px] shrink-0 place-items-center rounded border border-line bg-raised text-xs text-muted">—</div>;
}

export function RecentUploadsSection() {
  const { t: dict, locale } = useLocale();
  const d = dict.body.upload;
  const tag = DATE_TAG[locale];
  const { videos, select, selected, transfers, canWrite, reloadVideos, pause, resume } = useUpload();
  const { say, offerUndo } = usePage02();
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  /** whether a verified video can be removed (the same Library delete, ADR-052/ADR-074): a video still used by reels is refused */
  const [takes, setTakes] = useState<RemovalPreview | null>(null);
  useEffect(() => {
    setTakes(null);
    const v = (videos ?? []).find((x) => x.id === confirm);
    if (v?.state === "INGESTED") void api<RemovalPreview>(`/v1/library/video/${v.id}/removal`).then(setTakes, () => setTakes(null));
  }, [confirm]);  // eslint-disable-line react-hooks/exhaustive-deps
  const analysing = (v: Video) => v.state === "INGESTED" && !!v.analysis && (v.analysis.status === "QUEUED" || v.analysis.status === "RUNNING");
  const transferOf = (v: Video) => transfers.find((x) => x.state !== "done" && (x.videoId === v.id || (x.file.name === v.original_filename && x.file.size === v.byte_size)));
  const stopAnalysis = (v: Video) => {
    setConfirm(null);
    if (!v.analysis) return;
    void api(`/v1/analysis-runs/${v.analysis.run_id}/cancel`, { method: "POST" }).then(
      async () => { await reloadVideos(); say(d.analysisCancelledMsg.replace("{name}", v.title ?? v.original_filename ?? d.theUpload)); },
      (x) => say(x instanceof ApiProblem ? x.message : d.couldNotCancelAnalysis, true));
  };
  const cancelPlayback = (v: Video) => {
    setConfirm(null);
    void api(`/v1/videos/${v.id}/playback-copy/cancel`, { method: "POST" }).then(
      async () => { await reloadVideos(); say(d.playbackCancelledMsg.replace("{name}", v.title ?? v.original_filename ?? d.theUpload)); },
      (x) => say(x instanceof ApiProblem ? x.message : d.couldNotCancelPlayback, true));
  };
  const makePlayback = (v: Video) => {
    void api(`/v1/videos/${v.id}/playback-copy`, { method: "POST" }).then(
      async () => { await reloadVideos(); say(d.playbackRemade); },
      (x) => say(x instanceof ApiProblem ? x.message : d.couldNotStartPlayback, true));
  };
  const remove = (v: Video) => {
    setConfirm(null); setMenu(null);
    void api(`/v1/library/video/${v.id}`, { method: "DELETE" }).then(
      async () => {
        await reloadVideos();
        const name = v.title ?? v.original_filename ?? d.theUpload;
        say(d.removed.replace("{name}", name));
        if (v.state === "INGESTED") offerUndo({ id: v.id, title: name });      // only a verified video can be restored
      },
      (x) => say(x instanceof ApiProblem ? x.message : d.couldNotRemove, true));
  };
  const rows = (videos ?? []).slice(0, 5);
  /** what this video is doing now, with a real percentage when the worker reports one (null = nothing is moving, so no bar) */
  const barOf = (v: Video): { pct: number; tone: "busy" | "idle" } | null => {
    const t = transfers.find((x) => x.videoId === v.id || (x.state !== "done" && x.file.name === v.original_filename && x.file.size === v.byte_size));
    if (t && t.state !== "done" && t.progress) return { pct: Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes), tone: "busy" };
    if (v.state === "INGESTED") {
      if (v.analysis?.status === "RUNNING") return { pct: v.analysis.progress ?? 0, tone: "busy" };
      if (v.job?.kind === "PROXY" && v.job.state === "RUNNING") return { pct: v.job.progress, tone: "busy" };
      if (v.job?.state === "QUEUED" || v.analysis?.status === "QUEUED") return { pct: 0, tone: "idle" };
    }
    if (v.job?.state === "QUEUED" && v.state !== "FAILED" && v.state !== "QUARANTINED") return { pct: 0, tone: "idle" };
    if (v.state === "VALIDATING" && v.job) return { pct: v.job.progress, tone: "busy" };
    if (v.state === "INGESTED" && v.job?.kind === "PROXY" && v.job.state === "RUNNING") return { pct: v.job.progress, tone: "busy" };
    if (v.analysis?.status === "RUNNING") return { pct: v.analysis.progress ?? 0, tone: "busy" };
    if (v.analysis?.status === "QUEUED") return { pct: 0, tone: "idle" };
    return null;
  };
  const barsOf = (v: Video): Array<{ pct: number; tone: "busy" | "idle"; label: string }> => {
    if (v.state === "INGESTED") {
      const out: Array<{ pct: number; tone: "busy" | "idle"; label: string }> = [];
      if (v.job?.kind === "PROXY" && v.job.state === "RUNNING") out.push({ pct: v.job.progress, tone: "busy", label: d.playbackCopyLabel });
      else if (v.job?.kind === "PROXY" && v.job.state === "QUEUED") out.push({ pct: 0, tone: "idle", label: d.playbackCopyLabel });
      if (v.analysis?.status === "RUNNING") out.push({ pct: v.analysis.progress ?? 0, tone: "busy", label: d.analysisWord });
      else if (v.analysis?.status === "QUEUED") out.push({ pct: 0, tone: "idle", label: d.analysisWord });
      return out;
    }
    const b = barOf(v);
    return b ? [{ ...b, label: dict.nav.upload }] : [];
  };
  const progressOf = (v: Video) => {
    const t = transfers.find((x) => x.videoId === v.id || (x.state !== "done" && x.file.name === v.original_filename && x.file.size === v.byte_size));
    if (t && t.state !== "done" && t.progress) return { text: (t.state === "paused" ? d.progressPaused : d.progressUploading).replace("{n}", String(Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes))), tone: t.state === "error" ? "bad" : "busy" };
    if (v.state === "INGESTED") {
      const parts: string[] = [];
      if (v.job?.kind === "PROXY" && v.job.state === "RUNNING") parts.push(d.playbackPct.replace("{n}", String(Math.round(v.job.progress))));
      else if (v.job?.kind === "PROXY" && v.job.state === "QUEUED") parts.push(d.playbackWaiting);
      else if (v.job?.kind === "PROXY" && v.job.state === "CANCELLED") parts.push(d.playbackCancelled);
      if (v.analysis?.status === "RUNNING") parts.push(d.analysingPct.replace("{n}", String(Math.round(v.analysis.progress ?? 0))));
      else if (v.analysis?.status === "QUEUED") parts.push(d.analysisWaitingShort);
      if (parts.length) return { text: parts.join(" · "), tone: parts.some((x) => x.endsWith("%")) ? "busy" : "idle" };
    }
    // a job that has not started is WAITING for the worker (one process runs one job at a time), not checking at 0%
    if (v.job?.state === "QUEUED" && v.state !== "FAILED" && v.state !== "QUARANTINED") return { text: v.state === "INGESTED" ? d.playbackCopyWaiting : d.waitingForWorker, tone: "idle" };
    if (v.state === "VALIDATING" && v.job) return { text: d.checkingPct.replace("{n}", String(Math.round(v.job.progress))), tone: "busy" };
    if (v.state === "INGESTED" && v.job?.kind === "PROXY" && v.job.state === "RUNNING") return { text: d.playbackCopyPct.replace("{n}", String(Math.round(v.job.progress))), tone: "busy" };
    if (v.analysis?.status === "RUNNING") return { text: d.analysingPct.replace("{n}", String(Math.round(v.analysis.progress ?? 0))), tone: "busy" };
    if (v.analysis?.status === "QUEUED") return { text: d.analysisWaitingShort, tone: "idle" };
    const s = videoStatusText(v, d);
    return { text: s.label, tone: s.tone };
  };

  const pill = "rounded-ctl border px-2 py-0.5 text-xs hover:border-primary/60 disabled:opacity-50";
  return (
    <section aria-label={d.recentUploads} data-section="p02-s08" data-count={String(videos?.length ?? 0)} className="vie-panel">
      <div className="vie-ph">
        <h2 className="t-panel">{d.recentUploads}</h2>
        <Link href="/library" className="text-sm text-primary">{dict.body.home.viewAll}</Link>
      </div>
      {videos === null && <p className="p-3 text-sm text-muted" role="status">{dict.common.loading}</p>}
      {videos?.length === 0 && (
        <div className="p-3 text-sm text-muted">
          <p className="font-medium text-ink">{d.noUploadsYet}</p>
          <p>{d.uploadsAppearHere}</p>
        </div>
      )}
      <ul aria-label={d.recentUploadsPlain} className="divide-y divide-line/60">
        {rows.map((v) => {
          const sel = selected?.id === v.id;
          const p = progressOf(v);
          const bars = barsOf(v);
          const stop = analysing(v), gone = v.state === "FAILED" || v.state === "QUARANTINED", t = transferOf(v);
          const name = v.title ?? v.original_filename;
          const verb = stop ? d.cancelAnalysis : gone ? d.removeVerb : dict.common.cancel;
          const proxyOn = v.job?.kind === "PROXY" && (v.job.state === "RUNNING" || v.job.state === "QUEUED");
          const proxyStopped = v.job?.kind === "PROXY" && v.job.state === "CANCELLED";
          const anaOn = analysing(v);
          const key = (k: string) => `${v.id}:${k}`;
          return (
            <li key={v.id} className="relative px-3 py-2.5">
              <div className="flex items-start gap-3">
                <div className="relative shrink-0">
                  <Thumb v={v} />
                  <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[11px] font-semibold text-white">{mmss(v.duration_us)}</span>
                </div>
                <button type="button" onClick={() => select(v.id)} aria-pressed={sel} aria-label={`${v.title ?? v.original_filename}: ${p!.text}`}
                  className={`min-w-0 flex-1 rounded-ctl p-1 text-left hover:bg-raised/50 ${sel ? "bg-primary/10" : ""}`}>
                  <span className="block truncate text-sm font-medium">{v.title ?? v.original_filename ?? d.untitledVideo}</span>
                  <span className="block text-xs text-muted">{`${new Date(v.created_at).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" })} · ${formatBytes(v.byte_size)}`}</span>
                  {bars.length === 0 && (
                    <span data-video-state={v.state} className={`mt-1 inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[p?.tone ?? "idle"]}`}>{p!.text}</span>
                  )}
                  {bars.map((b) => (
                    <Fragment key={b.label}>
                      <span className={`mt-1 block text-xs font-semibold ${b.tone === "idle" ? "text-amber" : "text-ink2"}`}>
                        {b.tone === "idle" ? `${b.label} · ${d.waitingWord}` : `${b.label} ${Math.round(b.pct)}%`}
                      </span>
                      <span className="mt-0.5 block h-1.5 overflow-hidden rounded bg-line" role="progressbar" aria-label={`${v.title ?? v.original_filename}: ${b.label} progress`} aria-valuenow={Math.round(b.pct)} aria-valuemin={0} aria-valuemax={100}>
                        <i className="block h-full rounded" style={{ width: `${Math.min(100, Math.max(b.tone === "idle" ? 0 : 2, b.pct))}%`, background: b.label === d.analysisWord ? "#1e90ff" : "#33d0c8" }} />
                      </span>
                    </Fragment>
                  ))}
                </button>
                <button type="button" aria-label={d.moreFor.replace("{name}", v.title ?? v.original_filename ?? "")} aria-expanded={menu === v.id}
                  onClick={() => { setConfirm(null); setMenu((m) => (m !== v.id ? v.id : null)); }} className="vie-ib !h-8 !w-8 shrink-0">
                  <MoreVertical className="h-4 w-4" aria-hidden />
                </button>
              </div>

              {/* per-row actions */}
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[165px]">
                {canWrite && v.state !== "INGESTED" && (() => {
                  if (confirm === v.id) {
                    return (
                      <span className="flex flex-wrap items-center gap-2 text-xs text-amber">
                        {stop ? d.cancelAnalysisQ : gone ? d.removeQ : d.cancelUploadQ}
                        <button type="button" aria-label={d.confirmAria.replace("{text}", `${verb.toLowerCase()} ${name}`)} onClick={() => (stop ? stopAnalysis(v) : remove(v))}
                          className="font-semibold text-danger">{d.yes}</button>
                        <button type="button" onClick={() => setConfirm(null)} className="text-ink2">{d.no}</button>
                      </span>
                    );
                  }
                  return (
                    <>
                      {t && (t.state === "sending" || t.state === "paused" || t.state === "error") && (
                        <button type="button" aria-label={t.state === "sending" ? d.pauseFile.replace("{name}", name ?? "") : d.resumeFile.replace("{name}", name ?? "")}
                          onClick={() => (t.state === "sending" ? pause(t.id) : resume(t.id))} className={pill}>{t.state === "sending" ? d.pause : d.resume}</button>
                      )}
                      <button type="button" aria-label={`${verb} ${name}`} onClick={() => setConfirm(v.id)} className={`${pill} text-danger`}>{verb}</button>
                    </>
                  );
                })()}
                {canWrite && v.state === "INGESTED" && (() => {
                  if (confirm === key("proxy")) return (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-amber">{d.cancelPlaybackQ}
                      <button type="button" aria-label={d.confirmAria.replace("{text}", d.cancelPlaybackQ.replace("?", "").toLowerCase())} onClick={() => cancelPlayback(v)} className="font-semibold text-danger">{d.yes}</button>
                      <button type="button" onClick={() => setConfirm(null)} className="text-ink2">{d.no}</button>
                    </span>
                  );
                  if (confirm === key("analysis")) return (
                    <span className="flex flex-wrap items-center gap-2 text-xs text-amber">{d.cancelAnalysisQ}
                      <button type="button" aria-label={d.confirmAria.replace("{text}", d.cancelAnalysisQ.replace("?", "").toLowerCase())} onClick={() => stopAnalysis(v)} className="font-semibold text-danger">{d.yes}</button>
                      <button type="button" onClick={() => setConfirm(null)} className="text-ink2">{d.no}</button>
                    </span>
                  );
                  return (
                    <>
                      {proxyOn && <button type="button" aria-label={d.cancelPlaybackOf.replace("{name}", name ?? "")} onClick={() => setConfirm(key("proxy"))} className={`${pill} text-danger`}>{d.cancelPlayback}</button>}
                      {anaOn && <button type="button" aria-label={d.cancelAnalysisOf.replace("{name}", name ?? "")} onClick={() => setConfirm(key("analysis"))} className={`${pill} text-danger`}>{d.cancelAnalysis}</button>}
                      {proxyStopped && <button type="button" aria-label={d.makePlaybackOf.replace("{name}", name ?? "")} onClick={() => makePlayback(v)} className={`${pill} text-cyan`}>{d.makePlayback}</button>}
                    </>
                  );
                })()}
              </div>

              {menu === v.id && (
                <nav aria-label={d.openThisVideo} className="absolute right-3 top-12 z-40 w-60 rounded-md border border-line2 bg-panel p-1 text-sm shadow-xl">
                  {v.state === "INGESTED" ? (
                    <>
                      <Link href={`/processing?video=${v.id}`} className="block rounded px-2.5 py-1.5 hover:bg-raised">{dict.nav.processing}</Link>
                      <Link href={`/videos/${v.id}/analyze`} className="block rounded px-2.5 py-1.5 hover:bg-raised">{d.analysisWorkspace}</Link>
                      <Link href={`/tactics?video=${v.id}`} className="block rounded px-2.5 py-1.5 hover:bg-raised">{d.tacticalView}</Link>
                    </>
                  ) : <span className="block px-2.5 py-1.5 text-muted">{d.availableOnceVerified}</span>}
                  {canWrite && (
                    confirm === v.id ? (
                      <span className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 text-amber">
                        {!takes ? d.checking : takes.blocked ? takes.blocked : d.moveToTrash}
                        {takes && !takes.blocked && <button type="button" onClick={() => remove(v)} className="font-semibold text-danger">{d.yes}</button>}
                        <button type="button" onClick={() => setConfirm(null)} className="text-ink2">{d.no}</button>
                      </span>
                    ) : <button type="button" onClick={() => setConfirm(v.id)} className="block w-full rounded px-2.5 py-1.5 text-left text-danger hover:bg-raised">{d.removeUpload}</button>
                  )}
                </nav>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
