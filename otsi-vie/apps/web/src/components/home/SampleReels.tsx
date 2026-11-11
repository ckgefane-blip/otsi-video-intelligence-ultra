"use client";
/**
 * Home — Sample Reels: the organization's three most recently rendered reels (a finished render with a file), slot by slot. A slot with a
 * reel plays it in the shared VideoPlayer (its signed address is read when Play is pressed); title = the reel's name, subtitle = its
 * player, duration = the rendered length. A slot without a reel says so: "No reel in this slot" — never a stand-in clip. The three dots
 * open the reel actions; View all opens the Library. A failed read is not the empty state: the first slot says so and retries.
 */
import type { Reel } from "@otsi-vie/contracts";
import { ArrowRight, Play } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { ActionsMenu } from "@/components/media/ActionsMenu";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { reelActions } from "@/lib/actions";
import { useLocale } from "@/lib/i18n";
import { mmss, reelSeconds, reloadRenderedReels, useReelPlayback, useRenderedReels } from "./renderedReels";

function ReelSlot({ reel, failed, loading }: { reel: Reel | undefined; failed: boolean; loading: boolean }) {
  const { t } = useLocale();
  const [go, setGo] = useState(false);
  const src = useReelPlayback(reel, go);
  return (
    <div role="group" className="flex min-w-0 flex-col gap-1.5" aria-label={reel ? `Reel: ${reel.name}` : t.desktop.sampleSlotEmptyTitle} data-reel={reel?.id ?? "none"}>
      {reel && go ? (
        <VideoPlayer src={src} label={`Reel: ${reel.name}`} autoPlay />
      ) : (
        <div className="relative grid aspect-video place-items-center overflow-hidden rounded-md border border-line bg-p0 p-3 text-center">
          {reel ? (
            <>
              <button type="button" onClick={() => setGo(true)} aria-label={`${t.desktop.play} ${reel.name}`}
                className="grid h-11 w-11 place-items-center rounded-full border border-line2 bg-raised hover:border-primary hover:text-primary">
                <Play className="ml-0.5 h-5 w-5" aria-hidden />
              </button>
              <span className="t-mono absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 text-[11px]">{mmss(reelSeconds(reel))}</span>
            </>
          ) : failed ? (
            <button type="button" className="t-small text-primary hover:underline" onClick={() => reloadRenderedReels()} aria-label={t.body.home.reelsReadFailed}>
              {t.body.home.couldntLoadReels} · {t.body.home.tapRetry}
            </button>
          ) : (
            <span>
              <span className="t-small block text-ink2">{loading ? t.common.loading : t.desktop.sampleSlotEmptyTitle}</span>
              {!loading && <span className="t-small block text-muted">{t.desktop.sampleSlotEmptyBody}</span>}
            </span>
          )}
        </div>
      )}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          {reel ? <Link href={`/reels/${reel.id}`} className="t-body block truncate font-medium hover:text-primary">{reel.name}</Link>
            : <span className="t-body block text-muted">—</span>}
          <span className="t-small block truncate text-muted">{reel?.player?.display_name ?? ""}</span>
        </div>
        <ActionsMenu label="More reel actions" items={reel ? reelActions(reel, t) : []} empty={t.desktop.sampleSlotEmptyBody} />
      </div>
    </div>
  );
}

export function SampleReels() {
  const { t } = useLocale();
  const reels = useRenderedReels();
  const failed = reels === null;
  return (
    <section aria-label="Sample reels gallery" className="vie-panel min-w-0" data-section="p01-s07"
      data-count={reels ? String(Math.min(3, reels.length)) : reels === null ? "error" : "loading"}>
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.sampleReels}</h2>
        <Link href="/library" className="t-small flex items-center gap-1 text-primary hover:underline" aria-label="View all reels in the Library">
          {t.body.home.viewAll}<ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </div>
      <div className="grid grid-cols-3 gap-3 p-3">
        {[0, 1, 2].map((i) => <ReelSlot key={i} reel={reels?.[i]} failed={failed && i === 0} loading={reels === undefined} />)}
      </div>
    </section>
  );
}
