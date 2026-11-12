import type { Metadata } from "next";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { AdminBillingView } from "@/components/wallet/AdminBillingView";

export const metadata: Metadata = { title: "Billing" };

/**
 * Account / Governance > Billing (ADR-140): the wallet and ledger, pack requests awaiting an invoice or a
 * confirmed bank transfer, and manual top-up / refund / adjustment, each with a reason. Owners and Admins.
 */
export default function BillingPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="settings-admin-billing">
      <SettingsNav current="billing" />
      <AdminBillingView />
    </div>
  );
}
