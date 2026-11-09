import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageView } from "@/components/page/PageView";
import { OutputSummary, PipelineSteps, ProcessingLog, ProcessingProvider, RunHeadline } from "@/components/analysis/ProcessingView";
import { isUuid } from "@/lib/identity";

export const metadata: Metadata = { title: "AI Processing" };

/** Page 03 for one video, connected: start analysis, the run's real steps and progress, failures, and the measured output. */
export default async function Page({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  if (!isUuid(videoId)) notFound();
  return (
    <ProcessingProvider videoId={videoId}>
      <PageView id={3} live={[1, 2, 8, 11]} content={{ 1: <RunHeadline />, 2: <PipelineSteps />, 8: <ProcessingLog />, 11: <OutputSummary /> }} />
    </ProcessingProvider>
  );
}
