"use client";
/**
 * The live activity line (owner 2026-11-12: "when the user is doing work, a real-time update, as Claude and almost every AI does"):
 * the narration of what the engine is doing right now, in words, as it happens. While a job runs, the status bar says the job, its
 * subject, the stage the worker reports (the worker's own words — "Tracking players…", "Rendering reel…"), a ticking elapsed time
 * (from started_at), the progress, and › to open Processing. A queued job alone says it is waiting. With nothing running the line is
 * empty — unless a charged job just failed, when it says so and what happened to its tokens (below). Every word comes from GET /v1/jobs
 * (via the Jobs Center's own reads, every 3 s while busy); the time is counted here between reads. No estimate is shown as a countdown:
 * estimate_s is an estimate, so it is labelled "about".
 *
 * Billing blueprint §4.2(3) — the live job readout, built AS this narration (not a separate numbers panel): when the running job is
 * charged work (analysis or render), the line also says how many tokens the job committed and, for an analysis, how many minutes of
 * footage it has covered against the total ("minute 34 of 90"). The minute is derived from the job's progress, not measured — the
 * worker reports progress, not the minute it is on. The token cost is the exact charge the server makes (1 token per started minute
 * for analysis, 10 for a render), so the number here is the number that left the wallet. When a charged job fails, the line stays up
 * for 15 minutes and says what happened to the tokens: refunded, with the amount from the ledger, or committed with no refund
 * recorded yet (the worker does not call the refund yet — ADR-140 §7, known gap — so the line only claims a refund when a REFUND
 * row actually exists). The full app-wide ActivityLine (narration for every engine action) is a separate feature; this line narrates
 * the jobs list, which is what the readout specifies.
 */
import type { Job, Video, WalletLedgerEntry, WalletJobType } from "@otsi-vie/contracts";
import { analysisCostTokens } from "@otsi-vie/contracts";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { useJobs } from "@/lib/jobsLive";
import { chargedCost, chargedJobKind, minutesCovered, recentFailure, refundForJob } from "@/lib/tokenCost";

const elapsed = (from: string | null) => {
  if (!from) return null;
  const s = Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
};
const about = (s: number | null) => (s == null ? null : s >= 60 ? `about ${Math.round(s / 60)} min` : `about ${Math.round(s)} s`);

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

export function ActivityLine() {
  const { t } = useLocale();
  const w = t.body.wallet;
  const list = useJobs();
  const [, tick] = useState(0);
  const running = list?.jobs.filter((j) => j.state === "RUNNING") ?? [];
  const queued = list?.jobs.filter((j) => j.state === "QUEUED") ?? [];
  useEffect(() => {
    if (!running.length) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [running.length]);
  const j = running[0] ?? queued[0];
  const charged = useCharged(j);
  // a charged job that just failed: the line stays up for 15 minutes and says what happened to its tokens
  const failed = !j ? (list?.jobs ?? [])
    .filter((x) => x.state === "FAILED" && chargedJobKind(x.kind) !== null && recentFailure(x.finished_at))
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""))[0] : undefined;
  const failedCharged = useCharged(failed);
  const [refund, setRefund] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    if (!failed || !failedCharged) { setRefund(undefined); return; }
    let live = true;
    setRefund(undefined);
    api<{ entries: WalletLedgerEntry[] }>("/v1/wallet/ledger?limit=200").then(
      (l) => { if (live) setRefund(refundForJob(l.entries, failedCharged.type, failed.finished_at)); },
      () => { if (live) setRefund(null); },
    );
    return () => { live = false; };
  }, [failed?.id, failedCharged?.type]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!j && !failed) return null;
  if (failed && !j) {
    // no job running: narrate the failure (the refund line appears once the ledger has been read)
    const cost = failedCharged?.cost ?? null;
    const text = refund === undefined ? null
      : refund !== null ? w.cpFailedRefunded.replace("{a}", failed.kind_label).replace("{b}", String(refund))
      : cost !== null ? w.cpFailedNoRefund.replace("{a}", failed.kind_label).replace("{b}", String(cost)) : null;
    if (!text) return null;
    return (
      <Link href="/processing" data-activity={failed.id} data-activity-failed aria-live="polite"
        className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-raised"
        aria-label={`${text} Open processing`}>
        <span className="block h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
        <span className="truncate text-ink2">{text}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
      </Link>
    );
  }
  const busy = j!.state === "RUNNING";
  const more = running.length + queued.length - 1;
  // analysis only: the footage minutes covered so far, against the total (the total is the cost in tokens)
  const cost = charged?.cost ?? null;
  const covered = j!.kind === "ANALYZE" && cost !== null ? minutesCovered(j!.progress, cost) : null;
  return (
    <Link href="/processing" data-activity={j!.id} aria-live="polite"
      className="flex min-w-0 items-center gap-2 rounded px-1.5 py-0.5 text-left hover:bg-raised"
      aria-label={`${j!.kind_label}${j!.subject_title ? `, ${j!.subject_title}` : ""}: ${busy ? (j!.stage ?? w.cpRunning) : w.cpWaiting}. Open processing`}>
      {busy ? (
        <span className="flex gap-[3px]" aria-hidden>
          {[0, 1, 2].map((i) => <i key={i} className="block h-1 w-1 rounded-full bg-primary animate-pulse" style={{ animationDelay: `${i * 200}ms` }} />)}
        </span>
      ) : <span className="block h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />}
      <span className="truncate text-ink2">
        {j!.kind_label}{j!.subject_title ? ` · ${j!.subject_title}` : ""}
        <span className="text-muted">{busy ? ` — ${j!.stage ?? w.cpRunning}` : ` — ${w.cpWaiting}`}</span>
      </span>
      {covered !== null && cost !== null && (
        <span className="shrink-0 text-muted">{w.cpMinuteOf.replace("{a}", String(covered)).replace("{b}", String(cost))}</span>
      )}
      {cost !== null && (
        <span className="t-mono shrink-0 text-ink">{cost} {w.tokensUnit}</span>
      )}
      {busy && <span className="t-mono shrink-0 text-ink">{elapsed(j!.started_at) ?? ""}</span>}
      {busy && <span className="t-mono shrink-0 text-muted">{Math.round(j!.progress)}%</span>}
      {busy && j!.estimate_s != null && <span className="shrink-0 text-muted">({about(j!.estimate_s)} in total)</span>}
      {more > 0 && <span className="shrink-0 text-muted">+{more} more</span>}
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
    </Link>
  );
}
