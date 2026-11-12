import type { Metadata } from "next";
import { AdminConsole } from "@/components/admin/AdminConsole";
import { SettingsNav } from "@/components/settings/SettingsNav";

export const metadata: Metadata = { title: "Admin Console" };

/**
 * Account / Governance > Admin console: Members, Model Registry, Worker Concurrency & Audit Logs.
 * Available to Owners and Admins (v3 Phase D.3, ADR-111).
 */
export default function AdminPage() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="settings-admin">
      <SettingsNav current="admin" />
      <AdminConsole />
    </div>
  );
}
