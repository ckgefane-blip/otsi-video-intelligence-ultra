import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageView } from "@/components/page/PageView";
import {
  AnalysisWorkspace, BoxLegend, MatchContext, OverlayToggles, PresenceTimeline, SelectedTrack, TrackList, Transport, VideoWithBoxes,
} from "@/components/analysis/AnalysisWorkspace";
import { isUuid } from "@/lib/identity";

export const metadata: Metadata = { title: "Analysis Workspace" };

/** Page 04 for one video, connected: playback copy, the run's detected boxes, tracks, identity review and presence. */
export default async function Page({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isUuid(videoId)) notFound();
  return (
    <AnalysisWorkspace videoId={videoId}>
      <PageView
        id={4}
        live={[1, 3, 4, 5, 6, 7, 8, 10]}
        content={{
          1: <MatchContext />,
          3: <VideoWithBoxes />,
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
