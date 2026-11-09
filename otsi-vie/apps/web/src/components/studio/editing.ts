/**
 * v3 Phase B.19 (ADR-093): Clip Studio editing aids, as pure rules.
 *   slip   a clip shows another part of the source with the same length (in and out move together, kept at 0 or later)
 *   snap   an edge being dragged jumps to the nearest target (playhead, markers, clip boundaries) within a few pixels
 *   lanes  the timeline's lane heights: the approved layout, or a tall Video Clips lane with the other lanes compact
 */

import { outAt, type ClipEffect } from "@otsi-vie/contracts";

/** the window after slipping by d source microseconds, the same length, not before the start of the video */
export function slipWindow(c: { in_pts_us: number; out_pts_us: number }, d: number, videoUs?: number | null): { in_pts_us: number; out_pts_us: number } {
  const len = c.out_pts_us - c.in_pts_us;
  let a = Math.round(c.in_pts_us + d);
  if (videoUs && a + len > videoUs) a = videoUs - len;
  a = Math.max(0, a);
  return { in_pts_us: a, out_pts_us: a + len };
}

/** v moved to the nearest target within thr, else v; `hit` is the target used */
export function snapTo(v: number, targets: number[], thr: number): { v: number; hit: number | null } {
  let best: number | null = null;
  for (const t of targets) if (Math.abs(t - v) <= thr && (best === null || Math.abs(t - v) < Math.abs(best - v))) best = t;
  return { v: best ?? v, hit: best };
}

/** B.21 (ADR-096): the reel time of a marker at source time `src`: on the first clip whose window holds it (with its speed effect); null =
 *  in no clip of the reel */
export function reelTimeOf(items: { clip: { in_pts_us: number; out_pts_us: number; effect?: ClipEffect | null }; start: number }[], src: number): number | null {
  for (const p of items) if (src >= p.clip.in_pts_us && src <= p.clip.out_pts_us) return p.start + outAt(p.clip, src);
  return null;
}

export type LaneMode = "normal" | "tall";
/** the approved lanes' centres (reference 07_CLIP_STUDIO) */
export const LANE_Y = [1027, 1074, 1121, 1168, 1215, 1266, 1320, 1372] as const;
/** each lane's centre and height (stage units) */
export function laneGeometry(mode: LaneMode): { y: number; h: number }[] {
  if (mode === "normal") return LANE_Y.map((y) => ({ y, h: 40 }));
  const out: { y: number; h: number }[] = [];
  let top = 1007;
  for (const h of [92, 30, 30, 30, 30, 30, 30, 30]) { out.push({ y: top + h / 2, h }); top += h + 6; }
  return out;
}
