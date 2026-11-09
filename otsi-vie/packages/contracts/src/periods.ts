/**
 * Match time (migration 0030): when the first and the second half are played inside a broadcast that also carries the pre-match programme,
 * half-time studio and adverts, and the post-match interviews. Detected from how many players the engine follows on the pitch, second by
 * second (the tracker follows only people on the grass: studio, adverts and crowd shots have none); a person confirms or corrects it.
 * Replays and close-ups inside play stay inside the half: only long stretches without play are programme.
 */
import { z } from "zod";

export const Period = z.object({ start_us: z.number().int().min(0), end_us: z.number().int().min(0) }).refine((p) => p.end_us > p.start_us, { message: "a period ends after it starts" });
export type Period = z.infer<typeof Period>;

export const MatchPeriods = z.object({
  video_id: z.string().uuid(),
  /** NONE: no finished analysis to detect from; PROPOSED: detected by the engine; CONFIRMED: a person confirmed or corrected it */
  state: z.enum(["NONE", "PROPOSED", "CONFIRMED"]),
  first: Period.nullable(),
  second: Period.nullable(),
  /** players followed on the pitch per analysed frame, minute by minute (the evidence, for the timeline) */
  per_minute: z.array(z.number()),
  note: z.string().nullable(),
  decided_at: z.string().nullable(),
});
export type MatchPeriods = z.infer<typeof MatchPeriods>;

export const SetMatchPeriods = z.object({ first: Period, second: Period.nullable() })
  .refine((m) => !m.second || m.second.start_us >= m.first.end_us, { message: "the second half starts after the first ends" });
export type SetMatchPeriods = z.infer<typeof SetMatchPeriods>;

export const PLAY_PLAYERS = 4;          // a second with at least this many players followed per frame (median) shows play
export const PLAY_GAP_S = 150;          // shorter breaks inside play (replays, close-ups, an injury, a goal celebration) stay inside it
export const HALF_MIN_S = 15 * 60;      // a stretch of play shorter than this is not a half (warm-up, highlights of another match)
export const FULL_PLAYERS = 8;          // each end of a half is trimmed to where the one-minute average reaches this (walk-out, line-up, the
                                        // players leaving: few people on the pitch, not yet play)

/**
 * The two halves from players-per-frame for each second of the video (index = second). Returns the two longest stretches of play at least
 * HALF_MIN_S long, in time order; one stretch (no half-time break in the video) is returned as the first half alone. Null when no stretch
 * is long enough.
 */
export function detectPeriods(perSecond: number[], notBeforeS = 0): { first: Period | null; second: Period | null; note: string | null } {
  const play = perSecond.map((v, s) => s >= notBeforeS && v >= PLAY_PLAYERS);
  const runs: [number, number][] = [];                      // [first second, last second] of play, gaps up to PLAY_GAP_S closed
  for (let s = 0; s < play.length; s++) {
    if (!play[s]) continue;
    const last = runs[runs.length - 1];
    if (last && s - last[1] <= PLAY_GAP_S) last[1] = s; else runs.push([s, s]);
  }
  const halves = runs.filter(([a, b]) => b - a + 1 >= HALF_MIN_S).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0])).slice(0, 2).sort((x, y) => x[0] - y[0])
    .map(([a, b]) => trim(perSecond, a, b));
  const p = ([a, b]: [number, number]): Period => ({ start_us: a * 1_000_000, end_us: (b + 1) * 1_000_000 });
  if (!halves.length) return { first: null, second: null, note: "No stretch of play of 15 minutes or more was found." };
  if (halves.length === 1) return { first: p(halves[0]!), second: null, note: "One long stretch of play and no half-time break: check where the halves are." };
  return { first: p(halves[0]!), second: p(halves[1]!), note: null };
}

/** The run [a, b] with each end moved in to where the one-minute average of players reaches FULL_PLAYERS (never past the middle). */
function trim(v: number[], a: number, b: number): [number, number] {
  const mean = (c: number) => { let t = 0, n = 0; for (let s = Math.max(a, c - 30); s <= Math.min(b, c + 30); s++) { t += v[s] ?? 0; n++; } return n ? t / n : 0; };
  const mid = Math.floor((a + b) / 2);
  let s0 = a; while (s0 < mid && mean(s0) < FULL_PLAYERS) s0++;
  let s1 = b; while (s1 > mid && mean(s1) < FULL_PLAYERS) s1--;
  return s1 - s0 + 1 >= HALF_MIN_S ? [Math.max(a, s0 - 30), Math.min(b, s1 + 30)] : [a, b];
}
