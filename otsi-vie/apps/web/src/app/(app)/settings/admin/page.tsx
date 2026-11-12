import type { Metadata } from "next";
import { PlatformHealth } from "@/components/admin/PlatformHealth";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Platform Health" };

/**
 * Admin Console > Platform Health (SOT, Admin.dc.html): review inbox,
 * jobs running, licence, release control and models, plus the concurrency
 * sliders and the review inbox. Available to Owners and Admins (Advanced).
 * The Settings side nav is shared by the Settings and Admin Console pages.
 * The old tabbed AdminConsole is no longer routed here; its content lives
 * on the new pages (gates → release, models → models, retention/audit →
 * compliance, concurrency/workers → this page).
 */
export default function AdminPage() {
  return (
    <div className="flex h-full w-full" data-stage="settings-admin" data-page="settings-admin">
      <SettingsSideNav current="admin" />
      <PlatformHealth />
    </div>
  );
}
