"use client";
/**
 * Admin Billing (ADR-140 + ADR-144, ultra-only). The organization's wallet and ledger, pack requests awaiting
 * an invoice or a confirmed bank transfer, and the manual actions: top-up against an invoice, refund to the
 * wallet, and adjustment — every one with a reason recorded in the ledger. There is no payment gateway here:
 * money arrives by bank transfer and the owner confirms receipt, which is what writes the PURCHASE row.
 *
 * Billing console (ADR-144, docs/bank-transfer-web-ui.md §3–5): the plan orders (pending first) with the
 * confirm / reject / part-payment / refund actions, the bank accounts shown on every invoice, the renewal
 * run, and the revenue summary. Nothing activates before Confirm, and Confirm needs the received amounts
 * to add up to exactly the order amount. The bank details shown on an invoice are the ones saved here.
 *
 * Scoping (ADR-140 §8): the company billing actions (bank accounts, plan order confirm / part-pay /
 * reject / refund, pack invoice / confirm, top-up) are the company organisation's (OTSI) alone — the API
 * refuses everybody else with 403. The reads here are the company org's view of EVERY customer: the
 * order list, pack requests, revenue and wallets show all customers, with the customer's name on each
 * row (a customer org's own reads, on its own pages, stay own-organisation). A customer admin never
 * reaches this view: the nav hides it and the view below refuses to render it. The manual actions and
 * the ledger below act on the wallet picked in the Wallet selector (the first wallet when the page
 * loads); without it the actions would silently target whichever wallet happened to load first.
 */
import type { BankAccount, BankTransferOrder, ProFormaInvoice, RenewalRunResult, SubscriptionStatus, AdminWalletRow, PackRequest, WalletLedgerEntry, WalletLedgerPage } from "@otsi-vie/contracts";
import { PAY_REFERENCE_NOTE } from "@otsi-vie/contracts";
import { Loader2, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { RevenueSummary } from "@/components/billing/RevenueSummary";
import { ApiProblem, api, apiBlob } from "@/lib/api";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { InvoiceCard, OrderStatusLabel, ReceiptCard, money, planMonths, usePrintTarget } from "./BillingShared";

export function AdminBillingView() {
  const { t } = useLocale();
  const { organization } = useAuth();
  // The company organisation's screen (OTSI): a customer admin never sees the billing console — the nav
  // hides the link and this view refuses to render (and never calls the admin endpoints). The API refuses
  // the actions too; this is only the entry point.
  const isCompanyOrg = organization?.is_company_org === true;
  const [wallets, setWallets] = useState<AdminWalletRow[]>([]);
  const [requests, setRequests] = useState<PackRequest[]>([]);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  // Which customer's wallet the manual actions (top-up / refund / adjust / write-off) and the
  // ledger below act on. Defaults to the first wallet once they load; the admin picks another
  // customer's wallet here. (Before the visibility fix there was only ever one wallet — the
  // company org's own — so the actions could just use it; with every customer's wallet listed,
  // silently acting on the first one would top up the wrong club.)
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [topUp, setTopUp] = useState({ amount: "", reason: "", invoiceRef: "" });
  const [refund, setRefund] = useState({ amount: "", reason: "" });
  const [adjust, setAdjust] = useState({ amount: "", reason: "" });
  const [orders, setOrders] = useState<BankTransferOrder[]>([]);
  const [orderFilter, setOrderFilter] = useState<"ALL" | BankTransferOrder["status"]>("ALL");
  const [selectedOrder, setSelectedOrder] = useState<BankTransferOrder | null>(null);
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [bankDraft, setBankDraft] = useState<Record<string, { account_name: string; bank_name: string; account_number: string; swift_iban: string; is_active: boolean }>>({});
  /** Which currency's bank details were just saved: the page-top notice sits far above the bank form,
   *  so a save that only sets it looks like nothing happened where the person is looking. This shows
   *  "Bank details saved" inside the form that was saved, until that form is edited again. */
  const [bankSaved, setBankSaved] = useState<Record<string, boolean>>({});
  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null);
  const [renewal, setRenewal] = useState<RenewalRunResult | null>(null);
  const [confirmForm, setConfirmForm] = useState({ amount: "", bankReference: "", confirmedAt: "" });
  const [rejectReason, setRejectReason] = useState("");
  const [partialForm, setPartialForm] = useState({ amount: "", bankReference: "" });
  const [refundForm, setRefundForm] = useState({ reason: "", amountRefunded: "" });
  const { target: printTarget, print } = usePrintTarget();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, reqs, ords, accounts, sub] = await Promise.all([
        api<AdminWalletRow[]>("/v1/admin/wallet"),
        api<PackRequest[]>("/v1/admin/wallet/pack-requests"),
        api<BankTransferOrder[]>("/v1/admin/billing/orders"),
        api<BankAccount[]>("/v1/admin/billing/bank-accounts"),
        api<SubscriptionStatus | null>("/v1/billing/subscription"),
      ]);
      setWallets(w);
      setRequests(reqs);
      setOrders(ords);
      setBankAccounts(accounts);
      setSubscription(sub);
      setBankDraft(Object.fromEntries(["NGN", "USD"].map((c) => {
        const a = accounts.find((x) => x.currency === c);
        return [c, { account_name: a?.account_name ?? "", bank_name: a?.bank_name ?? "", account_number: a?.account_number ?? "", swift_iban: a?.swift_iban ?? "", is_active: a?.is_active ?? true }];
      })));
      if (w[0]) setSelectedWalletId((cur) => cur ?? w[0]!.organization_id);
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : t.body.wallet.billingLoadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (isCompanyOrg) void load(); }, [load, isCompanyOrg]);

  const orgId = selectedWalletId ?? wallets[0]?.organization_id ?? null;

  // The ledger follows the picked wallet.
  useEffect(() => {
    if (!isCompanyOrg || !orgId) return;
    let cancelled = false;
    void api<WalletLedgerPage>(`/v1/admin/wallet/${orgId}/ledger`).then((page) => {
      if (!cancelled) setLedger(page.entries);
    }).catch((e) => {
      if (!cancelled) setError(e instanceof ApiProblem ? e.message : t.body.wallet.billingLoadFailed);
    });
    return () => { cancelled = true; };
  }, [orgId, isCompanyOrg, t]);

  /** Pick an order to work on: the confirm amount starts prefilled with what is still owed. */
  function selectOrder(o: BankTransferOrder) {
    setSelectedOrder(o);
    setConfirmForm({ amount: String(o.amount_minor - o.amount_received_minor), bankReference: "", confirmedAt: "" });
    setRejectReason("");
    setPartialForm({ amount: "", bankReference: "" });
    setRefundForm({ reason: "", amountRefunded: "" });
  }

  /** The selected order's invoice, rebuilt from the bank account the order was raised against. The admin
   *  order read returns the bare order; the bank details come from the accounts saved on this page. */
  const selectedInvoice: ProFormaInvoice | null = selectedOrder ? (() => {
    const account = bankAccounts.find((a) => a.id === selectedOrder.bank_account_id);
    if (!account) return null;
    return {
      reference: selectedOrder.reference,
      plan_code: selectedOrder.plan_code,
      period_months: selectedOrder.period_months,
      amount_minor: selectedOrder.amount_minor,
      currency: selectedOrder.currency,
      expires_at: selectedOrder.expires_at,
      pay_reference_note: PAY_REFERENCE_NOTE,
      bank_account: { account_name: account.account_name, bank_name: account.bank_name, account_number: account.account_number, swift_iban: account.swift_iban, currency: account.currency },
    };
  })() : null;

  /** Download the receipt the payer uploaded, through the authenticated API (no plain link carries the token). */
  async function downloadProof(o: BankTransferOrder) {
    if (!o.proof_filename) return;
    setBusy(`proof-${o.id}`);
    try {
      const blob = await apiBlob(`/v1/admin/billing/orders/${o.id}/proof`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = o.proof_filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : t.body.wallet.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  async function saveBank(currency: "NGN" | "USD") {
    const d = bankDraft[currency];
    if (!d) return;
    const ok = await act(`bank-${currency}`, () => api("/v1/admin/billing/bank-accounts", {
      method: "POST",
      json: { currency, account_name: d.account_name.trim(), bank_name: d.bank_name.trim(), account_number: d.account_number.trim(), swift_iban: d.swift_iban.trim() || null, is_active: d.is_active },
    }), t.body.wallet.blBankSaved);
    if (ok) setBankSaved((cur) => ({ ...cur, [currency]: true }));
  }

  async function runRenewals() {
    setBusy("renewals");
    setNotice(null);
    setError(null);
    try {
      const result = await api<RenewalRunResult>("/v1/admin/billing/renewals/run", { method: "POST" });
      setRenewal(result);
      setNotice(t.body.wallet.blRenewalsDone);
      await load();
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : t.body.wallet.actionFailed);
    } finally {
      setBusy(null);
    }
  }

  async function act(label: string, fn: () => Promise<unknown>, done: string): Promise<boolean> {
    setBusy(label);
    setNotice(null);
    setError(null);
    try {
      await fn();
      setNotice(done);
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : t.body.wallet.actionFailed);
      return false;
    } finally {
      setBusy(null);
    }
  }

  if (!isCompanyOrg) {
    return (
      <div className="w-full max-w-4xl">
        <div className="flex items-center gap-3 rounded-card border border-danger/30 bg-danger/10 p-4 text-danger">
          <ShieldAlert className="h-6 w-6 shrink-0" />
          <div>
            <h2 className="font-normal">{t.body.admin.accessRequired}</h2>
            <p className="t-body opacity-90">
              {t.body.admin.accessOnly}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (loading && wallets.length === 0) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="w-full max-w-5xl space-y-4">
      <header>
        <h1 className="t-page">{t.body.wallet.billingTitle}</h1>
        <p className="t-body mt-1 text-muted">
          {t.body.wallet.billingSubtitle}
        </p>
      </header>

      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}

      {wallets.map((w) => (
        <section key={w.organization_id} aria-label={t.body.wallet.billingWalletSection} className="vie-panel">
          <div className="vie-ph"><h2 className="t-section">{w.organization_name}</h2></div>
          <div className="p-4">
          <p className="t-metric">{w.balance} <span className="t-small">{t.body.wallet.tokensUnit}</span></p>
          <p className="t-small mt-1">{t.body.wallet.billingSpendable.replace("{a}", String(w.spendable_balance))}{w.low_balance ? t.body.wallet.billingLowSuffix : ""}{w.last_activity_at ? t.body.wallet.billingLastMovement.replace("{a}", new Date(w.last_activity_at).toLocaleString()) : ""}</p>
          <button type="button" disabled={busy !== null || !orgId}
            onClick={() => void act("expire", () => api(`/v1/admin/wallet/${orgId}/expire`, { method: "POST" }), t.body.wallet.billingExpiredDone)}
            className="vie-btn vie-btn-sm mt-3">
            {busy === "expire" ? t.body.wallet.billingWritingOff : t.body.wallet.billingWriteOff}
          </button>
          </div>
        </section>
      ))}

      <section aria-label={t.body.wallet.billingPackRequestsAria} className="vie-panel">
        <div className="vie-ph"><h2 className="t-section">{t.body.wallet.packRequests}</h2></div>
        <div className="p-4">
        {requests.length === 0 ? (
          <p className="t-body text-muted">{t.body.wallet.billingNoRequests}</p>
        ) : (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-ctl border border-line bg-canvas p-3">
                <p>{r.organization_name ? `${r.organization_name} · ` : ""}<span>{r.pack_code}</span> · {r.tokens} {t.body.wallet.tokensUnit} · {money(r.amount_minor, r.currency)} · {({ REQUESTED: t.body.wallet.statusRequested, INVOICED: t.body.wallet.statusInvoiced, PAID: t.body.wallet.statusPaid, CANCELLED: t.body.wallet.statusCancelled } as Record<string, string>)[r.status] ?? r.status}{r.invoice_ref ? ` · ${r.invoice_ref}` : ""}</p>
                <p className="text-xs text-muted">{t.body.wallet.billingRequestedAt.replace("{a}", new Date(r.created_at).toLocaleString())}</p>
                {(r.status === "REQUESTED" || r.status === "INVOICED") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input aria-label={t.body.wallet.billingInvoiceAria} value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)}
                      placeholder={t.body.wallet.billingInvoicePlaceholder} className="min-w-64 flex-1 rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                    {r.status === "REQUESTED" && (
                      <button type="button" disabled={busy !== null || !invoiceRef.trim()}
                        onClick={() => void act(`invoice-${r.id}`, () => api(`/v1/admin/wallet/pack-requests/${r.id}/invoice`, { method: "POST", json: { invoice_ref: invoiceRef.trim() } }), t.body.wallet.billingInvoiceIssued)}
                        className="t-button rounded-ctl border border-primary px-3 py-1.5 text-primary disabled:opacity-50">{t.body.wallet.billingIssueInvoice}</button>
                    )}
                    {r.status === "INVOICED" && (
                      <button type="button" disabled={busy !== null || !invoiceRef.trim()}
                        onClick={() => void act(`confirm-${r.id}`, () => api(`/v1/admin/wallet/pack-requests/${r.id}/confirm-receipt`, { method: "POST", json: { invoice_ref: invoiceRef.trim() } }), t.body.wallet.billingTokensAdded.replace("{a}", String(r.tokens)))}
                        className="vie-btn vie-btn-sm vie-btn-pri">{t.body.wallet.billingConfirmTransfer}</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        </div>
      </section>

      {/* revenue: every customer's money for the company organisation (one summary, merge 2026-11-13) */}
      <RevenueSummary />

      <section aria-label={t.body.wallet.blAdminOrders} className="vie-panel">
        <div className="vie-ph"><h2 className="t-section">{t.body.wallet.blAdminOrders}</h2></div>
        <div className="p-4">
          {orders.length === 0 ? (
            <p className="t-body text-muted">{t.body.wallet.blNoOrders}</p>
          ) : (
            <ul className="space-y-2">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line bg-canvas px-3 py-2">
                  <span>{o.organization_name ? `${o.organization_name} · ` : ""}{o.reference} · {o.plan_code} · {planMonths(o.period_months, t.body.wallet)} · {money(o.amount_minor, o.currency)} · <OrderStatusLabel order={o} /></span>
                  <span className="flex items-center gap-3">
                    <span className="t-small text-muted">{new Date(o.created_at).toLocaleDateString()}</span>
                    <button type="button" className="t-button text-primary" onClick={() => selectOrder(o)}>{t.body.wallet.blViewOrder}</button>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {selectedOrder && (
            <div className="mt-4 space-y-4 rounded-ctl border border-line bg-canvas p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="t-panel">{selectedOrder.reference}</h3>
                <button type="button" className="t-button text-muted" onClick={() => setSelectedOrder(null)}>{t.common.close}</button>
              </div>
              <p className="t-body">
                {selectedOrder.organization_name ? `${selectedOrder.organization_name} · ` : ""}{selectedOrder.plan_code} · {planMonths(selectedOrder.period_months, t.body.wallet)} · {money(selectedOrder.amount_minor, selectedOrder.currency)} · <OrderStatusLabel order={selectedOrder} />
              </p>
              <dl className="kv">
                <dt>{t.body.wallet.blAmountReceived}</dt>
                <dd>{money(selectedOrder.amount_received_minor, selectedOrder.currency)}</dd>
                <dt>{t.body.wallet.blRemaining}</dt>
                <dd>{money(selectedOrder.amount_minor - selectedOrder.amount_received_minor, selectedOrder.currency)}</dd>
                <dt>{t.body.wallet.blOrderDate}</dt>
                <dd>{new Date(selectedOrder.created_at).toLocaleString()}</dd>
                <dt>{t.body.wallet.blOrderExpires}</dt>
                <dd>{new Date(selectedOrder.expires_at).toLocaleString()}</dd>
                {selectedOrder.proof_filename && (
                  <>
                    <dt>{t.body.wallet.blProofFile}</dt>
                    <dd>{selectedOrder.proof_filename}{selectedOrder.proof_uploaded_at ? ` · ${new Date(selectedOrder.proof_uploaded_at).toLocaleString()}` : ""}</dd>
                  </>
                )}
                {selectedOrder.proof_note && (
                  <>
                    <dt>{t.body.wallet.blProofNote}</dt>
                    <dd>{selectedOrder.proof_note}</dd>
                  </>
                )}
              </dl>
              {selectedOrder.proof_filename ? (
                <button type="button" className="btn sm" disabled={busy !== null} onClick={() => void downloadProof(selectedOrder)}>
                  {busy === `proof-${selectedOrder.id}` ? t.common.loading : t.body.wallet.blProofDownload}
                </button>
              ) : (
                <p className="sm mu">{t.body.wallet.blNoProof}</p>
              )}
              {selectedInvoice ? (
                <div className="border-t border-line pt-3">
                  <InvoiceCard invoice={selectedInvoice} printActive={false} />
                </div>
              ) : (
                <p className="sm mu">{t.body.wallet.wlBankNotSet}</p>
              )}
              {selectedOrder.status === "CONFIRMED" && (
                <div className="border-t border-line pt-3">
                  <ReceiptCard order={selectedOrder} printActive={printTarget === "receipt"} />
                  <button type="button" className="btn sm mt-3" onClick={() => print("receipt")}>{t.body.wallet.blPrintReceipt}</button>
                </div>
              )}
              {(selectedOrder.status === "AWAITING_CONFIRMATION" || selectedOrder.status === "PARTIAL") && (
                <div className="grid gap-4 border-t border-line pt-3 md:grid-cols-2">
                  <form className="space-y-2" onSubmit={async (e) => {
                    e.preventDefault();
                    await act(`confirm-${selectedOrder.id}`, () => api(`/v1/admin/billing/orders/${selectedOrder.id}/confirm`, {
                      method: "POST",
                      json: { amount_received_minor: Number(confirmForm.amount), bank_reference: confirmForm.bankReference.trim(), confirmed_at: confirmForm.confirmedAt || undefined },
                    }), t.body.wallet.blOrderConfirmed);
                    setSelectedOrder(null);
                  }}>
                    <h4 className="t-panel">{t.body.wallet.blConfirmPay}</h4>
                    <p className="sm mu">{t.body.wallet.blAmountMustMatch}</p>
                    <input aria-label={t.body.wallet.blAmountReceived} type="number" min="1" step="1" required value={confirmForm.amount} onChange={(e) => setConfirmForm({ ...confirmForm, amount: e.target.value })} placeholder={t.body.wallet.blAmountReceived} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                    <input aria-label={t.body.wallet.blBankRef} required value={confirmForm.bankReference} onChange={(e) => setConfirmForm({ ...confirmForm, bankReference: e.target.value })} placeholder={t.body.wallet.blBankRef} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                    <input aria-label={t.body.wallet.blDateArrived} type="date" value={confirmForm.confirmedAt} onChange={(e) => setConfirmForm({ ...confirmForm, confirmedAt: e.target.value })} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                    <button type="submit" disabled={busy !== null} className="vie-btn vie-btn-pri">{t.body.wallet.blConfirmPay}</button>
                  </form>
                  <form className="space-y-2" onSubmit={async (e) => {
                    e.preventDefault();
                    await act(`partial-${selectedOrder.id}`, () => api(`/v1/admin/billing/orders/${selectedOrder.id}/record-partial`, {
                      method: "POST",
                      json: { amount_received_minor: Number(partialForm.amount), bank_reference: partialForm.bankReference.trim() || undefined },
                    }), t.body.wallet.blPartialRecorded);
                    setSelectedOrder(null);
                  }}>
                    <h4 className="t-panel">{t.body.wallet.blRecordPartial}</h4>
                    <input aria-label={t.body.wallet.blAmountReceived} type="number" min="1" step="1" required value={partialForm.amount} onChange={(e) => setPartialForm({ ...partialForm, amount: e.target.value })} placeholder={t.body.wallet.blAmountReceived} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                    <input aria-label={t.body.wallet.blBankRef} value={partialForm.bankReference} onChange={(e) => setPartialForm({ ...partialForm, bankReference: e.target.value })} placeholder={t.body.wallet.blBankRef} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                    <button type="submit" disabled={busy !== null} className="vie-btn">{t.body.wallet.blRecordPartial}</button>
                  </form>
                </div>
              )}
              {(selectedOrder.status === "ORDERED" || selectedOrder.status === "AWAITING_CONFIRMATION" || selectedOrder.status === "PARTIAL") && (
                <form className="space-y-2 border-t border-line pt-3" onSubmit={async (e) => {
                  e.preventDefault();
                  await act(`reject-${selectedOrder.id}`, () => api(`/v1/admin/billing/orders/${selectedOrder.id}/reject`, {
                    method: "POST",
                    json: { reason: rejectReason.trim() },
                  }), t.body.wallet.blOrderRejected);
                  setSelectedOrder(null);
                }}>
                  <h4 className="t-panel">{t.body.wallet.blRejectOrder}</h4>
                  <input aria-label={t.body.wallet.blRejectReason} required value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={t.body.wallet.blRejectReason} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <button type="submit" disabled={busy !== null} className="vie-btn">{t.body.wallet.blRejectOrder}</button>
                </form>
              )}
              {selectedOrder.status === "CONFIRMED" && (
                <form className="space-y-2 border-t border-line pt-3" onSubmit={async (e) => {
                  e.preventDefault();
                  await act(`refund-${selectedOrder.id}`, () => api(`/v1/admin/billing/orders/${selectedOrder.id}/refund`, {
                    method: "POST",
                    json: { reason: refundForm.reason.trim(), amount_refunded_minor: refundForm.amountRefunded ? Number(refundForm.amountRefunded) : undefined },
                  }), t.body.wallet.blRefundDone);
                  setSelectedOrder(null);
                }}>
                  <h4 className="t-panel">{t.body.wallet.blRefund}</h4>
                  <p className="sm mu">{t.body.wallet.blRefundNote}</p>
                  <input aria-label={t.body.wallet.blMoneyRefunded} type="number" min="1" step="1" value={refundForm.amountRefunded} onChange={(e) => setRefundForm({ ...refundForm, amountRefunded: e.target.value })} placeholder={t.body.wallet.blMoneyRefunded} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <input aria-label={t.body.wallet.blRefundReason} required value={refundForm.reason} onChange={(e) => setRefundForm({ ...refundForm, reason: e.target.value })} placeholder={t.body.wallet.blRefundReason} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <button type="submit" disabled={busy !== null} className="vie-btn">{t.body.wallet.blRefund}</button>
                </form>
              )}
              {selectedOrder.status === "ORDERED" && (
                <p className="sm mu border-t border-line pt-3">{t.body.wallet.blOrderPlaced}</p>
              )}
            </div>
          )}
        </div>
      </section>

      <section aria-label={t.body.wallet.blBankAccounts} className="vie-panel">
        <div className="vie-ph"><h2 className="t-section">{t.body.wallet.blBankAccounts}</h2></div>
        <div className="p-4">
          <p className="t-body text-muted">{t.body.wallet.blBankNote}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {(["NGN", "USD"] as const).map((c) => {
              const d = bankDraft[c] ?? { account_name: "", bank_name: "", account_number: "", swift_iban: "", is_active: true };
              const saved = bankAccounts.find((a) => a.currency === c);
              return (
                <form key={c} className="space-y-2 rounded-ctl border border-line bg-canvas p-3" onSubmit={(e) => { e.preventDefault(); void saveBank(c); }} onChange={() => setBankSaved((cur) => ({ ...cur, [c]: false }))}>
                  <h3 className="t-panel">{c}{saved ? ` · ${saved.is_active ? t.body.wallet.blBankActive : t.body.wallet.blBankInactive}` : ""}</h3>
                  <input aria-label={t.body.wallet.blAccountName} required value={d.account_name} onChange={(e) => setBankDraft({ ...bankDraft, [c]: { ...d, account_name: e.target.value } })} placeholder={t.body.wallet.blAccountName} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <input aria-label={t.body.wallet.blBank} required value={d.bank_name} onChange={(e) => setBankDraft({ ...bankDraft, [c]: { ...d, bank_name: e.target.value } })} placeholder={t.body.wallet.blBank} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <input aria-label={t.body.wallet.blAccountNumber} required value={d.account_number} onChange={(e) => setBankDraft({ ...bankDraft, [c]: { ...d, account_number: e.target.value } })} placeholder={t.body.wallet.blAccountNumber} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <input aria-label={t.body.wallet.blSwift} value={d.swift_iban} onChange={(e) => setBankDraft({ ...bankDraft, [c]: { ...d, swift_iban: e.target.value } })} placeholder={t.body.wallet.blSwift} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
                  <label className="flex items-center gap-2 t-small">
                    <input type="checkbox" checked={d.is_active} onChange={(e) => setBankDraft({ ...bankDraft, [c]: { ...d, is_active: e.target.checked } })} />
                    {t.body.wallet.blBankActive}
                  </label>
                  <button type="submit" disabled={busy !== null} className="vie-btn vie-btn-pri w-full">{busy === `bank-${c}` ? t.common.loading : t.body.wallet.blSaveBank}</button>
                  {bankSaved[c] && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{t.body.wallet.blBankSaved}</p>}
                </form>
              );
            })}
          </div>
        </div>
      </section>

      <section aria-label={t.body.wallet.blRenewals} className="vie-panel">
        <div className="vie-ph"><h2 className="t-section">{t.body.wallet.blRenewals}</h2></div>
        <div className="p-4">
          <p className="t-body">
            {subscription
              ? `${subscription.plan_code} · ${subscription.state === "PAST_DUE" ? t.body.wallet.blSubPastDue : t.body.wallet.blPlanActiveUntil.replace("{a}", subscription.period_end ? new Date(subscription.period_end).toLocaleDateString() : "—")}`
              : t.body.wallet.blNoSubscription}
          </p>
          <p className="sm mu mt-2">{t.body.wallet.blRenewalNote}</p>
          <p className="sm mu mt-1">{t.body.wallet.blGraceNote}</p>
          <p className="sm mu mt-1">{t.body.wallet.blRenewalDailyNote}</p>
          <button type="button" className="vie-btn vie-btn-pri mt-3" disabled={busy !== null} onClick={() => void runRenewals()}>
            {busy === "renewals" ? t.common.loading : t.body.wallet.blRunRenewals}
          </button>
          {renewal && (
            <p className="t-body mt-3">
              {t.body.wallet.blRenewalsCreated.replace("{a}", String(renewal.renewals_created))} ·{" "}
              {t.body.wallet.blDroppedFree.replace("{a}", String(renewal.downgraded_to_free))} ·{" "}
              {t.body.wallet.blPastDue.replace("{a}", String(renewal.past_due))}
            </p>
          )}
        </div>
      </section>

      {orgId && (
        <section aria-label={t.body.wallet.billingManualAria} className="vie-panel">
          <div className="vie-ph"><h2 className="t-section">{t.body.wallet.billingManual}</h2></div>
          <div className="p-4">
          <label className="flex flex-wrap items-center gap-2 t-body">
            {t.body.wallet.billingWalletSection}
            <select aria-label={t.body.wallet.billingWalletSection} value={orgId ?? ""} onChange={(e) => setSelectedWalletId(e.target.value || null)}
              className="rounded-ctl border border-line bg-canvas px-2 py-1.5">
              {wallets.map((w) => (
                <option key={w.organization_id} value={w.organization_id}>{w.organization_name}</option>
              ))}
            </select>
          </label>
          <p className="t-body text-muted">{t.body.wallet.billingManualDesc}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <form onSubmit={(e) => { e.preventDefault(); void act("topup", () => api(`/v1/admin/wallet/${orgId}/topup`, { method: "POST", json: { amount: Number(topUp.amount), reason: topUp.reason.trim(), invoice_ref: topUp.invoiceRef.trim() || null } }), t.body.wallet.billingTopUpDone.replace("{a}", topUp.amount)); }}
              className="space-y-2 rounded-ctl border border-line bg-canvas p-3">
              <h3 className="t-panel">{t.body.wallet.billingTopUpTitle}</h3>
              <input aria-label={t.body.wallet.billingTopUpTokens} type="number" min="1" step="1" required value={topUp.amount} onChange={(e) => setTopUp({ ...topUp, amount: e.target.value })} placeholder={t.body.wallet.billingTopUpTokensPh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <input aria-label={t.body.wallet.billingTopUpInvoiceAria} value={topUp.invoiceRef} onChange={(e) => setTopUp({ ...topUp, invoiceRef: e.target.value })} placeholder={t.body.wallet.billingTopUpInvoicePh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <input aria-label={t.body.wallet.billingTopUpReasonAria} required value={topUp.reason} onChange={(e) => setTopUp({ ...topUp, reason: e.target.value })} placeholder={t.body.wallet.billingTopUpReasonPh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <button type="submit" disabled={busy !== null} className="vie-btn vie-btn-pri w-full">{t.body.wallet.billingTopUpBtn}</button>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); void act("refund", () => api(`/v1/admin/wallet/${orgId}/refund`, { method: "POST", json: { amount: Number(refund.amount), reason: refund.reason.trim() } }), t.body.wallet.billingRefundDone.replace("{a}", refund.amount)); }}
              className="space-y-2 rounded-ctl border border-line bg-canvas p-3">
              <h3 className="t-panel">{t.body.wallet.billingRefundTitle}</h3>
              <input aria-label={t.body.wallet.billingRefundTokens} type="number" min="1" step="1" required value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} placeholder={t.body.wallet.billingTopUpTokensPh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <input aria-label={t.body.wallet.billingRefundReasonAria} required value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} placeholder={t.body.wallet.billingTopUpReasonPh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <button type="submit" disabled={busy !== null} className="vie-btn w-full">{t.body.wallet.billingRefundBtn}</button>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); void act("adjust", () => api(`/v1/admin/wallet/${orgId}/adjust`, { method: "POST", json: { amount: Number(adjust.amount), reason: adjust.reason.trim() } }), t.body.wallet.billingAdjustDone); }}
              className="space-y-2 rounded-ctl border border-line bg-canvas p-3">
              <h3 className="t-panel">{t.body.wallet.billingAdjustTitle}</h3>
              <input aria-label={t.body.wallet.billingAdjustTokens} type="number" step="1" required value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} placeholder={t.body.wallet.billingAdjustTokensPh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <input aria-label={t.body.wallet.billingAdjustReasonAria} required value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder={t.body.wallet.billingTopUpReasonPh} className="w-full rounded-ctl border border-line bg-canvas px-2 py-1.5" />
              <button type="submit" disabled={busy !== null} className="vie-btn w-full">{t.body.wallet.billingAdjustBtn}</button>
            </form>
          </div>
          </div>
        </section>
      )}

      <section aria-label={t.body.wallet.billingLedgerAria} className="vie-panel">
        <div className="vie-ph"><h2 className="t-section">{t.body.wallet.ledger}</h2></div>
        <div className="p-4">
        {ledger.length === 0 ? (
          <p className="t-body text-muted">{t.body.wallet.billingLedgerEmpty}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="t-th text-left"><th className="py-1 pr-2">{t.body.wallet.colWhen}</th><th className="py-1 pr-2">{t.body.wallet.colWhat}</th><th className="py-1 pr-2">{t.body.wallet.colTokens}</th><th className="py-1 pr-2">{t.body.wallet.colBalance}</th><th className="py-1">{t.body.wallet.colNote}</th></tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-1.5 pr-2">{({ PURCHASE: t.body.wallet.kindPurchase, FREE_GRANT: t.body.wallet.kindFreeGrant, SPEND: t.body.wallet.kindSpend, REFUND: t.body.wallet.kindRefund, ADJUSTMENT: t.body.wallet.kindAdjustment, EXPIRY: t.body.wallet.kindExpiry } as Record<string, string>)[e.kind] ?? e.kind}</td>
                  <td className={`py-1.5 pr-2 font-normal ${e.amount > 0 ? "text-ok" : "text-danger"}`}>{e.amount > 0 ? `+${e.amount}` : e.amount}</td>
                  <td className="py-1.5 pr-2">{e.balance_after}</td>
                  <td className="py-1.5">{[e.reason, e.invoice_ref ? t.body.wallet.invoice.replace("{a}", e.invoice_ref) : null].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        </div>
      </section>
    </div>
  );
}
