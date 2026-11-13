import type { Metadata } from "next";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";
import { PlanOrdersView } from "@/components/wallet/PlanOrdersView";

export const metadata: Metadata = { title: "Plans & billing" };

/**
 * Settings > Plans & billing (ADR-144, ultra-only; docs/bank-transfer-web-ui.md §1): the plan catalogue
 * (the source of truth — never hard-coded), the user's plan orders and the live subscription. Orders are
 * placed by bank transfer; the invoice for an order lives on the order's own page. The Settings side nav
 * is shared by the Settings and Admin Console pages.
 */
export default function BillingPage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-billing" data-page="settings-billing">
      <SettingsSideNav current="plans" />
      <PlanOrdersView />
    </div>
  );
}
