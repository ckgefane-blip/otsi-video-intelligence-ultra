"use client";
/**
 * Settings > Token Wallet (SOT, Wallet.dc.html; ADR-140, ultra-only). The organization's token balance,
 * free grant, plan, pack catalogue, pack requests and ledger. 1 token = 1 minute of footage analysed; reel
 * render, player report and export pack cost 10 tokens each. The balance is derived from the ledger — this
 * page shows what the API derives, never a typed-in number. Bank transfer only: a pack is requested here, the
 * owner issues an invoice, the organization pays by bank transfer, and the owner confirms receipt before any
 * tokens arrive. No card, no payment gateway. "Export CSV" downloads the ledger rows shown.
 */
import type { LicenceSnapshot, PackRequest, PackRequestPayment, PlanCatalogue, TokenPackCatalogue, WalletBalance, WalletLedgerEntry } from "@otsi-vie/contracts";
import { FREE_GRANT_TOKENS } from "@otsi-vie/contracts";
import { FileText, List, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { UsageHistory } from "./UsageHistory";

const money = (minor: number, currency: "NGN" | "USD") =>
  currency === "NGN" ? `₦${(minor / 100).toLocaleString("en-NG")}` : `$${(minor / 100).toFixed(2)}`;

const kindLabel = (t: Dictionary): Record<WalletLedgerEntry["kind"], string> => ({
  PURCHASE: t.body.wallet.kindPurchase,
  FREE_GRANT: t.body.wallet.kindFreeGrant,
  SPEND: t.body.wallet.kindSpend,
  REFUND: t.body.wallet.kindRefund,
  ADJUSTMENT: t.body.wallet.kindAdjustment,
  EXPIRY: t.body.wallet.kindExpiry,
});

const csvOf = (entries: WalletLedgerEntry[]) =>
  ["when,kind,tokens,balance_after,note", ...entries.map((e) =>
    [e.created_at, e.kind, e.amount, e.balance_after, [e.reason, e.invoice_ref].filter(Boolean).join(" ")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");

export function WalletView() {
  const { t } = useLocale();
  const w = t.body.wallet;
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [entries, setEntries] = useState<WalletLedgerEntry[]>([]);
  const [catalogue, setCatalogue] = useState<TokenPackCatalogue | null>(null);
  const [requests, setRequests] = useState<PackRequest[]>([]);
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // the organization's plan (GET /v1/licence) by its catalogue name; null until read, and never guessed
  const [planName, setPlanName] = useState<string | null>(null);
  useEffect(() => {
    void Promise.all([api<LicenceSnapshot>("/v1/licence"), api<PlanCatalogue>("/v1/billing/plans")])
      .then(([l, c]) => setPlanName(c.plans.find((p) => p.code === l.plan)?.label ?? l.plan), () => setPlanName(null));
  }, []);
  const [payFor, setPayFor] = useState<string | null>(null);
  const [pay, setPay] = useState<PackRequestPayment | null>(null);
  const [payLoading, setPayLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, ledger, cat, reqs] = await Promise.all([
        api<WalletBalance>("/v1/wallet"),
        // the API caps the ledger at 200 rows: the usage history below groups these same rows,
        // so a month with more than 200 ledger rows is under-counted there (the ledger table too).
        api<{ balance: WalletBalance; entries: WalletLedgerEntry[] }>("/v1/wallet/ledger?limit=200"),
        api<TokenPackCatalogue>("/v1/wallet/packs"),
        api<PackRequest[]>("/v1/wallet/packs/requests"),
      ]);
      setBalance(b);
      setEntries(ledger.entries);
      setCatalogue(cat);
      setRequests(reqs);
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : w.loadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const claimedFreeGrant = entries.some((e) => e.kind === "FREE_GRANT");

  /** Payment details for one pack request (GET /v1/wallet/packs/requests/:id): the bank details and the
   *  invoice reference, so the organization knows where to pay. Bank details appear only once the owner
   *  has issued the invoice; before that the request is still being prepared. */
  async function togglePayment(id: string) {
    if (payFor === id) { setPayFor(null); setPay(null); return; }
    setPayFor(id);
    setPay(null);
    setPayLoading(true);
    try {
      setPay(await api<PackRequestPayment>(`/v1/wallet/packs/requests/${id}`));
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : w.actionFailed);
      setPayFor(null);
    } finally {
      setPayLoading(false);
    }
  }

  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setNotice(null);
    setError(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : w.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    const blob = new Blob([csvOf(entries)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "otsi-vie-ledger.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading && !balance) {
    return <main className="flex min-h-64 flex-1 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></main>;
  }

  const steps = [
    { n: 1, title: w.wlStep1, desc: w.wlStep1Desc },
    { n: 2, title: w.wlStep2, desc: w.wlStep2Desc },
    { n: 3, title: w.wlStep3, desc: w.wlStep3Desc },
    { n: 4, title: w.wlStep4, desc: w.wlStep4Desc },
    { n: 5, title: w.wlStep5, desc: w.wlStep5Desc },
  ];

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto px-7 py-3" data-page="settings-wallet">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5"><span className="eb">{t.desktop.navSettings}</span><h1 className="h1">{w.wlTitle}</h1></div>
        <div className="flex items-center gap-2">
          <span className="mu sm">{w.currencyAria}</span>
          <div className="seg" role="group" aria-label={w.currencyAria}>
            <button type="button" className={currency === "NGN" ? "on" : ""} aria-pressed={currency === "NGN"} onClick={() => setCurrency("NGN")}>{w.wlCurrencyNaira}</button>
            <button type="button" className={currency === "USD" ? "on" : ""} aria-pressed={currency === "USD"} onClick={() => setCurrency("USD")}>{w.wlCurrencyDollar}</button>
          </div>
        </div>
      </div>

      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}

      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        <section className="flex min-w-0 flex-col gap-2 border-t border-line pt-3" aria-labelledby="bl">
          <span id="bl" className="eb">{w.balance}</span>
          <div className="flex items-baseline gap-2.5"><span className="metric">{balance?.balance ?? "—"}</span><span className="sm mu">{w.tokensUnit}</span></div>
          <dl className="kv mt-1.5">
            <dt>{w.wlAnalysis}</dt><dd>{w.wlAnalysisCost}</dd>
            <dt>{w.wlRender}</dt><dd>{w.wlRenderCost}</dd>
          </dl>
        </section>

        {catalogue && !claimedFreeGrant && (
          <section className="flex min-w-0 flex-col gap-2 border-t border-line pt-3" aria-labelledby="fg">
            <div className="flex items-center justify-between"><span id="fg" className="eb">{w.wlFreeGrant}</span><span className="t-small text-muted">{w.wlOneTime}</span></div>
            <div className="flex items-baseline gap-2.5"><span className="metric">{FREE_GRANT_TOKENS}</span><span className="sm mu">{w.wlFreeOnce.replace(/^\S+\s/, "")}</span></div>
            <p className="sm mu">{w.wlFreeValid}</p>
            <p className="sm mu">{w.wlFreeCovers}</p>
            <button className="btn pri self-start" type="button" disabled={busy !== null}
              onClick={() => void act("grant", () => api("/v1/wallet/free-grant", { method: "POST" }), w.freeAdded)}>
              {busy === "grant" ? w.claiming : w.wlClaimFree}
            </button>
          </section>
        )}
      </div>

      <section className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line py-2.5" aria-labelledby="pl">
        <span id="pl" className="h3">{w.wlPlan}</span>
        {/* the real plan from the licence, and the way to Plans & billing (merge 2026-11-13; the old invented Free / Pro / Enterprise strip is gone) */}
        {planName && <span className="t-small" data-current-plan><span className="text-primary" aria-hidden>•</span> {t.body.plans.yourPlan.replace("{a}", planName)}</span>}
        <span className="flex-1" />
        <Link href="/settings/billing" className="btn sm pri" data-see-plans>{t.body.plans.seePlans}</Link>
      </section>

      {catalogue && (
        <section className="min-w-0 border-t border-line pt-3" aria-labelledby="tp">
          <div className="flex items-center justify-between gap-2 pb-1"><h2 id="tp" className="h3">{w.wlBuyPack}</h2><span className="mu sm">{w.wlBuyHint}</span></div>
          <ol className="steps" aria-label={w.wlBuyPack}>
            {steps.map((st) => (
              <li key={st.n} className="stp">
                <span className="node"><span className="dotn">{st.n}</span><span className="bar" /></span>
                <span className="nm2">{st.title}</span><span className="mu sm">{st.desc}</span>
              </li>
            ))}
          </ol>
          <div className="grid gap-2.5 py-2 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            {catalogue.packs.map((pack) => (
              <div key={pack.code} className="flex items-center gap-3 rounded-lg border border-line bg-canvas p-3.5">
                <div className="flex-1">
                  <div className="t-body">{pack.tokens} {w.tokensUnit}</div>
                  <div className="t-body">{money(currency === "NGN" ? pack.price_ngn_minor : pack.price_usd_minor, currency)}</div>
                </div>
                <button type="button" disabled={busy !== null} className="btn sm"
                  onClick={() => void act(`request-${pack.code}`, () => api("/v1/wallet/packs/request", { method: "POST", json: { pack_code: pack.code, currency } }),
                    w.requested.replace("{a}", pack.label).replace("{b}", money(currency === "NGN" ? pack.price_ngn_minor : pack.price_usd_minor, currency)))}>
                  {busy === `request-${pack.code}` ? w.requesting : w.wlRequest}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <UsageHistory entries={entries} />

      <div className="grid flex-1 gap-3 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
        <section className="flex min-w-0 flex-col border-t border-line pt-3" aria-labelledby="pr">
          <div className="flex items-center justify-between gap-2 pb-1"><h2 id="pr" className="h3">{w.packRequests}</h2><Link href="/settings/admin/billing" className="sm text-primary hover:underline">{w.wlBillingInvoices}</Link></div>
          {requests.length === 0 ? (
            <div className="empty flex-1">
              <span className="ei"><FileText className="i" aria-hidden /></span>
              <h3>{w.wlNoRequests}</h3>
              <p>{w.wlNoRequestsHint}</p>
            </div>
          ) : (
            <ul className="mt-2 space-y-2 p-3.5">
              {requests.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 rounded-ctl border border-line bg-canvas px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span>{r.pack_code} · {r.tokens} {w.tokensUnit} · {money(r.amount_minor, r.currency)} · {({ REQUESTED: w.statusRequested, INVOICED: w.statusInvoiced, PAID: w.statusPaid, CANCELLED: w.statusCancelled } as Record<string, string>)[r.status] ?? r.status}{r.invoice_ref ? ` · ${r.invoice_ref}` : ""}</span>
                    <span className="flex items-center gap-2">
                      {r.status !== "CANCELLED" && (
                        <button type="button" className="btn sm" disabled={payLoading}
                          onClick={() => void togglePayment(r.id)}>
                          {payFor === r.id ? w.wlHidePay : w.wlShowPay}
                        </button>
                      )}
                      {(r.status === "REQUESTED" || r.status === "INVOICED") && (
                        <button type="button" disabled={busy !== null}
                          onClick={() => void act(`cancel-${r.id}`, () => api(`/v1/wallet/packs/requests/${r.id}/cancel`, { method: "POST" }), w.requestCancelled)}
                          className="btn sm">{w.cancel}</button>
                      )}
                    </span>
                  </div>
                  {payFor === r.id && (
                    payLoading || !pay ? (
                      <p className="sm mu">{t.common.loading}</p>
                    ) : (
                      <div className="border-t border-line pt-2">
                        <p className="t-small">{w.wlPayHow}</p>
                        <dl className="kv mt-1">
                          <dt>{w.blReference}</dt>
                          <dd className="font-normal">{pay.request.invoice_ref ?? "—"}</dd>
                          <dt>{w.blAmountToPay}</dt>
                          <dd>{money(pay.request.amount_minor, pay.request.currency)}</dd>
                          {pay.bank_account ? (
                            <>
                              <dt>{w.blAccountName}</dt>
                              <dd>{pay.bank_account.account_name}</dd>
                              <dt>{w.blBank}</dt>
                              <dd>{pay.bank_account.bank_name}</dd>
                              <dt>{w.blAccountNumber}</dt>
                              <dd>{pay.bank_account.account_number}</dd>
                              {pay.bank_account.swift_iban && (
                                <>
                                  <dt>{w.blSwift}</dt>
                                  <dd>{pay.bank_account.swift_iban}</dd>
                                </>
                              )}
                            </>
                          ) : (
                            <>
                              <dt>{w.blBankDetails}</dt>
                              <dd>{r.status === "REQUESTED" ? w.wlInvoicePending : w.wlBankNotSet}</dd>
                            </>
                          )}
                        </dl>
                        <p className="sm mu mt-2">{pay.pay_reference_note}</p>
                      </div>
                    )
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex min-w-0 flex-col border-t border-line pt-3" aria-labelledby="lg">
          <div className="flex items-center justify-between gap-2 pb-1"><h2 id="lg" className="h3">{w.wlLedgerTitle}</h2>
            <button className="btn sm gh" type="button" disabled={entries.length === 0} onClick={exportCsv}>{w.wlExportCsv}</button>
          </div>
          {entries.length === 0 ? (
            <div className="empty flex-1">
              <span className="ei"><List className="i" aria-hidden /></span>
              <h3>{w.wlNoLedger}</h3>
              <p>{w.wlNoLedgerHint}</p>
            </div>
          ) : (
            <div className="p-3.5">
              <table className="w-full">
                <thead>
                  <tr className="t-th text-left"><th className="py-1 pr-2">{w.colWhen}</th><th className="py-1 pr-2">{w.colWhat}</th><th className="py-1 pr-2">{w.colTokens}</th><th className="py-1 pr-2">{w.colBalance}</th><th className="py-1">{w.colNote}</th></tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className="border-t border-line">
                      <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                      <td className="py-1.5 pr-2">{kindLabel(t)[e.kind]}</td>
                      <td className={`py-1.5 pr-2 font-normal ${e.amount > 0 ? "text-ok" : "text-danger"}`}>{e.amount > 0 ? `+${e.amount}` : e.amount}</td>
                      <td className="py-1.5 pr-2">{e.balance_after}</td>
                      <td className="py-1.5">{[e.reason, e.invoice_ref ? w.invoice.replace("{a}", e.invoice_ref) : null].filter(Boolean).join(" · ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
