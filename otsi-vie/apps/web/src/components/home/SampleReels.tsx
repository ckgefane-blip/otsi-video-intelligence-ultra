"use client";
/**
 * Home — Sample reels (ui-ux-spec §6.1): a collapsed section, clearly labelled "Sample reels". The content is sample
 * only, not the organisation's data: the app's own onboarding clips (public/onboarding), played here from their public
 * address. Collapsed for returning users; opening it never touches the organisation's reels.
 */
import { Play } from "lucide-react";
import { useState } from "react";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { useLocale } from "@/lib/i18n";

const SAMPLES = [
  { key: "hmSampleTrack", src: "/onboarding/01_TRACK_EVERY_PLAYER.mp4", poster: "/onboarding/01_TRACK_EVERY_PLAYER_poster.webp" },
  { key: "hmSampleTactical", src: "/onboarding/02_TACTICAL_INTELLIGENCE.mp4", poster: "/onboarding/02_TACTICAL_INTELLIGENCE_poster.webp" },
  { key: "hmSampleReels", src: "/onboarding/03_REELS_AND_REPORTS.mp4", poster: "/onboarding/03_REELS_AND_REPORTS_poster.webp" },
] as const;

function SampleSlot({ title, src, poster }: { title: string; src: string; poster: string }) {
  const { t } = useLocale();
  const [go, setGo] = useState(false);
  return (
    <div role="group" className="flex min-w-0 flex-col gap-1.5" aria-label={`Sample reel: ${title}`} data-sample={src}>
      {go ? (
        <VideoPlayer src={src} label={`Sample reel: ${title}`} autoPlay />
      ) : (
        <div className="relative grid aspect-video place-items-center overflow-hidden rounded-md border border-line bg-p0">
          <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
          <button type="button" onClick={() => setGo(true)} aria-label={`${t.desktop.play} ${title}`}
            className="relative grid h-11 w-11 place-items-center rounded-full border border-line2 bg-raised hover:border-primary hover:text-primary">
            <Play className="ml-0.5 h-5 w-5" aria-hidden />
          </button>
        </div>
      )}
      <span className="t-body block truncate font-normal">{title}</span>
    </div>
  );
}

export function SampleReels() {
  const { t } = useLocale();
  const h = t.body.home;
  const [open, setOpen] = useState(false);
  return (
    <section aria-label={h.sampleReels} className="min-w-0 rounded-md border border-line bg-panel" data-sample-reels>
      <button type="button" aria-expanded={open} onClick={() => setOpen((x) => !x)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left">
        <span className="t-panel">{h.sampleReels}</span>
        <span className="t-small text-muted">{open ? h.hmShowFewer : h.hmSeeAll.replace("{n}", String(SAMPLES.length))}</span>
      </button>
      {open && (
        <div className="border-t border-line px-4 py-3">
          <p className="t-small pb-3 text-muted">{h.hmSampleNote}</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {SAMPLES.map((s) => (
              <SampleSlot key={s.key} title={h[s.key] as string} src={s.src} poster={s.poster} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
