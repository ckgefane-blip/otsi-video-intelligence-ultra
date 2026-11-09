/**
 * v3 Phase B.15 (ADR-091): reviewing the Reel Builder's suggested moments.
 *   coverage   the share of a moment in which the reel's player has a recorded position (each detection widened by half a frame, gaps up
 *              to the preview's bridge joined), measured on the server from the confirmed tracks' observations
 *   rejected   a person said "Not this one" for this reel; listed last, left out of Add all and drafts, can be restored
 *   swap       a selected clip takes a moment's window in place (same position in the reel), one change in the history
 */
import { z } from "zod";

export const MomentWindowRequest = z.object({ in_pts_us: z.number().int().min(0), out_pts_us: z.number().int().positive() })
  .refine((c) => c.out_pts_us > c.in_pts_us, { message: "out_pts_us must be after in_pts_us" });
export type MomentWindowRequest = z.infer<typeof MomentWindowRequest>;

export const SwapClipRequest = z.object({
  in_pts_us: z.number().int().min(0), out_pts_us: z.number().int().positive(), label: z.string().trim().max(255).nullable().default(null),
}).refine((c) => c.out_pts_us > c.in_pts_us, { message: "out_pts_us must be after in_pts_us" });
export type SwapClipRequest = z.infer<typeof SwapClipRequest>;

export const COVER_FRAME_US = 40_000, COVER_BRIDGE_US = 600_000;

/** the share of [a, b] covered by the sorted observation times */
export function momentCoverage(times: number[], a: number, b: number, bridgeUs = COVER_BRIDGE_US, frameUs = COVER_FRAME_US): number {
  if (b <= a) return 0;
  let lo = 0, hi = times.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (times[m]! < a - bridgeUs) lo = m + 1; else hi = m; }
  let total = 0, runA: number | null = null, runB = 0;
  const flush = () => { if (runA !== null) { const s = Math.max(runA, a), e = Math.min(runB, b); if (e > s) total += e - s; } };
  for (let i = lo; i < times.length && times[i]! <= b + bridgeUs; i++) {
    const t = times[i]!;
    if (runA !== null && t - (runB - frameUs / 2) <= bridgeUs) runB = t + frameUs / 2;
    else { flush(); runA = t - frameUs / 2; runB = t + frameUs / 2; }
  }
  flush();
  return Math.min(1, total / (b - a));
}

/** a moment is rejected while at least half of it lies in one rejected window */
export function isRejected(windows: { in_pts_us: number; out_pts_us: number }[], a: number, b: number): boolean {
  return windows.some((w) => Math.min(b, w.out_pts_us) - Math.max(a, w.in_pts_us) >= (b - a) / 2);
}

/** the badge on a moment card: what the engine found, in the evidence words */
export function momentBadge(m: { kind: "EVENT" | "VISIBLE"; events: string[] }): { word: string; title: string } {
  if (m.kind === "VISIBLE") return { word: "On camera", title: "Detected on his confirmed tracks; no action of his was found here" };
  const possible = m.events.length > 0 && m.events.every((e) => e === "TACKLE" || e === "INTERCEPTION");
  return possible ? { word: "Possible", title: "Inferred by the engine from the ball and players' positions; check it before you rely on it" }
    : { word: "Detected", title: "An engine event he took part in, on his confirmed tracks" };
}
