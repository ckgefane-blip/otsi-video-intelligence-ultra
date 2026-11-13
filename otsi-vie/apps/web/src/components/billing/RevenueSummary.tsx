"use client";
/**
 * Admin › Billing — revenue summary (owner 2026-11-13). GET /v1/admin/billing/revenue: money confirmed into the organization's bank
 * accounts from plan orders and token packs, refunds, what still waits for confirmation, the last 12 months, order and pack counts,
 * active plans and renewals due within 7 days. Naira and dollars are never added together. The company organisation (OTSI) sees every
 * customer's money; a customer organisation its own (ADR-140 §8). A failed read says so and retries.
 */
import type { RevenueSummary as Summary } from "@otsi-vie/contracts";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { fill } from "@/lib/fill";
import { useLocale } from "@/lib/i18n";
import { money } from "@/components/wallet/BillingShared";

const monthLabel = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString(undefined, { month: "short", year: "numeric", timeZone: "UTC" });
const cap = (code: string) => code.charAt(0) + code.slice(1).toLowerCase();

export function RevenueSummary() {
  const { t } = useLocale();
  const s = t.body.plans;
  const [data, setData] = useState<Summary | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    setData(undefined); setError(null);
    void api<Summary>("/v1/admin/billing/revenue").then(setData, (e) => { setData(null); setError(e instanceof ApiProblem ? e.message : s.revLoadFailed); });
  }, [s.revLoadFailed]);
  useEffect(() => { load(); }, [load]);

  return (
    <section className="vie-panel space-y-3 p-4" aria-labelledby="rev-h" data-revenue>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 id="rev-h" className="h3">{s.revTitle}</h2><p className="mu sm">{s.revScope}</p></div>
        <button type="button" className="btn sm" onClick={load} disabled={data === undefined}>{s.revRefresh}</button>
      </div>
      {data === undefined && <div className="flex h-16 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-primary" aria-label={s.revTitle} /></div>}
      {data === null && <p role="alert" className="t-body text-danger">{error} · <button type="button" className="text-primary hover:underline" onClick={load}>{s.revRetry}</button></p>}
      {data && (
        <>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(300px,1fr))]">
            {data.totals.map((c) => {
              const row = (label: string, v: number, key: string) => (
                <div className="flex justify-between gap-3 border-b border-line py-1 last:border-0" data-rev={`${c.currency}-${key}`}>
                  <span className="mu sm">{label}</span><span className="t-body tabular-nums">{money(v, c.currency)}</span>
                </div>
              );
              return (
                <div key={c.currency} className="rounded-ctl border border-line p-3" data-rev-currency={c.currency}>
                  <div className="flex items-baseline justify-between gap-2 pb-1">
                    <span className="t-body">{c.currency === "NGN" ? s.naira : s.dollar}</span>
                    <span className="mu sm">{s.revThisMonth}</span>
                  </div>
                  <div className="pb-2 text-[22px] leading-7 text-ink tabular-nums" data-rev={`${c.currency}-this-month`}>{money(c.this_month_minor, c.currency)}</div>
                  {row(s.revLastMonth, c.last_month_minor, "last-month")}
                  {row(s.rev12, c.last_12_months_minor, "12m")}
                  {row(s.revAllTime, c.net_minor, "net")}
                  {row(s.revPlans, c.plans_minor, "plans")}
                  {row(s.revPacks, c.packs_minor, "packs")}
                  {row(s.revRefunded, c.refunded_minor, "refunded")}
                  {row(s.revAwaiting, c.awaiting_minor, "awaiting")}
                </div>
              );
            })}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] t-small" data-rev-months>
              <caption className="pb-1 text-left t-th">{s.revByMonth}</caption>
              <thead><tr className="text-muted"><th className="py-1 text-left font-normal">{s.revMonth}</th><th className="py-1 text-right font-normal">{s.naira}</th><th className="py-1 text-right font-normal">{s.dollar}</th></tr></thead>
              <tbody>
                {[...data.months].reverse().map((m) => (
                  <tr key={m.month} className="border-t border-line">
                    <td className="py-1">{monthLabel(m.month)}</td>
                    <td className="py-1 text-right tabular-nums">{m.NGN ? money(m.NGN, "NGN") : "—"}</td>
                    <td className="py-1 text-right tabular-nums">{m.USD ? money(m.USD, "USD") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1 t-small">
            <p data-rev-orders>{fill(s.revOrders, { a: data.orders.awaiting, b: data.orders.partial, c: data.orders.confirmed, d: data.orders.rejected, e: data.orders.refunded, f: data.orders.ordered })}</p>
            <p data-rev-packs>{fill(s.revPacksLine, { a: data.packs.requested, b: data.packs.invoiced, c: data.packs.paid })}</p>
            <p data-rev-active>{s.revActive}: {data.active_plans.length ? data.active_plans.map((x) => `${cap(x.plan_code)} ${x.count}`).join(" · ") : s.revNone}</p>
            <p data-rev-renewals>{fill(s.revRenewals, { n: data.renewals_due_7d })}</p>
          </div>
        </>
      )}
    </section>
  );
}
