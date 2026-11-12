"use client";
/**
 * Page 02 Section 09 — selected upload preview / metadata editor, on the Desktop UI flow layout.
 *
 * The selected video as measured: the frame decoded from the file (play streams the playback copy, GET /v1/videos/:id/playback, through
 * the shared VideoPlayer), name, size, resolution, frame rate, duration, container and codecs; a quarantine or failure with its reason.
 * Detected Content stays "Not classified" (the engine does not classify footage); Teams are the linked match's clubs, named by a person,
 * never guessed from video. Edit Metadata renames the video (PATCH /v1/videos/:id) — every other fact is measured, not typed.
 * A.12 (ADR-078): Media Info, beside the heading, opens everything recorded about the file (MediaInfoDialog).
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Match, Playback } from "@otsi-vie/contracts";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { MediaInfoDialog } from "@/components/media/MediaInfoDialog";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes, formatFps, formatResolution, NOT_MEASURED } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { DATE_TAG, mmss, usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

export function SelectedPreviewSection() {
  const { t: dict, locale } = useLocale();
  const d = dict.body.upload;
  const tag = DATE_TAG[locale];
  const { selected, canWrite, reloadVideos } = useUpload();
  const { matches, say } = usePage02();
  const [thumb, setThumb] = useState<string | null>(null);
  const [play, setPlay] = useState<string | null>(null);
  const [naming, setNaming] = useState(false);
  const [info, setInfo] = useState(false);
  const [title, setTitle] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setThumb(null); setPlay(null);
    if (!selected?.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${selected.id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setThumb(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [selected?.id, selected?.has_thumbnail]);
  const v = selected;
  const match: Match | null = v?.match_id ? (matches ?? []).find((m) => m.id === v.match_id) ?? null : null;
  const name = v ? (v.title ?? v.original_filename ?? d.untitledVideo) : null;
  const failed = v && (v.state === "FAILED" || v.state === "QUARANTINED");
  const codecs = v?.container_format ? `${v.container_format} · ${v.video_codec ?? NOT_MEASURED}${v.audio_codec ? ` + ${v.audio_codec}` : " (no audio)"}` : null;

  const startPlay = () => {
    if (!v) return say(d.selectUploadFirst);
    if (v.state !== "INGESTED") return say(d.videoPlayableOnceVerified);
    void api<Playback>(`/v1/videos/${v.id}/playback`).then((p) => (p.available && p.url ? setPlay(p.url) : say(d.noPlaybackYet.replace("{reason}", p.reason ?? dict.body.processing.playbackCopyPreparing))),
      () => say(d.playbackUnavailable, true));
  };
  const edit = () => {
    if (!v) return say(d.selectUploadFirst);
    if (!canWrite) return say(d.viewUploadsNoRename);
    setTitle(name ?? ""); setErr(null); setNaming(true);
  };

  const rows: [string, string][] = [
    [d.fileName, v ? (v.original_filename ?? NOT_MEASURED) : d.noFileUploaded],
    [d.fileSize, v ? formatBytes(v.byte_size) : "—"],
    [d.resolution, v ? formatResolution(v.width, v.height) : "—"],
    [d.frameRate, v ? formatFps(v.frame_rate, v.is_variable_frame_rate) : "—"],
    [d.duration, v ? mmss(v.duration_us) : "—"],
    [d.detectedContent, d.notClassified],
  ];

  return (
    <section aria-label={d.selectedPreviewAria} data-section="p02-s09" data-selected-video={v?.id ?? ""} className="vie-panel">
      <div className="vie-ph">
        <h2 className="t-panel">{d.selectedItemPreview}</h2>
        <button type="button" onClick={() => (v ? setInfo(true) : say(d.selectUploadFirst))} data-action="media-info" title={d.mediaInfoTitle}
          className="text-sm text-primary">{d.mediaInfo}</button>
      </div>
      <MediaInfoDialog videoId={v?.id ?? null} name={name ?? d.theVideo} open={info} onOpenChange={setInfo} />
      <div className="space-y-3 p-3 text-sm">
        {play ? (
          <VideoPlayer src={play} label={d.playingName.replace("{name}", name ?? d.theVideo)} autoPlay />
        ) : (
          <div className="relative overflow-hidden rounded-ctl border border-line bg-black">
            {thumb ? <img src={thumb} alt={d.frameFrom.replace("{name}", name ?? d.theVideo)} className="aspect-video w-full object-cover" />
              : <div className="grid aspect-video w-full place-items-center bg-raised text-xs text-muted">{v ? d.noVideoSelected : d.selectUploadPreview}</div>}
            <button type="button" aria-label={v ? d.playName.replace("{name}", name ?? d.theVideo) : d.nothingToPlay} onClick={startPlay}
              className="absolute left-1/2 top-1/2 grid h-14 w-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/70 text-white hover:bg-black/90">
              <Play className="h-6 w-6 fill-current" aria-hidden />
            </button>
            <span className="absolute bottom-2 right-2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] font-semibold text-white">{v ? mmss(v.duration_us) : "—"}</span>
          </div>
        )}
        <div>
          <p className="truncate font-semibold">{name ?? d.noVideoSelected}</p>
          <p className="text-xs text-muted">
            {v ? d.uploadedOn.replace("{date}", new Date(v.created_at).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" })) : d.selectUploadPreview}
          </p>
          {failed ? (
            <p role="alert" className="mt-1 text-danger"><span className="font-semibold">{v!.failure_code}</span>: {v!.failure_detail}</p>
          ) : <p className="mt-1 text-xs text-muted">{codecs ?? "—"}</p>}
        </div>
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          {rows.map(([k, val]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt><dd className="min-w-0 truncate">{val}</dd>
            </div>
          ))}
          <div className="contents">
            <dt className="text-muted">{d.teamsDetected}</dt>
            <dd className="min-w-0">
              {match?.home || match?.away ? (
                <span className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-raised text-[11px] font-semibold" title={match?.home?.name ?? ""}>{(match?.home?.short_name ?? match?.home?.name ?? "?").slice(0, 2).toUpperCase()}</span>
                  <span className="truncate">{match?.home?.short_name ?? match?.home?.name ?? "—"}</span>
                  <span className="text-muted">·</span>
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-raised text-[11px] font-semibold" title={match?.away?.name ?? ""}>{(match?.away?.short_name ?? match?.away?.name ?? "?").slice(0, 2).toUpperCase()}</span>
                  <span className="truncate">{match?.away?.short_name ?? match?.away?.name ?? "—"}</span>
                </span>
              ) : "—"}
            </dd>
          </div>
        </dl>
        <button type="button" onClick={edit} aria-label={d.editMetadata}
          className={`vie-btn vie-btn-pri w-full ${v && canWrite ? "" : "opacity-75"}`}>{d.editMetadata}</button>
      </div>

      <Dialog.Root open={naming} onOpenChange={setNaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">{d.editMetadataTitle}</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">{d.editMetadataDesc}</Dialog.Description>
            <form onSubmit={(e) => {
              e.preventDefault();
              void api(`/v1/videos/${v!.id}`, { method: "PATCH", json: { title } }).then(async () => { await reloadVideos(); setNaming(false); say(d.titleSaved); },
                (x) => setErr(x instanceof ApiProblem ? x.message : d.couldNotSaveTitle));
            }}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} aria-label={d.videoTitle} className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
              {err && <p role="alert" className="mb-2 text-xs text-danger">{err}</p>}
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">{dict.common.cancel}</Dialog.Close>
                <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">{dict.common.save}</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
