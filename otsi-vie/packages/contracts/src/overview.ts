/** Home / Overview (Page 01): the organization's totals, counted from what the engine actually recorded. */
import { z } from "zod";

export const OverviewStats = z.object({
  /** distinct matches with a finished analysis run; a video not yet linked to a match counts as its own match */
  matches_analyzed: z.number().int().nonnegative(),
  /** distinct registered players CONFIRMED on at least one track (current decision); tracked-but-unidentified people are not players */
  players_tracked: z.number().int().nonnegative(),
  /** distinct reels with at least one finished render that produced a file */
  reels_generated: z.number().int().nonnegative(),
  /** finished report jobs that produced a file */
  reports_created: z.number().int().nonnegative(),
  /** how many were added in each of the last five 7-day windows, oldest first (the last one ends now): when each was first counted */
  weekly: z.object({
    matches_analyzed: z.array(z.number().int().nonnegative()).length(5),
    players_tracked: z.array(z.number().int().nonnegative()).length(5),
    reels_generated: z.array(z.number().int().nonnegative()).length(5),
    reports_created: z.array(z.number().int().nonnegative()).length(5),
  }),
});
export type OverviewStats = z.infer<typeof OverviewStats>;

/** One analysed match video for Home's Recent Matches: what was recorded about it, nothing inferred. */
export const RecentMatch = z.object({
  video_id: z.string().uuid(),
  /** the linked match, if someone linked one; null = the video is not linked to a match */
  match: z.object({
    id: z.string().uuid(),
    home: z.string().nullable(),
    away: z.string().nullable(),
    competition: z.string().nullable(),
    kickoff_at: z.string().nullable(),
    home_score: z.number().int().nullable(),
    away_score: z.number().int().nullable(),
  }).nullable(),
  /** the video's own title, else its file name */
  video_title: z.string().nullable(),
  duration_us: z.number().int().nullable(),
  has_thumbnail: z.boolean(),
  /** when its latest analysis run finished */
  analysed_at: z.string().nullable(),
});
export type RecentMatch = z.infer<typeof RecentMatch>;

/** Page 03 "System Resources": the analysis workers' machine, as last measured (none reported in the last 20 s = not connected). */
export const SystemResources = z.object({
  connected: z.boolean(),
  workers: z.number().int().nonnegative(),
  busy_workers: z.number().int().nonnegative(),
  host: z.string().nullable(),
  cpu_percent: z.number().nullable(),
  cpu_count: z.number().int().nullable(),
  memory_used_bytes: z.number().int().nullable(),
  memory_total_bytes: z.number().int().nullable(),
  gpu_name: z.string().nullable(),
  /** never estimated: null when the GPU's load cannot be read */
  gpu_percent: z.number().nullable(),
  reported_at: z.string().nullable(),
});
export type SystemResources = z.infer<typeof SystemResources>;

/** Home hero (Page 01 Section 02): the player most recently CONFIRMED by a person on a track of this organization; null = none yet */
export const LatestConfirmedPlayer = z.object({
  player_id: z.string().uuid(),
  display_name: z.string(),
  canonical_otsi_id: z.string().nullable(),
  confirmed_at: z.string(),
  video_id: z.string().uuid(),
}).nullable();
export type LatestConfirmedPlayer = z.infer<typeof LatestConfirmedPlayer>;

/** Home hero picture (owner 2026-11-02: "use actual close-up images from real games ... to randomly fill all fields in the hero"; the
 *  owner chose his own footage): a random player a person CONFIRMED, at a moment of his own video where he is shown large; the boxes
 *  are the engine's detections in that frame (0-1 of the picture). A box's number comes only from the match sheet of a confirmed
 *  player; otherwise it has none. Null = no confirmed player yet. */
export const HeroBox = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), me: z.boolean(), number: z.number().int().nullable() });
export const HeroMoment = z.object({
  player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable(),
  jersey_number: z.number().int().nullable(), position: z.string().nullable(), team: z.string().nullable(),
  video_id: z.string().uuid(), pts_us: z.number().int(), width: z.number().int().nullable(), height: z.number().int().nullable(),
  boxes: z.array(HeroBox),
}).nullable();
export type HeroMoment = z.infer<typeof HeroMoment>;
