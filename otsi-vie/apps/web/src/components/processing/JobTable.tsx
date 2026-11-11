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
import { useLocale } from "@/lib/i18n";
import { duration, STATE_COLOR, STATE_LABEL } from "@/lib/jobs";
import { DATE_TAG } from "./model";

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
const FILTERS: Filter[] = ["ALL", "ACTIVE", "FAILED", "FINISHED"];
const isActiveJob = (j: Job) => j.state === "QUEUED" || j.state === "RUNNING" || j.state === "PAUSED";
const clock = (at: string | null, tag = "en-GB") => (at ? new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function JobTable({ list, reload }: { list: JobList | null; reload: () => Promise<void> }) {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const up = dict.body.upload;
  const tag = DATE_TAG[locale];
  const [filter, setFilter] = useState<Filter>("ALL");
  const [kind, setKind] = useState<string>("ALL");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** the state word for a job: the shared lib's label is English-only, so it is translated here. */
  const stateLabel = (s: Job["state"]) => ({ QUEUED: d.stageWaiting, RUNNING: d.ribbonRunning, PAUSED: d.jobPaused,
    SUCCEEDED: d.jobFinished, FAILED: d.stageFailed, CANCELLED: d.stageCancelled } as Record<string, string>)[s] ?? STATE_LABEL[s];
  /** the filter chip's word for a key. */
  const filterLabel = (f: Filter) => ({ ALL: d.filterAll, ACTIVE: d.filterActive, FAILED: d.filterFailed, FINISHED: d.filterFinished } as Record<Filter, string>)[f];
  /** the priority word for a value. */
  const priorityLabel = (v: string) => (v === "NORMAL" ? d.priorityNormal : v === "HIGH" ? d.priorityHigh : d.priorityLow);
  const jobs = (list?.jobs ?? []).filter((j) => (filter === "ALL" || (filter === "ACTIVE" ? isActiveJob(j) : filter === "FAILED" ? j.state === "FAILED" : !isActiveJob(j) && j.state !== "FAILED"))
    && (kind === "ALL" || j.kind === kind));
  const kinds = [...new Map((list?.jobs ?? []).map((j) => [j.kind, j.kind_label])).entries()];
  const act = async (j: Job, path: string, json?: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(j.id); setMsg(null);
    try {
      await api<Job>(`/v1/jobs/${j.id}/${path}`, { method: "POST", json: json ?? {} });
      setMsg({ ok: true, text: path === "retry" ? d.jobRetried.replace("{kind}", j.kind_label) : d.jobDone.replace("{kind}", j.kind_label) });
    } catch (x) {
      setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : d.didNotWork });
    } finally { setBusy(null); void reload(); }
  };
  const btn = { padding: `${u(2)} ${u(10)}`, border: `${u(1.5)} solid #1e3f66`, borderRadius: u(6), background: "#0a1f3a", color: "#cfe3ff", fontSize: u(15), cursor: "pointer", fontFamily: "inherit" };

  return (
    <section aria-label={d.jobs} data-section="p03-jobs">
      <B x={43} y={Y} w={2487} h={H} style={{ border: `${u(1.5)} solid #12335f`, borderRadius: u(10), background: "linear-gradient(180deg,#081a35,#06122a)" }} />
      <B x={58} y={Y + 20} w={7} h={52} style={{ background: "#1e90ff", borderRadius: u(3) }} />
      <T x={75} y={Y + 32} size={25} weight={700} as="h2">{d.jobs}</T>
      <T x={75} y={Y + 63} size={19} color="#b3c4dc">{list ? d.jobsSubtitle.replace("{running}", String(list.running)).replace("{waiting}", String(list.active - list.running)) : d.reading}</T>
      <div className="absolute" style={{ left: u(900), top: u(Y + 18 - 101), display: "flex", gap: u(8), alignItems: "center", fontSize: u(16) }}>
        {FILTERS.map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-job-filter={f}
            style={{ ...btn, background: filter === f ? "#1580ff" : btn.background, color: filter === f ? "#fff" : btn.color }}>{filterLabel(f)}</button>
        ))}
        <select aria-label={d.kindOfJob} value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...btn, marginLeft: u(8) }} data-job-kind-filter>
          <option value="ALL">{d.everyKind}</option>
          {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {msg && <span role={msg.ok ? "status" : "alert"} style={{ marginLeft: u(14), color: msg.ok ? "#3ee6a8" : "#ff8a8a" }}>{msg.text}</span>}
      </div>
      <div className="absolute" style={{ left: u(58), top: u(Y + 92 - 101), width: u(2457), height: u(H - 106), overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: u(16), color: "#cfdcf0" }}>
          <thead>
            <tr style={{ color: "#8ea3bf", textAlign: "left", position: "sticky", top: 0, background: "#07162d" }}>
              {[d.jobHeader, d.stateHeader, d.progressHeader, d.stepHeader, d.machineHeader, d.startedHeader, d.durationHeader, d.estimateHeader, d.priorityHeader, ""].map((h, i) => (
                <th key={i} scope="col" style={{ padding: `${u(6)} ${u(10)}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list && jobs.length === 0 && <tr><td colSpan={10} style={{ padding: u(18), color: "#8ea3bf" }}>{list.jobs.length ? d.noJobMatch : d.noJobYet}</td></tr>}
            {jobs.map((j) => {
              const can = (a: Job["actions"][number]) => j.actions.includes(a);
              const real = duration(j.started_at, j.finished_at);
              return (
                <tr key={j.id} data-job-row={j.kind} data-job-state={j.state} style={{ borderTop: `${u(1)} solid #12335f` }}>
                  <td style={{ padding: `${u(6)} ${u(10)}`, maxWidth: u(420), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <b>{j.kind_label}</b>{j.kind === "RENDER" && j.subject_title ? ` · ${j.subject_title}` : ""}{j.attempts > 1 ? ` · ${d.attemptCount.replace("{n}", String(j.attempts))}` : ""}
                  </td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, color: STATE_COLOR[j.state], whiteSpace: "nowrap" }}>{stateLabel(j.state)}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, width: u(170) }}>
                    <span style={{ display: "inline-block", width: u(100), height: u(7), background: "#17304f", borderRadius: u(4), verticalAlign: "middle" }}>
                      <i style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR[j.state], borderRadius: u(4) }} />
                    </span>{" "}{Math.round(j.progress)}%
                  </td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, maxWidth: u(460), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: j.state === "FAILED" ? "#ff8a8a" : undefined }}
                    title={j.state === "FAILED" ? (j.error ?? "") : (j.stage ?? "")}>{j.state === "FAILED" ? (j.error ?? d.stageFailed) : (j.stage ?? "—")}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }}>{j.worker ?? "—"}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }}>{clock(j.started_at, tag)}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }}>{real ?? (j.state === "RUNNING" ? d.runningWord : "—")}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap" }} title={j.estimate_s !== null ? d.estimateTitle : undefined}>
                    {j.estimate_s !== null ? d.aboutDuration.replace("{duration}", duration(null, null, j.estimate_s) ?? "") : "—"}</td>
                  <td style={{ padding: `${u(6)} ${u(10)}` }}>
                    {can("priority") ? (
                      <select aria-label={d.priorityAria.replace("{kind}", j.kind_label)} value={j.priority} disabled={busy === j.id} style={btn}
                        onChange={(e) => void act(j, "priority", { priority: e.target.value as JobPriority })}>
                        <option value="HIGH">{d.priorityHigh}</option><option value="NORMAL">{d.priorityNormal}</option><option value="LOW">{d.priorityLow}</option>
                      </select>
                    ) : <span style={{ color: "#6b7a92" }}>{priorityLabel(j.priority)}</span>}
                  </td>
                  <td style={{ padding: `${u(6)} ${u(10)}`, whiteSpace: "nowrap", textAlign: "right" }}>
                    <span style={{ display: "inline-flex", gap: u(6) }}>
                      {can("pause") && <button type="button" style={btn} disabled={busy === j.id} onClick={() => void act(j, "pause")}>{up.pause}</button>}
                      {can("resume") && <button type="button" style={btn} disabled={busy === j.id} onClick={() => void act(j, "resume")}>{up.resume}</button>}
                      {can("cancel") && <button type="button" style={btn} disabled={busy === j.id}
                        onClick={() => void act(j, "cancel", undefined, j.state === "RUNNING" ? d.stopJobConfirm.replace("{kind}", j.kind_label.toLowerCase()) : undefined)}>{dict.common.cancel}</button>}
                      {can("retry") && <button type="button" style={btn} disabled={busy === j.id} onClick={() => void act(j, "retry")}>{d.retryBtn}</button>}
                      {j.href && j.kind === "RENDER" && <Link href={j.href} style={{ ...btn, textDecoration: "none" }}>{d.openBtn}</Link>}
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
