/**
 * The ball answer key (migration 0027): a person marks where the ball is, frame by frame, or that it cannot be seen. A ball tracker is
 * measured against these marks before possession and passes are built on it.
 */
import { z } from "zod";

export const BallMarkInput = z.object({
  pts_us: z.number().int().min(0),
  visible: z.boolean(),
  x: z.number().min(0).max(1).nullable().default(null),
  y: z.number().min(0).max(1).nullable().default(null),
}).refine((m) => (m.visible ? m.x !== null && m.y !== null : m.x === null && m.y === null), { message: "A visible ball needs x and y; a hidden one has none." });
export type BallMarkInput = z.infer<typeof BallMarkInput>;

export const BallMark = z.object({
  id: z.string().uuid(),
  pts_us: z.number().int(),
  visible: z.boolean(),
  x: z.number().nullable(),
  y: z.number().nullable(),
  marked_by: z.string().uuid(),
  updated_at: z.string(),
});
export type BallMark = z.infer<typeof BallMark>;

/** The video's marks, in time order, with totals. */
export const BallMarks = z.object({
  video_id: z.string().uuid(),
  marks: z.array(BallMark),
  visible: z.number().int(),
  hidden: z.number().int(),
});
export type BallMarks = z.infer<typeof BallMarks>;

/** The engine's ball (migration 0028, ADR-037): followed automatically through an analysis run's detections. */
export const BallTrack = z.object({
  id: z.string().uuid(),
  run_id: z.string().uuid(),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]),
  /** started by the engine itself when the analysis finished (true) or by a person (false) */
  automatic: z.boolean(),
  progress: z.number().nullable(),
  stage_message: z.string().nullable(),
  /** frames, detected, inferred, unknown, removed by each rule; null until it finishes */
  metrics: z.record(z.string(), z.unknown()).nullable(),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type BallTrack = z.infer<typeof BallTrack>;

/** How the engine's answer compares with a person's marks, frame by frame. */
export const BallCheck = z.object({
  marked_visible: z.number().int(),
  right: z.number().int(),
  wrong: z.number().int(),
  unknown: z.number().int(),
  marked_hidden: z.number().int(),
  invented: z.number().int(),
  /** when the engine says where the ball is, how often it is right; null when nothing to compare */
  precision: z.number().nullable(),
  /** of the frames where a person saw the ball, how many the engine found */
  recall: z.number().nullable(),
});
export type BallCheck = z.infer<typeof BallCheck>;

/** The latest ball track of a video and its positions as parallel arrays (frames with no entry are unknown). */
export const BallPath = z.object({
  video_id: z.string().uuid(),
  track: BallTrack.nullable(),
  /** pts_us, state (D detected, I inferred), x, y, confidence: one entry per frame where the engine knows where the ball is */
  t: z.array(z.number().int()),
  s: z.string(),
  x: z.array(z.number()),
  y: z.array(z.number()),
  c: z.array(z.number()),
  check: BallCheck.nullable(),
});
export type BallPath = z.infer<typeof BallPath>;

/** A right answer is within this many pixels of a person's mark (the ball is 5-10 px wide at 720 p). */
export const BALL_RIGHT_PX = 12;

/** Index of the engine's entry within half a step of `pts_us` in sorted `t`, or -1. */
export function ballAt(t: number[], ptsUs: number, stepUs: number): number {
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m]! < ptsUs - stepUs / 2) lo = m + 1; else hi = m; }
  return lo < t.length && Math.abs(t[lo]! - ptsUs) < stepUs / 2 ? lo : -1;
}

/** The engine's ball against a person's marks (the same rule as vie_worker.ball.evaluate). */
export function checkBall(path: Pick<BallPath, "t" | "x" | "y">, marks: Pick<BallMark, "pts_us" | "visible" | "x" | "y">[], stepUs: number, widthPx: number, heightPx: number): BallCheck {
  const r = { marked_visible: 0, right: 0, wrong: 0, unknown: 0, marked_hidden: 0, invented: 0 };
  for (const m of marks) {
    const i = ballAt(path.t, m.pts_us, stepUs);
    if (m.visible) {
      r.marked_visible++;
      if (i < 0) r.unknown++;
      else if (Math.hypot((path.x[i]! - m.x!) * widthPx, (path.y[i]! - m.y!) * heightPx) <= BALL_RIGHT_PX) r.right++;
      else r.wrong++;
    } else {
      r.marked_hidden++;
      if (i >= 0) r.invented++;
    }
  }
  const said = r.right + r.wrong;
  return { ...r, precision: said ? Math.round((r.right / said) * 1000) / 1000 : null, recall: r.marked_visible ? Math.round((r.right / r.marked_visible) * 1000) / 1000 : null };
}
