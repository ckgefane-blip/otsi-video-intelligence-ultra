/**
 * v3 Phase B.3 (ADR-082): the Analysis timeline's engine lanes for one video, from what the engine recorded (GET /v1/videos/:id/lanes):
 *   shots       the camera shots of the latest finished analysis (each cut starts a new one)
 *   ball        where the latest finished ball track saw the ball (detected positions joined while under 1 s apart); null: no ball track
 *   calibrated  where the pitch is measured (pitch calibrations), with their quality
 *   markers     the notes people pinned on the video at a time
 * The selected player's visibility comes from his track's observations on the page. Nothing is drawn where nothing was recorded.
 */
import { z } from "zod";

export const Span = z.object({ start_us: z.number().int(), end_us: z.number().int() });
export const VideoMarker = z.object({
  id: z.string().uuid(),
  at_pts_us: z.number().int().nonnegative(),
  body: z.string(),
  author: z.object({ user_id: z.string().uuid(), name: z.string() }).nullable(),
  mine: z.boolean(),
  created_at: z.string(),
});
export type VideoMarker = z.infer<typeof VideoMarker>;

export const VideoLanes = z.object({
  video_id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  duration_us: z.number().int().nullable(),
  shots: z.array(Span.extend({ shot_number: z.number().int() })),
  ball: z.array(Span).nullable(),
  calibrated: z.array(Span.extend({ quality: z.number().nullable() })),
  markers: z.array(VideoMarker),
});
export type VideoLanes = z.infer<typeof VideoLanes>;

export const CreateMarkerRequest = z.object({ at_pts_us: z.number().int().nonnegative(), body: z.string().trim().min(1).max(500) });
export type CreateMarkerRequest = z.infer<typeof CreateMarkerRequest>;

/** positions (sorted times, detected or not) joined into spans: neighbours under `gapUs` apart are one span; a lone point covers `padUs` */
export function joinSpans(times: number[], gapUs: number, padUs: number): { start_us: number; end_us: number }[] {
  const out: { start_us: number; end_us: number }[] = [];
  for (const t of times) {
    const last = out[out.length - 1];
    if (last && t - last.end_us <= gapUs) last.end_us = Math.max(last.end_us, t);
    else out.push({ start_us: t, end_us: t });
  }
  const h = Math.round(padUs / 2);
  return out.map((s) => (s.end_us - s.start_us < padUs ? { start_us: Math.max(0, s.start_us - h), end_us: s.end_us + h } : s));
}
