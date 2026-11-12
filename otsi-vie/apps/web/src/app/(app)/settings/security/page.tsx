import type { Metadata } from "next";
import { SecurityView } from "@/components/account/SecurityView";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

export const metadata: Metadata = { title: "Security" };

/**
 * Settings > Security (SOT, Security.dc.html): the signed-in person's own 2-step sign-in (authenticator-app
 * code) and passkeys (Windows Hello). The Settings side nav is shared by the Settings and Admin Console pages.
 */
export default function Page() {
  return (
    <div className="flex min-h-full w-full" data-stage="settings-security" data-page="settings-security">
      <SettingsSideNav current="security" />
      <SecurityView />
    </div>
  );
}
