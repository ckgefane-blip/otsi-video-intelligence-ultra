import type { Metadata } from "next";
import { Suspense } from "react";
import { StudioStage } from "@/components/studio/StudioStage";

export const metadata: Metadata = { title: "Clip Studio" };

/**
 * Page 07 Clip Studio / Timeline Editor on the approved composition (corrected reference 07_CLIP_STUDIO): 01 header and actions,
 * 02 media bin, 03 preview, 04 clip inspector, 05 tools ribbon, 06 ruler and playhead, 07–11 the eight lanes. The reel comes from ?reel=.
 */
export default function Page() {
  return <Suspense><StudioStage /></Suspense>;
}
