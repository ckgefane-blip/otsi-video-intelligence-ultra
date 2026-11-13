"use client";
/**
 * The cost preview (billing blueprint §4.2(2)): before ANY charged action starts, the user sees
 * the exact cost and confirms it. Format: `Analyse <match> (<minutes> min) — <cost> tokens.
 * Balance <before>. After: <after>.` with [Cancel] and [Continue]. If the balance is too low the
 * action MUST NOT start: the dialog states how many more tokens are needed, offers to buy a pack,
 * and the Continue button is disabled. The server still enforces the balance (402
 * INSUFFICIENT_TOKENS); this preview is the user seeing the cost before it happens, not the check.
 *
 * Every charged action uses this one dialog (analysis, reel render, player report, export pack,
 * AI Analyst assessment, Scouting Pack), so the wording and the rule are the same everywhere.
 * The reel render confirmation embeds the same summary line instead of opening a second dialog.
 */
import * as Dialog from "@radix-ui/react-dialog";
import { useLocale } from "@/lib/i18n";
import { useWalletBalance } from "@/lib/wallet";
import Link from "next/link";

export type Affordability =
  | { state: "loading"; balance: null; shortfall: 0 }
  | { state: "unknown"; balance: null; shortfall: 0 }
  | { state: "ok"; balance: number; shortfall: 0 }
  | { state: "short"; balance: number; shortfall: number };

/** can this wallet afford `cost` tokens, right now? `spendable_balance` is what can actually be
 *  spent (the same number the status bar shows), not the raw balance. */
export function useWalletAffordability(cost: number): Affordability {
  const w = useWalletBalance();
  if (w === undefined) return { state: "loading", balance: null, shortfall: 0 };
  if (w === null) return { state: "unknown", balance: null, shortfall: 0 };
  const b = w.spendable_balance;
  return b >= cost ? { state: "ok", balance: b, shortfall: 0 } : { state: "short", balance: b, shortfall: cost - b };
}

/** the blueprint's cost line, with the shortfall and the buy-tokens link when the balance is too low. */
export function CostSummary({ action, cost }: { action: string; cost: number }) {
  const { t } = useLocale();
  const w = t.body.wallet;
  const a = useWalletAffordability(cost);
  if (a.state === "loading") return <p data-cost="checking" className="text-xs text-muted">{w.cpChecking}</p>;
  if (a.state === "unknown") {
    return (
      <div className="space-y-1 text-xs">
        <p data-cost="line">{w.cpLine.replace("{a}", action).replace("{b}", String(cost)).replace("{c}", "—").replace("{d}", "—")}</p>
        <p className="text-muted">{w.cpBalanceUnknown}</p>
      </div>
    );
  }
  const after = a.state === "short" ? "—" : String(a.balance - cost);
  return (
    <div className="space-y-1 text-xs">
      <p data-cost="line">{w.cpLine.replace("{a}", action).replace("{b}", String(cost)).replace("{c}", String(a.balance)).replace("{d}", after)}</p>
      {a.state === "short" && (
        <p data-cost="short" className="text-amber">
          {w.cpShort.replace("{a}", String(a.shortfall))}{" "}
          <Link href="/settings/wallet#tp" className="text-primary hover:underline">{w.cpBuyTokens}</Link>
        </p>
      )}
    </div>
  );
}

export function CostPreviewDialog({ action, cost, open, onOpenChange, onConfirm }: {
  action: string;
  cost: number;
  open: boolean;
  onOpenChange(o: boolean): void;
  onConfirm(): void;
}) {
  const { t } = useLocale();
  const w = t.body.wallet;
  const a = useWalletAffordability(cost);
  const canContinue = a.state === "ok" || a.state === "unknown";
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/70" />
        <Dialog.Content data-dialog="cost-preview" className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[min(480px,96vw)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-panel p-4 t-body shadow-xl">
          <Dialog.Title className="t-section">{w.cpConfirmTitle}</Dialog.Title>
          <div className="my-3">
            <CostSummary action={action} cost={cost} />
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded-ctl border border-line px-3 py-1.5">{t.common.cancel}</button>
            <button type="button" data-confirm-cost disabled={!canContinue} onClick={() => { onOpenChange(false); onConfirm(); }} className="rounded-ctl bg-primary px-3 py-1.5 font-normal text-white disabled:opacity-50">{t.common.continue}</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
