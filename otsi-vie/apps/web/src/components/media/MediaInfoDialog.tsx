"use client";
/**
 * v3 Phase A.12 (ADR-078): the Media Info panel, opened from Upload's selected video and from the Library's selected item.
 * Everything recorded about the video's file (GET /v1/videos/:id/media-info): what arrived, what the prober measured, the ingest checks in
 * order with their results, the playback copy, and what the engine has made from it so far. A fact never measured shows "—", and a check
 * whose result was not kept says so.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { MEDIA_CHECK_LABELS, type MediaCheck, type MediaInfo } from "@otsi-vie/contracts";
import { useEffect, useState, type ReactNode } from "react";
import { api, ApiProblem } from "@/lib/api";
import { formatBytes, formatDuration, formatFps, formatResolution, formatWhen, NOT_MEASURED } from "@/lib/format";

const MARK: Record<MediaCheck["status"], [string, string]> = {
  PASSED: ["✓", "text-ok"], FAILED: ["✕", "text-danger"], NOT_RUN: ["–", "text-amber"], PENDING: ["…", "text-muted"],
};
const STATUS_WORD: Record<MediaCheck["status"], string> = { PASSED: "passed", FAILED: "failed", NOT_RUN: "not run", PENDING: "waiting" };
const USES: [string, string][] = [["ANALYZE", "analyse"], ["SHARE", "share"], ["DOWNLOAD", "download"]];

const or = (v: string | number | null | undefined) => (v === null || v === undefined || v === "" ? NOT_MEASURED : String(v));
const when = (iso: string | null) => (iso ? formatWhen(iso) : NOT_MEASURED);

/** the evidence in one line each, from recorded rows only */
export function evidenceLines(e: MediaInfo["evidence"]): string[] {
  const out: string[] = [];
  const la = e.latest_analysis;
  out.push(e.analyses === 0 ? "Not analysed yet"
    : `${e.analyses} ${e.analyses === 1 ? "analysis" : "analyses"}; latest ${la!.status.toLowerCase()}${la!.status === "SUCCEEDED" ? `: ${la!.tracks.toLocaleString("en-US")} tracks, ${la!.confirmed_tracks.toLocaleString("en-US")} with a confirmed identity` : ""}`);
  out.push(!e.footage_check ? "Footage not checked" : e.footage_check.status === "SUCCEEDED" ? `Footage check recommends ${e.footage_check.recommended_profile ?? "—"}` : `Footage check ${e.footage_check.status.toLowerCase()}`);
  if (!e.rights) out.push("No rights recorded: not analysed until they are");
  else {
    const uses = USES.filter(([k]) => e.rights!.allowed_uses.includes(k)).map(([, w]) => w);
    out.push(`Rights: ${uses.length ? uses.join(", ") : "view only"}${e.rights.analysis_blocked ? `. ${e.rights.analysis_blocked}` : ""}`);
  }
  out.push(`${e.reels} ${e.reels === 1 ? "reel" : "reels"} made from it, ${e.renders} finished ${e.renders === 1 ? "render" : "renders"}`);
  return out;
}

function Rows({ title, rows }: { title: string; rows: [string, ReactNode][] }) {
  return (
    <section aria-label={title} className="mb-3">
      <h3 className="mb-1 text-xs font-normal uppercase tracking-wide text-muted">{title}</h3>
      <dl className="grid grid-cols-[minmax(8rem,auto),1fr] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (<div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>))}
      </dl>
    </section>
  );
}

export function MediaInfoBody({ info }: { info: MediaInfo }) {
  const f = info.file, s = info.streams;
  return (
    <div className="text-sm" data-media-info={info.video_id}>
      <Rows title="File" rows={[
        ["Name", or(f.name)], ["Size", formatBytes(f.bytes)], ["Type", or(f.mime_type)], ["Container (from its bytes)", or(f.signature)],
        ["SHA-256", f.sha256 ? <code className="text-xs" title={f.sha256}>{f.sha256}</code> : NOT_MEASURED],
        ["Came in", f.ingest_mode === "UPLOAD" ? "Uploaded" : f.source_uri ? `Imported from ${f.source_uri}` : "Imported from a link"],
        ["Added", `${when(f.added_at)}${f.added_by ? ` by ${f.added_by}` : ""}`], ["Verified", when(f.verified_at)],
      ]} />
      <Rows title="Streams (measured)" rows={[
        ["Container", or(s.container)], ["Video codec", or(s.video_codec)], ["Audio", s.audio_codec ?? (info.state === "INGESTED" ? "no audio track" : NOT_MEASURED)],
        ["Picture", formatResolution(s.width, s.height)], ["Frame rate", formatFps(s.frame_rate, s.variable_frame_rate)],
        ["Frames", s.frame_count === null ? NOT_MEASURED : s.frame_count.toLocaleString()], ["Duration", formatDuration(s.duration_us)],
        ["Time base", s.time_base ? `${s.time_base.num}/${s.time_base.den}` : NOT_MEASURED], ["Rotation", s.rotation_degrees === null ? NOT_MEASURED : `${s.rotation_degrees}°`],
      ]} />
      <section aria-label="Ingest checks" className="mb-3">
        <h3 className="mb-1 text-xs font-normal uppercase tracking-wide text-muted">Ingest checks</h3>
        <ol className="space-y-0.5">
          {info.checks.map((c) => (
            <li key={c.key} data-check={c.key} data-check-status={c.status} className="flex gap-2">
              <span aria-hidden className={`w-4 shrink-0 text-center font-normal ${MARK[c.status][1]}`}>{MARK[c.status][0]}</span>
              <span><span className="font-normal">{MEDIA_CHECK_LABELS[c.key]}</span> <span className="sr-only">{STATUS_WORD[c.status]}</span>
                {c.detail ? <span className="text-muted">: {c.detail}</span> : c.status === "PENDING" ? <span className="text-muted">: waiting</span> : null}</span>
            </li>
          ))}
        </ol>
        {info.ingest_job && <p className="mt-1 text-xs text-muted">Ingest job {info.ingest_job.state.toLowerCase()}{info.ingest_job.attempts > 1 ? ` after ${info.ingest_job.attempts} attempts` : ""}{info.ingest_job.finished_at ? `, ${when(info.ingest_job.finished_at)}` : ""}.</p>}
      </section>
      <Rows title="Copies" rows={[
        ["Playback copy", info.copies.playback ? `${formatBytes(info.copies.playback.bytes)}, made ${when(info.copies.playback.created_at)}` : "not made yet"],
        ["Thumbnail", info.copies.thumbnail ? "yes" : "none"],
      ]} />
      <section aria-label="Evidence so far">
        <h3 className="mb-1 text-xs font-normal uppercase tracking-wide text-muted">Evidence so far</h3>
        <ul className="list-disc space-y-0.5 pl-5">{evidenceLines(info.evidence).map((l) => <li key={l}>{l}</li>)}</ul>
      </section>
    </div>
  );
}

export function MediaInfoDialog({ videoId, name, open, onOpenChange }: { videoId: string | null; name: string; open: boolean; onOpenChange(o: boolean): void }) {
  const [info, setInfo] = useState<MediaInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open || !videoId) return;
    let live = true;
    setInfo(null); setErr(null);
    api<MediaInfo>(`/v1/videos/${videoId}/media-info`).then((x) => { if (live) setInfo(x); },
      (x) => { if (live) setErr(x instanceof ApiProblem ? x.message : "Media info could not be read."); });
    return () => { live = false; };
  }, [open, videoId]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(640px,94vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 text-sm shadow-2xl"
          data-dialog="media-info">
          <Dialog.Title className="text-base font-normal">Media Info · {name}</Dialog.Title>
          <Dialog.Description className="mb-3 text-xs text-muted">What was recorded about this file: measured by the ingest checks, never typed. &quot;—&quot; means not measured.</Dialog.Description>
          {err ? <p role="alert" className="text-danger">{err}</p> : info ? <MediaInfoBody info={info} /> : <p role="status" className="text-muted">Reading…</p>}
          <div className="mt-3 flex justify-end"><Dialog.Close className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white">Close</Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
