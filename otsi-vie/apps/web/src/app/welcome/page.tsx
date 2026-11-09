import type { Metadata } from "next";
import { Onboarding } from "@/components/auth/Onboarding";

export const metadata: Metadata = { title: "Welcome" };

/** First-run welcome: splash, three-screen tour, then the person's own name. Shown once per account (users.onboarded_at). */
export default function Page() {
  return <Onboarding />;
}
