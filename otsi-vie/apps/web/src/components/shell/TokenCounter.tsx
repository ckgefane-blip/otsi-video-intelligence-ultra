"use client";
/**
 * The live token counter in the top bar (owner 2026-11-12: "a token counter in real time, like Claude Code: the user sees and can check
 * tokens in real time"). It shows the spendable balance from GET /v1/wallet (lib/wallet: every 15 s, every 5 s while jobs run, on focus,
 * and right after anything spends or adds tokens). When the number moves it flashes the change (−3 / +10) for 4 s. Clicking it opens the
 * breakdown: spendable and the plan tier, total balance, expired-but-not-written-off, the low-balance flag, when it was last read, and the
 * last five ledger movements (GET /v1/wallet/ledger?limit=5), each with its kind, job, amount and balance after. Every value is the server's;
 * "…" while reading and "—" when it could not be read — never a guessed number. The counter is the SOT's .tok (database icon, bold
 * tabular number); its border is teal while the popover is open and amber on low balance.
 */
import type { WalletLedgerEntry, WalletLedgerPage } from "@otsi-vie/contracts";
import { Database } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { fill } from "@/lib/fill";
import { useLocale } from "@/lib/i18n";
import { useTierLimit } from "@/lib/uploadTier";
import { useWalletBalance, walletReadAt } from "@/lib/wallet";

export function TokenCounter() {
  const { t } = useLocale();
  const d = t.desktop;
  const w = useWalletBalance();
  const tier = useTierLimit();
  const [open, setOpen] = useState(false);
  const [delta, setDelta] = useState<number | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[] | null | undefined>(undefined);
  const [, tick] = useState(0);
  const prev = useRef<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // flash the change when the balance moves
  useEffect(() => {
    if (!w) return;
    const p = prev.current;
    prev.current = w.spendable_balance;
    if (p === null || p === w.spendable_balance) return;
    setDelta(w.spendable_balance - p);
    const id = setTimeout(() => setDelta(null), 4000);
    return () => clearTimeout(id);
  }, [w]);
  // while open: the last movements, re-read whenever the balance is read again, and a ticking "updated … ago"
  useEffect(() => {
    if (!open) return;
    let live = true;
    void api<WalletLedgerPage>("/v1/wallet/ledger?limit=5").then((x) => live && setLedger(x.entries), () => live && setLedger(null));
    return () => { live = false; };
  }, [open, w]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { clearInterval(id); document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const value = w === undefined ? "…" : w === null ? "—" : w.spendable_balance.toLocaleString("en-GB");
  const secs = walletReadAt() === null ? null : Math.max(0, Math.round((Date.now() - walletReadAt()!) / 1000));
  const tierName = tier?.tier === "Free" ? d.tokTierFree : tier?.tier === "Pro" ? d.tokTierPro : tier?.tier === "Enterprise" ? d.tokTierEnterprise : null;
  const kind = (k: WalletLedgerEntry["kind"]) => ({ PURCHASE: t.body.wallet.kindPurchase, FREE_GRANT: t.body.wallet.kindFreeGrant, SPEND: t.body.wallet.kindSpend, REFUND: t.body.wallet.kindRefund, ADJUSTMENT: t.body.wallet.kindAdjustment, EXPIRY: t.body.wallet.kindExpiry })[k];
  const job = (j: string | null) => j === "ANALYSIS" ? t.body.wallet.wlAnalysis : j === "REEL_RENDER" ? d.tokJobReel : j === "PLAYER_REPORT" ? d.tokJobReport : j === "EXPORT_PACK" ? d.tokJobExport : j === "AI_ANALYSIS" ? d.tokJobAi : j;
  const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const row = "flex h-7 items-center justify-between gap-3";
  return (
    <div ref={box} className="relative shrink-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        data-token-counter={w ? String(w.spendable_balance) : w === null ? "error" : "loading"} aria-label={`${d.tokens}: ${value}`}
        className={`tok${w?.low_balance ? " low" : ""}`}>
        <Database className="i" aria-hidden />
        <b>{value}</b>
        <span>{d.tokens}</span>
        {delta !== null && <span className={`t-mono text-[12px] ${delta < 0 ? "text-amber" : "text-ok"}`} data-token-delta>{delta > 0 ? `+${delta}` : `−${-delta}`}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={d.tokens} className="absolute right-0 top-full z-50 mt-1 w-[300px] rounded-md border border-line2 bg-panel p-3 shadow-2xl" data-token-panel>
          <div className="flex items-baseline justify-between">
            <span className="t-metric">{value}</span>
            <span className="t-small text-muted">{secs === null ? "—" : fill(d.tokUpdatedAgo, { a: String(secs) })}</span>
          </div>
          <p className="t-small text-muted">{tierName ? fill(d.tokSpendableTier, { a: tierName }) : d.tokSpendableNow}</p>
          <dl className="mt-2 border-t border-line pt-1">
            <div className={row}><dt className="t-label">{d.tokTotalBalance}</dt><dd className="t-mono">{w ? w.balance : "—"}</dd></div>
            <div className={row}><dt className="t-label">{d.tokExpiredUnwritten}</dt><dd className="t-mono">{w ? w.expired_unwritten_off : "—"}</dd></div>
            {w?.low_balance && <p className="t-small text-amber">{d.tokLowBalance}</p>}
          </dl>
          <p className="t-label mt-2">{d.tokLastMovements}</p>
          <ul className="mt-1">
            {ledger === undefined && <li className="t-small text-muted">{t.common.loading}</li>}
            {ledger === null && <li className="t-small text-muted">{d.tokLedgerFailed}</li>}
            {ledger?.length === 0 && <li className="t-small text-muted">{d.tokNoMovements}</li>}
            {ledger?.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-2 border-b border-line py-1 last:border-0">
                <span className="min-w-0">
                  <span className="t-body block truncate">{kind(e.kind)}{e.job_type ? ` · ${job(e.job_type)}` : ""}</span>
                  <span className="t-small block text-muted">{when(e.created_at)} · balance {e.balance_after}</span>
                </span>
                <span className={`t-mono ${e.amount < 0 ? "text-amber" : "text-ok"}`}>{e.amount > 0 ? `+${e.amount}` : `−${-e.amount}`}</span>
              </li>
            ))}
          </ul>
          <Link href="/settings/wallet" onClick={() => setOpen(false)} className="vie-btn vie-btn-sm mt-2 w-full">{d.tokOpenWallet}</Link>
        </div>
      )}
    </div>
  );
}
