/**
 * v3 Phase B.25 (ADR-100): moment boundary suggestions around events, labelled Inferred.
 * For a clip of the reel, the engine's event moments of the reel's player that overlap it (the same windows the moment cards use) give a
 * suggested in and out: from the first moment's start to the last one's end. It never crosses a camera cut the clip does not already
 * cross, never runs into the footage of another clip of the reel (the same picture twice), never makes a clip longer than 60 s or
 * shorter than 1 s, and is offered only when an end moves by 0.5 s or more.
 * A suggestion is Inferred (built from detected events by a rule); a person applies it or not. Nothing moves by itself.
 */
import { z } from "zod";
import { MomentEvent } from "./reels";

export const BOUNDARY_MIN_DELTA_US = 500_000;
export const BOUNDARY_MAX_CLIP_US = 60_000_000;
export const BoundarySuggestion = z.object({
  clip_id: z.string().uuid(),
  from_in_us: z.number().int(), from_out_us: z.number().int(),
  in_pts_us: z.number().int(), out_pts_us: z.number().int(),
  events: z.array(MomentEvent),
  evidence: z.literal("INFERRED"),
  why: z.string(),
});
export type BoundarySuggestion = z.infer<typeof BoundarySuggestion>;

type Win = { in_pts_us: number; out_pts_us: number };
const shotAt = (shots: { start_us: number; end_us: number }[], t: number) => shots.find((s) => s.start_us <= t && t < s.end_us) ?? null;
const sec = (us: number) => `${(Math.abs(us) / 1e6).toFixed(1)} s`;

/** the suggested window for one clip, or null when the events agree with it already (or there is none) */
export function suggestBoundary(clip: Win, moments: (Win & { events: MomentEvent[] })[], shots: { start_us: number; end_us: number }[], durationUs: number, others: Win[] = []):
  { in_pts_us: number; out_pts_us: number; events: MomentEvent[]; why: string } | null {
  const over = moments.filter((m) => m.in_pts_us < clip.out_pts_us && m.out_pts_us > clip.in_pts_us);
  if (!over.length) return null;
  let a = Math.max(0, Math.min(...over.map((m) => m.in_pts_us))), b = Math.min(durationUs, Math.max(...over.map((m) => m.out_pts_us)));
  if (a < clip.in_pts_us) { const s = shotAt(shots, clip.in_pts_us); if (s) a = Math.max(a, s.start_us); }      // not across a cut before the clip
  if (b > clip.out_pts_us) { const s = shotAt(shots, clip.out_pts_us - 1); if (s) b = Math.min(b, s.end_us); }   // nor after it
  for (const o of others) {                                                        // not into another clip's picture
    if (o.in_pts_us < clip.in_pts_us && o.out_pts_us > a) a = Math.max(a, Math.min(clip.in_pts_us, o.out_pts_us));
    if (o.out_pts_us > clip.out_pts_us && o.in_pts_us < b) b = Math.min(b, Math.max(clip.out_pts_us, o.in_pts_us));
  }
  if (b - a > BOUNDARY_MAX_CLIP_US) b = a + BOUNDARY_MAX_CLIP_US;
  a = Math.round(a); b = Math.round(b);
  if (b - a < 1_000_000) return null;
  const da = a - clip.in_pts_us, db = b - clip.out_pts_us;
  if (Math.abs(da) < BOUNDARY_MIN_DELTA_US && Math.abs(db) < BOUNDARY_MIN_DELTA_US) return null;
  const events = [...new Set(over.flatMap((m) => m.events))];
  const parts = [Math.abs(da) >= BOUNDARY_MIN_DELTA_US ? `start ${sec(da)} ${da < 0 ? "earlier" : "later"}` : null,
    Math.abs(db) >= BOUNDARY_MIN_DELTA_US ? `end ${sec(db)} ${db > 0 ? "later" : "earlier"}` : null].filter(Boolean);
  return { in_pts_us: a, out_pts_us: b, events, why: `${parts.join(", ")}: to hold the engine's ${events.length} event${events.length === 1 ? "" : "s"} of his around this clip` };
}
