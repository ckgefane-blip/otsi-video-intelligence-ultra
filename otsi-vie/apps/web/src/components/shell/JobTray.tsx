"use client";
/**
 * The Jobs Center drawer (SOT rebuild, page 12, alphabetical): the top-bar
 * icon (with the badge, shown only while jobs run) opens a right-hand
 * drawer with the organization's jobs (ingest, playback copy, footage
 * check, analysis, ball, pitch, lineups, render) as a table — Job | State |
 * Tokens | Elapsed — filtered by the All / Queued / Running / Done / Failed
 * tabs, with the actions the server allows now (pause / resume a waiting
 * job, its place in the queue, cancel, retry — a new run, the old one kept —
 * and open the page with the result). Available on every page.
 *
 * The job record carries no token cost (the wallet ledger records the
 * spend, not the job list), so the Tokens column shows "—" until the API
 * joins it. Elapsed is the job's own times (started → finished, or now
 * while it runs). A failed read is named, never shown as empty.
 */
import * as Dialog from "@radix-ui/react-dialog";
import type { Job, JobList, JobPriority } from "@otsi-vie/contracts";
import { Activity, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";
import { ago, agoTemplates, badge, duration, jobStateLabel, pollMs, STATE_COLOR } from "@/lib/jobs";
import { useLocale } from "@/lib/i18n";
import { JOBS_OPEN_EVENT, publishJobs } from "@/lib/jobsLive";
import { setWalletBusy } from "@/lib/wallet";

type Styles = Record<string, string>;
type Tab = "all" | "queued" | "running" | "done" | "failed";
const TABS: Tab[] = ["all", "queued", "running", "done", "failed"];
/** the tab a job's state belongs to (a paused job waits in the queue) */
const tabOf = (s: Job["state"]): Tab => s === "QUEUED" || s === "PAUSED" ? "queued" : s === "RUNNING" ? "running" : s === "FAILED" ? "failed" : "done";

export function JobTray({ styles }: { styles: Styles }) {
  const { t } = useLocale();
  const { status, organization } = useAuth();
  const org = organization?.organization_id ?? null;
  const [list, setList] = useState<JobList | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hidden, setHidden] = useState(false);

  const load = useCallback(async () => {
    if (!org) return;
    try { const l = await api<JobList>("/v1/jobs"); setList(l); setFailed(false); publishJobs(l); } catch { setFailed(true); /* keep the last list; the next read tries again */ }
  }, [org]);

  useEffect(() => {
    const vis = () => setHidden(document.visibilityState === "hidden");
    vis();
    document.addEventListener("visibilitychange", vis);
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  useEffect(() => { setList(null); setFailed(false); void load(); }, [load]);
  const every = pollMs(list, open, hidden);
  useEffect(() => {
    if (every === null || !org) return;
    const t = window.setInterval(() => void load(), every);
    return () => window.clearInterval(t);
  }, [every, load, org]);
  useEffect(() => { if (open) void load(); }, [open, load]);
  // the live activity line opens the Jobs Center; the wallet reads faster while jobs run
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener(JOBS_OPEN_EVENT, on);
    return () => window.removeEventListener(JOBS_OPEN_EVENT, on);
  }, []);
  useEffect(() => {
    setWalletBusy((list?.jobs ?? []).some((j) => j.state === "RUNNING" || j.state === "QUEUED"));
  }, [list]);

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
  const jobs = list?.jobs ?? [];
  const activeCount = list?.active ?? 0;
  const shown = tab === "all" ? jobs : jobs.filter((j) => tabOf(j.state) === tab);
  const tabLabel = (tb: Tab) => ({ all: t.body.shell.jcAll, queued: t.body.shell.jcQueued, running: t.body.shell.jcRunning, done: t.body.shell.jcDone, failed: t.body.shell.jcFailed })[tb];

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
        <Dialog.Content className="drawer" role="dialog" aria-label={t.desktop.jobsCenter} data-job-list data-jobs-center>
          <div className="vie-ph" style={{ minHeight: 48 }}>
            <Dialog.Title className="t-page">{t.desktop.jobsCenter}</Dialog.Title>
            <div className="flex items-center gap-1.5">
              <span className="t-small text-muted">{t.body.shell.jcActive.replace("{a}", String(activeCount))}</span>
              <Dialog.Close asChild>
                <button type="button" className="vie-ib h-[30px] w-[30px]" aria-label={t.body.shell.jcClose}><X className="h-4 w-4" aria-hidden /></button>
              </Dialog.Close>
            </div>
          </div>
          <div className="tabs" role="tablist" aria-label={t.desktop.jobsCenter}>
            {TABS.map((tb) => (
              <button key={tb} type="button" role="tab" aria-selected={tab === tb} className={`tab${tab === tb ? " on" : ""}`} onClick={() => setTab(tb)}>
                {tabLabel(tb)}
              </button>
            ))}
          </div>
          <div className="eb grid grid-cols-[minmax(0,1fr)_80px_64px_64px] gap-2 px-3.5" style={{ height: 32, alignItems: "center", borderBottom: "1px solid rgb(var(--line))" }}>
            <span>{t.body.shell.jcJob}</span><span>{t.body.shell.jcState}</span>
            <span style={{ textAlign: "right" }}>{t.body.shell.jcTokens}</span><span style={{ textAlign: "right" }}>{t.body.shell.jcElapsed}</span>
          </div>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`px-3.5 pt-2 text-xs ${msg.ok ? "text-ok" : "text-danger"}`}>{msg.text}</p>}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {failed && !list && <p role="alert" className="px-3.5 py-3 text-sm text-danger">{t.body.shell.jobsReading} — {t.common.retry}</p>}
            {list && shown.length === 0 && (
              <div className="empty" style={{ flex: 1 }}>
                <span className="ei"><Activity className="h-5 w-5" aria-hidden /></span>
                <h3 className="t-panel">{t.body.shell.jcNoJobs}</h3>
                <p className="t-small max-w-[300px] text-muted">{t.body.shell.jcNoJobsSub}</p>
                <Link href="/upload?mode=file" className="vie-btn vie-btn-sm" onClick={() => setOpen(false)}>{t.body.shell.jcUploadVideo}</Link>
              </div>
            )}
            {shown.map((j) => <Row key={j.id} j={j} busy={busy === j.id} act={act} close={() => setOpen(false)} />)}
          </div>
          <div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 t-small text-muted">
            <span className="flex-1">{t.body.shell.jcBadgeNote}</span>
            <span className="vie-kbd">Ctrl J</span>
          </div>
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
  const elapsed = duration(j.started_at, j.finished_at ?? (j.state === "RUNNING" ? new Date().toISOString() : null));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_80px_64px_64px] gap-2 border-b border-line/60 px-3.5 py-2 last:border-0" data-job={j.kind} data-job-state={j.state}>
      <div className="min-w-0">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 flex-none rounded-full" style={{ background: STATE_COLOR[j.state] }} aria-hidden />
          <span className="min-w-0 flex-1 truncate t-body font-normal">{j.kind_label}{j.subject_title ? ` · ${j.subject_title}` : ""}</span>
        </span>
        <span className="mt-0.5 block truncate t-small text-muted">
          {j.state === "FAILED" ? <span className="text-danger">{j.error ?? t.body.shell.jobFailedFallback}</span> : (j.stage ?? (j.state === "QUEUED" ? t.body.shell.jobWaitingWorker : ""))}
          {" "}<span>{ago(j.finished_at ?? j.started_at ?? j.created_at, Date.now(), agoTemplates(t))}{j.requested_by ? ` · ${j.requested_by}` : ""}</span>
        </span>
        {j.state === "RUNNING" && (
          <span className="mt-1 block h-1 overflow-hidden rounded bg-raised" role="progressbar" aria-valuenow={Math.round(j.progress)} aria-valuemin={0} aria-valuemax={100} aria-label={t.body.shell.jobProgressAria.replace("{a}", j.kind_label)}>
            <span className="block h-full rounded" style={{ width: `${Math.max(0, Math.min(100, j.progress))}%`, background: STATE_COLOR.RUNNING }} />
          </span>
        )}
        {(j.actions.length > 0 || j.href) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
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
          </span>
        )}
      </div>
      <span className="t-small" style={{ color: STATE_COLOR[j.state] }}>{jobStateLabel(t, j.state)}{j.state === "RUNNING" ? ` ${Math.round(j.progress)}%` : ""}</span>
      <span className="t-mono text-right" title={t.body.shell.jcTokens}>—</span>
      <span className="t-mono text-right">{elapsed ?? "—"}</span>
    </div>
  );
}
