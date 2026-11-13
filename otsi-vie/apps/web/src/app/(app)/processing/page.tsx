import type { Metadata } from "next";
import { Suspense } from "react";
import { ProcessingStage } from "@/components/processing/ProcessingStage";

export const metadata: Metadata = { title: "AI processing" };

/**
 * Page 03 AI Processing on the approved composition (corrected reference 03_AI_PROCESSING), section by section: 01 header (shared
 * layout), 02 title and job card, 03 pipeline stages, 04 processing preview, 05 detection tiles, 06 processing log, 07 system resources,
 * 08 processing timeline, 09 output summary. The video comes from ?video=.
 */
export default function Page() {
  return <Suspense><ProcessingStage /></Suspense>;
}
