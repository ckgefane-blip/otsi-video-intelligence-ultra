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
import { crest, mmss, usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

export function SelectedPreviewSection() {
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
  const name = v ? (v.title ?? v.original_filename ?? "Untitled video") : null;
  const failed = v && (v.state === "FAILED" || v.state === "QUARANTINED");
  const codecs = v?.container_format ? `${v.container_format} · ${v.video_codec ?? NOT_MEASURED}${v.audio_codec ? ` + ${v.audio_codec}` : " (no audio)"}` : null;

  const startPlay = () => {
    if (!v) return say("Select an upload in Recent Uploads first");
    if (v.state !== "INGESTED") return say("The video can be played once it is verified");
    void api<Playback>(`/v1/videos/${v.id}/playback`).then((p) => (p.available && p.url ? setPlay(p.url) : say(`No playback copy yet: ${p.reason ?? "it is being prepared"}`)),
      () => say("Playback unavailable", true));
  };
  const edit = () => {
    if (!v) return say("Select an upload in Recent Uploads first");
    if (!canWrite) return say("Your role can view uploads but not rename them");
    setTitle(name ?? ""); setErr(null); setNaming(true);
  };

  const rows: [string, string, string, number][] = [
    ["clk", "File Name", v ? (v.original_filename ?? NOT_MEASURED) : "No file uploaded", 1056],
    ["u_fs", "File Size", v ? formatBytes(v.byte_size) : "—", 1097],
    ["asp", "Resolution", v ? formatResolution(v.width, v.height) : "—", 1139],
    ["asp", "Frame Rate", v ? formatFps(v.frame_rate, v.is_variable_frame_rate) : "—", 1180],
    ["clk", "Duration", v ? mmss(v.duration_us) : "—", 1222],
    ["meta", "Detected Content", "Not classified", 1263],
  ];

  return (
    <section aria-label="Selected upload preview / metadata editor" data-section="p02-s09" data-selected-video={v?.id ?? ""}>
      <P x={1923} y={777} w={612} h={641} />
      <T x={1945} y={811} size={26} weight={600} as="h2">Selected Item Preview</T>
      <button type="button" onClick={() => (v ? setInfo(true) : say("Select an upload in Recent Uploads first"))} className="absolute" data-action="media-info"
        title="Everything recorded about this file: streams, checks and evidence"
        style={{ left: u(2390), top: u(811 - 101 - 13), width: u(130), height: u(26), padding: 0, border: 0, background: "transparent", color: "#33a8ff", fontSize: u(18),
          fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap", textAlign: "right", opacity: v ? 1 : 0.6 }}>Media Info</button>
      <MediaInfoDialog videoId={v?.id ?? null} name={name ?? "this video"} open={info} onOpenChange={setInfo} />
      <B x={1948} y={846} w={255} h={174} style={{ borderRadius: u(6), overflow: "hidden",
        background: thumb ? `center / cover no-repeat url(${thumb}), #000`
          : "radial-gradient(ellipse at 55% 40%,#e0b090 0,#c98c6a 6%,transparent 7%),radial-gradient(ellipse at 50% 100%,#6fb8ee 0,#2a6fb8 40%,transparent 75%),linear-gradient(135deg,#27487a,#0e2040)" }}>
        {thumb && !play && <img src={thumb} alt={`Frame from ${name}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        {play && <video src={play} controls autoPlay playsInline aria-label={`Playing ${name}`} style={{ width: "100%", height: "100%", background: "#000", display: "block" }} />}
      </B>
      {!play && (
        <>
          <button type="button" aria-label={v ? `Play ${name}` : "Nothing to play"} onClick={startPlay} className="absolute"
            style={{ left: u(2040), top: u(918 - 101), width: u(56), height: u(56), padding: 0, border: 0, borderRadius: "50%", background: "rgba(10,20,40,.7)", cursor: "pointer" }}>
            <span style={{ position: "absolute", left: u(18), top: u(15), width: u(22), height: u(26), background: "#fff", clipPath: "polygon(0 0,100% 50%,0 100%)" }} />
          </button>
          <B x={2130} y={983} w={66} h={30} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(5) }} />
          <T x={2163} y={998} size={20} weight={600} align="center">{v ? mmss(v.duration_us) : "—"}</T>
        </>
      )}
      <T x={2222} y={860} size={22} weight={600} style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>{name ?? "No video selected"}</T>
      <T x={2222} y={890} size={20} color="#b9cbe2" style={{ maxWidth: u(290), overflow: "hidden", textOverflow: "ellipsis" }}>
        {v ? `Uploaded ${new Date(v.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : "Select an upload to preview"}
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
          <T x={1997} y={1306} size={20} color="#d6e4f7" as="span">Teams (Detected)</T>
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
      <button type="button" onClick={edit} aria-label="Edit Metadata" className="absolute"
        style={{ left: u(1950), top: u(1342 - 101), width: u(561), height: u(54), padding: 0, border: 0, borderRadius: u(8), background: "#0a84ff", color: "#fff", font: "inherit",
          cursor: "pointer", opacity: v && canWrite ? 1 : 0.75 }}>
        <Ic o={[1950, 1342]} x={2162} y={1370} k="u_edit" size={26} />
        <T o={[1950, 1342]} x={2190} y={1370} size={23} weight={600} as="span">Edit Metadata</T>
      </button>

      <Dialog.Root open={naming} onOpenChange={setNaming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,94vw)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-panel p-4 text-sm shadow-2xl">
            <Dialog.Title className="text-base font-semibold">Edit metadata</Dialog.Title>
            <Dialog.Description className="mb-3 text-xs text-muted">The video&apos;s title. Size, resolution, frame rate, duration and codecs are measured from the file; teams come from the linked match.</Dialog.Description>
            <form onSubmit={(e) => {
              e.preventDefault();
              void api(`/v1/videos/${v!.id}`, { method: "PATCH", json: { title } }).then(async () => { await reloadVideos(); setNaming(false); say("Title saved"); },
                (x) => setErr(x instanceof ApiProblem ? x.message : "The title could not be saved."));
            }}>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={255} aria-label="Video title" className="mb-2 w-full rounded-ctl border border-line bg-canvas px-2 py-1.5 text-ink" />
              {err && <p role="alert" className="mb-2 text-xs text-danger">{err}</p>}
              <div className="flex justify-end gap-2">
                <Dialog.Close className="rounded-ctl border border-line px-3 py-1.5">Cancel</Dialog.Close>
                <button type="submit" className="rounded-ctl bg-primary px-3 py-1.5 font-semibold text-white">Save</button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}
