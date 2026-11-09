import type { Metadata } from "next";
import { TwoStepSettings } from "@/components/account/TwoStepSettings";

export const metadata: Metadata = { title: "2-step sign-in" };

/** Account menu > 2-step sign-in: the signed-in person's own authenticator-app code. Not one of the ten numbered pages. */
export default function Page() {
  return <TwoStepSettings />;
}
