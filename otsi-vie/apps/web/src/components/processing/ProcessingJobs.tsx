"use client";
/**
 * Processing — Jobs & log (SOT, Page 19). The organisation's engine jobs in one place: how each video is processed (the eight
 * pipeline steps, read from the latest job of each kind — "Waits for a video" when that step has never run), the All jobs table
 * (Job | Subject | Priority | State | Progress | Actions), the History of finished and failed jobs, and a Job details inspector
 * with the selected job's log. The per-video processing view stays at /processing?video=<id>; this page is the jobs overview.
 * Everything comes from GET /v1/jobs (waiting, running, paused, and finished in the last 24 h); nothing is invented.
 */
import { SidePanel } from "@/components/shell/SidePanel";
import type { Job, JobList, JobPriority } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { duration, STATE_COLOR } from "@/lib/jobs";
import { DATE_TAG } from "./model";
import { lines } from "./LogPanel";

/** all jobs, read every 3 s while one is active, else every 15 s; undefined while loading, null when the read failed */
export function useAllJobs(): { list: JobList | null | undefined; reload: () => Promise<void> } {
  const [list, setList] = useState<JobList | null | undefined>(undefined);
  const reload = useCallback(async () => {
    try { setList(await api<JobList>("/v1/jobs")); } catch { setList((l) => (l === undefined ? null : l)); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  const every = (list?.active ?? 0) > 0 ? 3000 : 15000;
  useEffect(() => {
    const t = window.setInterval(() => { if (document.visibilityState !== "hidden") void reload(); }, every);
    return () => window.clearInterval(t);
  }, [every, reload]);
  return { list, reload };
}

type Filter = "ALL" | "ACTIVE" | "FAILED" | "FINISHED";
const FILTERS: Filter[] = ["ALL", "ACTIVE", "FAILED", "FINISHED"];
const isActiveJob = (j: Job) => j.state === "QUEUED" || j.state === "RUNNING" || j.state === "PAUSED";
const isFinishedJob = (j: Job) => !isActiveJob(j) && j.state !== "FAILED";

/** the eight pipeline steps, each read from the latest job of its kind (newest first) */
const STEP_KINDS: [string, string[]][] = [
  ["pjStepFootage", ["ASSESS"]],
  ["pjStepPlayback", ["PROXY"]],
  ["detection", ["ANALYZE"]],
  ["tracking", ["ANALYZE"]],
  ["ball", ["TRACK_BALL"]],
  ["pjStepLineups", ["READ_LINEUPS"]],
  ["pjStepEvents", ["TRACK_BALL"]],
  ["pjStepPitch", ["CALIBRATE_PITCH"]],
];
type StepState = "wait" | "run" | "done" | "fail";
const stepOf = (jobs: Job[], kinds: string[]): { state: StepState; progress: number | null; job: Job | null } => {
  const j = jobs.filter((x) => kinds.includes(x.kind)).sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0] ?? null;
  if (!j) return { state: "wait", progress: null, job: null };
  if (j.state === "RUNNING") return { state: "run", progress: Math.max(0, Math.min(100, j.progress)), job: j };
  if (j.state === "SUCCEEDED") return { state: "done", progress: 100, job: j };
  if (j.state === "FAILED") return { state: "fail", progress: null, job: j };
  return { state: "wait", progress: null, job: j };
};

const clock = (at: string | null, tag = "en-GB") => (at ? new Date(at.includes("T") ? at : `${at.replace(" ", "T")}Z`).toLocaleString(tag, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");

export function ProcessingJobs() {
  const { t: dict, locale } = useLocale();
  const d = dict.body.processing;
  const up = dict.body.upload;
  const tag = DATE_TAG[locale];
  const { list, reload } = useAllJobs();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const jobs = list?.jobs ?? [];
  const shown = jobs.filter((j) => filter === "ALL" || (filter === "ACTIVE" ? isActiveJob(j) : filter === "FAILED" ? j.state === "FAILED" : isFinishedJob(j)));
  const history = jobs.filter((j) => !isActiveJob(j));
  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const selectedLines = selected ? lines([], [selected], d, tag) : [];
  /** the state word for a job, translated. */
  const stateLabel = (s: Job["state"]) => ({ QUEUED: d.stageWaiting, RUNNING: d.ribbonRunning, PAUSED: d.jobPaused,
    SUCCEEDED: d.jobFinished, FAILED: d.stageFailed, CANCELLED: d.stageCancelled } as Record<string, string>)[s] ?? s;
  /** the filter chip's word for a key. */
  const filterLabel = (f: Filter) => ({ ALL: d.filterAll, ACTIVE: d.filterActive, FAILED: d.filterFailed, FINISHED: d.filterFinished } as Record<Filter, string>)[f];
  /** the priority word for a value. */
  const priorityLabel = (v: string) => (v === "NORMAL" ? d.priorityNormal : v === "HIGH" ? d.priorityHigh : d.priorityLow);
  /** the step's status line: what the latest job of that kind is doing, or "Waits for a video" when it never ran. */
  const stepLine = (s: { state: StepState; progress: number | null }) => s.state === "wait" ? d.pjWaitsVideo
    : s.state === "run" ? `${d.ribbonRunning}${s.progress !== null ? ` · ${Math.round(s.progress)}%` : ""}`
    : s.state === "done" ? d.jobFinished : d.stageFailed;
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
  const actions = (j: Job) => {
    const can = (a: Job["actions"][number]) => j.actions.includes(a);
    return (
      <span className="inline-flex gap-1.5">
        {can("pause") && <button type="button" className={btn} disabled={busy === j.id} onClick={() => void act(j, "pause")}>{up.pause}</button>}
        {can("resume") && <button type="button" className={btn} disabled={busy === j.id} onClick={() => void act(j, "resume")}>{up.resume}</button>}
        {can("cancel") && <button type="button" className={btn} disabled={busy === j.id}
          onClick={() => void act(j, "cancel", undefined, j.state === "RUNNING" ? d.stopJobConfirm.replace("{kind}", j.kind_label.toLowerCase()) : undefined)}>{dict.common.cancel}</button>}
        {can("retry") && <button type="button" className={btn} disabled={busy === j.id} onClick={() => void act(j, "retry")}>{d.retryBtn}</button>}
        {j.href && j.kind === "RENDER" && <Link href={j.href} className={btn}>{d.openBtn}</Link>}
      </span>
    );
  };
  const row = (j: Job, key: string) => {
    const isSel = selected?.id === j.id;
    return (
      <div key={key} role="button" tabIndex={0} aria-pressed={isSel} onClick={() => setSelectedId(isSel ? null : j.id)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(isSel ? null : j.id); } }}
        className={`grid cursor-pointer items-center gap-3 border-b border-line/60 px-3.5 py-2 text-sm hover:bg-raised/40 ${isSel ? "bg-raised/60" : ""}`}
        style={{ gridTemplateColumns: "minmax(180px, 1.4fr) minmax(160px, 1.2fr) 90px 100px minmax(120px, 1fr) 132px", minWidth: 820 }}>
        <span className="min-w-0"><b className="font-normal text-ink">{j.kind_label}</b>{j.attempts > 1 ? ` · ${d.attemptCount.replace("{n}", String(j.attempts))}` : ""}</span>
        <span className="min-w-0 truncate text-ink2">{j.subject_title ?? "—"}</span>
        <span className="text-ink2">{priorityLabel(j.priority)}</span>
        <span style={{ color: STATE_COLOR[j.state] }}>{stateLabel(j.state)}</span>
        <span className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-[80px] rounded bg-line/60 align-middle">
            <i className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR[j.state] }} />
          </span>
          {Math.round(j.progress)}%
        </span>
        <span className="text-right" onClick={(e) => e.stopPropagation()}>{actions(j)}</span>
      </div>
    );
  };

  return (
    <div className="flex min-h-full min-w-0 flex-1 items-stretch" data-page="processing" data-stage>
      <main className="flex min-w-0 flex-1 flex-col gap-3.5 p-5 px-7">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="eb">{dict.nav.processing}</span>
            <h1 className="t-page">{d.jobs}</h1>
          </div>
          <div className="seg" role="group" aria-label={d.jobs}>
            {FILTERS.map((f) => (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} className={filter === f ? "on" : ""}>{filterLabel(f)}</button>
            ))}
          </div>
        </div>

        <section className="min-w-0 border-t border-line pt-3" aria-labelledby="pj-steps">
          <div className="flex items-center justify-between gap-2 pb-1">
            <h2 id="pj-steps" className="t-panel">{d.pjHowProcessed}</h2>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink2">
              <span><span className="text-muted" aria-hidden>•</span> {d.runQueued}</span>
              <span><span className="text-cyan" aria-hidden>•</span> {d.ribbonRunning}</span>
              <span><span className="text-primary" aria-hidden>•</span> {d.jobFinished}</span>
              <span><span className="text-danger" aria-hidden>•</span> {d.stageFailed}</span>
            </div>
          </div>
          <ol className="steps">
            {STEP_KINDS.map(([key, kinds], i) => {
              const s = stepOf(jobs, kinds);
              const name = (d as unknown as Record<string, string>)[key] ?? key;
              return (
                <li key={key} className={`stp ${s.state === "run" ? "run" : s.state === "done" ? "done" : s.state === "fail" ? "fail" : ""}`}
                  data-processing-step={key} data-step-state={s.state}>
                  <span className="node"><span className="dotn">{i + 1}</span><span className="bar" /></span>
                  <span className="nm2">{name}</span>
                  <span className="text-xs text-muted">{stepLine(s)}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="min-w-0 border-t border-line pt-3" aria-labelledby="pj-jobs">
          <div className="flex items-center justify-between gap-2 pb-1">
            <h2 id="pj-jobs" className="t-panel">{d.pjAllJobs}</h2>
            <span className="text-xs text-muted">{d.pjAllJobsSub}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="eb grid items-center gap-3 border-b border-line px-3.5" style={{ gridTemplateColumns: "minmax(180px, 1.4fr) minmax(160px, 1.2fr) 90px 100px minmax(120px, 1fr) 132px", minWidth: 820, height: 32 }}>
              <span>{d.jobHeader}</span><span>{d.pjSubject}</span><span>{d.priorityHeader}</span><span>{d.stateHeader}</span><span>{d.progressHeader}</span><span style={{ textAlign: "right" }}>{d.pjActions}</span>
            </div>
            {list === undefined && <p className="p-4 text-sm text-muted">{dict.common.loading}</p>}
            {list === null && <p role="alert" className="p-4 text-sm text-danger">{d.didNotWork}</p>}
            {list && shown.length === 0 && (
              <div className="empty" style={{ padding: 16, minHeight: 240 }}>
                {/* SOT Jobs Center: the empty state is centred vertically — the .empty flex centres its content in this height */}
                <span className="ei"><svg className="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l3-7 4 14 3-7h4"></path></svg></span>
                <h3>{d.pjNoJobs}</h3>
                <p>{d.pjUploadToStart}</p>
                <Link href="/upload" className="vie-btn">{d.pjUploadVideo}</Link>
              </div>
            )}
            {shown.map((j) => row(j, j.id))}
            {msg && <p role={msg.ok ? "status" : "alert"} className={`px-3.5 py-2 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
          </div>
        </section>

        <section className="flex min-w-0 flex-1 flex-col border-t border-line pt-3" aria-labelledby="pj-history" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <div className="flex items-center justify-between gap-2 pb-1">
            <h2 id="pj-history" className="t-panel">{d.pjHistory}</h2>
            <span className="text-xs text-muted">{d.pjLogsKept}</span>
          </div>
          {history.length === 0 ? (
            <div className="empty" style={{ flex: 1 }}>
              <h3>{d.pjNoFinished}</h3>
              <p>{d.pjFinishedHere}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              {history.map((j) => row(j, `h-${j.id}`))}
            </div>
          )}
        </section>
      </main>

      <SidePanel panel="processing-inspector" def={340} edge="left" className="insp self-stretch" aria-label={d.pjJobDetails}>
        <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-3" style={{ minHeight: 44 }}>
          <h2 className="t-panel">{d.pjJobDetails}</h2>
        </div>
        {selected ? (
          <div className="flex flex-col gap-3 p-3.5">
            <div>
              <p className="text-sm font-normal">{selected.kind_label}</p>
              <p className="text-xs text-muted">{selected.subject_title ?? "—"}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">{d.stateHeader}</dt><dd style={{ color: STATE_COLOR[selected.state] }}>{stateLabel(selected.state)}</dd>
              <dt className="text-muted">{d.priorityHeader}</dt><dd>{priorityLabel(selected.priority)}</dd>
              <dt className="text-muted">{d.progressHeader}</dt><dd>{Math.round(selected.progress)}%</dd>
              <dt className="text-muted">{d.startedHeader}</dt><dd>{clock(selected.started_at, tag)}</dd>
              <dt className="text-muted">{d.durationHeader}</dt><dd>{duration(selected.started_at, selected.finished_at) ?? (selected.state === "RUNNING" ? d.runningWord : "—")}</dd>
              <dt className="text-muted">{d.machineHeader}</dt><dd>{selected.worker ?? "—"}</dd>
            </dl>
            {selected.state === "FAILED" && selected.error && <p role="alert" className="text-xs text-danger">{selected.error}</p>}
            {selected.stage && selected.state !== "FAILED" && <p className="text-xs text-muted">{selected.stage}</p>}
            <div className="flex flex-wrap gap-1.5">{actions(selected)}</div>
          </div>
        ) : (
          <div className="empty" style={{ padding: "28px 16px" }}>
            <h3>{d.pjNoJobSelected}</h3>
            <p>{d.pjPauseHint}</p>
          </div>
        )}
        <div className="flex min-h-[200px] flex-1 flex-col border-t border-line">
          <div className="flex items-center justify-between gap-2 px-3.5 pb-1 pt-3">
            <span className="eb">{d.pjLog}</span>
            <button type="button" disabled={!selectedLines.length} className="rounded-ctl border border-line px-2 py-1 text-xs hover:bg-raised/60 disabled:opacity-50"
              onClick={() => {
                const text = selectedLines.map((l) => `${l.at || "        "}  ${l.text}`).join("\n");
                void navigator.clipboard?.writeText(text).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); }, () => undefined);
              }}>{copied ? d.copied : d.copy}</button>
          </div>
          {selectedLines.length === 0 ? (
            <pre className="t-mono m-0 flex-1 bg-canvas p-3 text-xs leading-[18px] text-muted" style={{ whiteSpace: "pre-wrap" }}>{d.pjNoLog}</pre>
          ) : (
            <ol className="m-0 flex-1 list-none overflow-y-auto bg-canvas p-3 text-sm leading-relaxed">
              {selectedLines.map((l, i) => (
                <li key={i} className={`flex gap-2.5 px-1 py-0.5 ${l.tone === "ok" ? "text-ok" : l.tone === "bad" ? "text-danger" : l.tone === "live" ? "text-cyan" : "text-ink2"}`}>
                  <span className="shrink-0 tabular-nums text-muted">{l.at}</span><span>{l.text}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SidePanel>
    </div>
  );
}
