/**
 * v3 Phase B.21 (ADR-096): Clip Studio transitions for every cut, and compound clips (saved blocks).
 *   SetAllTransitionsRequest   one transition kind (or none) on every cut, as one change; a cut whose clip is too short gets the longest
 *                              transition it can take (half the clip, at least TRANSITION_MIN_MS) or none; a clip after a gap gets none
 *   ReelBlock                  a run of consecutive clips saved under a name, put into another reel of the same video in one step
 */
import { z } from "zod";
import { TRANSITION_DEFAULT_MS, TRANSITION_MAX_MS, TRANSITION_MIN_MS, TransitionKind } from "./reels";

export const SetAllTransitionsRequest = z.object({
  kind: TransitionKind.nullable(),
  duration_ms: z.number().int().min(TRANSITION_MIN_MS).max(TRANSITION_MAX_MS).default(TRANSITION_DEFAULT_MS),
});
export type SetAllTransitionsRequest = z.infer<typeof SetAllTransitionsRequest>;

/** each cut's transition length when one kind is put on every cut: null = none on that cut (first clip, after a gap, or too short) */
export function transitionsForAll(clips: { id: string; in_pts_us: number; out_pts_us: number; gap_ms?: number }[], ms: number): { clip_id: string; ms: number | null }[] {
  return clips.map((c, i) => {
    if (i === 0 || (c.gap_ms ?? 0) > 0) return { clip_id: c.id, ms: null };
    const most = Math.floor((c.out_pts_us - c.in_pts_us) / 2000);         // at most half the clip, in ms
    const take = Math.min(ms, most);
    return { clip_id: c.id, ms: take >= TRANSITION_MIN_MS ? take : null };
  });
}

export const BlockClip = z.object({ in_pts_us: z.number().int(), out_pts_us: z.number().int(), label: z.string().nullable() });
export const ReelBlock = z.object({
  id: z.string().uuid(),
  name: z.string(),
  video_id: z.string().uuid(),
  clips: z.array(BlockClip),
  /** the clips' source length (speed effects and gaps not counted) */
  length_us: z.number().int(),
  created_by: z.string().nullable(),
  created_at: z.string(),
});
export type ReelBlock = z.infer<typeof ReelBlock>;
export const CreateBlockRequest = z.object({
  name: z.string().trim().min(1).max(120),
  /** consecutive clips of the reel, in their order */
  clip_ids: z.array(z.string().uuid()).min(1).max(20),
});
export type CreateBlockRequest = z.infer<typeof CreateBlockRequest>;
/** where the block's clips go: before the clip at this position (0 = first); null = at the end */
export const InsertBlockRequest = z.object({ at: z.number().int().min(0).nullable().default(null) });
export type InsertBlockRequest = z.infer<typeof InsertBlockRequest>;
