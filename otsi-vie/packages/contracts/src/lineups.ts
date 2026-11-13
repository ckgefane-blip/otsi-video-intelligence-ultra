/**
 * Broadcast lineup cards (ADR-039, migration 0029): the team sheets a video shows, read by the engine, approved by a person into the match
 * roster. A card is evidence; only the approval creates the match, the clubs, the players (or finds them in the registry) and the roster.
 */
import { z } from "zod";
import { Match } from "./matches";

export const LineupEntry = z.object({
  number: z.string(),
  name: z.string(),
  role: z.enum(["STARTER", "SUBSTITUTE"]),
  confidence: z.number(),
});
export type LineupEntry = z.infer<typeof LineupEntry>;

export const LineupCard = z.object({
  id: z.string().uuid(),
  pts_us: z.number().int(),
  team_name: z.string().nullable(),
  coach_name: z.string().nullable(),
  entries: z.array(LineupEntry),
  has_image: z.boolean(),
  state: z.enum(["PROPOSED", "APPLIED", "DISMISSED"]),
  applied_match_id: z.string().uuid().nullable(),
  applied_club_id: z.string().uuid().nullable(),
});
export type LineupCard = z.infer<typeof LineupCard>;

export const Lineups = z.object({
  video_id: z.string().uuid(),
  /** the latest read of this video; null when it was never read */
  read: z.object({
    id: z.string().uuid(),
    status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]),
    automatic: z.boolean(),
    progress: z.number().nullable(),
    stage_message: z.string().nullable(),
    metrics: z.record(z.string(), z.unknown()).nullable(),
    failure_detail: z.string().nullable(),
  }).nullable(),
  cards: z.array(LineupCard),
  /** the match the video is linked to, if any: applying a card fills that match's roster */
  match_id: z.string().uuid().nullable(),
});
export type Lineups = z.infer<typeof Lineups>;

/** A person's approval: each card with its side, the team name and the rows as corrected (rows left out are not used). */
export const ApplyLineups = z.object({
  cards: z.array(z.object({
    card_id: z.string().uuid(),
    side: z.enum(["HOME", "AWAY"]),
    team_name: z.string().trim().min(2).max(255),
    entries: z.array(z.object({
      number: z.number().int().min(0).max(99),
      name: z.string().trim().min(2).max(255),
      role: z.enum(["STARTER", "SUBSTITUTE"]),
    })).min(1).max(40),
  })).min(1).max(2),
});
export type ApplyLineups = z.infer<typeof ApplyLineups>;

export const AppliedLineups = z.object({
  match: Match,
  rows: z.array(z.object({
    card_id: z.string().uuid(),
    number: z.number().int(),
    name: z.string(),
    player_id: z.string().uuid().nullable(),
    /** FOUND: an existing player of that name (exactly, or the same name in another alphabet or spelling: see message); CREATED: a new
     * provisional player; FAILED: see message */
    outcome: z.enum(["FOUND", "CREATED", "FAILED"]),
    message: z.string().nullable(),
  })),
});
export type AppliedLineups = z.infer<typeof AppliedLineups>;

/** Rejecting (dismissing) one card: the reason is optional on the wire — the Analysis page dismisses with one click — but the
 *  review inbox asks for it, because decisions are logged with a reason. It is stored on the audit row. */
export const DismissLineupCard = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type DismissLineupCard = z.infer<typeof DismissLineupCard>;

const CYR: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", ґ: "g", д: "d", е: "e", ё: "e", є: "e", ж: "zh", з: "z", и: "i", і: "i", ї: "i", й: "i", к: "k",
  л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ў: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh", ъ: "", ы: "i", ь: "",
  э: "e", ю: "iu", я: "ia", ј: "i", љ: "l", њ: "n", ћ: "c", ђ: "d", џ: "dz" };

/**
 * One spelling key for a person's name in any alphabet: Cyrillic transliterated, accents dropped, common spelling variants folded
 * (w/v, y/j/i, kh/h, ph/f, x/ks, ts/c, doubled letters), word order ignored ("ЧИНАЗОМ ГОДВИН" = "Chinazom Godwin" = "Godwin Chinazom").
 * Two names with the same key are spellings of one name, not a guess about similar names.
 */
export function nameKey(name: string): string {
  const latin = [...name.normalize("NFKD").toLowerCase()].map((ch) => CYR[ch] ?? ch).join("").replace(/[\u0300-\u036f]/g, "");
  return latin.split(/[^a-z]+/).filter(Boolean).map((w) => w
    .replace(/ph/g, "f").replace(/kh/g, "h").replace(/x/g, "ks").replace(/ts/g, "c").replace(/w/g, "v").replace(/[yj]/g, "i").replace(/(.)\1+/g, "$1"))
    .sort().join(" ");
}
