import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageView } from "@/components/page/PageView";
import {
  AnalysisWorkspace, BoxLegend, MatchContext, PresenceTimeline, SelectedTrack, TrackList, Transport, useAnalysisWorkspace,
} from "@/components/analysis/AnalysisWorkspace";
import { OverlayToggles } from "@/components/media/OverlayToggles";
import { OverlaySync, WorkspaceVideo } from "@/components/analysis/WorkspacePlayer";
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
      <PageView
        id={4}
        live={[1, 3, 4, 5, 6, 7, 8, 10]}
        content={{
          1: <MatchContext />,
          3: <WorkspaceVideo />,
          4: <BoxLegend />,
          5: <OverlayToggles />,
          6: <TrackList />,
          7: <SelectedTrack />,
          8: <Transport />,
          10: <PresenceTimeline />,
        }}
      />
    </AnalysisWorkspace>
  );
}
