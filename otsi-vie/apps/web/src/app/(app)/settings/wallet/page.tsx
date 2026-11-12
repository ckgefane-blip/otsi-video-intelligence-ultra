import type { Metadata } from "next";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";
import { WalletView } from "@/components/wallet/WalletView";

export const metadata: Metadata = { title: "Token Wallet" };

/**
 * Settings > Token Wallet (SOT, Wallet.dc.html; ADR-140): the organization's balance, free grant, plan, pack
 * catalogue, pack requests and ledger. Bank transfer only; no payment gateway. The Settings side nav is shared
 * by the Settings and Admin Console pages.
 */
export default function WalletPage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-wallet" data-page="settings-wallet">
      <SettingsSideNav current="wallet" />
      <WalletView />
    </div>
  );
}
