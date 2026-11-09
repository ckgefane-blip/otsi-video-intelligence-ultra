/**
 * The actions the three-dots menus offer for a reel, a finished render and a video (MoreMenu), the same on every page.
 */
import type { Reel } from "@otsi-vie/contracts";
import { copyLink, downloadRender, type MoreItem } from "@/components/stage/MoreMenu";
import { api } from "@/lib/api";

const playback = (renderId: string) => () => api<{ download_url: string }>(`/v1/renders/${renderId}/playback`);

/** a reel: open it in each editor, export it, download its finished MP4, copy its link */
export function reelActions(reel: Pick<Reel, "id" | "last_good_render">): MoreItem[] {
  const done = reel.last_good_render?.has_output ? reel.last_good_render.id : null;
  return [
    { label: "Open in Reel Builder", href: `/reels/${reel.id}` },
    { label: "Edit in Clip Studio", href: `/studio?reel=${reel.id}` },
    { label: "Export & share", href: `/exports?reel=${reel.id}` },
    { label: "Download MP4", ...(done ? { run: () => downloadRender(playback(done)) } : { why: "Not rendered yet: press Generate Reel in the Reel Builder first" }) },
    { label: "Copy link", run: () => copyLink(`/reels/${reel.id}`) },
  ];
}

/** a finished render of a reel */
export function renderActions(renderId: string, reelId: string): MoreItem[] {
  return [
    { label: "Download MP4", run: () => downloadRender(playback(renderId)) },
    { label: "Watch in Export", href: `/exports?reel=${reelId}` },
    { label: "Open in Reel Builder", href: `/reels/${reelId}` },
    { label: "Edit in Clip Studio", href: `/studio?reel=${reelId}` },
    { label: "Copy link", run: () => copyLink(`/exports?reel=${reelId}`) },
  ];
}

/** a match video: each workspace that reads it */
export function videoActions(videoId: string): MoreItem[] {
  return [
    { label: "Open in Analysis", href: `/videos/${videoId}/analyze` },
    { label: "Processing (detection and tracking)", href: `/processing?video=${videoId}` },
    { label: "Tactical view", href: `/tactics?video=${videoId}` },
    { label: "Make a highlight reel", href: "/reels" },
    { label: "Copy link", run: () => copyLink(`/videos/${videoId}/analyze`) },
  ];
}
