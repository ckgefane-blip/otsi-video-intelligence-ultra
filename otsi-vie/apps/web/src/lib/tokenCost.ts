/**
 * Live token display helpers (billing blueprint §4.2): which jobs cost tokens, what they cost,
 * how far an analysis has got in footage minutes, and how the ledger groups into usage history.
 * Pure functions, no I/O — tested in test/tokenCost.test.ts. Nothing here invents a cost: every
 * number comes from the contracts (TOKEN_COSTS, analysisCostTokens) or from the ledger rows given.
 */
import { TOKEN_COSTS, analysisCostTokens, type JobKind, type WalletJobType, type WalletLedgerEntry } from "@otsi-vie/contracts";

/** the charged work a worker job kind maps to, or null when the job costs nothing (ingest, proxy,
 *  footage check, ball, pitch, lineups, snapshot, beat grid are free — only analysis and render spend). */
export function chargedJobKind(kind: JobKind): WalletJobType | null {
  return kind === "ANALYZE" ? "ANALYSIS" : kind === "RENDER" ? "REEL_RENDER" : null;
}

/** the tokens one charged action commits. An analysis needs the video's measured duration;
 *  null (no measured duration) means it cannot be priced and must be refused, never guessed. */
export function chargedCost(type: WalletJobType, durationUs?: number | null): number | null {
  switch (type) {
    case "ANALYSIS": return analysisCostTokens(durationUs);
    case "REEL_RENDER": return TOKEN_COSTS.reelRender;
    case "PLAYER_REPORT": return TOKEN_COSTS.playerReport;
    case "EXPORT_PACK": return TOKEN_COSTS.exportPack;
    case "AI_ANALYSIS": return TOKEN_COSTS.aiAnalysis;
  }
}

/** footage minutes covered so far, from the job's progress (0-100) over the total minutes.
 *  Derived from progress, not measured: the worker reports progress, not the minute it is on. */
export function minutesCovered(progress: number, totalMinutes: number): number {
  const p = Math.min(100, Math.max(0, progress));
  return Math.min(totalMinutes, Math.max(0, Math.round((p / 100) * totalMinutes)));
}

/** a failed charged job worth narrating in the status line: finished within the last 15 minutes.
 *  Older failures live in the Jobs Center, not in the live line. */
export function recentFailure(finishedAt: string | null, now = Date.now()): boolean {
  if (!finishedAt) return false;
  const t = Date.parse(finishedAt);
  return !Number.isNaN(t) && now - t >= 0 && now - t <= 15 * 60 * 1000;
}

/** the refund issued for one failed job, if any: the earliest REFUND row of the same job type
 *  created at/after the job finished and within 5 minutes after it. A heuristic — the ledger
 *  carries the run/render id and the job list does not — so the match is by type and timing.
 *  Returns the refunded amount (REFUND rows are positive), or null when no refund was recorded. */
export function refundForJob(entries: WalletLedgerEntry[], type: WalletJobType, finishedAt: string | null): number | null {
  if (!finishedAt) return null;
  const t = Date.parse(finishedAt);
  if (Number.isNaN(t)) return null;
  const cands = entries
    .filter((e) => e.kind === "REFUND" && e.job_type === type)
    .filter((e) => { const c = Date.parse(e.created_at); return !Number.isNaN(c) && c >= t && c <= t + 5 * 60 * 1000; })
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const first = cands[0];
  return first ? first.amount : null;
}

/** one usage period's spend, broken down by action. Only SPEND rows count, net of REFUND rows
 *  of the same action in the same period (a refunded spend did not stay spent). */
export interface UsageBucket {
  /** tokens that left the wallet and stayed gone, in this period */
  total: number;
  byAction: Record<WalletJobType, number>;
}

const ACTIONS: WalletJobType[] = ["ANALYSIS", "REEL_RENDER", "PLAYER_REPORT", "EXPORT_PACK", "AI_ANALYSIS"];

function bucket(entries: WalletLedgerEntry[], from: number, to: number): UsageBucket {
  const byAction = Object.fromEntries(ACTIONS.map((a) => [a, 0])) as Record<WalletJobType, number>;
  for (const e of entries) {
    if (!e.job_type || (e.kind !== "SPEND" && e.kind !== "REFUND")) continue;
    const t = Date.parse(e.created_at);
    if (Number.isNaN(t) || t < from || t > to) continue;
    // SPEND rows are negative and REFUND rows positive, so -amount is the net spend in both
    // cases: a spend adds, a refund of the same action subtracts. Clamped per action below.
    byAction[e.job_type] += -e.amount;
  }
  for (const a of ACTIONS) byAction[a] = Math.max(0, byAction[a]);
  return { total: ACTIONS.reduce((s, a) => s + byAction[a], 0), byAction };
}

/** usage over three windows, all ending now: today (same local calendar day), the last 7 days,
 *  and the last 30 days. `now` is injectable for tests. */
export function usageBuckets(entries: WalletLedgerEntry[], now = new Date()): { day: UsageBucket; week: UsageBucket; month: UsageBucket } {
  const to = now.getTime();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return {
    day: bucket(entries, dayStart, to),
    week: bucket(entries, to - 7 * 86400_000, to),
    month: bucket(entries, to - 30 * 86400_000, to),
  };
}
