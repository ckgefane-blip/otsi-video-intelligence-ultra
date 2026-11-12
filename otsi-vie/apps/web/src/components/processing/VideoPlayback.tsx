"use client";
/**
 * The video's playback copy for the per-video Processing page: the signed URL from GET /v1/videos/:id/playback, played by the
 * shared VideoPlayer. With no playback copy yet the player says so honestly (the server's own reason), and offers the local file
 * only as a stand-in the person opens themselves — never a stock clip.
 */
import type { Playback } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { VideoPlayer } from "@/components/media/VideoPlayer";
import { api } from "@/lib/api";
import { useLocale } from "@/lib/i18n";

export function VideoPlayback({ videoId, name }: { videoId: string; name: string }) {
  const { t: dict } = useLocale();
  const d = dict.body.processing;
  const [play, setPlay] = useState<Playback | null | undefined>(undefined);   // undefined: reading; null: could not be read
  useEffect(() => {
    let live = true;
    setPlay(undefined);
    void api<Playback>(`/v1/videos/${videoId}/playback`).then((p) => { if (live) setPlay(p); }, () => { if (live) setPlay(null); });
    return () => { live = false; };
  }, [videoId]);
  if (play === null) {
    return (
      <div className="grid aspect-video w-full place-items-center rounded-ctl border border-line bg-raised p-6 text-center">
        <p className="text-sm text-muted">{dict.desktop.playbackUnavailable}</p>
      </div>
    );
  }
  return (
    <VideoPlayer src={play === undefined ? undefined : (play.available ? play.url : null)} label={name} allowLocal
      empty={{ title: d.noPlaybackYet.replace("{a}", play?.reason ?? d.playbackCopyPreparing), body: d.playbackCopyPreparing }} />
  );
}
