"use client";
/**
 * Page 03 Section 02 — title and processing job card (approved reference 03_AI_PROCESSING, "title + match card").
 *
 * The card shows the selected video and its latest analysis run as recorded: the video's thumbnail, the run's profile and frame rate,
 * the run status and the worker's own progress. The blue line is the next real action: choose or upload a video, start the analysis,
 * cancel it while it runs, or open the finished analysis. The title opens the video chooser.
 */
import { PROFILES } from "@otsi-vie/contracts";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProcessingState } from "@/components/analysis/ProcessingView";
import { B, T, u } from "@/components/stage/DesignStage";
import { apiBlob, ApiProblem } from "@/lib/api";
import { isActive, PILL, runLabel, runProgress, pct } from "./model";

const plain = { position: "absolute" as const, padding: 0, border: 0, background: "transparent", font: "inherit", cursor: "pointer", textAlign: "left" as const };

function Thumb({ videoId, has }: { videoId: string | null; has: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!videoId || !has) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${videoId}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [videoId, has]);
  return <B x={1520} y={150} w={88} h={90} style={{ borderRadius: "50%", background: src ? `center / cover no-repeat url(${src})` : "#10243f" }} />;
}

export function JobCard({ p, hasVideos, onPick, onRun }: { p: ProcessingState | null; hasVideos: boolean | null; onPick: () => void; onRun: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const video = p?.video ?? null, run = p?.run ?? null;
  const status = runLabel(run);
  const pillTone = run?.status === "SUCCEEDED" ? PILL.DONE : run?.status === "FAILED" ? PILL.FAILED
    : run && !isActive(run) ? PILL.WAITING : { background: "#1580ff", color: "#fff" };
  const progress = runProgress(run);

  const line1 = p?.error ? p.error : !video ? "No processing job" : !run ? "Not analysed yet"
    : `Analysis · ${run.config.profile ? PROFILES[run.config.profile].label : "custom"} · ${run.config.sample_fps} fps`;
  const title = video ? (video.title ?? video.original_filename ?? "Untitled video") : p ? "Loading…" : "No video selected";

  const cancel = () => {
    setBusy(true); setMsg(null);
    void p!.cancel().catch((x) => setMsg(x instanceof ApiProblem ? x.message : "Could not cancel.")).finally(() => setBusy(false));
  };

  /** the blue action line */
  let action: React.ReactNode;
  const link = { left: u(1635), top: u(231 - 101 - 14), height: u(28), fontSize: u(20), color: "#4db3ff", whiteSpace: "nowrap" as const };
  if (!p) {
    action = hasVideos
      ? <button type="button" onClick={onPick} style={{ ...plain, ...link }} data-action="choose">Choose a video to process</button>
      : <Link href="/upload" className="absolute" style={{ ...link, textDecoration: "none" }} data-action="upload">Upload a video to begin</Link>;
  } else if (!video) {
    action = null;
  } else if (video.state !== "INGESTED") {
    action = <T x={1635} y={231} size={20} color="#b9cbe3">Not verified yet ({video.state.toLowerCase()})</T>;
  } else if (isActive(run)) {
    action = p.canRun
      ? <button type="button" disabled={busy} onClick={cancel} style={{ ...plain, ...link }} data-action="cancel">Cancel analysis</button>
      : <T x={1635} y={231} size={20} color="#b9cbe3">Analysis in progress</T>;
  } else if (run?.status === "SUCCEEDED") {
    action = (
      <span className="absolute" style={{ ...link, display: "flex", gap: u(14) }}>
        <Link href={`/videos/${video.id}/analyze`} style={{ color: "#4db3ff", textDecoration: "none" }} data-action="open">Open Analysis Workspace →</Link>
        {p.canRun && <button type="button" onClick={onRun} style={{ ...plain, position: "static", color: "#4db3ff", fontSize: "inherit" }} data-action="rerun">Re-run</button>}
      </span>
    );
  } else {
    action = p.canRun
      ? <button type="button" onClick={onRun} style={{ ...plain, ...link }} data-action="start">{run ? "Analyse again →" : "Start analysis →"}</button>
      : <T x={1635} y={231} size={20} color="#b9cbe3">Your role can view analyses only</T>;
  }

  return (
    <section aria-label="Run headline and selected media summary" data-section="p03-s01" data-run-status={run?.status ?? "NONE"}>
      <T x={44} y={138} size={18} weight={600} ls={4.5} color="#2d9bff">FROM RAW VIDEO TO ACTIONABLE INSIGHTS</T>
      <T x={44} y={192} size={72} weight={700} ls={-0.5} as="h1">AI Processing Pipeline</T>
      <T x={44} y={249} size={25} color="#cdd9ec">Our AI automatically detects, tracks, and analyzes every moment of the match, turning video into structured data and insights.</T>

      <B x={1500} y={123} w={1030} h={144} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
      <Thumb videoId={video?.id ?? null} has={!!video?.has_thumbnail} />
      <T x={1635} y={154} size={19} color={p?.error ? "#ff8a8a" : "#b9cbe3"} style={{ maxWidth: u(340), overflow: "hidden", textOverflow: "ellipsis" }}>{line1}</T>
      <button type="button" onClick={onPick} aria-label={`${title}: choose another video`} data-action="pick"
        style={{ ...plain, left: u(1635), top: u(190 - 101 - 16), height: u(32), maxWidth: u(340), color: "#fff", fontSize: u(25), fontWeight: 700,
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1 }}>{title}</button>
      {action}
      {msg && <T x={1635} y={258} size={16} color="#ff8a8a">{msg}</T>}

      <B x={1990} y={133} w={1} h={124} style={{ background: "#17355f" }} />
      <B x={2017} y={145} w={156} h={44} data-status={status}
        style={{ ...pillTone, borderRadius: u(6), fontSize: u(20), fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{status}</B>
      <B x={2017} y={215} w={401} h={9} style={{ background: "#17304f", borderRadius: u(4) }}>
        <i style={{ display: "block", height: "100%", width: `${progress ?? 0}%`, borderRadius: u(4), background: "#1a8cff" }} />
      </B>
      <T x={2446} y={217} size={26} weight={700}>{pct(progress)}</T>
    </section>
  );
}
