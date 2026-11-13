"use client";
/**
 * The live token counter in the top bar (SOT rebuild 2026-11-13): the SOT's `.tok` — a plain link to the Wallet, database icon,
 * bold number, "tokens". No popover, no delta flash, no ledger: the breakdown lives on the Wallet page itself. The number is the
 * spendable balance from GET /v1/wallet (lib/wallet: every 15 s, every 5 s while jobs run, on focus, and right after anything
 * spends or adds tokens), in plain digits; "…" while reading and "—" when it could not be read — never a guessed number.
 */
import { Database } from "lucide-react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n";
import { useWalletBalance } from "@/lib/wallet";

export function TokenCounter() {
  const { t } = useLocale();
  const d = t.desktop;
  const w = useWalletBalance();

  const value = w === undefined ? "…" : w === null ? "—" : String(w.spendable_balance);
  return (
    <Link href="/settings/wallet" data-token-counter={w ? String(w.spendable_balance) : w === null ? "error" : "loading"}
      aria-label={`${d.tokens}: ${value}`} className={`tok${w?.low_balance ? " low" : ""}`}>
      <Database className="i" aria-hidden />
      <b>{value}</b>
      {/* SOT (Token Counter): the chip reads "10 tokens" lowercase — the shared `tokens` key stays capital for the
          status bar ("Tokens 10"), so this chip uses the wallet's lowercase count unit instead (reconciliation 2026-11-13) */}
      <span>{t.body.wallet.tokensUnit}</span>
    </Link>
  );
}
