"use client";
/**
 * Page 06 Section 05 — the preview (centre), rebuilt to the SOT (Page 20, Reels.dc.html).
 *
 * The preview is the shared VideoPlayer, capped at 700 px and centred, with the transport bar below it — also in the empty state.
 * It plays the selected clip's source footage (a cross-match clip's own video, else the reel's single video), starting at the clip's
 * in point and stopping at its out point, then advancing to the next clip. No overlays: no player card, no scoreboard, no clip/render
 * toggle, no Prev/Next buttons, no coverage bar, no spotlight note — the SOT's preview is just the footage (or its empty state) and
 * the transport. Without a reel: the honest empty state, and the organization's reels to open below it.
 */
import type { Playback, Reel } from "@otsi-vie/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLocale, type Dictionary } from "@/lib/i18n";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { useStage } from "./shared";

const ASPECT: Record<string, string> = { "16:9": "16 / 9", "9:16": "9 / 16", "1:1": "1 / 1", "4:5": "4 / 5" };

const renderWord = (state: string | null | undefined, d: Dictionary["body"]["reels"]) =>
  state === "SUCCEEDED" ? d.renderStateSucceeded : state === "FAILED" ? d.renderStateFailed
    : state === "QUEUED" ? d.renderStateQueued : state === "RUNNING" ? d.renderStateRunning : d.renderStateNotRendered;

export function PreviewPanel() {
  const { t: dict } = useLocale();
  const { r } = useStage();
  const reel = r?.reel ?? null;
  const router = useRouter();
  const [list, setList] = useState<Reel[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [src, setSrc] = useState<{ url: string } | null>(null);
  const [srcLoading, setSrcLoading] = useState(false);
  // the preview advances to the next clip at the out point and keeps playing (autoPlay follows the advance only)
  const [autoPlay, setAutoPlay] = useState(false);
  const [replay, setReplay] = useState(0);
  const advanceRef = useRef(false);
  const advancingRef = useRef(false);
  const clips = reel?.clips ?? [];
  const sel = r?.selectedClip ?? null;
  const clipIndex = Math.max(0, clips.findIndex((c) => c.id === sel));
  const clip = clips[clipIndex] ?? null;
  // ADR-131: the clip's own video — a cross-match clip's source_video_id, else the reel's single video
  const clipVideoId = clip?.source_video_id ?? reel?.video_id ?? null;

  // without a reel id the page opens the reel worked on last (the list is newest first); the list stays as the way to pick another one
  // a failed read is named as one, with a retry: an empty list means "no reels yet", not "could not load them"
  const loadList = useCallback(() => { setListFailed(false); void api<Reel[]>("/v1/reels").then((l) => { setList(l); if (l[0] && !r) router.replace(`/reels/${l[0].id}`); }, () => setListFailed(true)); }, [r, router]);
  useEffect(() => { if (!reel) loadList(); }, [reel, loadList]);
  useEffect(() => {
    setSrc(null);
    if (!reel) return;
    if (!clipVideoId) return;
    setSrcLoading(true);
    const done = () => setSrcLoading(false);
    void api<Playback>(`/v1/videos/${clipVideoId}/playback`).then((p) => { setSrc(p.url ? { url: p.url } : null); done(); }, () => { setSrc(null); done(); });
  }, [reel?.id, clipVideoId]);   // eslint-disable-line react-hooks/exhaustive-deps

  // source footage: start at the clip's in point and stop at its out point (the player remounts per clip, so startAt applies)
  const outUs = clip?.out_pts_us ?? 0;
  // an advance resets the autoplay flag on the next selection change, so a hand-picked clip never starts by itself
  useEffect(() => {
    if (advanceRef.current) { advanceRef.current = false; advancingRef.current = false; }
    else setAutoPlay(false);
  }, [sel]);
  const advance = useCallback(() => {
    if (!clips.length || advancingRef.current) return;
    advancingRef.current = true;
    const next = clips[(clipIndex + 1) % clips.length]!;
    advanceRef.current = true;
    setAutoPlay(true);
    if (next.id === sel) setReplay((n) => n + 1);   // one clip: loop it from its in point
    r?.setSelectedClip(next.id);
  }, [clips, clipIndex, sel, r]);
  const onTime = (sec: number) => {
    if (clip && sec * 1e6 >= outUs) advance();
  };

  const noSrc = !!reel && !src && !srcLoading;
  // SOT: a reel with no footage to play says "No playable footage / Open the match file from this computer to play it."
  // with the "Open local footage" button (allowLocal) — not the generic "No preview yet" line
  const emptyTitle = !reel
    ? (listFailed ? dict.body.reels.reelsNotLoaded : list === null ? dict.body.reelstage.previewLoadingReels : list.length === 0 ? dict.body.reelstage.noReelYet.replace("{a}", dict.body.workspace.createHighlightReel) : dict.body.reels.openReel)
    : (noSrc ? dict.body.reels.rbNoFootage : dict.body.reelstage.previewNoSrc);
  const emptyBody = noSrc ? dict.body.reels.rbOpenLocal : "";

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 700 }}>
        <section aria-label={dict.body.reelstage.previewAria} data-section="p06-s05" data-preview={reel ? (src ? "source" : "none") : "none"} className="vie-panel p-3">
          <VideoPlayer
            key={`${src?.url ?? "none"}:${clip?.id ?? "none"}:${replay}`}
            src={reel ? (src?.url ?? (srcLoading ? undefined : null)) : null}
            label={dict.body.reels.previewSourceAria}
            aspect={ASPECT[reel?.aspect ?? "16:9"] ?? "16 / 9"}
            autoPlay={autoPlay}
            startAt={clip ? clip.in_pts_us / 1e6 : undefined}
            range={clip ? { inUs: clip.in_pts_us, outUs: clip.out_pts_us } : null}
            onTime={onTime}
            allowLocal
            emptyTransport
            empty={{ title: emptyTitle, body: emptyBody }}
          />
        </section>

        {/* the empty / loading states live in the preview's own empty title above — showing them again here duplicated the sentence
            (and the trailing "." made it ".."). Below the preview only the things the title cannot show: a retry when the read failed,
            and the reels to open when there are any. */}
        {!reel && listFailed && (
          <div className="mt-2">
            <p className="t-body">{dict.body.reels.reelsNotLoaded} <button type="button" onClick={() => loadList()} className="text-primary underline">{dict.common.retry}</button></p>
          </div>
        )}
        {!reel && list !== null && list.length > 0 && (
          <div className="mt-2">
            <p className="t-panel mb-1">{dict.body.reels.openReel}</p>
            <ul aria-label={dict.pages.reels.title} className="max-h-44 space-y-1 overflow-y-auto t-body">
              {list.map((x) => (
                <li key={x.id}>
                  <Link href={`/reels/${x.id}`} className="text-primary underline">{x.name}</Link>
                  <span className="t-small"> · {(x.clips.length === 1 ? dict.body.reels.reelListClipsOne : dict.body.reels.reelListClipsMany).replace("{a}", String(x.clips.length))} · {renderWord(x.latest_render?.state, dict.body.reels)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
