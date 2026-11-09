/**
 * v3 Phase B.12 (ADR-088): the Library table's extra columns, from recorded facts only.
 *   Rights    the video's current rights grant: its state and whether new material may be made (PRODUCE) and analysed (ANALYZE) now;
 *             a reel or export takes its video's rights. No grant recorded: "Not recorded".
 *   Evidence  what the engine and people recorded about the video: analysed or not, its tracks, how many a person confirmed.
 *   Profile   a video: the profile its latest analysis ran with (else the one chosen at upload); a reel: its frame; an export: its export profile (Scout cut, Social cut...).
 *   Device    the screen an output is made for, from its frame (16:9 TV / desktop, 9:16 phone, 4:5 social feed, 1:1 square). The camera
 *             that recorded a source video is not recorded, so a video says so.
 */
import { z } from "zod";
import { ANALYSIS_RIGHTS_REASONS } from "./rights";

export const VideoFacts = z.object({
  video_id: z.string().uuid(),
  rights: z.object({
    state: z.string(),
    uses: z.array(z.string()),
    /** why nothing new may be made from it now (null: it may) */
    produce_block: z.string().nullable(),
    analyse_block: z.string().nullable(),
  }).nullable(),
  analysed: z.boolean(),
  tracks: z.number().int().nonnegative(),
  confirmed_tracks: z.number().int().nonnegative(),
  profile: z.string().nullable(),
});
export type VideoFacts = z.infer<typeof VideoFacts>;
export const LibraryFacts = z.object({ videos: z.array(VideoFacts) });
export type LibraryFacts = z.infer<typeof LibraryFacts>;

/** the analysis profiles (analysis.ts AnalysisProfile, and RECOMMENDED: the footage check chooses) */
export const PROFILE_LABEL: Record<string, string> = { STANDARD: "Standard", HIGH_ACCURACY: "High accuracy", ULTRA_SENSITIVE: "Ultra sensitive", RECOMMENDED: "Recommended" };

/** the screen a frame is made for */
export function deviceOf(aspect: string | null | undefined): string | null {
  switch (aspect) {
    case "16:9": return "TV / desktop";
    case "9:16": return "Phone";
    case "4:5": return "Social feed";
    case "1:1": return "Square";
    default: return null;
  }
}

/** one line for the Rights column */
export function rightsLine(r: VideoFacts["rights"]): { text: string; locked: boolean } {
  if (!r) return { text: "Not recorded", locked: true };
  const state = r.state.charAt(0) + r.state.slice(1).toLowerCase().replace(/_/g, " ");
  if (r.produce_block) return { text: `${state} · locked`, locked: true };
  return { text: `${state} · ${r.uses.map((u) => u.toLowerCase()).join(", ")}`, locked: false };
}

/** one line for the Evidence column */
export function evidenceLine(f: VideoFacts | null | undefined): string {
  if (!f) return "—";
  if (!f.analysed) return "Not analysed";
  return `${f.tracks.toLocaleString("en-GB")} tracks · ${f.confirmed_tracks} confirmed`;
}

export const RIGHTS_REASON_TEXT = ANALYSIS_RIGHTS_REASONS;
