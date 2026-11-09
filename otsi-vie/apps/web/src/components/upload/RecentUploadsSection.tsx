"use client";
/**
 * Page 02 Section 08 — recent uploads panel (approved reference 02_UPLOAD_INGEST, "right: recent").
 *
 * The organization's five newest videos (GET /v1/videos, followed every few seconds while anything uploads or is being checked): the
 * frame decoded from the file, measured length, date and size, and the real state — uploading with this page's own progress, checked by
 * the ingest worker with its progress, ready, quarantined or failed. A row selects the video for the preview and the pipeline; ⋮ opens
 * it in Processing, the Analysis workspace or the Tactical view. View All opens the Library.
 */
import type { RemovalPreview, Video } from "@otsi-vie/contracts";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { B, Ic, P, T, u } from "@/components/stage/DesignStage";
import { api, apiBlob, ApiProblem } from "@/lib/api";
import { formatBytes, videoStatusLabel } from "@/lib/format";
import { RIGHT_EXTRA } from "./layout";
import { mmss, pitchThumb, usePage02 } from "./page02";
import { useUpload } from "./UploadWorkspace";

/** row centre y, title y, second line y, third line y */
const ROWS: [number, number, number, number][] = [[251, 226, 254, 282], [360, 335, 363, 391], [471, 443, 473, 502], [583, 557, 586, 615], [697, 671, 701, 729]];
const TONE: Record<string, [string, string]> = { ok: ["#3ee6a8", "#063a2a"], busy: ["#7fd0ff", "#06305a"], warn: ["#ffc66d", "#3a2a06"], bad: ["#ff9aa8", "#3a0f18"], idle: ["#cfe0f5", "#1a2840"] };

function Thumb({ v, x, y, a }: { v: Video | undefined; x: number; y: number; a: number }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    setSrc(null);
    if (!v?.has_thumbnail) return;
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${v.id}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [v?.id, v?.has_thumbnail]);
  return <B x={x} y={y} w={153} h={88} style={{ borderRadius: u(5), background: src ? `center / cover no-repeat url(${src}), #0a1d38` : pitchThumb(a), pointerEvents: "none" }} />;
}

export function RecentUploadsSection() {
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
      async () => { await reloadVideos(); say(`Analysis of ${v.title ?? v.original_filename ?? "the video"} cancelled. You can start it again from Processing.`); },
      (x) => say(x instanceof ApiProblem ? x.message : "The analysis could not be cancelled", true));
  };
  const cancelPlayback = (v: Video) => {
    setConfirm(null);
    void api(`/v1/videos/${v.id}/playback-copy/cancel`, { method: "POST" }).then(
      async () => { await reloadVideos(); say(`Playback copy of ${v.title ?? v.original_filename ?? "the video"} cancelled. You can make it again from the row.`); },
      (x) => say(x instanceof ApiProblem ? x.message : "The playback copy could not be cancelled", true));
  };
  const makePlayback = (v: Video) => {
    void api(`/v1/videos/${v.id}/playback-copy`, { method: "POST" }).then(
      async () => { await reloadVideos(); say("The playback copy is being made again."); },
      (x) => say(x instanceof ApiProblem ? x.message : "The playback copy could not be started", true));
  };
  const remove = (v: Video) => {
    setConfirm(null); setMenu(null);
    void api(`/v1/library/video/${v.id}`, { method: "DELETE" }).then(
      async () => {
        await reloadVideos();
        const name = v.title ?? v.original_filename ?? "the upload";
        say(`Removed ${name}`);
        if (v.state === "INGESTED") offerUndo({ id: v.id, title: name });      // only a verified video can be restored
      },
      (x) => say(x instanceof ApiProblem ? x.message : "The upload could not be removed", true));
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
      if (v.job?.kind === "PROXY" && v.job.state === "RUNNING") out.push({ pct: v.job.progress, tone: "busy", label: "Playback copy" });
      else if (v.job?.kind === "PROXY" && v.job.state === "QUEUED") out.push({ pct: 0, tone: "idle", label: "Playback copy" });
      if (v.analysis?.status === "RUNNING") out.push({ pct: v.analysis.progress ?? 0, tone: "busy", label: "Analysis" });
      else if (v.analysis?.status === "QUEUED") out.push({ pct: 0, tone: "idle", label: "Analysis" });
      return out;
    }
    const b = barOf(v);
    return b ? [{ ...b, label: "Upload" }] : [];
  };
  const progressOf = (v: Video) => {
    const t = transfers.find((x) => x.videoId === v.id || (x.state !== "done" && x.file.name === v.original_filename && x.file.size === v.byte_size));
    if (t && t.state !== "done" && t.progress) return { text: `${t.state === "paused" ? "Paused" : "Uploading"} ${Math.floor((100 * t.progress.sentBytes) / t.progress.totalBytes)}%`, tone: t.state === "error" ? "bad" : "busy" };
    if (v.state === "INGESTED") {
      const parts: string[] = [];
      if (v.job?.kind === "PROXY" && v.job.state === "RUNNING") parts.push(`Playback ${Math.round(v.job.progress)}%`);
      else if (v.job?.kind === "PROXY" && v.job.state === "QUEUED") parts.push("Playback waiting");
      else if (v.job?.kind === "PROXY" && v.job.state === "CANCELLED") parts.push("Playback cancelled");
      if (v.analysis?.status === "RUNNING") parts.push(`Analysing ${Math.round(v.analysis.progress ?? 0)}%`);
      else if (v.analysis?.status === "QUEUED") parts.push("Analysis waiting");
      if (parts.length) return { text: parts.join(" · "), tone: parts.some((x) => x.endsWith("%")) ? "busy" : "idle" };
    }
    // a job that has not started is WAITING for the worker (one process runs one job at a time), not checking at 0%
    if (v.job?.state === "QUEUED" && v.state !== "FAILED" && v.state !== "QUARANTINED") return { text: v.state === "INGESTED" ? "Playback copy waiting" : "Waiting for the worker", tone: "idle" };
    if (v.state === "VALIDATING" && v.job) return { text: `Checking ${Math.round(v.job.progress)}%`, tone: "busy" };
    if (v.state === "INGESTED" && v.job?.kind === "PROXY" && v.job.state === "RUNNING") return { text: `Playback copy ${Math.round(v.job.progress)}%`, tone: "busy" };
    if (v.analysis?.status === "RUNNING") return { text: `Analysing ${Math.round(v.analysis.progress ?? 0)}%`, tone: "busy" };
    if (v.analysis?.status === "QUEUED") return { text: "Analysis waiting", tone: "idle" };
    const s = videoStatusLabel(v);
    return { text: s.label, tone: s.tone };
  };

  return (
    <section aria-label="Recent uploads panel" data-section="p02-s08" data-count={String(videos?.length ?? 0)}>
      <P x={1923} y={134} w={612} h={626 + RIGHT_EXTRA} />
      <T x={1943} y={165} size={28} weight={600} as="h2">Recent Uploads</T>
      <Link href="/library" className="absolute" style={{ left: u(2506 - 90), top: u(166 - 101 - 12), width: u(90), height: u(24), color: "#33a8ff", fontSize: u(20),
        textAlign: "right", textDecoration: "none", lineHeight: u(24) }}>View All</Link>
      <B x={1943} y={198} w={574} h={1} style={{ background: "#12335f" }} />
      <ul aria-label="Recent uploads" style={{ margin: 0, padding: 0, listStyle: "none" }}>
        {ROWS.map(([y0, ty00, y200, y300], i) => {
          const sh = RIGHT_EXTRA / 10 + (RIGHT_EXTRA / 5) * i;          // each of the five boxes is taller by RIGHT_EXTRA / 5: half of it above, half below
          const y = y0 + sh, ty0 = ty00 + sh, y20 = y200 + sh, y3 = y300 + sh;
          const v = rows[i];
          // a verified video with running jobs has four lines (title, date, one line per job): they are spread over the whole height of the box
          // (the bottom of the box was empty) so none is squeezed against another
          const spread = !!v && v.state === "INGESTED" && barsOf(v).length > 0;
          const ty = spread ? y - 38 : ty0;
          const y2 = spread ? y - 14 : y20;
          const sel = !!v && selected?.id === v.id;
          const p = v ? progressOf(v) : null;
          const [fg, bg] = TONE[p?.tone ?? "idle"] ?? TONE.idle!;
          const first = i === 0 && !v;
          return (
            <li key={y}>
              {sel && <B x={1931} y={y - 50 - RIGHT_EXTRA / 10} w={596} h={100 + RIGHT_EXTRA / 5} style={{ background: "#04264a", border: `${u(2)} solid #1e90ff`, borderRadius: u(8) }} />}
              <Thumb v={v} x={1943} y={y - 44} a={20 + i * 8} />
              {!v && (
                <>
                  <B x={2034} y={y + 17} w={58} h={24} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(4) }} />
                  <T x={2063} y={y + 29} size={19} weight={600} align="center">—</T>
                </>
              )}
              {v ? (
                <button type="button" onClick={() => select(v.id)} aria-pressed={sel} aria-label={`${v.title ?? v.original_filename}: ${p!.text}`} className="absolute"
                  style={{ left: u(1943), top: u(y - 50 - 101), width: u(550), height: u(100), padding: 0, border: 0, background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
                  <B o={[1943, y - 50]} x={2034} y={y + 17} w={58} h={24} style={{ background: "rgba(0,10,25,.8)", borderRadius: u(4) }} />
                  <T o={[1943, y - 50]} x={2063} y={y + 29} size={19} weight={600} align="center" as="span">{mmss(v.duration_us)}</T>
                  <T o={[1943, y - 50]} x={2115} y={ty} size={20} weight={600} as="span" style={{ maxWidth: u(v.state === "INGESTED" && canWrite && (analysing(v) || (v.job?.kind === "PROXY" && v.job.state !== "SUCCEEDED")) ? 140 : 370), overflow: "hidden", textOverflow: "ellipsis" }}>{v.title ?? v.original_filename ?? "Untitled video"}</T>
                  <T o={[1943, y - 50]} x={2115} y={y2} size={18} color="#9fb3cc" as="span">
                    {`${new Date(v.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · ${formatBytes(v.byte_size)}`}
                  </T>
                  {!(v.state === "INGESTED" && barsOf(v).length > 0) && <span data-video-state={v.state} style={{ position: "absolute", left: u(2115 - 1943), top: u(y3 - (y - 50) - 13), height: u(26), padding: `0 ${u(10)}`,
                    borderRadius: u(13), background: bg, color: fg, fontSize: u(16), fontWeight: 600, lineHeight: u(26), whiteSpace: "nowrap" }}>{p!.text}</span>}
                  {barsOf(v).map((b, i, all) => {
                    const lines = v.state === "INGESTED";        // one labelled line per job, each with its own bar
                    const ly = lines ? y + (all.length === 2 ? (i === 0 ? 12 : 38) : 22) : y3 + 16;
                    const color = b.label === "Analysis" ? "#1e90ff" : "#33d0c8";       // one colour per job, always: playback copy teal, analysis blue
                    return (
                      <Fragment key={b.label}>
                        {lines && <T o={[1943, y - 50]} x={2115} y={ly} size={15} weight={600} color={b.tone === "idle" ? "#ffc66d" : "#e3eefb"} as="span">
                          {b.tone === "idle" ? `${b.label} · waiting` : `${b.label} ${Math.round(b.pct)}%`}</T>}
                        <B o={[1943, y - 50]} x={lines ? 2262 : 2115} y={lines ? ly - 4 : ly} w={lines ? 215 : 290} h={lines ? 8 : 6} style={{ background: "#12335f", borderRadius: u(4) }}>
                          <i role="progressbar" aria-label={`${v.title ?? v.original_filename}: ${b.label} progress`} aria-valuenow={Math.round(b.pct)} aria-valuemin={0} aria-valuemax={100}
                            style={{ display: "block", height: "100%", width: `${Math.min(100, Math.max(b.tone === "idle" ? 0 : 2, b.pct))}%`, borderRadius: u(4), background: color, transition: "width .6s" }} />
                        </B>
                      </Fragment>
                    );
                  })}
                </button>
              ) : (
                <>
                  <T x={2115} y={ty} size={20} weight={600}>{first ? (videos === null ? "Loading…" : "No uploads yet") : "—"}</T>
                  <T x={2115} y={y2} size={18} color="#9fb3cc">{first ? "Uploaded videos appear here" : "—"}</T>
                  {first && <T x={2115} y={y3} size={18} color="#9fb3cc">—</T>}
                </>
              )}
              {v && canWrite && v.state !== "INGESTED" && (() => {
                const stop = analysing(v), gone = v.state === "FAILED" || v.state === "QUARANTINED", t = transferOf(v), name = v.title ?? v.original_filename;
                const verb = stop ? "Cancel analysis" : gone ? "Remove" : "Cancel";
                return confirm === v.id ? (
                  <span className="absolute" style={{ left: u(2330), top: u(y3 - 101 - 12), display: "flex", gap: u(10), fontSize: u(17), whiteSpace: "nowrap", zIndex: 5, color: "#ffc66d" }}>
                    {stop ? "Cancel analysis?" : gone ? "Remove?" : "Cancel upload?"}
                    <button type="button" aria-label={`Confirm: ${verb.toLowerCase()} ${name}`} onClick={() => (stop ? stopAnalysis(v) : remove(v))}
                      style={{ color: "#ff9aa8", fontWeight: 700, background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>Yes</button>
                    <button type="button" onClick={() => setConfirm(null)} style={{ color: "#cfe0f5", background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>No</button>
                  </span>
                ) : (
                  <>
                    {t && (t.state === "sending" || t.state === "paused" || t.state === "error") && (
                      <button type="button" aria-label={`${t.state === "sending" ? "Pause" : "Resume"} ${name}`} onClick={() => (t.state === "sending" ? pause(t.id) : resume(t.id))} className="absolute"
                        style={{ left: u(2310), top: u(y3 - 101 - 12), height: u(24), padding: `0 ${u(10)}`, borderRadius: u(12), border: `${u(1.5)} solid #1d4f8a`, background: "transparent", color: "#cfe0f5",
                          fontSize: u(15), fontFamily: "inherit", cursor: "pointer", zIndex: 5 }}>{t.state === "sending" ? "Pause" : "Resume"}</button>
                    )}
                    <button type="button" aria-label={`${verb} ${name}`} onClick={() => setConfirm(v.id)} className="absolute"
                      style={{ left: u(stop ? 2392 : 2400), top: u(y3 - 101 - 12), height: u(24), padding: `0 ${u(8)}`, borderRadius: u(12), border: `${u(1.5)} solid #7a3a48`, background: "transparent", color: "#ff9aa8",
                        fontSize: u(stop ? 13 : 15), fontFamily: "inherit", cursor: "pointer", zIndex: 5 }}>{stop ? "Cancel analysis" : !gone ? "Cancel" : "Remove"}</button>
                  </>
                );
              })()}
              {v && canWrite && v.state === "INGESTED" && (() => {
                const proxyOn = v.job?.kind === "PROXY" && (v.job.state === "RUNNING" || v.job.state === "QUEUED");
                const proxyStopped = v.job?.kind === "PROXY" && v.job.state === "CANCELLED";
                const anaOn = analysing(v), name = v.title ?? v.original_filename;
                const key = (k: string) => `${v.id}:${k}`;
                const pill = (left: number, label: string, aria: string, onClick: () => void, tone: "stop" | "go") => (
                  <button type="button" aria-label={aria} onClick={onClick} className="absolute"
                    style={{ left: u(left), top: u(ty - 101 - 12), height: u(24), padding: `0 ${u(8)}`, borderRadius: u(12), border: `${u(1.5)} solid ${tone === "stop" ? "#7a3a48" : "#1d6fb8"}`,
                      background: "transparent", color: tone === "stop" ? "#ff9aa8" : "#7fd0ff", fontSize: u(13), fontFamily: "inherit", cursor: "pointer", zIndex: 5, whiteSpace: "nowrap" }}>{label}</button>
                );
                const ask = (text: string, yes: () => void) => (
                  <span className="absolute" style={{ left: u(2290), top: u(ty - 101 - 12), display: "flex", gap: u(10), fontSize: u(15), whiteSpace: "nowrap", zIndex: 5, color: "#ffc66d" }}>
                    {text}
                    <button type="button" aria-label={`Confirm: ${text.replace("?", "").toLowerCase()}`} onClick={yes} style={{ color: "#ff9aa8", fontWeight: 700, background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>Yes</button>
                    <button type="button" onClick={() => setConfirm(null)} style={{ color: "#cfe0f5", background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>No</button>
                  </span>
                );
                if (confirm === key("proxy")) return ask("Cancel playback copy?", () => cancelPlayback(v));
                if (confirm === key("analysis")) return ask("Cancel analysis?", () => stopAnalysis(v));
                return (
                  <>
                    {proxyOn && pill(2262, "Cancel playback", `Cancel the playback copy of ${name}`, () => setConfirm(key("proxy")), "stop")}
                    {anaOn && pill(proxyOn ? 2378 : 2262, "Cancel analysis", `Cancel the analysis of ${name}`, () => setConfirm(key("analysis")), "stop")}
                    {proxyStopped && pill(2262, "Make playback copy", `Make the playback copy of ${name} again`, () => makePlayback(v), "go")}
                  </>
                );
              })()}
              <button type="button" aria-label={v ? `More for ${v.title ?? v.original_filename}` : "No upload in this row"} aria-expanded={menu === v?.id}
                onClick={() => { setConfirm(null); setMenu((m) => (v && m !== v.id ? v.id : null)); }} className="absolute"
                style={{ left: u(2496), top: u(y - 16 - 101), width: u(28), height: u(32), padding: 0, border: 0, background: "transparent", cursor: "pointer" }}>
                <Ic o={[2496, y - 16]} x={2510} y={y} k="dots" size={22} color={v ? "#cfe0f5" : "#4a5a78"} />
              </button>
              {v && menu === v.id && (
                <nav aria-label="Open this video" className="absolute" style={{ left: u(2290), top: u(y + 18 - 101), width: u(230), zIndex: 6, background: "#081a35",
                  border: `${u(1.5)} solid #1d4f8a`, borderRadius: u(8), padding: u(6), display: "flex", flexDirection: "column", fontSize: u(18) }}>
                  {v.state === "INGESTED" ? (
                    <>
                      <Link href={`/processing?video=${v.id}`} style={{ padding: u(7), color: "#e3eefb" }}>Processing</Link>
                      <Link href={`/videos/${v.id}/analyze`} style={{ padding: u(7), color: "#e3eefb" }}>Analysis workspace</Link>
                      <Link href={`/tactics?video=${v.id}`} style={{ padding: u(7), color: "#e3eefb" }}>Tactical view</Link>
                    </>
                  ) : <span style={{ padding: u(7), color: "#8ea3bf" }}>Available once the video is verified</span>}
                  {canWrite && (
                    confirm === v.id ? (
                      <span style={{ display: "flex", flexWrap: "wrap", gap: u(8), padding: u(7), alignItems: "center", color: "#ffc66d", maxWidth: u(420), whiteSpace: "normal" }}>
                        {!takes ? "Checking…" : takes.blocked ? takes.blocked
                          : "Move to the Trash? You can restore it from Library › Trash."}
                        {takes && !takes.blocked && <button type="button" onClick={() => remove(v)} style={{ color: "#ff9aa8", fontWeight: 700, background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>Yes</button>}
                        <button type="button" onClick={() => setConfirm(null)} style={{ color: "#cfe0f5", background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>No</button>
                      </span>
                    ) : <button type="button" onClick={() => setConfirm(v.id)} style={{ textAlign: "left", padding: u(7), color: "#ff9aa8", background: "transparent", border: 0, cursor: "pointer", font: "inherit" }}>Remove this upload</button>
                  )}
                </nav>
              )}
              {i < 4 && <B x={1943} y={y + 54 + RIGHT_EXTRA / 10} w={574} h={1} style={{ background: "#10294a" }} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
