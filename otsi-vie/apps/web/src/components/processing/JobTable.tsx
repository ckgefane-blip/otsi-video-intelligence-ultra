"use client";
/**
 * Page 03 — the video's job table (v3 Phase A.4, ADR-061), below the timeline. Every engine job of this video (its ingest, playback copy,
 * footage check, analyses, ball, pitch, team sheets and its reels' renders) as the worker recorded it: state, progress, step, machine,
 * start, duration and, for an analysis, the footage check's estimate next to the real duration. Filters by state and kind; pause, resume,
 * priority, cancel and retry are the server's own actions (the same as the top-bar job tray).
 */
import type { Job, JobList, JobPriority } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { B, T, u } from "@/components/stage/DesignStage";
import { api, ApiProblem } from "@/lib/api";
import { duration, STATE_COLOR, STATE_LABEL } from "@/lib/jobs";

export const JOB_TABLE_EXTRA = 450;            // design pixels the page grows below the reference for this table
const Y = 1432, H = 430;

/** the video's jobs, read every 3 s while one is active, else every 15 s */
export function useVideoJobs(videoId: string | null): { list: JobList | null; reload: () => Promise<void> } {
  const [list, setList] = useState<JobList | null>(null);
  const reload = useCallback(async () => {
    if (!videoId) return;
    try { setList(await api<JobList>(`/v1/jobs?video_id=${videoId}`)); } catch { /* keep the last list */ }
  }, [videoId]);
  useEffect(() => { setList(null); void reload(); }, [reload]);
  const every = (list?.active ?? 0) > 0 ? 3000 : 15000;
  useEffect(() => {
    if (!videoId) return;
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") void reload(); }, every);
    return () => window.clearInterval(t);
  }, [videoId, every, reload]);
  return { list, reload };
}

type Filter = "ALL" | "ACTIVE" | "FAILED" | "FINISHED";
const FILTERS: [Filter, string][] = [["ALL", "All"], ["ACTIVE", "Active"], ["FAILED", "Failed"], ["FINISHED", "Finished"]];
const isActiveJob = (j: Job) => j.state === "QUEUED" || j.state === "RUNNING" || j.state === "PAUSED";
const clock = (at: string | null) => (at ? new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function JobTable({ list, reload }: { list: JobList | null; reload: () => Promise<void> }) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [kind, setKind] = useState<string>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const jobs = (list?.jobs ?? []).filter((j) => (filter === "ALL" || (filter === "ACTIVE" ? isActiveJob(j) : filter === "FAILED" ? j.state === "FAILED" : !isActiveJob(j) && j.state !== "FAILED"))
    && (kind === "ALL" || j.kind === kind));
  const kinds = [...new Map((list?.jobs ?? []).map((j) => [j.kind, j.kind_label])).entries()];
  const act = async (j: Job, path: string, json?: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(j.id); setMsg(null);
    try {
      await api<Job>(`/v1/jobs/${j.id}/${path}`, { method: "POST", json: json ?? {} });
      setMsg({ ok: true, text: path === "retry" ? `${j.kind_label} started again; the earlier attempt is kept.` : `${j.kind_label}: done.` });
    } catch (x) {
      setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : "That did not work; try again." });
    } finally { setBusy(null); void reload(); }
  };
  const btn = { padding: `${u(2)} ${u(10)}`, border: `${u(1.5)} solid #1e3f66`, borderRadius: u(6), background: "#0a1f3a", color: "#cfe3ff", fontSize: u(15), cursor: "pointer", fontFamily: "inherit" };

  return (
    <section aria-label="Jobs of this video" data-section="p03-jobs">
      <B x={43} y={Y} w={2487} h={H} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
      <B x={58} y={Y + 20} w={7} h={52} style={{ background: "#1e90ff", borderRadius: u(3) }} />
      <T x={75} y={Y + 32} size={25} weight={700} as="h2">Jobs</T>
      <T x={75} y={Y + 63} size={19} color="#b3c4dc">{list ? `Every engine job of this video · ${list.running} running · ${list.active - list.running} waiting or paused` : "Reading…"}</T>
      <div className="absolute" style={{ left: u(900), top: u(Y + 18 - 101), display: "flex", gap: u(8), alignItems: "center", fontSize: u(16) }}>
        {FILTERS.map(([f, l]) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-job-filter={f}
            style={{ ...btn, background: filter === f ? "#1580ff" : btn.background, color: filter === f ? "#fff" : btn.color }}>{l}</button>
        ))}
        <select aria-label="Kind of job" value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...btn, marginLeft: u(8) }} data-job-kind-filter>
          <option value="ALL">Every kind</option>
          {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {msg && <span role={msg.ok ? "status" : "alert"} style={{ marginLeft: u(14), color: msg.ok ? "#3ee6a8" : "#ff8a8a" }}>{msg.text}</span>}
      </div>
      <div className="absolute" style={{ left: u(58), top: u(Y + 92 - 101), width: u(2457), height: u(H - 106), overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: u(16), color: "#cfdcf0" }}>
          <thead>
            <tr style={{ color: "#8ea3bf", textAlign: "left", position: "sticky", top: 0, background: "#07162d" }}>
              {["Job", "State", "Progress", "Step", "Machine", "Started", "Duration", "Estimate", "Priority", ""].map((h, i) => (
                <th key={i} scope="col" style={{ padding: `${u(6)} ${u(10)}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list && jobs.length === 0 && <tr><td colSpan={10} style={{ padding: u(18), color: "#8ea3bf" }}>{list.jobs.length ? "No job matches this filter." : "No engine job has run for this video yet."}</td></tr>}
            {jobs.map((j) => {
              const can = (a: Job["actions"][number]) => j.actions.includes(a);
              const real = duration(j.started_at, j.finished_at);
              return (
                <tr key={j.id} data-job-row={j.kind} data-job-state={j.state} style={{ borderTop: `${u(1)} solid #12335f` }}>
                  <td style={{ padding: `${u(6)} ${u(10)}`, maxWidth: u(420), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b>{j.kind_label}</b>{j.kind === "RENDER" && j.subject_title ? ` · ${j.subject_title}` : ""}{j.attempts > 1 ? ` · attempt ${j.attempts}` : ""}
                  </td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, color: STATE_COLOR[j.state], whiteSpace: "nowrap" }}>{STATE_LABEL[j.state]}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, width: u(170) }}>
                    <span style={{ display: "inline-block", width: u(100), height: u(7), background: "#17304f", borderRadius: u(4), verticalAlign: "middle" }}>
                      <i style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR[j.state], borderRadius: u(4) }} />
                    </span>{" "}{Math.round(j.progress)}%
                  </td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, maxWidth: u(460), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: j.state === "FAILED" ? "#ff8a8a" : undefined }}
                    title={j.state === "FAILED" ? (j.error ?? "") : (j.stage ?? "")}>{j.state === "FAILED" ? (j.error ?? "Failed") : (j.stage ?? "—")}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }}>{j.worker ?? "—"}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }}>{clock(j.started_at)}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }}>{real ?? (j.state === "RUNNING" ? "running" : "—")}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }} title={j.estimate_s !== null ? "Estimate from the footage check (not a measurement)" : undefined}>
                    {j.estimate_s !== null ? `about ${duration(null, null, j.estimate_s)}` : "—"}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}` }}>
                    {can("priority") ? (
                      <select aria-label={`${j.kind_label} priority`} value={j.priority} disabled={busy === j.id} style={btn}
                        onChange={(e) => void act(j, "priority", { priority: e.target.value as JobPriority })}>
                        <option value="HIGH">High</option><option value="NORMAL">Normal</option><option value="LOW">Low</option>
                      </select>
                    ) : <span style={{ color: "#6b7a92" }}>{j.priority === "NORMAL" ? "Normal" : j.priority === "HIGH" ? "High" : "Low"}</span>}
                  </td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap", textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: u(6) }}>
                      {can("pause") && <button type="button" style={btn} disabled={busy === j.id} onClick={() => void act(j, "pause")}>Pause</button>}
                      {can("resume") && <button type="button" style={btn} disabled={busy === j.id} onClick={() => void act(j, "resume")}>Resume</button>}
                      {can("cancel") && <button type="button" style={btn} disabled={busy === j.id}
                        onClick={() => void act(j, "cancel", undefined, j.state === "RUNNING" ? `Stop this ${j.kind_label.toLowerCase()}? The work done so far is not kept.` : undefined)}>Cancel</button>}
                      {can("retry") && <button type="button" style={btn} disabled={busy === j.id} onClick={() => void act(j, "retry")}>Retry</button>}
                      {j.href && j.kind === "RENDER" && <Link href={j.href} style={{ ...btn, textDecoration: "none" }}>Open</Link>}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
