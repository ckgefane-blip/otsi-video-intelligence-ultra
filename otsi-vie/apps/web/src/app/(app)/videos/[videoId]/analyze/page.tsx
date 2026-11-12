import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalyzeLayout } from "@/components/analysis/AnalyzeLayout";
import { AnalysisWorkspace, useAnalysisWorkspace } from "@/components/analysis/AnalysisWorkspace";
import { OverlaySync } from "@/components/analysis/WorkspacePlayer";
import { isUuid } from "@/lib/identity";

export const metadata: Metadata = { title: "Analysis Workspace" };

/** Applies the viewer's overlay preference to this workspace, so the Drop 1 OverlayToggles below drive the boxes shown. */
function Sync() {
  const ws = useAnalysisWorkspace();
  return <OverlaySync ws={ws} />;
}

/**
 * Page 04 for one video, connected: the video on the shared player (signed playback URL, with the run's boxes drawn over it),
 * the overlay toggles, the run's tracks, the selected track and its identity review, transport and the selected track's presence.
 */
export default async function Page({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isUuid(videoId)) notFound();
  return (
    <AnalysisWorkspace videoId={videoId}>
      <Sync />
      <AnalyzeLayout />
    </AnalysisWorkspace>
  );
}
