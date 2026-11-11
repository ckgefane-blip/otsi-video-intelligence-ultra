import type { Metadata } from "next";
import { AdminBillingView } from "@/components/wallet/AdminBillingView";

export const metadata: Metadata = { title: "Billing" };

/**
 * Account / Governance > Billing (ADR-140): the wallet and ledger, pack requests awaiting an invoice or a
 * confirmed bank transfer, and manual top-up / refund / adjustment, each with a reason. Owners and Admins.
 */
export default function BillingPage() {
  return <AdminBillingView />;
}
