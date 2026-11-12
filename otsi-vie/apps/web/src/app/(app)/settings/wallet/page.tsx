import type { Metadata } from "next";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { WalletView } from "@/components/wallet/WalletView";

export const metadata: Metadata = { title: "Token Wallet" };

/**
 * Account > Token Wallet (ADR-140): the organization's balance, ledger, pack catalogue and pack requests.
 * Bank transfer only; no payment gateway.
 */
export default function WalletPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="settings-wallet">
      <SettingsNav current="wallet" />
      <WalletView />
    </div>
  );
}
