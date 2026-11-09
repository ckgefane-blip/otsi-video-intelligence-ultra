/**
 * v3 Phase A.1 (S01, ADR-069): the work context Project ▸ Match ▸ Player shown under the navigation and carried from page to page.
 * Resolved by the API from what the page is about (a reel, a video, a player) with the caller's organization and project access;
 * anything it cannot see or that does not exist is simply not in the context (null), never an error.
 */
import { z } from "zod";

const Named = z.object({ id: z.string().uuid(), name: z.string() });
export const ContextPlayer = z.object({ id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable() });
export type ContextPlayer = z.infer<typeof ContextPlayer>;
export const ContextVideo = z.object({
  id: z.string().uuid(), title: z.string(),
  /** "Home v Away" (and the competition / date) when the video is linked to a match; null when it is not */
  match_label: z.string().nullable(),
  analysed: z.boolean(),
});
export type ContextVideo = z.infer<typeof ContextVideo>;

export const WorkContext = z.object({
  project: Named.nullable(),
  video: ContextVideo.nullable(),
  match: Named.nullable(),
  player: ContextPlayer.nullable(),
  reel: Named.nullable(),
  choices: z.object({
    /** projects the caller may see, most recently active first */
    projects: z.array(Named),
    /** videos of the context's project (or of the asked project), newest first */
    videos: z.array(ContextVideo),
    /** players a person confirmed on a track of the context's video */
    players: z.array(ContextPlayer),
    /** reels of the context's video (for the context's player first) */
    reels: z.array(Named.extend({ player_id: z.string().uuid() })),
  }),
});
export type WorkContext = z.infer<typeof WorkContext>;

const Id = z.string().uuid().optional().catch(undefined);
export const WorkContextQuery = z.object({ project: Id, video: Id, reel: Id, player: z.string().max(40).optional() });
export type WorkContextQuery = z.infer<typeof WorkContextQuery>;

/** a video's name in the bar: its match when it has one, else its title */
export const videoLabel = (v: ContextVideo) => v.match_label ?? v.title;
