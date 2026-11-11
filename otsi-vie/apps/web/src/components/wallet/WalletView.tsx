"use client";
/**
 * Token Wallet (ADR-140, ultra-only). The organization's token balance, ledger, pack catalogue and pack requests.
 * 1 token = 1 minute of footage analysed; reel render, player report and export pack cost 10 tokens each.
 * The balance is derived from the ledger — this page shows what the API derives, never a typed-in number.
 * Bank transfer only: a pack is requested here, the owner issues an invoice, the organization pays by bank
 * transfer, and the owner confirms receipt before any tokens arrive. No card, no payment gateway.
 */
import type { PackRequest, TokenPackCatalogue, WalletBalance, WalletLedgerEntry } from "@otsi-vie/contracts";
import { AlertTriangle, Coins, Loader2, Wallet } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, api } from "@/lib/api";

const money = (minor: number, currency: "NGN" | "USD") =>
  currency === "NGN" ? `₦${(minor / 100).toLocaleString("en-NG")}` : `$${(minor / 100).toFixed(2)}`;

const kindLabel: Record<WalletLedgerEntry["kind"], string> = {
  PURCHASE: "Purchase",
  FREE_GRANT: "Free grant",
  SPEND: "Spent",
  REFUND: "Refund",
  ADJUSTMENT: "Adjustment",
  EXPIRY: "Expired",
};

export function WalletView() {
  const [balance, setBalance] = useState<WalletBalance | null>(null);
  const [entries, setEntries] = useState<WalletLedgerEntry[]>([]);
  const [catalogue, setCatalogue] = useState<TokenPackCatalogue | null>(null);
  const [requests, setRequests] = useState<PackRequest[]>([]);
  const [currency, setCurrency] = useState<"NGN" | "USD">("NGN");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, ledger, cat, reqs] = await Promise.all([
        api<WalletBalance>("/v1/wallet"),
        api<{ balance: WalletBalance; entries: WalletLedgerEntry[] }>("/v1/wallet/ledger?limit=100"),
        api<TokenPackCatalogue>("/v1/wallet/packs"),
        api<PackRequest[]>("/v1/wallet/packs/requests"),
      ]);
      setBalance(b);
      setEntries(ledger.entries);
      setCatalogue(cat);
      setRequests(reqs);
    } catch (e) {
      setError(e instanceof ApiProblem ? e.message : "The wallet could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const claimedFreeGrant = entries.some((e) => e.kind === "FREE_GRANT");

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

  if (loading && !balance) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <header>
        <h1 className="flex items-center gap-2 text-2xl font-semibold"><Wallet className="h-6 w-6" /> Token Wallet</h1>
        <p className="mt-1 text-sm text-muted">
          1 token = 1 minute of footage analysed. A reel render, a player report and an export pack cost 10 tokens each.
          Tokens are charged when a job starts, and returned automatically when a job fails before producing output.
        </p>
      </header>

      {error && <p role="alert" className="rounded-ctl border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-emerald-400/50 bg-emerald-500/10 px-3 py-2 text-sm">{notice}</p>}

      {balance && (
        <section aria-label="Balance" className="rounded-ctl border border-line bg-raised p-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Balance</p>
              <p className="mt-1 flex items-center gap-2 text-4xl font-semibold"><Coins className="h-7 w-7 text-primary" /> {balance.balance} <span className="text-lg font-normal text-muted">tokens</span></p>
              <p className="mt-1 text-sm text-muted">
                {balance.spendable_balance} tokens can be spent now
                {balance.expired_unwritten_off > 0 && ` · ${balance.expired_unwritten_off} expired tokens waiting to be written off`}
              </p>
            </div>
            <div className="text-sm text-muted">
              <p>Analysis: 1 token per minute</p>
              <p>Reel render · Player report · Export pack: 10 tokens each</p>
            </div>
          </div>
          {balance.low_balance && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-ctl border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Low balance — below 90 tokens, the cost of one full match. Buy tokens below so the next analysis, render, report or export is not refused.</span>
            </p>
          )}
        </section>
      )}

      {catalogue && !claimedFreeGrant && (
        <section aria-label="Free tier" className="rounded-ctl border border-line bg-raised p-5">
          <h2 className="font-semibold">Try it first — 25 free tokens</h2>
          <p className="mt-1 text-sm text-muted">
            25 tokens, once per organization: enough to analyse the first 25 minutes of a match on your own footage.
            They expire 30 days after signup. A full match (90 tokens) or a full-match reel needs a pack.
          </p>
          <button type="button" disabled={busy !== null} onClick={() => void act("grant", () => api("/v1/wallet/free-grant", { method: "POST" }), "25 free tokens added to the wallet.")}
            className="mt-3 rounded-ctl bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy === "grant" ? "Claiming…" : "Claim 25 free tokens"}
          </button>
        </section>
      )}

      {catalogue && (
        <section aria-label="Token packs" className="rounded-ctl border border-line bg-raised p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Buy tokens — bank transfer</h2>
            <div role="group" aria-label="Currency" className="flex gap-1">
              {(["NGN", "USD"] as const).map((c) => (
                <button key={c} type="button" onClick={() => setCurrency(c)} aria-pressed={currency === c}
                  className={`rounded-ctl border px-3 py-1 text-sm ${currency === c ? "border-primary bg-primary/10 text-primary" : "border-line"}`}>
                  {c === "NGN" ? "Naira (₦)" : "US dollars ($)"}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-1 text-sm text-muted">
            Request a pack and the owner issues an invoice. Pay by bank transfer, the owner confirms receipt in Admin,
            and the tokens arrive with the invoice reference on the ledger. Naira prices are the real prices; dollar
            prices are the international tier. Tokens expire 12 months after purchase.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {catalogue.packs.map((pack) => (
              <article key={pack.code} className="rounded-ctl border border-line p-4">
                <h3 className="font-semibold">{pack.label}</h3>
                <p className="mt-1 text-2xl font-semibold">{pack.tokens} <span className="text-sm font-normal text-muted">tokens</span></p>
                <p className="text-lg">{money(currency === "NGN" ? pack.price_ngn_minor : pack.price_usd_minor, currency)}</p>
                <p className="mt-1 text-xs text-muted">{pack.covers}</p>
                <button type="button" disabled={busy !== null}
                  onClick={() => void act(`request-${pack.code}`, () => api("/v1/wallet/packs/request", { method: "POST", json: { pack_code: pack.code, currency } }),
                    `Requested the ${pack.label} pack (${money(currency === "NGN" ? pack.price_ngn_minor : pack.price_usd_minor, currency)}). The owner will issue an invoice.`)}
                  className="mt-3 w-full rounded-ctl border border-primary px-3 py-1.5 text-sm font-medium text-primary disabled:opacity-50">
                  {busy === `request-${pack.code}` ? "Requesting…" : "Request this pack"}
                </button>
              </article>
            ))}
          </div>
          {requests.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">Pack requests</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-ctl border border-line px-3 py-2">
                    <span>{r.pack_code} · {r.tokens} tokens · {money(r.amount_minor, r.currency)} · {r.status}{r.invoice_ref ? ` · ${r.invoice_ref}` : ""}</span>
                    {(r.status === "REQUESTED" || r.status === "INVOICED") && (
                      <button type="button" disabled={busy !== null}
                        onClick={() => void act(`cancel-${r.id}`, () => api(`/v1/wallet/packs/requests/${r.id}/cancel`, { method: "POST" }), "Pack request cancelled.")}
                        className="rounded-ctl border border-line px-2 py-1 text-xs disabled:opacity-50">Cancel</button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section aria-label="Ledger" className="rounded-ctl border border-line bg-raised p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Ledger — every token movement</h2>
          <Link href="/settings/admin/billing" className="text-sm text-primary hover:underline">Billing (owners and admins)</Link>
        </div>
        {entries.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No token movements yet. Claim the free tokens or request a pack above.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-muted"><th className="py-1 pr-2">When</th><th className="py-1 pr-2">What</th><th className="py-1 pr-2">Tokens</th><th className="py-1 pr-2">Balance after</th><th className="py-1">Note</th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-t border-line">
                  <td className="py-1.5 pr-2 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                  <td className="py-1.5 pr-2">{kindLabel[e.kind]}</td>
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
