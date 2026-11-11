"use client";
/**
 * Page 02 Section 09 — selected upload preview / metadata editor (approved reference 02_UPLOAD_INGEST, "selected preview").
 *
 * The selected video as measured: the frame decoded from the file (play streams the playback copy, GET /v1/videos/:id/playback), name,
 * size, resolution, frame rate, duration, container and codecs; a quarantine or failure with its reason. Detected Content stays "Not
 * classified" (the engine does not classify footage); Teams are the linked match's clubs, named by a person, never guessed from video.
 * Edit Metadata renames the video (PATCH /v1/videos/:id) — every other fact is measured, not typed.
 * A.12 (ADR-078): Media Info, beside the heading, opens everything recorded about the file (MediaInfoDialog).
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Match, Playback } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { MediaInfoDialog } from "@/components/media/MediaInfoDialog";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes, formatFps, formatResolution, NOT_MEASURED } from "@/lib/format";
import { useLocale } from "@/lib/i18n";
import { crest, DATE_TAG, mmss, usePage02 } from "./page02";
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

  const rows: [string, string, string, number][] = [
    ["clk", d.fileName, v ? (v.original_filename ?? NOT_MEASURED) : d.noFileUploaded, 1056],
    ["u_fs", d.fileSize, v ? formatBytes(v.byte_size) : "—", 1097],
    ["asp", d.resolution, v ? formatResolution(v.width, v.height) : "—", 1139],
    ["asp", d.frameRate, v ? formatFps(v.frame_rate, v.is_variable_frame_rate) : "—", 1180],
    ["clk", d.duration, v ? mmss(v.duration_us) : "—", 1222],
    ["meta", d.detectedContent, d.notClassified, 1263],
  ];

  return (
    <section aria-label={d.selectedPreviewAria} data-section="p02-s09" data-selected-video={v?.id ?? ""}>
      <P x={1923} y={777} w={612} h={641} />
      <T x={1945} y={811} size={26} weight={600} as="h2">{d.selectedItemPreview}</T>
      <button type="button" onClick={() => (v ? setInfo(true) : say(d.selectUploadFirst))} className="absolute" data-action="media-info"
        title={d.mediaInfoTitle}
        style={{ left: u(2390), top: u(811 - 101 - 13), width: u(130), height: u(26), padding: 0, border: 0, background: "transparent", color: "#33a8ff", fontSize: u(18),
          fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", textAlign: "right", opacity: v ? 1 : 0.6 }}>{d.mediaInfo}</button>
      <MediaInfoDialog videoId={v?.id ?? null} name={name ?? d.theVideo} open={info} onOpenChange={setInfo} />
      <B x={1948} y={846} w={255} h={174} style={{ borderRadius: u(6), overflow: "hidden",
        background: thumb ? `center / cover no-repeat url(${thumb}), #000`
          : "radial-gradient(ellipse at 55% 40%,#e0b090 0,#c98c6a 6%,transparent 7%),radial-gradient(ellipse at 50% 100%,#6fb8ee 0,#2a6fb8 40%,transparent 75%),linear-gradient(135deg,#27487a,#0e2040)" }}>
        {thumb && !play && <img src={thumb} alt={d.frameFrom.replace("{name}", name ?? d.theVideo)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        {play && <video src={play} controls autoPlay playsInline aria-label={d.playingName.replace("{name}", name ?? d.theVideo)} style={{ width: "100%", height: "100%", background: "#000", display: "block" }} />}
      </B>
      {!play && (
        <>
          <button type="button" aria-label={v ? d.playName.replace("{name}", name ?? d.theVideo) : d.nothingToPlay} onClick={startPlay} className="absolute"
            style={{ left: u(2040), top: u(918 - 101), width: u(56), height: u(56), padding: 0, border: 0, borderRadius: "50%", background: "rgba(10,20,40,.7)", cursor: "pointer" }}>
            <span style={{ position: "absolute", left: u(18), top: u(15), width: u(22), height: u(26), background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)" }} />
          </button>
          <B x={2130} y={983} w={66} h={30} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(5) }} />
          <T x={2163} y={998} size={20} weight={600} align="center">{v ? mmss(v.duration_us) : "—"}</T>
        </>
      )}
      <T x={2222} y={860} size={22} weight={600} style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>{name ?? d.noVideoSelected}</T>
      <T x={2222} y={890} size={20} color="#b9cbe2" style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>
        {v ? d.uploadedOn.replace("{date}", new Date(v.created_at).toLocaleDateString(tag, { day: "numeric", month: "short", year: "numeric" })) : d.selectUploadPreview}
      </T>
      {failed ? (
        <div role="alert" className="absolute" style={{ left: u(2222), top: u(906 - 101), width: u(295), fontSize: u(16), lineHeight: 1.25, color: "#ff9aa8", maxHeight: u(60), overflow: "hidden" }}>
          <strong>{v!.failure_code}</strong>: {v!.failure_detail}
        </div>
      ) : <T x={2222} y={919} size={20} color="#b9cbe2" style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>{codecs ?? "—"}</T>}

      <dl style={{ margin: 0 }}>
        {rows.map(([k, l, val, y]) => (
          <div key={l}>
            <Ic x={1962} y={y} k={k} size={26} color="#cfe0f5" />
            <T x={1997} y={y} size={20} color="#d6e4f7" as="span">{l}</T>
            <T x={2180} y={y} size={20} color="#cfe0f5" as="span" style={{ maxWidth: u(330), overflow: "hidden", textOverflow: "ellipsis" }}>{val}</T>
          </div>
        ))}
        <div>
          <Ic x={1962} y={1306} k="ppl" size={26} color="#cfe0f5" />
          <T x={1997} y={1306} size={20} color="#d6e4f7" as="span">{d.teamsDetected}</T>
          {match?.home || match?.away ? (
            <>
              <B x={2180} y={1288} w={36} h={36} style={crest} />
              <T x={2226} y={1306} size={20} as="span" style={{ maxWidth: u(100), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.home?.short_name ?? match?.home?.name ?? "—"}</T>
              <B x={2346} y={1288} w={36} h={36} style={crest} />
              <T x={2392} y={1306} size={20} as="span" style={{ maxWidth: u(110), overflow: "hidden", textOverflow: "ellipsis" }}>{match?.away?.short_name ?? match?.away?.name ?? "—"}</T>
            </>
          ) : <T x={2180} y={1306} size={20} color="#cfe0f5" as="span">—</T>}
        </div>
      </dl>
      <button type="button" onClick={edit} aria-label={d.editMetadata} className="absolute"
        style={{ left: u(1950), top: u(1342 - 101), width: u(561), height: u(54), padding: 0, border: 0, borderRadius: u(8), background: "#0a84ff", color: "#fff", font: "inherit",
          cursor: "pointer", opacity: v && canWrite ? 1 : 0.75 }}>
        <Ic o={[1950, 1342]} x={2162} y={1370} k="u_edit" size={26} />
        <T o={[1950, 1342]} x={2190} y={1370} size={23} weight={600} as="span">{d.editMetadata}</T>
      </button>

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
