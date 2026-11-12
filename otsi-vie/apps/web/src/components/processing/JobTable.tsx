"use client";
/**
 * Page 03 — the video's job table, on the Desktop UI flow layout (v3 Phase A.4, ADR-061), below the timeline. Every engine job of this video (its ingest, playback copy,
 * footage check, analyses, ball, pitch, team sheets and its reels' renders) as the worker recorded it: state, progress, step, machine,
 * start, duration and, for an analysis, the footage check's estimate next to the real duration. Filters by state and kind; pause, resume,
 * priority, cancel and retry are the server's own actions (the same as the top-bar job tray).
 */
import type { Job, JobList, JobPriority } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { duration, STATE_COLOR, STATE_LABEL } from "@/lib/jobs";
import { DATE_TAG } from "./model";

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
  const btn = "rounded-ctl border border-line px-2 py-1 text-xs hover:bg-raised/60 disabled:opacity-50";

  return (
    <section aria-label={d.jobs} data-section="p03-jobs" className="vie-panel">
      <div className="vie-ph flex-wrap gap-2 py-2">
        <div className="min-w-0">
          <h2 className="t-panel">{d.jobs}</h2>
          <p className="text-xs text-muted">{list ? d.jobsSubtitle.replace("{running}", String(list.running)).replace("{waiting}", String(list.active - list.running)) : d.reading}</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {FILTERS.map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-job-filter={f}
              className={`${btn} ${filter === f ? "border-primary bg-primary text-white" : ""}`}>{filterLabel(f)}</button>
          ))}
          <select aria-label={d.kindOfJob} value={kind} onChange={(e) => setKind(e.target.value)} className={`${btn} ml-1`} data-job-kind-filter>
            <option value="ALL">{d.everyKind}</option>
            {kinds.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {msg && <span role={msg.ok ? "status" : "alert"} className={`ml-2 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</span>}
        </div>
      </div>
      <div className="max-h-[430px] overflow-auto p-1">
        <table className="w-full border-collapse text-sm text-ink2">
          <thead>
            <tr className="t-th sticky top-0 bg-panel text-left">
              {[d.jobHeader, d.stateHeader, d.progressHeader, d.stepHeader, d.machineHeader, d.startedHeader, d.durationHeader, d.estimateHeader, d.priorityHeader, ""].map((h, i) => (
                <th key={i} scope="col" className="px-2.5 py-1.5 font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list && jobs.length === 0 && <tr><td colSpan={10} className="px-3 py-4 text-muted">{list.jobs.length ? d.noJobMatch : d.noJobYet}</td></tr>}
            {jobs.map((j) => {
              const can = (a: Job["actions"][number]) => j.actions.includes(a);
              const real = duration(j.started_at, j.finished_at);
              return (
                <tr key={j.id} data-job-row={j.kind} data-job-state={j.state} className="border-t border-line/60 align-top">
                  <td className="max-w-[420px] px-2.5 py-1.5">
                    <b className="text-ink">{j.kind_label}</b>{j.kind === "RENDER" && j.subject_title ? ` · ${j.subject_title}` : ""}{j.attempts > 1 ? ` · ${d.attemptCount.replace("{n}", String(j.attempts))}` : ""}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5" style={{ color: STATE_COLOR[j.state] }}>{stateLabel(j.state)}</td>
                  <td className="w-[170px] px-2.5 py-1.5">
                    <span className="inline-block h-1.5 w-[100px] rounded bg-line/60 align-middle">
                      <i className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR[j.state] }} />
                    </span>{" "}{Math.round(j.progress)}%
                  </td>
                  <td className="max-w-[460px] truncate px-2.5 py-1.5" style={{ color: j.state === "FAILED" ? "#ff8a8a" : undefined }}
                    title={j.state === "FAILED" ? (j.error ?? "") : (j.stage ?? "")}>{j.state === "FAILED" ? (j.error ?? d.stageFailed) : (j.stage ?? "—")}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{j.worker ?? "—"}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{clock(j.started_at, tag)}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5">{real ?? (j.state === "RUNNING" ? d.runningWord : "—")}</td>
                  <td className="whitespace-nowrap px-2.5 py-1.5" title={j.estimate_s !== null ? d.estimateTitle : undefined}>
                    {j.estimate_s !== null ? d.aboutDuration.replace("{duration}", duration(null, null, j.estimate_s) ?? "") : "—"}</td>
                  <td className="px-2.5 py-1.5">
                    {can("priority") ? (
                      <select aria-label={d.priorityAria.replace("{kind}", j.kind_label)} value={j.priority} disabled={busy === j.id} className={btn}
                        onChange={(e) => void act(j, "priority", { priority: e.target.value as JobPriority })}>
                        <option value="HIGH">{d.priorityHigh}</option><option value="NORMAL">{d.priorityNormal}</option><option value="LOW">{d.priorityLow}</option>
                      </select>
                    ) : <span className="text-muted">{priorityLabel(j.priority)}</span>}
                  </td>
                  <td className="whitespace-nowrap px-2.5 py-1.5 text-right">
                    <span className="inline-flex gap-1.5">
                      {can("pause") && <button type="button" className={btn} disabled={busy === j.id} onClick={() => void act(j, "pause")}>{up.pause}</button>}
                      {can("resume") && <button type="button" className={btn} disabled={busy === j.id} onClick={() => void act(j, "resume")}>{up.resume}</button>}
                      {can("cancel") && <button type="button" className={btn} disabled={busy === j.id}
                        onClick={() => void act(j, "cancel", undefined, j.state === "RUNNING" ? d.stopJobConfirm.replace("{kind}", j.kind_label.toLowerCase()) : undefined)}>{dict.common.cancel}</button>}
                      {can("retry") && <button type="button" className={btn} disabled={busy === j.id} onClick={() => void act(j, "retry")}>{d.retryBtn}</button>}
                      {j.href && j.kind === "RENDER" && <Link href={j.href} className={btn}>{d.openBtn}</Link>}
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
