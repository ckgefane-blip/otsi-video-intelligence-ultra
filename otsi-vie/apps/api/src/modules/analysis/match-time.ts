/**
 * Match time for every measure (migration 0030): the halves of a video as a person confirmed them, else as the engine proposed them. Heat
 * zones, team shape, distance and speed, kit samples, shirt-number proposals and look-alikes count only what happens inside them, so the
 * pre-match programme, half-time studio and post-match interviews never enter a statistic or a naming screen. A video without known halves
 * is not filtered (`null`).
 */
import { RowDataPacket } from "mysql2/promise";
import { Db } from "../../core/db";

export type Windows = [number, number][] | null;

export async function matchWindows(db: Db, videoId: string): Promise<Windows> {
  const r = await db.one<RowDataPacket>("SELECT first_start_us, first_end_us, second_start_us, second_end_us FROM match_periods WHERE video_id = ?", [videoId]);
  if (!r) return null;
  const w: [number, number][] = [[Number(r.first_start_us), Number(r.first_end_us)]];
  if (r.second_start_us !== null) w.push([Number(r.second_start_us), Number(r.second_end_us)]);
  return w;
}

/** Page 08 "1st Half" / "2nd Half": one half only; empty (nothing counts) when that half is not known for the video. null = both halves. */
export async function halfWindows(db: Db, videoId: string, half: 1 | 2 | null): Promise<Windows> {
  const w = await matchWindows(db, videoId);
  if (!half) return w;
  const one = w?.[half - 1];
  return one ? [one] : [];
}

/** the moment is inside match time (always, when the halves are not known) */
export const within = (w: Windows, us: number): boolean => !w || w.some(([a, b]) => us >= a && us < b);

/** the span [a, b] touches match time */
export const overlaps = (w: Windows, a: number, b: number): boolean => !w || w.some(([s, e]) => a < e && b >= s);

/** a short key for caches: changes when the halves change */
export const windowsKey = (w: Windows): string => (w ? w.map(([a, b]) => `${a}-${b}`).join(",") : "all");
