import type { Metadata } from "next";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";
import { AdminBillingView } from "@/components/wallet/AdminBillingView";

export const metadata: Metadata = { title: "Billing" };

/**
 * Account / Governance > Billing (ADR-140): the wallet and ledger, pack requests awaiting an invoice or a
 * confirmed bank transfer, and manual top-up / refund / adjustment, each with a reason. Owners and Admins.
 */
export default function BillingPage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-admin-billing" data-page="settings-admin-billing">
      <SettingsSideNav current="billing" />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]">
        <AdminBillingView />
      </main>
    </div>
  );
}
