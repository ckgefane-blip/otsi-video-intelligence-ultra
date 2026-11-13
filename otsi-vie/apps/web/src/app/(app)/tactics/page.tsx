import type { Metadata } from "next";
import { Suspense } from "react";
import { TacticsStage } from "@/components/tactics/TacticsStage";

export const metadata: Metadata = { title: "Tactical intelligence" };

/**
 * Page 05 Tactical Intelligence on the approved composition (corrected reference 05_TACTICAL_INTELLIGENCE), section by section:
 * 01 header and filter context, 02 team shape, 03 shape metrics, 04 synced video, 05 pass network, 06 possession, 07 pressing,
 * 08 off-ball runs, 09 player comparison. The video comes from ?video=.
 */
export default function Page() {
  return <Suspense><TacticsStage /></Suspense>;
}
