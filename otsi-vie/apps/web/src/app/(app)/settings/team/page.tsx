import type { Metadata } from "next";
import { SettingsNav } from "@/components/settings/SettingsNav";
import { TeamSettings } from "@/components/account/TeamSettings";

export const metadata: Metadata = { title: "Team and roles" };

/** Account menu > Team and roles: invitations, roles and removal (owners and admins). Not one of the ten numbered pages. */
export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="settings-team">
      <SettingsNav current="team" />
      <TeamSettings />
    </div>
  );
}
