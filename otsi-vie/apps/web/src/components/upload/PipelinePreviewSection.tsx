"use client";
/**
 * Page 02 Section 10 — processing pipeline preview strip (approved reference 02_UPLOAD_INGEST, "pipeline").
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
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { PIPE_EXTRA } from "./layout";
import { pitchThumb, usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";
import { notBuilt } from "@/lib/devMode";

type State = "done" | "busy" | "bad" | "todo" | "unbuilt";
interface Stage { name: string; state: State; progress: number | null; status: string; action?: ReactNode }

const step = (run: AnalysisRun | null, name: string) => run?.steps.find((s) => s.name === name) ?? null;
function stepStage(run: AnalysisRun | null, name: string, title: string): Stage {
  const s = step(run, name);
  if (!run || !s) return { name: title, state: "todo", progress: null, status: run ? "Queued" : "Waiting..." };
  if (s.status === "SUCCEEDED") return { name: title, state: "done", progress: 100, status: "Done" };
  if (s.status === "RUNNING") return { name: title, state: "busy", progress: s.progress, status: `${Math.round(s.progress)}%` };
  if (s.status === "FAILED") return { name: title, state: "bad", progress: s.progress, status: `Failed${s.error_code ? ` (${s.error_code})` : ""}` };
  if (s.status === "CANCELLED") return { name: title, state: "bad", progress: null, status: "Cancelled" };
  return { name: title, state: "todo", progress: null, status: "Queued" };
}

/** card x, width, number-circle centre x, number, description lines, icon, icon x, bar end x, text x (the reference's ST table) */
const CARDS: [number, number, number, string, [string, string], string, number, number, number][] = [
  [760, 290, 811, "2", ["Detecting players, ball", "and match context..."], "bars", 828, 1036, 864],
  [1053, 287, 1105, "3", ["Tracking players, ball,", "team shapes, events..."], "u_tgt", 1123, 1308, 1158],
  [1346, 275, 1393, "4", ["Indexing key moments", "and metadata..."], "db", 1411, 1596, 1446],
  [1627, 263, 1674, "5", ["Ready for analysis", "and highlights..."], "ckc", 1692, 1878, 1727],
];

export function PipelinePreviewSection() {
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
    : run.status === "RUNNING" ? (run.job?.stage_message ?? "Analysing")
    : run.status === "QUEUED" ? "Analysis waiting for the worker"
    : run.status === "SUCCEEDED" ? "Analysis finished"
    : run.status === "FAILED" ? `Analysis failed${run.failure_code ? ` (${run.failure_code})` : ""}` : "Analysis cancelled";
  const cancelRun = () => {
    setConfirmCancel(false);
    if (!run) return;
    void api(`/v1/analysis-runs/${run.id}/cancel`, { method: "POST" }).then(
      async () => { await reloadRuns(); say("Analysis cancelled. Nothing it already found is lost; you can start it again from Processing."); },
      (x) => say(x instanceof ApiProblem ? x.message : "The analysis could not be cancelled", true));
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
    ? { name: "Uploading", state: transfer.state === "error" ? "bad" : "busy", progress: tPct ?? 0,
        status: transfer.state === "paused" ? `Paused at ${tPct ?? 0}%` : transfer.state === "error" ? (transfer.error ?? "Stopped") : `Uploading ${tPct ?? 0}%` }
    : !v ? { name: "Uploading", state: "todo", progress: null, status: "Awaiting upload" }
    : v.state === "PENDING" ? { name: "Uploading", state: "busy", progress: v.upload ? (100 * v.upload.received_bytes) / v.upload.expected_bytes : 0, status: "Upload not finished: drop the file again to resume" }
    : v.state === "VALIDATING" ? (v.job?.state === "QUEUED"
        ? { name: "Uploading", state: "busy", progress: 0, status: "Waiting for the worker" }
        : { name: "Uploading", state: "busy", progress: v.job?.progress ?? 0, status: `Checking the file${v.job ? ` ${Math.round(v.job.progress)}%` : ""}` })
    : v.state === "INGESTED" ? { name: "Uploading", state: "done", progress: 100, status: "Uploaded and verified" }
    : { name: "Uploading", state: "bad", progress: 100, status: v.failure_code ?? "Refused" };

  const ready = v?.state === "INGESTED";
  const detect = ready && !run
    ? { name: "AI Detection", state: "todo" as State, progress: null, status: "Not started",
        action: <Link href={`/processing?video=${v!.id}`} style={{ color: "#33a8ff", fontWeight: 600 }}>Analyse this video</Link> }
    : stepStage(run, "DETECT", "AI Detection");
  const track = stepStage(run, "TRACK", "Tracking");
  const index: Stage = { name: "Indexing", state: "unbuilt", progress: null, status: notBuilt() };
  const done: Stage = run?.status === "SUCCEEDED"
    ? { name: "Analysis Ready", state: "done", progress: 100, status: "Ready", action: <Link href={`/videos/${v!.id}/analyze`} style={{ color: "#33a8ff", fontWeight: 600 }}>Open analysis</Link> }
    : { name: "Analysis Ready", state: run?.status === "FAILED" ? "bad" : "todo", progress: null, status: run?.status === "FAILED" ? `Run failed${run.failure_code ? ` (${run.failure_code})` : ""}` : "Waiting..." };
  const stages = [detect, track, index, done];

  const identify = stepStage(run, "IDENTIFY", "Team identification");
  const live: [number, number, string, number | null, number, number][] = [
    [457, 396, "Player detection", detect.progress, 653, 852], [883, 299, "Ball tracking", detect.progress, 1018, 1182],
    [1212, 343, "Team identification", identify.progress, 1410, 1555], [1585, 297, "Metadata", v ? (v.state === "INGESTED" ? 100 : v.state === "VALIDATING" ? v.job?.progress ?? 0 : 0) : null, 1762, 1882],
  ];

  return (
    <section aria-label="Processing pipeline preview strip" data-section="p02-s10">
      <P x={438} y={1068} w={1462} h={358 + PIPE_EXTRA} />
      <Ic x={458} y={1093} k="u_tgt" size={34} color="#33a8ff" />
      <T x={487} y={1094} size={25} weight={600} as="h2">Processing Pipeline</T>
      {run && overall !== null && (
        <div role="progressbar" aria-label="Analysis progress" aria-valuenow={Math.round(overall)} aria-valuemin={0} aria-valuemax={100} data-analysis-status={run.status}>
          <T x={760} y={1094} size={19} color={run.status === "FAILED" ? "#ff9aa8" : "#cfe0f5"} style={{ maxWidth: u(190), overflow: "hidden", textOverflow: "ellipsis" }}>{overallText}</T>
          <B x={960} y={1089} w={300} h={10} style={{ background: "#12335f", borderRadius: u(5) }}>
            <i style={{ display: "block", height: "100%", width: `${Math.min(100, Math.max(run.status === "RUNNING" ? 1 : 0, overall))}%`, borderRadius: u(5), transition: "width .6s",
              background: run.status === "SUCCEEDED" ? "#3ee6a8" : run.status === "FAILED" || run.status === "CANCELLED" ? "#ff8a8a" : "#1e90ff" }} />
          </B>
          <T x={1278} y={1094} size={20} weight={600} color={run.status === "SUCCEEDED" ? "#3ee6a8" : "#33a8ff"}>{run.status === "QUEUED" || run.status === "CANCELLED" ? "—" : `${overall < 10 && overall > 0 ? overall.toFixed(1) : Math.round(overall)}%`}</T>
          {v && (
            <Link href={`/processing?video=${v.id}`} className="absolute" style={{ left: u(1352), top: u(1094 - 101 - 12), color: "#33a8ff", fontSize: u(18), fontWeight: 600, whiteSpace: "nowrap" }}>
              Follow in Processing →
            </Link>
          )}
        </div>
      )}
      {runActive && (
        <span className="absolute" style={{ left: u(1625), top: u(1094 - 101 - 14), display: "flex", gap: u(10), alignItems: "center", fontSize: u(18), whiteSpace: "nowrap" }}>
          {confirmCancel ? (
            <>
              <span style={{ color: "#ffc66d" }}>Cancel this analysis?</span>
              <button type="button" aria-label="Confirm: cancel the analysis" onClick={cancelRun} style={{ color: "#ff9aa8", fontWeight: 700, background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>Yes</button>
              <button type="button" onClick={() => setConfirmCancel(false)} style={{ color: "#cfe0f5", background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>No</button>
            </>
          ) : (
            <button type="button" aria-label="Cancel analysis" onClick={() => setConfirmCancel(true)}
              style={{ padding: `${u(4)} ${u(14)}`, borderRadius: u(14), border: `${u(1.5)} solid #7a3a48`, background: "transparent", color: "#ff9aa8", fontSize: u(18), fontFamily: "inherit", cursor: "pointer" }}>Cancel analysis</button>
          )}
        </span>
      )}
      <ol aria-label="Processing pipeline" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        <li data-stage="Uploading" data-stage-state={upload.state} data-transfer-state={transfer?.state ?? ""}>
          <B x={438} y={1122} w={319} h={155} style={{ background: "#04264a", border: `${u(2)} solid #1e90ff`, borderRadius: u(10) }} />
          <B x={451} y={1129} w={52} h={52} style={{ background: upload.state === "done" ? "#0f5a46" : "#0a84ff", borderRadius: "50%" }} />
          <Ic x={477} y={1155} k={upload.state === "done" ? "chk" : "ups"} size={30} />
          <T x={515} y={1154} size={24} weight={600} color="#33a8ff">Uploading</T>
          <B x={464} y={1204} w={26} h={26} style={{ background: upload.state === "done" ? "#3ee6a8" : upload.state === "bad" ? "#ff8a8a" : "#26364d", borderRadius: "50%" }} />
          <T x={516} y={1196} size={18} color="#cfe0f5" style={{ maxWidth: u(225), overflow: "hidden", textOverflow: "ellipsis" }}>
            {transfer && transfer.state !== "done" ? transfer.file.name : v ? (v.title ?? v.original_filename ?? "Video") : "No file uploaded"}
          </T>
          <T x={516} y={1223} size={18} color={upload.state === "bad" ? "#ff9aa8" : "#cfe0f5"} style={{ maxWidth: u(225), overflow: "hidden", textOverflow: "ellipsis" }}>
            {transfer && transfer.state !== "done" ? `${upload.status} · ${formatBytes(transfer.file.size)}` : upload.status}
          </T>
          <B x={457} y={1246} w={282} h={12} style={{ background: "#12335f", borderRadius: u(6) }}>
            <i style={{ display: "block", height: "100%", width: `${Math.min(100, upload.progress ?? 0)}%`, borderRadius: u(6), background: upload.state === "bad" ? "#ff8a8a" : "#1e90ff" }} />
          </B>
          {transfer && transfer.state !== "done" && (
            <span className="absolute" style={{ left: u(640), top: u(1140 - 101), display: "flex", gap: u(6), fontSize: u(15) }}>
              {transfer.state === "sending"
                ? <button type="button" aria-label={`Pause ${transfer.file.name}`} onClick={() => pause(transfer.id)} style={chip}>Pause</button>
                : <button type="button" aria-label={`Resume ${transfer.file.name}`} onClick={() => resume(transfer.id)} style={chip}>Resume</button>}
              <button type="button" aria-label={`Cancel ${transfer.file.name}`} onClick={() => void cancel(transfer)} style={chip}>Cancel</button>
            </span>
          )}
        </li>
        {CARDS.map(([x, w, cx, num, lines, icon, ix, barEnd, tx], i) => {
          const st = stages[i]!;
          const active = st.state === "busy";
          return (
            <li key={num} data-stage={st.name} data-stage-state={st.state}>
              <B x={x} y={1122} w={w} h={155} style={{ background: "#06142a", border: `${u(1.5)} solid ${st.state === "done" ? "#1a8a5e" : "#12335f"}`, borderRadius: u(10) }} />
              <B x={cx - 24} y={1122} w={48} h={48} style={st.state === "done" ? { background: "#0f5a46", borderRadius: "50%" } : active ? { background: "#0a84ff", borderRadius: "50%" }
                : { background: "#0a1d38", border: `${u(2)} solid #4a8ad8`, borderRadius: "50%" }} />
              <T x={cx} y={1146} size={22} weight={600} align="center">{st.state === "done" ? "✓" : num}</T>
              <T x={cx + 35} y={1148} size={22} color="#33a8ff">{st.name}</T>
              <Ic x={ix} y={1194} k={icon} size={34} color="#33a8ff" />
              <T x={tx} y={1183} size={17} color="#cfe0f5">{lines[0]}</T>
              <T x={tx} y={1206} size={17} color="#cfe0f5">{lines[1]}</T>
              {st.action ? (
                <span className="absolute" style={{ left: u(cx - 24), top: u(1241 - 101 - 11), fontSize: u(17), lineHeight: u(22), whiteSpace: "nowrap" }}>{st.action}</span>
              ) : (
                <T x={cx - 24} y={1241} size={active ? 19 : 17} weight={active ? 600 : 400} color={active ? "#33a8ff" : st.state === "bad" ? "#ff9aa8" : st.state === "done" ? "#3ee6a8" : "#8ea3bf"}>{st.status}</T>
              )}
              <B x={cx - 24} y={1253} w={barEnd - cx + 24} h={10} style={{ background: "#12335f", borderRadius: u(5) }}>
                <i style={{ display: "block", height: "100%", width: `${Math.min(100, st.progress ?? 0)}%`, borderRadius: u(5), background: st.state === "done" ? "#3ee6a8" : "#1e90ff" }} />
              </B>
            </li>
          );
        })}
      </ol>
      {[775, 1069, 1358, 1640].map((x) => <Ic key={x} x={x} y={1200} k="arrow" size={26} color="#1e90ff" />)}

      <B x={438} y={1290} w={1462} h={136 + PIPE_EXTRA} style={{ background: "rgba(5,16,34,.7)", border: `${u(1.5)} solid #12335f`, borderRadius: u(10) }} />
      <T x={457} y={1300} size={19} color="#e3eefb">Live Processing Preview</T>
      <B x={677} y={1300} w={14} h={2} style={{ background: "#8ea3bf" }} />
      <ul aria-label="Live processing preview" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {live.map(([x, w, label, p, b0, b1], i) => (
          <li key={label} data-output={label} data-progress={p === null ? "" : String(Math.round(p))}>
            <B x={x} y={1316} w={w} h={74 + PIPE_EXTRA} style={{ borderRadius: u(5), background: thumb ? `center / cover no-repeat url(${thumb}), #0a1d38` : pitchThumb(25 + i * 12) }} />
            {p === 100 && (
              <>
                <B x={x} y={1400 + PIPE_EXTRA} w={16} h={16} style={{ background: "#17c27a", borderRadius: "50%" }} />
                <Ic x={x + 8} y={1408 + PIPE_EXTRA} k="chk" size={10} color="#04210f" />
              </>
            )}
            <T x={x + (p === 100 ? 21 : 0)} y={1408 + PIPE_EXTRA} size={17} color="#d6e4f7">{label}</T>
            <B x={b0} y={1405 + PIPE_EXTRA} w={b1 - b0} h={7} style={{ background: "#12335f", borderRadius: u(4) }}>
              <i style={{ display: "block", height: "100%", width: `${Math.min(100, p ?? 0)}%`, borderRadius: u(4), background: p === 100 ? "#3ee6a8" : "#1e90ff" }} />
            </B>
          </li>
        ))}
      </ul>
      {[868, 1197, 1570].map((x) => <B key={x} x={x} y={1305} w={1} h={110 + PIPE_EXTRA} style={{ background: "#12335f" }} />)}
    </section>
  );
}

const chip = { padding: `${u(3)} ${u(8)}`, borderRadius: u(5), border: `${u(1.5)} solid #1d4f8a`, background: "#0a2447", color: "#e3eefb", font: "inherit", cursor: "pointer" };
