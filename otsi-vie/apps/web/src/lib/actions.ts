/**
 * The actions the three-dots menus offer for a reel, a finished render and a video (MoreMenu), the same on every page.
 */
import type { Reel } from "@otsi-vie/contracts";
import { copyLink, downloadRender, type MoreItem } from "@/components/stage/MoreMenu";
import { api } from "@/lib/api";
import { getDictionary, type Dictionary } from "@/lib/i18n";

const playback = (renderId: string) => () => api<{ download_url: string }>(`/v1/renders/${renderId}/playback`);

/** a reel: open it in each editor, export it, download its finished MP4, copy its link */
export function reelActions(reel: Pick<Reel, "id" | "last_good_render">, dict: Dictionary = getDictionary("en")): MoreItem[] {
  const done = reel.last_good_render?.has_output ? reel.last_good_render.id : null;
  const l = dict.body.library;
  return [
    { label: l.menuOpenReelBuilder, href: `/reels/${reel.id}` },
    { label: l.menuEditClipStudio, href: `/studio?reel=${reel.id}` },
    { label: l.menuExportShare, href: `/exports?reel=${reel.id}` },
    { label: l.menuDownloadMp4, ...(done ? { run: () => downloadRender(playback(done)) } : { why: l.menuNotRendered }) },
    { label: l.menuCopyLink, run: () => copyLink(`/reels/${reel.id}`) },
  ];
}

/** a finished render of a reel */
export function renderActions(renderId: string, reelId: string, dict: Dictionary = getDictionary("en")): MoreItem[] {
  const l = dict.body.library;
  return [
    { label: l.menuDownloadMp4, run: () => downloadRender(playback(renderId)) },
    { label: l.menuWatchExport, href: `/exports?reel=${reelId}` },
    { label: l.menuOpenReelBuilder, href: `/reels/${reelId}` },
    { label: l.menuEditClipStudio, href: `/studio?reel=${reelId}` },
    { label: l.menuCopyLink, run: () => copyLink(`/exports?reel=${reelId}`) },
  ];
}

/** a match video: each workspace that reads it */
export function videoActions(videoId: string, dict: Dictionary = getDictionary("en")): MoreItem[] {
  const l = dict.body.library;
  return [
    { label: l.openInAnalysis, href: `/videos/${videoId}/analyze` },
    { label: l.menuProcessing, href: `/processing?video=${videoId}` },
    { label: l.menuTactical, href: `/tactics?video=${videoId}` },
    { label: l.menuMakeReel, href: "/reels" },
    { label: l.menuCopyLink, run: () => copyLink(`/videos/${videoId}/analyze`) },
  ];
}
