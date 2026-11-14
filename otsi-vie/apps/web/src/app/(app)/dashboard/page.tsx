import type { Metadata } from "next";
import { HomeStage } from "@/components/home/HomeStage";

export const metadata: Metadata = { title: "Home" };

/**
 * Home — Page 1 of 31 (ui-ux-spec §6.1, SOT home-first-run): hero (Start + the live picture with tracking boxes) →
 * NextActionBar → Featured reel (full width) → KPI row → trust strip (Evidence Integrity) → Continue Work + Jobs
 * Center → Review inbox + Recent Activity → sample reels (collapsed, labelled sample). The accuracy line is rendered
 * by HomeStage, on Home only. The old page's Capabilities and How It Works are not in the SOT or the spec; they stay
 * removed (Home audit, owner 2026-11-13). The trust strip and sample reels are back in the spec's §6.1 form (an
 * Evidence Integrity legend, and the app's own onboarding clips — not the old partner strip or real reels).
 */
export default function Page() {
  return <HomeStage />;
}
