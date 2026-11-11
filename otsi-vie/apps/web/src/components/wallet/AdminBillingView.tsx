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

const money = (minor: number, currency: string) =>
  currency === "NGN" ? `₦${(minor / 100).toLocaleString("en-NG")}` : `$${(minor / 100).toFixed(2)}`;

export function AdminBillingView() {
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
      setError(e instanceof ApiProblem ? e.message : "Billing could not be loaded.");
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
      setError(e instanceof ApiProblem ? e.message : "That did not work. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (loading && wallets.length === 0) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-muted">
          Token wallets, pack requests and the ledger. Money arrives by bank transfer only — confirm receipt here and
          the tokens arrive with the invoice reference. Every top-up, refund and adjustment needs a reason.
        </p>
      </header>

      {error && <p role="alert" className="rounded-ctl border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p>}

      {wallets.map((w) => (
        <section key={w.organization_id} aria-label="Wallet" className="rounded-ctl border border-line bg-raised p-5">
          <h2 className="font-semibold">{w.organization_name}</h2>
          <p className="mt-1 text-3xl font-semibold">{w.balance} <span className="text-lg font-normal text-muted">tokens</span></p>
          <p className="text-sm text-muted">{w.spendable_balance} can be spent now{w.low_balance ? " · low balance (below 90)" : ""}{w.last_activity_at ? ` · last movement ${new Date(w.last_activity_at).toLocaleString()}` : ""}</p>
          <button type="button" disabled={busy !== null || !orgId}
            onClick={() => void act("expire", () => api(`/v1/admin/wallet/${orgId}/expire`, { method: "POST" }), "Expired tokens written off (if any).")}
            className="mt-3 rounded-ctl border border-line px-3 py-1.5 text-sm disabled:opacity-50">
            {busy === "expire" ? "Writing off…" : "Write off expired tokens"}
          </button>
        </section>
      ))}

      <section aria-label="Pack requests" className="rounded-ctl border border-line bg-raised p-5">
        <h2 className="font-semibold">Pack requests</h2>
        {requests.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No pack requests yet. An organization requests a pack from its Wallet page.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="rounded-ctl border border-line p-3 text-sm">
                <p><strong>{r.pack_code}</strong> · {r.tokens} tokens · {money(r.amount_minor, r.currency)} · {r.status}{r.invoice_ref ? ` · ${r.invoice_ref}` : ""}</p>
                <p className="text-xs text-muted">Requested {new Date(r.created_at).toLocaleString()}</p>
                {(r.status === "REQUESTED" || r.status === "INVOICED") && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input aria-label="Invoice reference" value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)}
                      placeholder="Invoice reference, e.g. INV-2026-001" className="min-w-64 flex-1 rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
                    {r.status === "REQUESTED" && (
                      <button type="button" disabled={busy !== null || !invoiceRef.trim()}
                        onClick={() => void act(`invoice-${r.id}`, () => api(`/v1/admin/wallet/pack-requests/${r.id}/invoice`, { method: "POST", json: { invoice_ref: invoiceRef.trim() } }), "Invoice issued.")}
                        className="rounded-ctl border border-primary px-3 py-1.5 text-sm font-medium text-primary disabled:opacity-50">Issue invoice</button>
                    )}
                    {r.status === "INVOICED" && (
                      <button type="button" disabled={busy !== null || !invoiceRef.trim()}
                        onClick={() => void act(`confirm-${r.id}`, () => api(`/v1/admin/wallet/pack-requests/${r.id}/confirm-receipt`, { method: "POST", json: { invoice_ref: invoiceRef.trim() } }), `${r.tokens} tokens added to the wallet.`)}
                        className="rounded-ctl bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Confirm bank transfer received</button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {orgId && (
        <section aria-label="Manual actions" className="rounded-ctl border border-line bg-raised p-5">
          <h2 className="font-semibold">Top up, refund, adjust</h2>
          <p className="mt-1 text-sm text-muted">Each writes a ledger row with its reason. A money refund that claws tokens back is a negative adjustment with the refund stated in the reason.</p>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <form onSubmit={(e) => { e.preventDefault(); void act("topup", () => api(`/v1/admin/wallet/${orgId}/topup`, { method: "POST", json: { amount: Number(topUp.amount), reason: topUp.reason.trim(), invoice_ref: topUp.invoiceRef.trim() || null } }), `${topUp.amount} tokens added.`); }}
              className="space-y-2 rounded-ctl border border-line p-3">
              <h3 className="text-sm font-semibold">Top up (bank transfer)</h3>
              <input aria-label="Top-up tokens" type="number" min="1" step="1" required value={topUp.amount} onChange={(e) => setTopUp({ ...topUp, amount: e.target.value })} placeholder="Tokens" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <input aria-label="Top-up invoice reference" value={topUp.invoiceRef} onChange={(e) => setTopUp({ ...topUp, invoiceRef: e.target.value })} placeholder="Invoice reference" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <input aria-label="Top-up reason" required value={topUp.reason} onChange={(e) => setTopUp({ ...topUp, reason: e.target.value })} placeholder="Reason (required)" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <button type="submit" disabled={busy !== null} className="w-full rounded-ctl bg-primary px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">Top up</button>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); void act("refund", () => api(`/v1/admin/wallet/${orgId}/refund`, { method: "POST", json: { amount: Number(refund.amount), reason: refund.reason.trim() } }), `${refund.amount} tokens refunded to the wallet.`); }}
              className="space-y-2 rounded-ctl border border-line p-3">
              <h3 className="text-sm font-semibold">Refund to wallet</h3>
              <input aria-label="Refund tokens" type="number" min="1" step="1" required value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} placeholder="Tokens" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <input aria-label="Refund reason" required value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} placeholder="Reason (required)" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <button type="submit" disabled={busy !== null} className="w-full rounded-ctl border border-line px-3 py-1.5 text-sm font-medium disabled:opacity-50">Refund</button>
            </form>
            <form onSubmit={(e) => { e.preventDefault(); void act("adjust", () => api(`/v1/admin/wallet/${orgId}/adjust`, { method: "POST", json: { amount: Number(adjust.amount), reason: adjust.reason.trim() } }), "Adjustment recorded."); }}
              className="space-y-2 rounded-ctl border border-line p-3">
              <h3 className="text-sm font-semibold">Adjust</h3>
              <input aria-label="Adjustment tokens (negative to remove)" type="number" step="1" required value={adjust.amount} onChange={(e) => setAdjust({ ...adjust, amount: e.target.value })} placeholder="Tokens (+ or −)" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <input aria-label="Adjustment reason" required value={adjust.reason} onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} placeholder="Reason (required)" className="w-full rounded-ctl border border-line bg-background px-2 py-1.5 text-sm" />
              <button type="submit" disabled={busy !== null} className="w-full rounded-ctl border border-line px-3 py-1.5 text-sm font-medium disabled:opacity-50">Adjust</button>
            </form>
          </div>
        </section>
      )}

      <section aria-label="Ledger" className="rounded-ctl border border-line bg-raised p-5">
        <h2 className="font-semibold">Ledger — every token movement</h2>
        {ledger.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No token movements yet.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted"><th className="py-1 pr-2">When</th><th className="py-1 pr-2">What</th><th className="py-1 pr-2">Tokens</th><th className="py-1 pr-2">Balance after</th><th className="py-1">Note</th></tr>
            </thead>
            <tbody>
              {ledger.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-1.5 pr-2">{e.kind}</td>
                  <td className={`py-1.5 pr-2 font-medium ${e.amount > 0 ? "text-emerald-600" : "text-red-600"}`}>{e.amount > 0 ? `+${e.amount}` : e.amount}</td>
                  <td className="py-1.5 pr-2">{e.balance_after}</td>
                  <td className="py-1.5">{[e.reason, e.invoice_ref ? `Invoice ${e.invoice_ref}` : null].filter(Boolean).join(" · ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
