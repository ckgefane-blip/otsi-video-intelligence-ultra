import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { VideoProcessingDetail } from "@/components/processing/VideoProcessingDetail";
import { isUuid } from "@/lib/identity";

export const metadata: Metadata = { title: "AI processing" };

/** Page 03 for one video: the run headline and the match video, the run's real steps and progress, the processing log, and the measured output. */
export default async function Page({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isUuid(videoId)) notFound();
  return <VideoProcessingDetail videoId={videoId} />;
}
