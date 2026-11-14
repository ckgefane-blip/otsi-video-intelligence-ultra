"use client";
/**
 * Settings > Plans & billing (ADR-144, ultra-only; docs/bank-transfer-web-ui.md §1). The plan catalogue
 * (GET /v1/billing/plans — the source of truth, never hard-coded here), the user's plan orders
 * (GET /v1/billing/orders) and the live subscription (GET /v1/billing/subscription). An order is placed by
 * bank transfer; its pro-forma invoice — with the owner's bank details — lives on the order's own page.
 * "Pay online — Coming soon" is a disabled button only: it never opens a checkout and never charges.
 * The approved grassroots price list (owner 2026-11-13; free grant 100 tokens by owner decision 2026-11-14 ~02:33): Free first (its 100 free tokens are claimed here or in Token Wallet),
 * the four orderable plans, then Enterprise ("Contact us", from a monthly price, agreed per customer). Every card shows its
 * upload limit per video and its top-up rate — all read from the catalogue the server sends.
 */
import type { BankTransferOrder, PlanCatalogue, SubscriptionStatus } from "@otsi-vie/contracts";
import { FREE_GRANT_TOKENS, planPriceMinor, planTokens, type PlanCatalogueEntry } from "@otsi-vie/contracts";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import { walletChanged } from "@/lib/wallet";
import { money, OrderStatusLabel, planMonths } from "./BillingShared";
import { FieldMessage, useFieldMessages } from "./FieldMessage";

const BILLABLE = ["STARTER", "CLUB", "ACADEMY", "SEASON"] as const;

/** The last Plans & billing data the app actually saw, kept in localStorage so the page can show it
 *  when the server cannot be reached. Only data the server really returned is ever shown; when
 *  nothing was ever read, the sections say plainly they cannot load offline, instead of the wrong
 *  "No active subscription / No orders yet" (the Wallet page's pattern, 2026-11-14). */
const CATALOGUE_KEY = "otsi-plans-last-known-catalogue";
const ORDERS_KEY = "otsi-plans-last-known-orders";
const SUB_KEY = "otsi-plans-last-known-subscription";
function readLastKnown<T>(key: string): T | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}
function saveLastKnown(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

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
  /** true when the last load failed (the server cannot be reached): the sections below show the last
   *  known data, if any — and when there is none, they say they cannot load offline instead of
   *  claiming there is no subscription and no orders. Ordering needs the server, so its buttons stay
   *  disabled while offline. */
  const [offline, setOffline] = useState(false);
  /** Load errors only — they have no button, so they stay at the top of the page. Every action's
   *  own result goes next to the button that caused it (owner rule, 2026-11-14), in `fieldMsg`. */
  const [error, setError] = useState<string | null>(null);
  /** One result message per action, keyed by the action's slot, rendered next to its button. */
  const { msgs: fieldMsg, set: setFieldMsg } = useFieldMessages();
  const [busy, setBusy] = useState<string | null>(null);
  const [contact, setContact] = useState(false);

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
      saveLastKnown(CATALOGUE_KEY, cat);
      setOrders(ords);
      saveLastKnown(ORDERS_KEY, ords);
      setSubscription(sub);
      saveLastKnown(SUB_KEY, sub);
      setOffline(false);
    } catch (e) {
      // offline: show the last known data, if any — never the empty state as if it were real.
      setCatalogue(readLastKnown<PlanCatalogue>(CATALOGUE_KEY));
      setOrders(readLastKnown<BankTransferOrder[]>(ORDERS_KEY) ?? []);
      setSubscription(readLastKnown<SubscriptionStatus | null>(SUB_KEY));
      setOffline(true);
      setError(e instanceof ApiProblem ? e.message : w.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function order(planCode: (typeof BILLABLE)[number]) {
    setBusy(`order-${planCode}`);
    setFieldMsg(`order-${planCode}`, null);
    try {
      const created = await api<{ order: BankTransferOrder }>("/v1/billing/orders", {
        method: "POST",
        json: { plan_code: planCode, period_months: period, currency },
      });
      // success navigates to the order's own page — that page is the result, so no message here.
      router.push(`/settings/billing/orders/${created.order.id}`);
    } catch (e) {
      if (e instanceof ApiProblem && e.code === "BANK_ACCOUNT_NOT_CONFIGURED") {
        setFieldMsg(`order-${planCode}`, { ok: false, text: w.blNoBankAccount.replace("{a}", currency) });
      } else {
        setFieldMsg(`order-${planCode}`, { ok: false, text: e instanceof ApiProblem ? e.message : w.actionFailed });
      }
    } finally {
      setBusy(null);
    }
  }

  async function claimFree() {
    setBusy("free");
    setFieldMsg("free", null);
    try {
      await api("/v1/wallet/free-grant", { method: "POST" });
      walletChanged(); // the top token chip and the status bar read the shared balance — refresh them now
      setFieldMsg("free", { ok: true, text: w.freeAdded });
    } catch (e) {
      setFieldMsg("free", { ok: false, text: e instanceof ApiProblem ? e.message : w.actionFailed });
    } finally {
      setBusy(null);
    }
  }

  if (loading && !catalogue) {
    return <main className="flex min-h-64 flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></main>;
  }

  const plans = catalogue?.plans ?? [];
  const billable = (p: PlanCatalogueEntry): p is PlanCatalogueEntry & { code: (typeof BILLABLE)[number] } => (BILLABLE as readonly string[]).includes(p.code);
  const upload = (p: PlanCatalogueEntry) => (p.upload_gb_per_video === null ? w.blNoPlanLimit : `${p.upload_gb_per_video} GB`);
  const blockPrice = (p: PlanCatalogueEntry) => {
    const m = currency === "NGN" ? p.topup_block_ngn_minor : p.topup_block_usd_minor;
    return m === null ? null : money(m, currency);
  };
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
          <span className="t-small text-muted">{offline ? w.blCantLoadOffline : w.blNoSubscription}</span>
        )}
        {offline && subscription && <span className="t-small text-muted">{w.wlOfflineNote}</span>}
      </section>

      <section className="min-w-0 border-t border-line pt-3" aria-labelledby="plans">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
          <h2 id="plans" className="h3">{w.blChoosePlan}</h2>
          <div className="seg" role="group" aria-label={w.blChoosePlan}>
            <button type="button" className={period === 1 ? "on" : ""} aria-pressed={period === 1} onClick={() => setPeriod(1)}>{w.blMonthly}</button>
            <button type="button" className={period === 12 ? "on" : ""} aria-pressed={period === 12} onClick={() => setPeriod(12)}>{w.blTwelve}</button>
          </div>
        </div>
        {offline && catalogue && <p className="sm mu">{w.wlOfflineNote}</p>}
        {!catalogue ? (
          <p className="t-body text-muted py-2">{w.blCantLoadOffline}</p>
        ) : (
          <>
        <div className="grid gap-2.5 py-2 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
          {plans.map((plan) => (
            <div key={plan.code} className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3.5" data-plan-card={plan.code}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="t-body">{plan.label}</span>
                <span className="t-body">
                  {billable(plan) ? priceOf(plan.code, period)
                    : plan.code === "ENTERPRISE" ? w.blFromPrice.replace("{a}", money(currency === "NGN" ? plan.price_ngn_minor : plan.price_usd_minor, currency))
                    : money(0, currency)}
                </span>
              </div>
              <p className="sm mu">{plan.covers}</p>
              <dl className="kv">
                {billable(plan) && (
                  <>
                    <dt>{w.blTokensPerMonth}</dt>
                    <dd>{plan.tokens_per_month.toLocaleString()}</dd>
                    <dt>{w.blMonthly}</dt>
                    <dd>{priceOf(plan.code, 1)}</dd>
                    <dt>{w.blTwelve}</dt>
                    <dd>{priceOf(plan.code, 12)}</dd>
                  </>
                )}
                {plan.code === "FREE" && (
                  <>
                    <dt>{w.wlFreeGrant}</dt>
                    <dd>{FREE_GRANT_TOKENS}</dd>
                  </>
                )}
                <dt>{w.blUploadPerVideo}</dt>
                <dd>{upload(plan)}</dd>
              </dl>
              {blockPrice(plan) && <p className="sm mu" data-topup-rate>{w.blTopupRate.replace("{a}", blockPrice(plan)!)}</p>}
              {billable(plan) && (
                <p className="sm mu">{w.blPeriodTokens.replace("{a}", planTokens(plan.code, period).toLocaleString())}</p>
              )}
              <div className="mt-auto flex flex-wrap gap-2">
                {billable(plan) && (
                  <>
                    <button type="button" disabled={busy !== null || offline} className="btn pri sm" onClick={() => void order(plan.code)}>
                      {busy === `order-${plan.code}` ? w.requesting : `${w.blOrderBtn} · ${planMonths(period, w)}`}
                    </button>
                    <button type="button" disabled className="btn sm" title={w.blPayOnlineNote}>{w.blPayOnline}</button>
                  </>
                )}
                {plan.code === "FREE" && (
                  <button type="button" disabled={busy !== null || offline} className="btn pri sm" onClick={() => void claimFree()}>
                    {busy === "free" ? w.claiming : w.blFreeClaim.replace("{a}", String(FREE_GRANT_TOKENS))}
                  </button>
                )}
                {plan.code === "ENTERPRISE" && (
                  <button type="button" className="btn sm" aria-expanded={contact} onClick={() => setContact((c) => !c)}>{w.blContactUs}</button>
                )}
              </div>
              {billable(plan) && <FieldMessage msg={fieldMsg[`order-${plan.code}`]} />}
              {plan.code === "FREE" && <FieldMessage msg={fieldMsg["free"]} />}
              {plan.code === "ENTERPRISE" && contact && <p role="status" className="sm">{w.blEnterpriseNote}</p>}
            </div>
          ))}
        </div>
        <p className="sm mu">{w.blPayOnlineNote}</p>
          </>
        )}
      </section>

      <section className="min-w-0 flex-1 border-t border-line pt-3" aria-labelledby="ords">
        <div className="flex items-center justify-between gap-2 pb-1"><h2 id="ords" className="h3">{w.blYourOrders}</h2></div>
        {offline && orders.length > 0 && <p className="sm mu">{w.wlOfflineNote}</p>}
        {orders.length === 0 ? (
          <div className="empty">
            <h3>{offline ? w.blCantLoadOffline : w.blNoOrders}</h3>
            {!offline && <p>{w.blNoOrdersHint}</p>}
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
