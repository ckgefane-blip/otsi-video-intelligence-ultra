"use client";
/**
 * Settings > Plans & billing (ADR-144, ultra-only; docs/bank-transfer-web-ui.md §1). The plan catalogue
 * (GET /v1/billing/plans — the source of truth, never hard-coded here), the user's plan orders
 * (GET /v1/billing/orders) and the live subscription (GET /v1/billing/subscription). An order is placed by
 * bank transfer; its pro-forma invoice — with the owner's bank details — lives on the order's own page.
 * "Pay online — Coming soon" is a disabled button only: it never opens a checkout and never charges.
 */
import type { BankTransferOrder, PlanCatalogue, SubscriptionStatus } from "@otsi-vie/contracts";
import { planPriceMinor, planTokens } from "@otsi-vie/contracts";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { money, OrderStatusLabel, planMonths } from "./BillingShared";

const BILLABLE = ["STARTER", "CLUB", "ACADEMY", "SEASON"] as const;

export function PlanOrdersView() {
  const { t } = useLocale();
  const w = t.body.wallet;
  const router = useRouter();
  const [catalogue, setCatalogue] = useState<PlanCatalogue | null>(null);
  const [orders, setOrders] = useState<BankTransferOrder[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [period, setPeriod] = useState<1 | 12>(1);
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, ords, sub] = await Promise.all([
        api<PlanCatalogue>("/v1/billing/plans"),
        api<BankTransferOrder[]>("/v1/billing/orders"),
        api<SubscriptionStatus | null>("/v1/billing/subscription"),
      ]);
      setCatalogue(cat);
      setOrders(ords);
      setSubscription(sub);
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : w.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function order(planCode: (typeof BILLABLE)[number]) {
    setBusy(`order-${planCode}`);
    setNotice(null);
    setError(null);
    try {
      const created = await api<{ order: BankTransferOrder }>("/v1/billing/orders", {
        method: "POST",
        json: { plan_code: planCode, period_months: period, currency },
      });
      setNotice(w.blOrderCreated);
      router.push(`/settings/billing/orders/${created.order.id}`);
    } catch (e) {
      if (e instanceof ApiProblem && e.code === "BANK_ACCOUNT_NOT_CONFIGURED") {
        setError(w.blNoBankAccount.replace("{a}", currency));
      } else {
        setError(e instanceof ApiProblem ? e.message : w.actionFailed);
      }
    } finally {
      setBusy(null);
    }
  }

  if (loading && !catalogue) {
    return <main className="flex min-h-64 flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></main>;
  }

  const plans = (catalogue?.plans ?? []).filter((p) => (BILLABLE as readonly string[]).includes(p.code));
  const priceOf = (code: (typeof BILLABLE)[number], months: 1 | 12) => money(planPriceMinor(code, months, currency), currency);

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-7 py-3" data-page="settings-billing">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5"><span className="eb">{t.desktop.navSettings}</span><h1 className="h1">{w.blTitle}</h1></div>
        <div className="flex items-center gap-2">
          <span className="mu sm">{w.currencyAria}</span>
          <div className="seg" role="group" aria-label={w.currencyAria}>
            <button type="button" className={currency === "NGN" ? "on" : ""} aria-pressed={currency === "NGN"} onClick={() => setCurrency("NGN")}>{w.wlCurrencyNaira}</button>
            <button type="button" className={currency === "USD" ? "on" : ""} aria-pressed={currency === "USD"} onClick={() => setCurrency("USD")}>{w.wlCurrencyDollar}</button>
          </div>
        </div>
      </div>
      <p className="t-body text-muted">{w.blSubtitle}</p>

      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}

      <section className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2.5" aria-labelledby="sub">
        <span id="sub" className="h3">{w.blSubscription}</span>
        {subscription ? (
          <span className="t-small">
            <span className="text-primary" aria-hidden>•</span> {subscription.plan_code} ·{" "}
            {subscription.state === "PAST_DUE"
              ? w.blSubPastDue
              : w.blPlanActiveUntil.replace("{a}", subscription.period_end ? new Date(subscription.period_end).toLocaleDateString() : "—")}
          </span>
        ) : (
          <span className="t-small text-muted">{w.blNoSubscription}</span>
        )}
      </section>

      <section className="min-w-0 border-t border-line pt-3" aria-labelledby="plans">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <h2 id="plans" className="h3">{w.blChoosePlan}</h2>
          <div className="seg" role="group" aria-label={w.blChoosePlan}>
            <button type="button" className={period === 1 ? "on" : ""} aria-pressed={period === 1} onClick={() => setPeriod(1)}>{w.blMonthly}</button>
            <button type="button" className={period === 12 ? "on" : ""} aria-pressed={period === 12} onClick={() => setPeriod(12)}>{w.blTwelve}</button>
          </div>
        </div>
        <div className="grid gap-2.5 py-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {plans.map((plan) => (
            <div key={plan.code} className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-body">{plan.label}</span>
                <span className="t-body">{priceOf(plan.code as (typeof BILLABLE)[number], period)}</span>
              </div>
              <p className="sm mu">{plan.covers}</p>
              <dl className="kv">
                <dt>{w.blTokensPerMonth}</dt>
                <dd>{plan.tokens_per_month}</dd>
                <dt>{w.blMonthly}</dt>
                <dd>{priceOf(plan.code as (typeof BILLABLE)[number], 1)}</dd>
                <dt>{w.blTwelve}</dt>
                <dd>{priceOf(plan.code as (typeof BILLABLE)[number], 12)}</dd>
              </dl>
              <p className="sm mu">
                {period === 1
                  ? w.blPeriodTokens.replace("{a}", String(planTokens(plan.code as (typeof BILLABLE)[number], 1)))
                  : w.blPeriodTokens.replace("{a}", String(planTokens(plan.code as (typeof BILLABLE)[number], 12)))}
              </p>
              <div className="mt-auto flex flex-wrap gap-2">
                <button type="button" disabled={busy !== null} className="btn pri sm"
                  onClick={() => void order(plan.code as (typeof BILLABLE)[number])}>
                  {busy === `order-${plan.code}` ? w.requesting : `${w.blOrderBtn} · ${planMonths(period, w)}`}
                </button>
                <button type="button" disabled className="btn sm" title={w.blPayOnlineNote}>{w.blPayOnline}</button>
              </div>
            </div>
          ))}
        </div>
        <p className="sm mu">{w.blPayOnlineNote}</p>
      </section>

      <section className="min-w-0 flex-1 border-t border-line pt-3" aria-labelledby="ords">
        <div className="flex items-center justify-between gap-2 pb-1"><h2 id="ords" className="h3">{w.blYourOrders}</h2></div>
        {orders.length === 0 ? (
          <div className="empty">
            <h3>{w.blNoOrders}</h3>
            <p>{w.blNoOrdersHint}</p>
          </div>
        ) : (
          <ul className="mt-2 space-y-2">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line bg-canvas px-3 py-2">
                <span>
                  {o.reference} · {o.plan_code} · {planMonths(o.period_months, w)} · {money(o.amount_minor, o.currency)} · <OrderStatusLabel order={o} />
                </span>
                <span className="flex items-center gap-3">
                  <span className="t-small text-muted">{new Date(o.created_at).toLocaleDateString()}</span>
                  <Link href={`/settings/billing/orders/${o.id}`} className="sm text-primary hover:underline">{w.blViewOrder}</Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
