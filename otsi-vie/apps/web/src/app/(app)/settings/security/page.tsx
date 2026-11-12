import type { Metadata } from "next";
import { PasskeySettings } from "@/components/account/PasskeySettings";
import { TwoStepSettings } from "@/components/account/TwoStepSettings";
import { SettingsNav } from "@/components/settings/SettingsNav";

export const metadata: Metadata = { title: "Security" };

/** Account menu > Security: the signed-in person's own 2-step sign-in (authenticator-app code) and passkeys
 *  (Windows Hello). Not one of the ten numbered pages. */
export default function Page() {
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4" data-page="settings-security">
      <SettingsNav current="security" />
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <TwoStepSettings />
        <PasskeySettings />
      </div>
    </div>
  );
}
