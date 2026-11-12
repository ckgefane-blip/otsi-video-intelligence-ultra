"use client";
/**
 * Admin Billing (ADR-140, ultra-only). The organization's wallet and ledger, pack requests awaiting an invoice or
 * a confirmed bank transfer, and the manual actions: top-up against an invoice, refund to the wallet, and
 * adjustment — every one with a reason recorded in the ledger. There is no payment gateway here: money arrives by
 * bank transfer and the owner confirms receipt, which is what writes the PURCHASE row.
 *
 * Scoping (ADR-140 §8): this codebase has no platform-wide owner role, so Admin acts only on the caller's own
 * organization — the API refuses any other organization with 403.
 */
import type { AdminWalletRow, PackRequest, WalletLedgerEntry, WalletLedgerPage } from "@otsi-vie/contracts";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

const money = (minor: number, currency: string) =>
  currency === "NGN" ? `₦${(minor / 100).toLocaleString("en-NG")}` : `$${(minor / 100).toFixed(2)}`;

export function AdminBillingView() {
  const { t } = useLocale();
  const [wallets, setWallets] = useState<AdminWalletRow[]>([]);
  const [requests, setRequests] = useState<PackRequest[]>([]);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [invoiceRef, setInvoiceRef] = useState("");
  const [topUp, setTopUp] = useState({ amount: "", reason: "", invoiceRef: "" });
  const [refund, setRefund] = useState({ amount: "", reason: "" });
  const [adjust, setAdjust] = useState({ amount: "", reason: "" });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, reqs] = await Promise.all([
        api<AdminWalletRow[]>("/v1/admin/wallet"),
        api<PackRequest[]>("/v1/admin/wallet/pack-requests"),
      ]);
      setWallets(w);
      setRequests(reqs);
      if (w[0]) {
        const page = await api<WalletLedgerPage>(`/v1/admin/wallet/${w[0].organization_id}/ledger`);
        setLedger(page.entries);
      }
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : t.body.wallet.billingLoadFailed);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const orgId = wallets[0]?.organization_id ?? null;

  async function act(label: string, fn: () => Promise<unknown>, done: string) {
    setBusy(label);
    setNotice(null);
    setError(null);
    try {
      await fn();
      setNotice(done);
      await load();
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : t.body.wallet.actionFailed);
    } finally {
      setBusy(null);
    }
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
                <p><strong>{r.pack_code}</strong> · {r.tokens} {t.body.wallet.tokensUnit} · {money(r.amount_minor, r.currency)} · {({ REQUESTED: t.body.wallet.statusRequested, INVOICED: t.body.wallet.statusInvoiced, PAID: t.body.wallet.statusPaid, CANCELLED: t.body.wallet.statusCancelled } as Record<string, string>)[r.status] ?? r.status}{r.invoice_ref ? ` · ${r.invoice_ref}` : ""}</p>
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

      {orgId && (
        <section aria-label={t.body.wallet.billingManualAria} className="vie-panel">
          <div className="vie-ph"><h2 className="t-section">{t.body.wallet.billingManual}</h2></div>
          <div className="p-4">
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
