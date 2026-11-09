/**
 * v3 Phase B.7 (ADR-084): what an identity decision would make out of date, shown BEFORE it is saved.
 *   GET /v1/identity-impact?track_ids=a,b&state=CONFIRMED&player_id=x
 * reels       reels that follow one of these tracks under its current decision: after the change they are stale (no render until refreshed);
 *             with how many finished renders and live share links each has
 * reports     made PDF reports of the player who loses the tracks and of the player who gains them: their figures no longer match until
 *             made again
 * unchanged   the decision would change nothing for these tracks (the same state and player as now)
 */
import { z } from "zod";

export const IdentityImpact = z.object({
  changing_tracks: z.number().int(),
  unchanged_tracks: z.number().int(),
  reels: z.array(z.object({ reel_id: z.string().uuid(), name: z.string(), renders: z.number().int(), live_links: z.number().int() })),
  reports: z.array(z.object({ player_id: z.string().uuid(), name: z.string(), pdfs: z.number().int(), latest_at: z.string().nullable(), role: z.enum(["LOSES", "GAINS"]) })),
});
export type IdentityImpact = z.infer<typeof IdentityImpact>;

/** one plain sentence of what goes out of date, or null when nothing does */
export function impactText(i: IdentityImpact): string | null {
  const parts: string[] = [];
  if (i.reels.length) {
    const rendered = i.reels.filter((r) => r.renders > 0).length, shared = i.reels.filter((r) => r.live_links > 0).length;
    const one = i.reels.length === 1;
    parts.push(`${one ? `the reel “${i.reels[0]!.name}” will need its` : `${i.reels.length} reels will need their`} targets refreshed before rendering again`
      + (rendered ? ` (${one ? "it was already rendered" : `${rendered} already rendered`}${shared ? `, ${one ? "and shared by link" : `${shared} shared by link`}` : ""})` : ""));
  }
  for (const r of i.reports.filter((x) => x.pdfs > 0)) parts.push(`${r.name}'s ${r.pdfs === 1 ? "PDF report" : `${r.pdfs} PDF reports`} will no longer match`);
  if (!parts.length) return null;
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}
