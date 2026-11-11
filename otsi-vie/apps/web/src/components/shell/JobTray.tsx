"use client";
/**
 * The job tray in the top bar (v3 Phase A.3, S02, ADR-060): an icon with the number of jobs waiting, running or paused, next to the
 * account. It opens the organization's jobs (ingest, playback copy, footage check, analysis, ball, pitch, lineups, render) with state,
 * current step and progress as the worker recorded them, and the actions the server allows now: pause / resume a waiting job, its place
 * in the queue, cancel, retry (a new run; the old one is kept) and open the page with the result. Available on every page.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Job, JobList, JobPriority } from "@otsi-vie/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { ago, agoTemplates, badge, jobStateLabel, pollMs, STATE_COLOR } from "@/lib/jobs";
import { useLocale } from "@/lib/i18n";

type Styles = Record<string, string>;

export function JobTray({ styles }: { styles: Styles }) {
  const { t } = useLocale();
  const { status, organization } = useAuth();
  const org = organization?.organization_id ?? null;
  const [list, setList] = useState<JobList | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    try { setList(await api<JobList>("/v1/jobs")); } catch { /* keep the last list; the next read tries again */ }
  }, [org]);

  useEffect(() => {
    const vis = () => setHidden(document.visibilityState === "hidden");
    vis();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  useEffect(() => { setList(null); void load(); }, [load]);
  const every = pollMs(list, open, hidden);
  useEffect(() => {
    if (every === null || !org) return;
    const t = window.setInterval(() => void load(), every);
    return () => window.clearInterval(t);
  }, [every, load, org]);
  useEffect(() => { if (open) void load(); }, [open, load]);

  if (status !== "signed-in" || !org) return null;
  const b = badge(list);
  const act = async (j: Job, path: string, json?: unknown, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(j.id); setMsg(null);
    try {
      await api<Job>(`/v1/jobs/${j.id}/${path}`, { method: "POST", json: json ?? {} });
      setMsg({ ok: true, text: path === "retry" ? t.body.shell.jobRetryDone.replace("{a}", j.kind_label) : t.body.shell.jobDone.replace("{a}", j.kind_label) });
    } catch (x) {
      setMsg({ ok: false, text: x instanceof ApiProblem ? x.message : t.body.shell.jobFailed });
    } finally {
      setBusy(null);
      void load();
    }
  };
  const active = list?.jobs.filter((j) => j.state === "QUEUED" || j.state === "RUNNING" || j.state === "PAUSED") ?? [];
  const done = list?.jobs.filter((j) => !active.includes(j)) ?? [];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className={`${styles.abs} ${styles.jobs}`} data-job-tray aria-label={list ? t.body.shell.jobsAriaActive.replace("{a}", String(list.active)) : t.body.shell.jobsAriaLoading}
          title={list ? t.body.shell.jobsTitleAttr.replace("{a}", String(list.running)).replace("{b}", String(list.active - list.running)) + (list.failed_recent ? t.body.shell.jobsTitleFailed.replace("{a}", String(list.failed_recent)) : "") : t.body.shell.jobsTitleFallback}>
          <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="4" rx="1.2" /><rect x="3" y="10" width="18" height="4" rx="1.2" /><rect x="3" y="16" width="18" height="4" rx="1.2" />
            {(list?.running ?? 0) > 0 && <path d="M6 6h6M6 12h9M6 18h4" stroke="#33a8ff" />}
          </svg>
          {b && <span className={styles.jobsCount} data-alert={b.alert ? "1" : "0"} data-job-count={b.text}>{b.text}</span>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50" />
        <Dialog.Content className="fixed right-4 z-50 flex max-h-[75vh] w-[30rem] max-w-[calc(100vw-2rem)] flex-col rounded-card border border-line bg-panel p-3 shadow-2xl"
          style={{ top: "calc(max(0.5px, 100vw / 2560) * 104)" }} data-job-list>
          <div className="flex items-baseline justify-between gap-2">
            <Dialog.Title className="text-sm font-semibold">{t.body.shell.jobsTitle}</Dialog.Title>
            <Dialog.Description className="text-xs text-muted">
              {list ? t.body.shell.jobsDesc.replace("{a}", String(list.running)).replace("{b}", String(list.active - list.running)) : t.body.shell.jobsReading}
            </Dialog.Description>
          </div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-1 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
          <div className="mt-2 flex-1 overflow-y-auto pr-1">
            {list && list.jobs.length === 0 && <p className="py-6 text-center text-sm text-muted">{t.body.shell.jobsEmpty}</p>}
            {active.map((j) => <Row key={j.id} j={j} busy={busy === j.id} act={act} close={() => setOpen(false)} />)}
            {done.length > 0 && <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted">{t.body.shell.jobsFinished}</p>}
            {done.map((j) => <Row key={j.id} j={j} busy={busy === j.id} act={act} close={() => setOpen(false)} />)}
          </div>
          <p className="mt-2 text-[11px] text-muted">{t.body.shell.jobsFooter}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Row({ j, busy, act, close }: { j: Job; busy: boolean; close: () => void;
  act: (j: Job, path: string, json?: unknown, confirmText?: string) => Promise<void> }) {
  const { t } = useLocale();
  const can = (a: Job["actions"][number]) => j.actions.includes(a);
  const btn = "rounded-ctl border border-line px-2 py-0.5 text-xs hover:bg-raised/60 disabled:opacity-50";
  return (
    <div className="border-b border-line/60 py-2 last:border-0" data-job={j.kind} data-job-state={j.state}>
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 flex-none rounded-full" style={{ background: STATE_COLOR[j.state] }} aria-hidden />
        <span className="flex-1 truncate text-sm"><b>{j.kind_label}</b>{j.subject_title ? ` · ${j.subject_title}` : ""}</span>
        <span className="flex-none text-xs" style={{ color: STATE_COLOR[j.state] }}>{jobStateLabel(t, j.state)}{j.state === "RUNNING" ? ` ${Math.round(j.progress)}%` : ""}</span>
      </div>
      {j.state === "RUNNING" && (
        <div className="mt-1 h-1 rounded bg-raised" role="progressbar" aria-valuenow={Math.round(j.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={t.body.shell.jobProgressAria.replace("{a}", j.kind_label)}>
          <div className="h-1 rounded" style={{ width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR.RUNNING }} />
        </div>
      )}
      <p className="mt-0.5 truncate text-xs text-muted">
        {j.state === "FAILED" ? <span className="text-danger">{j.error ?? t.body.shell.jobFailedFallback}</span> : (j.stage ?? (j.state === "QUEUED" ? t.body.shell.jobWaitingWorker : ""))}
        {" "}<span>{ago(j.finished_at ?? j.started_at ?? j.created_at, Date.now(), agoTemplates(t))}{j.requested_by ? ` · ${j.requested_by}` : ""}</span>
      </p>
      {(j.actions.length > 0 || j.href) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {can("pause") && <button type="button" className={btn} disabled={busy} onClick={() => void act(j, "pause")} data-job-action="pause">{t.body.shell.jobPause}</button>}
          {can("resume") && <button type="button" className={btn} disabled={busy} onClick={() => void act(j, "resume")} data-job-action="resume">{t.body.shell.jobResume}</button>}
          {can("priority") && (
            <label className="flex items-center gap-1 text-xs text-muted">{t.body.shell.jobPriority}
              <select className="rounded-ctl border border-line bg-panel px-1 py-0.5 text-xs text-ink" disabled={busy} value={j.priority} data-job-action="priority"
                onChange={(e) => void act(j, "priority", { priority: e.target.value as JobPriority })}>
                <option value="HIGH">{t.body.shell.jobPriorityHigh}</option><option value="NORMAL">{t.body.shell.jobPriorityNormal}</option><option value="LOW">{t.body.shell.jobPriorityLow}</option>
              </select>
            </label>
          )}
          {can("cancel") && <button type="button" className={btn} disabled={busy} data-job-action="cancel"
            onClick={() => void act(j, "cancel", undefined, j.state === "RUNNING" ? t.body.shell.jobCancelConfirm.replace("{a}", j.kind_label.toLowerCase()) : undefined)}>{t.body.shell.jobCancel}</button>}
          {can("retry") && <button type="button" className={btn} disabled={busy} onClick={() => void act(j, "retry")} data-job-action="retry">{t.body.shell.jobRetry}</button>}
          {j.href && <Link href={j.href} onClick={close} className="ml-auto text-xs text-cyan underline" data-job-open>{t.body.shell.jobOpen}</Link>}
        </div>
      )}
    </div>
  );
}
