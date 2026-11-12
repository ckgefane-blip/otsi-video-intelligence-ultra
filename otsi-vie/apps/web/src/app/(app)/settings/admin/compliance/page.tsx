import type { Metadata } from "next";
import { Compliance } from "@/components/admin/Compliance";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Security & Compliance" };

/**
 * Admin Console > Security & Compliance (SOT, AdminCompliance.dc.html):
 * retention, erasure, backups and audit. Available to Owners and
 * Admins (Advanced). The Settings side nav is shared by the Settings
 * and Admin Console pages.
 */
export default function AdminCompliancePage() {
  return (
    <div className="flex min-h-full w-full" data-stage="settings-admin-compliance" data-page="settings-admin-compliance">
      <SettingsSideNav current="compliance" />
      <Compliance />
    </div>
  );
}
