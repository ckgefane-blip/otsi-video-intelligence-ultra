import type { Metadata } from "next";
import { PasskeySettings } from "@/components/account/PasskeySettings";
import { TwoStepSettings } from "@/components/account/TwoStepSettings";

export const metadata: Metadata = { title: "Security" };

/** Account menu > Security: the signed-in person's own 2-step sign-in (authenticator-app code) and passkeys
 *  (Windows Hello). Not one of the ten numbered pages. */
export default function Page() {
  return (
    <div className="space-y-10 py-6">
      <TwoStepSettings />
      <PasskeySettings />
    </div>
  );
}
