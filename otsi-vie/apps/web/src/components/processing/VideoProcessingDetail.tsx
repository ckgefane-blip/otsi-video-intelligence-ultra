"use client";
/**
 * The per-video Processing page, in flow layout: the run headline and the match video side by side, the pipeline steps below,
 * then the processing log and the output summary. The four sections are the live ones from ProcessingView; the old page's
 * placeholder cards for sections that were never built are gone. The match video is new here — this page previously had no
 * player — and plays from the signed playback URL (GET /v1/videos/:id/playback) via VideoPlayback.
 */
import { OutputSummary, PipelineSteps, ProcessingLog, ProcessingProvider, RunHeadline, useProcessing } from "@/components/analysis/ProcessingView";
import { useLocale } from "@/lib/i18n";
import { VideoPlayback } from "./VideoPlayback";

function DetailBody({ videoId }: { videoId: string }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const { video } = useProcessing();
  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-4">
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="vie-panel" aria-label={d.analysisRuns}>
          <RunHeadline />
        </section>
        <section className="vie-panel" aria-label={d.matchVideo}>
          <h2 className="t-panel">{d.matchVideo}</h2>
          <div className="mt-3">
            <VideoPlayback videoId={videoId} name={video ? (video.title ?? video.original_filename ?? "") : ""} />
          </div>
        </section>
      </div>
      <section className="vie-panel" aria-label={d.analysisSteps}>
        <h2 className="t-panel">{d.analysisSteps}</h2>
        <div className="mt-3">
          <PipelineSteps />
        </div>
      </section>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="vie-panel" aria-label={d.processingLog}>
          <h2 className="t-panel">{d.processingLog}</h2>
          <div className="mt-3">
            <ProcessingLog />
          </div>
        </section>
        <section className="vie-panel" aria-label={d.outputSummary}>
          <h2 className="t-panel">{d.outputSummary}</h2>
          <div className="mt-3">
            <OutputSummary />
          </div>
        </section>
      </div>
    </div>
  );
}

export function VideoProcessingDetail({ videoId }: { videoId: string }) {
  return (
    <ProcessingProvider videoId={videoId}>
      <DetailBody videoId={videoId} />
    </ProcessingProvider>
  );
}
