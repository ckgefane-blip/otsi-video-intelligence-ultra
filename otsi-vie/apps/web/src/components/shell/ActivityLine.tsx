"use client";
/**
 * The live activity line (owner 2026-11-12: "when the user is doing work, a real-time update, as Claude and almost every AI does"):
 * the narration of what the engine is doing right now, in words, as it happens — for EVERY engine action, not just worker jobs.
 *
 * Two sources, one line. (1) Worker jobs from GET /v1/jobs (via the Jobs Center's own reads, every 3 s while busy): while a job runs,
 * the status bar says the job, its subject, the stage the worker reports (the worker's own words — "Tracking players…", "Rendering
 * reel…"), a ticking elapsed time (from started_at), the progress, and › to open Processing. A queued job alone says it is waiting.
 * (2) Client-side activities (lib/activities.ts): the long synchronous API actions (export pack, player report, AI Analyst, Scouting
 * Pack) and the browser file upload — none of which appear in /v1/jobs. They are narrated at the action level, in plain words, with
 * elapsed time ticking every second; the upload shows its REAL progress % (sentBytes / totalBytes), the four API actions show NO
 * progress — the server reports none, so none is invented.
 *
 * Rotation: the bar is one line, so when several actions run at once it cycles through each in turn (every ~4 s), saying which one is
 * shown ("2 of 3"); queued jobs waiting behind are counted as "+N more". When nothing runs, the last completed action is shown briefly
 * (5 minutes), then a plain idle line ("Nothing running") — never a fake "live" state.
 *
 * Billing blueprint §4.2(3) — the live job readout, built AS this narration (not a separate numbers panel): when the running job is
 * charged work (analysis or render), the line also says how many tokens the job committed and, for an analysis, how many minutes of
 * footage it has covered against the total ("minute 34 of 90"). The minute is derived from the job's progress, not measured — the
 * worker reports progress, not the minute it is on. The token cost is the exact charge the server makes (1 token per started minute
 * for analysis, 10 for a render), so the number here is the number that left the wallet. The four API actions cost 10 tokens each at
 * enqueue and show the same committed number. When a charged job or activity fails, the line stays up for 15 minutes and says what
 * happened to its tokens: refunded, with the amount from the ledger, or committed with no refund recorded yet (the worker does not
 * call the refund yet — ADR-140 §7, known gap — so the line only claims a refund when a REFUND row actually exists). A free action
 * that fails (an upload) just says it failed. No estimate is shown as a countdown: estimate_s is an estimate, so it is labelled
 * "about". Every user-facing word is an i18n key (wallet group); nothing here is English-only.
 */
import type { Job, Video, WalletLedgerEntry, WalletJobType } from "@otsi-vie/contracts";
import { analysisCostTokens } from "@otsi-vie/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useActivities, type ClientActivity } from "@/lib/activities";
import { useLocale } from "@/lib/i18n";
import { useJobs } from "@/lib/jobsLive";
import { chargedCost, chargedJobKind, minutesCovered, recentFailure, refundForJob } from "@/lib/tokenCost";

const elapsed = (from: string | null) => {
  if (!from) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
/** the estimate, labelled as what it is ("about 5 min"), never a countdown */
const about = (w: { cpAboutMin: string; cpAboutSec: string }, s: number | null) =>
  s == null ? null : s >= 60 ? w.cpAboutMin.replace("{a}", String(Math.round(s / 60))) : w.cpAboutSec.replace("{a}", String(Math.round(s)));

/** the charged job the line is narrating, with its committed tokens (null when the cost cannot be
 *  worked out — an analysis whose video has no measured duration — so no token line is shown). */
function useCharged(j: Job | undefined): { type: WalletJobType; cost: number | null } | null {
  const [durations, setDurations] = useState<Record<string, number | null>>({});
  const seen = useRef(new Set<string>());
  const type = j ? chargedJobKind(j.kind) : null;
  useEffect(() => {
    if (!j || j.kind !== "ANALYZE" || !j.video_id || seen.current.has(j.video_id)) return;
    seen.current.add(j.video_id);
    let live = true;
    api<Video>(`/v1/videos/${j.video_id}`).then(
      (v) => { if (live) setDurations((d) => ({ ...d, [j.video_id!]: v.duration_us })); },
      () => { if (live) setDurations((d) => ({ ...d, [j.video_id!]: null })); },
    );
    return () => { live = false; };
  }, [j]);
  if (!j || !type) return null;
  if (type === "ANALYSIS") {
    const d = j.video_id ? durations[j.video_id] : undefined;
    if (d === undefined) return { type, cost: null }; // video not read yet: narrate without tokens
    return { type, cost: analysisCostTokens(d) };
  }
  return { type, cost: chargedCost(type) };
}

/** one running action in the rotation cycle: a worker job or a client activity */
type RunningItem = { type: "job"; job: Job } | { type: "activity"; activity: ClientActivity };
/** a recent failure worth narrating, from either source */
type FailedItem = { type: "job"; job: Job } | { type: "activity"; activity: ClientActivity };
/** the last completed action, from either source */
type DoneItem = { type: "job"; job: Job } | { type: "activity"; activity: ClientActivity };

/** a failure is narrated for 15 minutes (same window as a failed job); a completion for 5 */
const DONE_MS = 5 * 60 * 1000;
const within = (at: string | null, ms: number, now = Date.now()) => {
  if (!at) return false;
  const t = Date.parse(at);
  return !Number.isNaN(t) && now - t >= 0 && now - t <= ms;
};
/** the most recently finished of a list, by finished_at */
function latest<T extends { finishedAt?: string | null }>(xs: T[]): T | undefined {
  return [...xs].sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""))[0];
}

export function ActivityLine() {
  const { t } = useLocale();
  const w = t.body.wallet;
  const list = useJobs();
  const activities = useActivities();
  const [, tick] = useState(0);

  const runningJobs = list?.jobs.filter((j) => j.state === "RUNNING") ?? [];
  const queued = list?.jobs.filter((j) => j.state === "QUEUED") ?? [];
  const runningActs = activities.filter((a) => a.state === "RUNNING");
  const items: RunningItem[] = [
    ...runningJobs.map((job): RunningItem => ({ type: "job", job })),
    ...runningActs.map((activity): RunningItem => ({ type: "activity", activity })),
  ];
  // rotation: cycle every ~4 s through every running action, so each gets its turn
  const [rot, setRot] = useState(0);
  const countRef = useRef(items.length);
  countRef.current = items.length;
  useEffect(() => { setRot((r) => (items.length ? r % items.length : 0)); }, [items.length]);
  useEffect(() => {
    if (items.length < 2) return;
    const id = setInterval(() => setRot((r) => (r + 1) % Math.max(1, countRef.current)), 4000);
    return () => clearInterval(id);
  }, [items.length]);
  const current = items.length ? items[rot % items.length] : undefined;
  const currentJob = current?.type === "job" ? current.job : undefined;
  const currentAct = current?.type === "activity" ? current.activity : undefined;
  const charged = useCharged(currentJob);
  const firstQueued = !current ? queued[0] : undefined;

  // a charged job or activity that just failed: the line stays up for 15 minutes and says what
  // happened to its tokens (a free action that failed just says it failed). Most recent first.
  const failedJob: Job | undefined = !current && !firstQueued ? (list?.jobs ?? [])
    .filter((x) => x.state === "FAILED" && chargedJobKind(x.kind) !== null && recentFailure(x.finished_at))
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0] : undefined;
  const failedAct: ClientActivity | undefined = !current && !firstQueued ? latest(activities
    .filter((a) => a.state === "FAILED" && recentFailure(a.finishedAt))) : undefined;
  const failed: FailedItem | undefined = failedJob && failedAct
    ? ((failedJob.finished_at ?? "") >= (failedAct.finishedAt ?? "") ? { type: "job", job: failedJob } : { type: "activity", activity: failedAct })
    : failedJob ? { type: "job", job: failedJob } : failedAct ? { type: "activity", activity: failedAct } : undefined;
  const failedJobCharged = useCharged(failed?.type === "job" ? failed.job : undefined);
  const failedId = failed?.type === "job" ? failed.job.id : failed?.activity.id;
  const failedType: WalletJobType | null = failed?.type === "job" ? chargedJobKind(failed.job.kind) : failed?.activity.chargedType ?? null;
  const failedCost: number | null = failed?.type === "job" ? failedJobCharged?.cost ?? null : failed?.activity.cost ?? null;
  const failedFinishedAt: string | null = failed?.type === "job" ? failed.job.finished_at : failed?.activity.finishedAt ?? null;
  const [refund, setRefund] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!failed || !failedType) { setRefund(undefined); return; }
    let live = true;
    setRefund(undefined);
    api<{ entries: WalletLedgerEntry[] }>("/v1/wallet/ledger?limit=200").then(
      (l) => { if (live) setRefund(refundForJob(l.entries, failedType, failedFinishedAt)); },
      () => { if (live) setRefund(null); },
    );
    return () => { live = false; };
  }, [failedId, failedType]); // eslint-disable-line react-hooks/exhaustive-deps

  // the last completed action, shown briefly (5 min) when nothing runs, waits or just failed
  const doneJob: Job | undefined = !current && !firstQueued && !failed ? (list?.jobs ?? [])
    .filter((x) => x.state === "SUCCEEDED" && within(x.finished_at, DONE_MS))
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0] : undefined;
  const doneAct: ClientActivity | undefined = !current && !firstQueued && !failed ? latest(activities
    .filter((a) => a.state === "SUCCEEDED" && within(a.finishedAt, DONE_MS))) : undefined;
  const done: DoneItem | undefined = doneJob && doneAct
    ? ((doneJob.finished_at ?? "") >= (doneAct.finishedAt ?? "") ? { type: "job", job: doneJob } : { type: "activity", activity: doneAct })
    : doneJob ? { type: "job", job: doneJob } : doneAct ? { type: "activity", activity: doneAct } : undefined;

  // the elapsed time ticks every second while anything time-sensitive is shown (running,
  // failed, or just completed); the plain idle line is static and needs no tick
  const live = !!current || !!failed || !!done;
  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  const actLabel = (a: ClientActivity): string => {
    switch (a.kind) {
      case "EXPORT_PACK": return w.cpExportPackRun;
      case "PLAYER_REPORT": return w.cpPlayerReportRun;
      case "AI_ANALYSIS": return w.cpAiAnalystRun;
      case "SCOUTING_PACK": return w.cpScoutingPackRun;
      case "UPLOAD": return w.cpUploading.replace("{a}", a.subject ?? "");
    }
  };
  /** the short noun a finished / failed activity is called by */
  const actNoun = (a: ClientActivity): string => {
    switch (a.kind) {
      case "EXPORT_PACK": return w.cpExportPackDone;
      case "PLAYER_REPORT": return w.cpPlayerReportDone;
      case "AI_ANALYSIS": return w.cpAiAnalystDone;
      case "SCOUTING_PACK": return w.cpScoutingPackDone;
      case "UPLOAD": return w.cpUploadDone;
    }
  };
  const more = queued.length; // jobs waiting behind the one being narrated

  if (failed) {
    // no action running: narrate the failure (the refund line appears once the ledger has been read)
    const label = failed.type === "job" ? failed.job.kind_label : actNoun(failed.activity);
    const subject = failed.type === "job" ? failed.job.subject_title : failed.activity.subject;
    const shown = subject ? `${label} · ${subject}` : label;
    let text: string | null = null;
    if (!failedType) text = w.cpActivityFailed.replace("{a}", shown); // free action: no tokens involved
    else if (refund === undefined) return null; // ledger still loading
    else if (refund !== null) text = w.cpFailedRefunded.replace("{a}", label).replace("{b}", String(refund));
    else if (failedCost !== null) text = w.cpFailedNoRefund.replace("{a}", label).replace("{b}", String(failedCost));
    else return null; // charged cost not worked out yet (analysis video not read)
    return (
      <span data-activity={failedId} data-activity-failed aria-live="polite"
        className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left">
        <span className="block h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
        <span className="truncate text-ink2">{text}</span>
      </span>
    );
  }

  if (done) {
    // nothing running: the last completed action, briefly
    let text: string;
    if (done.type === "job") {
      text = done.job.subject_title
        ? w.cpFinished.replace("{a}", done.job.kind_label).replace("{b}", done.job.subject_title)
        : w.cpFinishedPlain.replace("{a}", done.job.kind_label);
    } else if (done.activity.kind === "UPLOAD") {
      text = done.activity.subject
        ? w.cpFinished.replace("{a}", w.cpUploadDone).replace("{b}", done.activity.subject)
        : w.cpFinishedPlain.replace("{a}", w.cpUploadDone);
    } else {
      text = w.cpReady.replace("{a}", actNoun(done.activity));
    }
    return (
      <span data-activity-done aria-live="polite" className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left">
        <span className="block h-1.5 w-1.5 rounded-full" style={{ background: "rgb(var(--ok))" }} aria-hidden />
        <span className="truncate text-ink2">{text}</span>
      </span>
    );
  }

  if (!current && !firstQueued) {
    return (
      <span data-activity-idle className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left">
        <span className="block h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />
        <span className="truncate text-muted">{w.cpIdle}</span>
      </span>
    );
  }

  const position = items.length > 1 ? w.cpOfTotal.replace("{a}", String(rot + 1)).replace("{b}", String(items.length)) : null;
  const busy = current ? (current.type === "job" ? current.job.state === "RUNNING" : true) : false;

  if (currentAct) {
    // a client-side activity: the action in plain words, elapsed time ticking, the real %
    // for uploads only, and the committed tokens for the charged ones — no stage, no
    // estimate, no progress for the API actions: the server reports none
    const label = actLabel(currentAct);
    const cost = currentAct.cost;
    return (
      <span data-activity={currentAct.id} aria-live="polite" className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left">
        <span className="flex gap-[3px]" aria-hidden>
          {[0, 1, 2].map((i) => <i key={i} className="block h-1 w-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />)}
        </span>
        <span className="truncate text-ink2">
          {label}{currentAct.kind !== "UPLOAD" && currentAct.subject ? ` · ${currentAct.subject}` : ""}
        </span>
        {cost !== null && (
          <span className="t-mono shrink-0 text-ink">{cost} {w.tokensUnit}</span>
        )}
        <span className="t-mono shrink-0 text-ink">{elapsed(currentAct.startedAt) ?? ""}</span>
        {currentAct.progress !== null && <span className="t-mono shrink-0 text-muted">{Math.round(currentAct.progress)}%</span>}
        {position && <span className="shrink-0 text-muted">{position}</span>}
        {more > 0 && <span className="shrink-0 text-muted">{w.cpMore.replace("{a}", String(more))}</span>}
      </span>
    );
  }

  const j = currentJob ?? firstQueued!;
  const queuedMore = currentJob ? queued.length : queued.length - 1;
  // analysis only: the footage minutes covered so far, against the total (the total is the cost in tokens)
  const cost = charged?.cost ?? null;
  const covered = j.kind === "ANALYZE" && cost !== null ? minutesCovered(j.progress, cost) : null;
  const est = about(w, j.estimate_s);
  return (
    <Link href="/processing" data-activity={j.id} aria-live="polite"
      className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-raised"
      aria-label={`${j.kind_label}${j.subject_title ? `, ${j.subject_title}` : ""}: ${busy ? (j.stage ?? w.cpRunning) : w.cpWaiting}. Open processing`}>
      {busy ? (
        <span className="flex gap-[3px]" aria-hidden>
          {[0, 1, 2].map((i) => <i key={i} className="block h-1 w-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />)}
        </span>
      ) : <span className="block h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />}
      <span className="truncate text-ink2">
        {j.kind_label}{j.subject_title ? ` · ${j.subject_title}` : ""}
        <span className="text-muted">{busy ? ` — ${j.stage ?? w.cpRunning}` : ` — ${w.cpWaiting}`}</span>
      </span>
      {covered !== null && cost !== null && (
        <span className="shrink-0 text-muted">{w.cpMinuteOf.replace("{a}", String(covered)).replace("{b}", String(cost))}</span>
      )}
      {cost !== null && (
        <span className="t-mono shrink-0 text-ink">{cost} {w.tokensUnit}</span>
      )}
      {busy && <span className="t-mono shrink-0 text-ink">{elapsed(j.started_at) ?? ""}</span>}
      {busy && <span className="t-mono shrink-0 text-muted">{Math.round(j.progress)}%</span>}
      {busy && est !== null && <span className="shrink-0 text-muted">({est} {w.cpInTotal})</span>}
      {position && <span className="shrink-0 text-muted">{position}</span>}
      {queuedMore > 0 && <span className="shrink-0 text-muted">{w.cpMore.replace("{a}", String(queuedMore))}</span>}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
