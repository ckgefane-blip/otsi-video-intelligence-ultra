import type { Metadata } from "next";
import { Suspense } from "react";
import { AnalysisStage } from "@/components/workspace/AnalysisStage";

export const metadata: Metadata = { title: "Analysis" };

/**
 * Page 04 Analysis Workspace on the approved composition (corrected reference 04_ANALYSIS_WORKSPACE): left rail (match, overlays, team
 * filter, time range), centre (modes, video, playback bar, events and track presence), right column (players, selected player).
 * The video comes from ?video=.
 */
export default function Page() {
  return <Suspense><AnalysisStage /></Suspense>;
}
