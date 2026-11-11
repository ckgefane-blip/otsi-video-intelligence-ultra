import type { Metadata } from "next";
import { WalletView } from "@/components/wallet/WalletView";

export const metadata: Metadata = { title: "Token Wallet" };

/**
 * Account > Token Wallet (ADR-140): the organization's balance, ledger, pack catalogue and pack requests.
 * Bank transfer only; no payment gateway.
 */
export default function WalletPage() {
  return <WalletView />;
}
