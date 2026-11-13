"use client";
/**
 * Token usage history (billing blueprint §4.2(5)): where the tokens went — per day, per week, per
 * month, broken down by action (analysis, reel render, player report, export pack, AI Analyst).
 * The source is the ledger rows the wallet page already loaded (GET /v1/wallet/ledger, up to 200
 * rows); the grouping is the pure usageBuckets helper, so a spend that was later refunded does
 * not count as spent. Credits (purchases, grants) are not spend and never appear here.
 */
import type { WalletJobType, WalletLedgerEntry } from "@otsi-vie/contracts";
import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { usageBuckets } from "@/lib/tokenCost";

const ACTIONS: WalletJobType[] = ["ANALYSIS", "REEL_RENDER", "PLAYER_REPORT", "EXPORT_PACK", "AI_ANALYSIS"];
type Period = "day" | "week" | "month";

export function UsageHistory({ entries }: { entries: WalletLedgerEntry[] }) {
  const { t } = useLocale();
  const w = t.body.wallet;
  const [period, setPeriod] = useState<Period>("month");
  const buckets = useMemo(() => usageBuckets(entries), [entries]);
  const bucket = buckets[period];
  const labels: Record<WalletJobType, string> = {
    ANALYSIS: w.wlAnalysis,
    REEL_RENDER: w.uhReelRender,
    PLAYER_REPORT: w.uhPlayerReport,
    EXPORT_PACK: w.uhExportPack,
    AI_ANALYSIS: w.uhAiAnalysis,
  };
  const rows = ACTIONS.filter((a) => bucket.byAction[a] > 0);
  const tabs: [Period, string][] = [[ "day", w.uhDay ], [ "week", w.uhWeek ], [ "month", w.uhMonth ]];
  return (
    <section className="min-w-0 border-t border-line pt-3" aria-labelledby="uh" data-usage-history>
      <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
        <h2 id="uh" className="h3">{w.uhTitle}</h2>
        <div className="seg" role="group" aria-label={w.uhTitle}>
          {tabs.map(([p, label]) => (
            <button key={p} type="button" className={period === p ? "on" : ""} aria-pressed={period === p}
              onClick={() => setPeriod(p)}>{label}</button>
          ))}
        </div>
      </div>
      {bucket.total === 0 ? (
        <p className="py-2 text-sm text-muted">{w.uhNoSpend}</p>
      ) : (
        <dl className="kv mt-1.5" data-usage-period={period}>
          {rows.map((a) => (
            <div key={a} className="contents" data-usage-action={a}>
              <dt>{labels[a]}</dt>
              <dd className="font-normal">{bucket.byAction[a]} {w.tokensUnit}</dd>
            </div>
          ))}
          <div className="contents" data-usage-total>
            <dt className="border-t border-line pt-1 font-normal text-ink">{w.uhTotal}</dt>
            <dd className="border-t border-line pt-1 font-normal">{bucket.total} {w.tokensUnit}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}
