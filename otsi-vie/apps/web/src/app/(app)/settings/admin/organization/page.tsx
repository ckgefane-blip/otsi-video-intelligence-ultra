import type { Metadata } from "next";
import { TeamSettings } from "@/components/account/TeamSettings";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Organization" };

/**
 * Admin Console > Organization: the organisation's members, invitations and roles (the same Team screen as
 * Settings > Team and roles), reached from the Admin Console so its side nav stays the Admin Console's
 * (owner 2026-11-13: Settings and Admin are separate places).
 */
export default function Page() {
  return (
    <div className="flex h-full w-full" data-stage="settings-admin-organization" data-page="settings-admin-organization">
      <SettingsSideNav current="organization" />
      <TeamSettings />
    </div>
  );
}
