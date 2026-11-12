import type { Metadata } from "next";
import { HomeStage } from "@/components/home/HomeStage";

export const metadata: Metadata = { title: "Home" };

/**
 * Home — SOT rebuild (page 11, alphabetical). The SOT's Home (Main.dc.html):
 * a three-column row (Start | live picture | Featured reel), a four-number
 * KPI row, and a three-panel row (Recent matches | Review inbox | Active
 * jobs). The accuracy banner is in the (app) layout. The old page's Sample
 * Reels, Capabilities, How It Works and TrustStrip are not in the SOT, so
 * they are not here.
 */
export default function Page() {
  return <HomeStage />;
}
