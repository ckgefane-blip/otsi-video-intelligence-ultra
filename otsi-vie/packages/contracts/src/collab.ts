/** Collaboration basics: who is in the organization, a person's saved library searches, and notes on a reel's timeline. */
import { z } from "zod";

export const Member = z.object({ user_id: z.string().uuid(), display_name: z.string(), role: z.string() });
export type Member = z.infer<typeof Member>;

/** a Library search: tab and filters as the Library page stores them (opaque to the server, at most 4 KB) */
export const SavedSearch = z.object({ id: z.string().uuid(), name: z.string(), query: z.record(z.unknown()), created_at: z.string() });
export type SavedSearch = z.infer<typeof SavedSearch>;
export const CreateSavedSearchRequest = z.object({
  name: z.string().trim().min(1).max(120),
  query: z.record(z.unknown()).refine((q) => JSON.stringify(q).length <= 4096, "the search is too large"),
});
export type CreateSavedSearchRequest = z.infer<typeof CreateSavedSearchRequest>;

/** a note on a reel, pinned to a timestamp of the source video (a clip's notes are the notes inside its in/out) */
export const ReelNote = z.object({
  id: z.string().uuid(), body: z.string(), at_pts_us: z.number().int().nullable(),
  author: z.object({ user_id: z.string().uuid(), display_name: z.string() }), created_at: z.string(),
});
export type ReelNote = z.infer<typeof ReelNote>;
export const CreateReelNoteRequest = z.object({ body: z.string().trim().min(1).max(255), at_pts_us: z.number().int().min(0).nullable().default(null) });
export type CreateReelNoteRequest = z.infer<typeof CreateReelNoteRequest>;
