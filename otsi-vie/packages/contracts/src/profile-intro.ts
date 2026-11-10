/**
 * Player Profile Intro (ADR-130): the 16:9 opening segment of a generated highlight reel, automatically placed at the very beginning,
 * before the first football clip — and the preview of it in the Reel Builder. It shows the selected player's ACTUAL profile: the
 * identity from the one registry (ADR-016), the profile a person recorded (never guessed), and the engine's measured values only.
 * Anything not measured or not confirmed is null here and is shown as "Not measured" / "Unconfirmed" — never invented, never filled
 * from the design reference, never guessed from a name (ADR-124: unknown beats wrong).
 */
import { z } from "zod";
import { PlayerIdentity, PlayerProfile } from "./identity";
import { HeatZones } from "./pitch";

/** How long the rendered intro runs, in seconds (the worker's PROFILE_S is the same number). */
export const PROFILE_INTRO_S = 6;

/** The rule the "Player Identity Verified" badge is held to (ADR-130): the player is REGISTERED (his permanent OTSI Player ID issued),
 *  a person has confirmed at least one track as him in this organization, and — when the intro opens a reel — that reel's targets are
 *  still current (not stale). Anything less: no badge, and the intro says the identity is unconfirmed. */
export const PROFILE_INTRO_VERIFIED_RULE =
  "Player Identity Verified means: the player is registered with his permanent OTSI Player ID, a person confirmed at least one track as him, and (for a reel) the reel's targets are still current.";
export function introVerified(f: { registered: boolean; confirmed_tracks: number; reel_stale: boolean }): boolean {
  return f.registered && f.confirmed_tracks > 0 && !f.reel_stale;
}

/**
 * The intro's data, as the API assembles it (GET /v1/players/:id/profile-intro, optional ?reel_id= for the reel-aware badge).
 * Key Performance Stats come from his measured values only (PlayerMeasures, tracks a person confirmed as him):
 *   games_analysed = videos with a confirmed track; minutes_seen = minutes seen on camera (never "minutes played");
 *   goals = GOAL events on his confirmed tracks; assists = NOT measured — the engine does not link a pass to a goal (ADR-124:
 *   a chance created is a pass directly assisting a confirmed shot, which is not measured either). A stat is null where it is not
 *   measured, and `basis` names where each number came from.
 * Recent Form has no engine model behind it (there is no per-match rating), so it is always not measured until one exists.
 */
export const PlayerProfileIntro = z.object({
  player: PlayerIdentity,
  profile: PlayerProfile,
  verified: z.boolean(),
  verified_rule: z.string(),
  /** the reel this intro opens, when there is one; null = the standalone preview (then the badge needs no reel check) */
  reel_id: z.string().uuid().nullable(),
  stats: z.object({
    games_analysed: z.number().int().nullable(),
    minutes_seen: z.number().int().nullable(),
    goals: z.number().int().nullable(),
    assists: z.number().int().nullable(),
    basis: z.string(),
    assists_reason: z.string(),
  }),
  /** his heat map (measured positions only); null = not measured */
  heat: HeatZones.nullable(),
  /** the engine has no per-match rating model: always not measured, with the reason, until one exists */
  recent_form: z.object({ ratings: z.array(z.number()).nullable(), reason: z.string() }),
});
export type PlayerProfileIntro = z.infer<typeof PlayerProfileIntro>;

/**
 * What the API fixes into a render's snapshot as `profile` (the worker reads nothing else for the intro, like `overlay` for the
 * match card). Flat, JSON-only, no URLs: the photo is a storage key the worker resolves, the heat map is the measured grid.
 * `club_source` is the provenance of the club shown: ROSTER (a match team sheet, shown first) or USER_ENTERED (the person typed it).
 * The worker draws the badge only when `verified` is true — it never decides identity itself.
 */
export const ProfileIntroSnapshot = z.object({
  name: z.string(),
  number: z.number().int().nullable(),
  position: z.string().nullable(),
  otsi_id: z.string().nullable(),
  club: z.string().nullable(),
  club_source: z.enum(["ROSTER", "USER_ENTERED"]).nullable(),
  nationality: z.string().nullable(),
  age: z.number().int().nullable(),
  birth_date: z.string().nullable(),
  height_cm: z.number().int().nullable(),
  weight_kg: z.number().nullable(),
  foot: z.string().nullable(),
  games_analysed: z.number().int().nullable(),
  minutes_seen: z.number().int().nullable(),
  goals: z.number().int().nullable(),
  /** assists are never measured: always null here, and the worker writes "Not measured" */
  assists: z.null(),
  strengths: z.array(z.string()),
  summary: z.string().nullable(),
  league: z.string().nullable(),
  international: z.object({ country: z.string(), caps: z.number().int().nullable(), goals: z.number().int().nullable() }).nullable(),
  verified: z.boolean(),
  /** the photo file's storage key (`org/…/players/…`, assets.kind = 'PLAYER_PHOTO'); null = no photo entered */
  photo_key: z.string().nullable(),
  /** the measured heat grid, or null where nothing was measured */
  heat: z.object({ cols: z.number().int(), rows: z.number().int(), seconds: z.array(z.number()), length_m: z.number(), width_m: z.number() }).nullable(),
});
export type ProfileIntroSnapshot = z.infer<typeof ProfileIntroSnapshot>;

/** The render snapshot's `profile` from an assembled intro (pure, so the API and its tests share it). */
export function profileIntroSnapshot(intro: PlayerProfileIntro, photoKey: string | null): ProfileIntroSnapshot {
  const p = intro.profile, t = p.latest_team;
  const club = t?.team ?? p.details?.club_name ?? null;
  const country = p.details?.international_country_code
    ? { country: p.details.international_country_name ?? p.details.international_country_code,
        caps: p.details.international_caps, goals: p.details.international_goals }
    : null;
  return ProfileIntroSnapshot.parse({
    name: intro.player.display_name,
    number: t?.jersey_number ?? null,
    position: t?.position ?? p.position,
    otsi_id: intro.player.canonical_otsi_id,
    club,
    club_source: t?.team ? "ROSTER" : p.details?.club_name ? "USER_ENTERED" : null,
    nationality: p.nationality?.name ?? null,
    age: p.age,
    birth_date: p.birth_date,
    height_cm: p.details?.height_cm ?? null,
    weight_kg: p.details?.weight_kg ?? null,
    foot: p.preferred_foot,
    games_analysed: intro.stats.games_analysed,
    minutes_seen: intro.stats.minutes_seen,
    goals: intro.stats.goals,
    assists: null,
    strengths: p.details?.strengths ?? [],
    summary: p.details?.summary ?? null,
    league: p.details?.league ?? null,
    international: country,
    verified: intro.verified,
    photo_key: photoKey,
    heat: intro.heat ? { cols: intro.heat.cols, rows: intro.heat.rows, seconds: intro.heat.seconds, length_m: intro.heat.length_m, width_m: intro.heat.width_m } : null,
  });
}
