import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";
import { OrderDetailView } from "@/components/wallet/OrderDetailView";

export const metadata: Metadata = { title: "Order" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Settings > Plans & billing > one order (ADR-144, ultra-only; docs/bank-transfer-web-ui.md §1–2): the
 * pro-forma invoice with the owner's bank details, the proof section ("I have paid" + optional receipt
 * upload) and the final receipt once the order is confirmed. Both the invoice and the receipt are print
 * views only — the browser's print / save-as-PDF does the printing; no PDF library, no PDF generation.
 */
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return (
    <div className="flex h-full w-full" data-stage="settings-billing-order" data-page="settings-billing-order">
      <SettingsSideNav current="plans" />
      <OrderDetailView orderId={id} />
    </div>
  );
}
