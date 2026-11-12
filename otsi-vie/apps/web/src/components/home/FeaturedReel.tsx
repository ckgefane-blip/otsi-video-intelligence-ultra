"use client";
/**
 * Home — Featured Reel: the organization's most recently completed reel render (GET /v1/reels, latest render SUCCEEDED with an output),
 * played in the shared VideoPlayer from its signed address (GET /v1/renders/:id/playback): play / pause, scrubber, time, speed,
 * fullscreen. The chips are the reel's own recorded facts — clips, aspect, codec and quality of the rendered file. Reels have no views
 * or likes yet, so none are shown. Share copies the reel's in-app link; the three dots open the reel actions (editors, export, download,
 * copy link). With no rendered reel: "No featured reel". A failed read is not that empty state: it says so and retries.
 */
import type { Reel } from "@otsi-vie/contracts";
import { Share2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ActionsMenu } from "@/components/media/ActionsMenu";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { reelActions } from "@/lib/actions";
import { fill } from "@/lib/fill";
import { useLocale } from "@/lib/i18n";
import { codec, mmss, quality, reelSeconds, reloadRenderedReels, useReelPlayback, useRenderedReels } from "./renderedReels";

export function FeaturedReel() {
  const { t } = useLocale();
  const reels = useRenderedReels();
  const reel = reels === undefined ? undefined : (reels?.[0] ?? null);        // undefined = loading
  const failed = reels === null;
  const src = useReelPlayback(failed ? null : reel);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = (s: string) => { setNote(s); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setNote(null), 2000); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const result = (reel?.last_good_render?.result ?? {}) as { height?: number };

  return (
    <section aria-label="Featured reel" className="vie-panel flex min-w-0 flex-col" data-section="p01-s03" data-featured={reel ? reel.id : reel === null ? "none" : "loading"}>
      <div className="vie-ph">
        <h2 className="t-panel">{t.body.home.featuredReel}</h2>
        {reel && <span className="t-mono text-muted">{mmss(reelSeconds(reel))}</span>}
      </div>
      <div className="p-3 pb-2">
        <VideoPlayer src={src} label={`Featured reel: ${reel?.name ?? ""}`}
          empty={failed ? { title: t.body.home.couldntLoadReels, body: t.body.home.featuredLoadFailed } : { title: t.body.home.noFeaturedReel, body: t.body.home.publishedReelsHere }} />
      </div>
      <div className="flex items-start justify-between gap-2 px-3">
        <div className="min-w-0">
          {failed ? (
            <button type="button" className="t-body text-primary hover:underline" onClick={() => reloadRenderedReels()} aria-label={t.body.home.reelsReadFailed}>
              {t.body.home.featuredLoadFailed}
            </button>
          ) : reel ? (
            <>
              <Link href={`/reels/${reel.id}`} className="t-panel block truncate hover:text-primary">{reel.name}</Link>
              <span className="t-small block truncate text-muted">{reel.player?.display_name ?? "—"}</span>
            </>
          ) : (
            <span className="t-small text-muted">{reel === null ? t.body.home.publishedReelsHere : t.common.loading}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center">
          <button type="button" className="vie-ib" disabled={!reel} aria-label="Share: copy the reel's link" title={t.body.library.share}
            onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/reels/${reel!.id}`).then(() => flash("Link copied"), () => flash("Copy failed")); }}>
            <Share2 className="h-4 w-4" aria-hidden />
          </button>
          <ActionsMenu label="More reel actions" items={reel ? reelActions(reel, t) : []} empty="No finished reel yet: make one in the Reel Builder" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 px-3 pb-3 pt-2" data-reel-facts>
        {reel ? [fill(t.desktop.featuredClips, { n: reel.clips.length }), reel.aspect, codec(reel), quality(result.height)].map((c) => <span key={c} className="vie-chip">{c}</span>) : null}
      </div>
      {note && <p role="status" className="t-small px-3 pb-2 text-primary">{note}</p>}
    </section>
  );
}
