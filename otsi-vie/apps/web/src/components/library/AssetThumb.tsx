"use client";
/**
 * Library — one asset's real thumbnail: the frame stored beside its source video (GET /v1/videos/:id/thumbnail, via apiBlob).
 * A video whose thumbnail is recorded as absent, or whose thumbnail read fails, gets an honest empty tile that says so — never a
 * gradient, a stock picture, or a made-up frame. Folders, projects, templates and reports have no source video, so they show the
 * same honest empty tile (the row itself shows the folder / project icon instead). The duration badge is the asset's recorded
 * length, or nothing when none was recorded.
 */
import { ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { apiBlob } from "@/lib/api";
import { useLocale } from "@/lib/i18n";
import type { Asset } from "./useLibrary";

const clock = (us: number | null) => (us ? `${Math.floor(us / 6e7)}:${String(Math.round(us / 1e6) % 60).padStart(2, "0")}` : null);

export function AssetThumb({ a, className = "h-[54px] w-[96px]" }: { a: Asset; className?: string }) {
  const { t } = useLocale();
  const videoId = a.videoId ?? null;
  // the Video itself records whether it has a thumbnail; a reel / export / match only knows its video, so the read is attempted
  const knownNone = a.kind === "Video" && (a.raw as { has_thumbnail?: boolean }).has_thumbnail === false;
  const [src, setSrc] = useState<string | null | undefined>(videoId && !knownNone ? undefined : null);
  useEffect(() => {
    if (!videoId || knownNone) { setSrc(null); return; }
    let live = true, url: string | null = null;
    void apiBlob(`/v1/videos/${videoId}/thumbnail`).then((b) => { url = URL.createObjectURL(b); if (live) setSrc(url); }, () => { if (live) setSrc(null); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [videoId, knownNone]);
  const dur = clock(a.durationUs);
  return (
    <span className={`relative grid shrink-0 place-items-center overflow-hidden rounded border border-line bg-p0 ${className}`}
      data-thumb={src ? "frame" : src === null ? "none" : "loading"}>
      {src ? <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
        : src === null ? <span title={t.desktop.noThumb} className="text-muted"><ImageOff className="h-4 w-4" aria-hidden /><span className="sr-only">{t.desktop.noThumb}</span></span> : null}
      {dur && <span className="absolute bottom-0.5 right-0.5 rounded-sm bg-black/75 px-1 text-xs font-normal leading-4 text-white tabular-nums">{dur}</span>}
    </span>
  );
}
