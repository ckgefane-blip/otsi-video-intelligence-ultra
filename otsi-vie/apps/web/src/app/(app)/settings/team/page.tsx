import type { Metadata } from "next";
import { TeamSettings } from "@/components/account/TeamSettings";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Team" };

/**
 * Settings > Team (SOT, Team.dc.html): invitations, roles and removal (owners and admins). The Settings side
 * nav is shared by the Settings and Admin Console pages.
 */
export default function Page() {
  return (
    <div className="flex h-full w-full" data-stage="settings-team" data-page="settings-team">
      <SettingsSideNav current="team" />
      <TeamSettings />
    </div>
  );
}
