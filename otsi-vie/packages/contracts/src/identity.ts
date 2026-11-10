/**
 * Player identity contracts (ADR-016). Every response that identifies a player carries BOTH the internal `player_id`
 * (relational key) and the public permanent `canonical_otsi_id`, resolved from the one registry. Never a jersey number or
 * a track number in place of either.
 */
import { z } from "zod";

/** OTSI-CCC-YYYY-NNNNNN: exactly 20 characters, case-sensitive. */
export const CANONICAL_OTSI_ID_PATTERN = /^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$/;
export const CanonicalOtsiId = z.string().length(20).regex(CANONICAL_OTSI_ID_PATTERN, "not an OTSI Player ID (OTSI-CCC-YYYY-NNNNNN)");
export type CanonicalOtsiId = z.infer<typeof CanonicalOtsiId>;

export const CountryCode = z.string().regex(/^[A-Z]{3}$/, "3 capital letters (ISO 3166-1 alpha-3 or ENG/SCO/WAL/NIR)");

export const PlayerState = z.enum(["PROVISIONAL", "REGISTERED", "RETIRED", "MERGED"]);
export type PlayerState = z.infer<typeof PlayerState>;

/**
 * How a UI must present the record. A canonical ID is shown as the player's confirmed public ID only for REGISTERED_PLAYER
 * (and RETIRED_PLAYER); PROVISIONAL_PLAYER has no ID; MERGED_DUPLICATE shows the survivor's ID it resolves to.
 */
export const IdentityLabel = z.enum(["REGISTERED_PLAYER", "PROVISIONAL_PLAYER", "RETIRED_PLAYER", "MERGED_DUPLICATE"]);

export const PlayerIdentity = z.object({
  player_id: z.string().uuid(),
  /** the permanent public ID; for a merged duplicate, the survivor's; null while PROVISIONAL */
  canonical_otsi_id: CanonicalOtsiId.nullable(),
  /** this record's own ID (differs from canonical_otsi_id only for a merged duplicate) */
  own_canonical_otsi_id: CanonicalOtsiId.nullable(),
  canonical_state: PlayerState,
  resolved_player_id: z.string().uuid(),
  display_name: z.string(),
  identity_label: IdentityLabel,
});
export type PlayerIdentity = z.infer<typeof PlayerIdentity>;

export const PlayerFoot = z.enum(["LEFT", "RIGHT", "BOTH", "UNKNOWN"]);

export const CreatePlayerRequest = z.object({
  display_name: z.string().trim().min(2).max(255),
  birth_date: z.string().date().optional(),
  preferred_foot: PlayerFoot.optional(),
});
export type CreatePlayerRequest = z.infer<typeof CreatePlayerRequest>;

/** Registering issues the permanent ID. The year is the server's UTC year, never sent by the client. */
export const RegisterPlayerRequest = z.object({ country_code: CountryCode });
export type RegisterPlayerRequest = z.infer<typeof RegisterPlayerRequest>;

export const RoleConfirmationState = z.enum(["ROLE_PROVISIONAL", "ROLE_CONFIRMED"]);
export type RoleConfirmationState = z.infer<typeof RoleConfirmationState>;

/** What a person recorded about a player (owner 2026-11-02): never read from the video, never guessed; null = not recorded.
 *  The age is computed from the birth date. Only the organization that created the record may change it (the registry is shared).
 *  Tactical position/role confirmation is recorded per ADR-122: person-confirmed roles only are used in role filters. */
export const PlayerProfile = z.object({
  birth_date: z.string().nullable(),
  age: z.number().int().nullable(),
  preferred_foot: PlayerFoot.nullable(),
  nationality: z.object({ code: z.string(), name: z.string() }).nullable(),
  /** his usual position, recorded on the Players list (a team sheet's position for one match is shown first where there is one) */
  position: z.string().nullable(),
  role_confirmed: z.boolean().default(false),
  role_confirmation_state: RoleConfirmationState.default("ROLE_PROVISIONAL"),
  role_confirmed_by: z.string().nullable().default(null),
  role_confirmed_at: z.string().nullable().default(null),
  role_confirmed_by_name: z.string().nullable().optional(),
  /** his entry on this organization's latest match team sheet (team, shirt number, position), as recorded there; null = on none */
  latest_team: z.object({ team: z.string(), jersey_number: z.number().int().nullable(), position: z.string().nullable(), role_confirmed: z.boolean().optional() }).nullable(),
  /** the extra profile a person entered for the Player Profile Intro (ADR-130); null = nothing entered yet. Every field is user-entered:
   *  the intro marks it so, and nothing here is ever filled from a guess. */
  details: z.lazy(() => PlayerProfileDetails).nullable().default(null),
  editable: z.boolean(),
});
export type PlayerProfile = z.infer<typeof PlayerProfile>;

/**
 * The extra player profile for the Player Profile Intro (ADR-130, migration 0067): the fields the reference layout shows that the
 * engine does not measure — height and weight, a photo, strengths, a summary, the current club and league, and the international
 * career. All of it is USER_ENTERED: a person typed it, it is shown as such, and a field left empty stays empty ("Not measured" /
 * "Unconfirmed" in the intro), never filled from the reference image or a guess. One row per player (`player_profile_details`).
 * The photo is an asset (`assets.kind = 'PLAYER_PHOTO'`); `photo_url` is a short-lived signed read URL, null when there is no photo.
 */
export const PlayerProfileDetails = z.object({
  height_cm: z.number().int().min(100).max(250).nullable(),
  weight_kg: z.number().min(30).max(200).nullable(),
  /** the photo asset's id; null = no photo entered */
  photo_asset_id: z.string().uuid().nullable(),
  photo_url: z.string().nullable(),
  /** his strengths, in the order the person wrote them; at most 6, each at most 60 characters */
  strengths: z.array(z.string().trim().min(1).max(60)).max(6),
  /** his summary, in the person's words; at most 600 characters */
  summary: z.string().trim().max(600).nullable(),
  /** the current club as the person entered it; used only where no match team sheet names one (the team sheet is shown first) */
  club_name: z.string().trim().max(255).nullable(),
  /** the league his club plays in, as the person entered it */
  league: z.string().trim().max(255).nullable(),
  /** his international career, as the person entered it; caps and goals null = not entered (never 0 by default: 0 caps is a fact) */
  international_country_code: z.string().nullable(),
  international_country_name: z.string().nullable(),
  international_caps: z.number().int().min(0).nullable(),
  international_goals: z.number().int().min(0).nullable(),
  /** who entered it last, and when (provenance: user-entered, never engine output) */
  updated_by_name: z.string().nullable(),
  updated_at: z.string().nullable(),
});
export type PlayerProfileDetails = z.infer<typeof PlayerProfileDetails>;

/** A row of the Players list: who, and what is recorded about him */
export const PlayerListEntry = z.object({
  player_id: z.string().uuid(),
  display_name: z.string(),
  canonical_otsi_id: z.string().nullable(),
  profile: PlayerProfile,
});
export type PlayerListEntry = z.infer<typeof PlayerListEntry>;

/** A field left out is unchanged; null clears it. confirm_role marks role explicitly confirmed by an analyst. */
export const UpdatePlayerProfileRequest = z.object({
  birth_date: z.string().date().nullable().optional(),
  preferred_foot: PlayerFoot.nullable().optional(),
  nationality: CountryCode.nullable().optional(),
  position: z.enum(["GK", "RB", "CB", "LB", "RWB", "LWB", "DM", "CM", "AM", "RM", "LM", "RW", "LW", "CF", "ST", "DF", "MF", "FW"]).nullable().optional(),
  confirm_role: z.boolean().optional(),
});
export type UpdatePlayerProfileRequest = z.infer<typeof UpdatePlayerProfileRequest>;

/** The extra profile for the Player Profile Intro (ADR-130): a field left out is unchanged; null clears it. Every value is user-entered
 *  (provenance USER_ENTERED); the API never fills one from a guess, and the intro shows unentered fields as unentered. */
export const UpdatePlayerProfileDetailsRequest = z.object({
  height_cm: z.number().int().min(100).max(250).nullable().optional(),
  weight_kg: z.number().min(30).max(200).nullable().optional(),
  strengths: z.array(z.string().trim().min(1).max(60)).max(6).nullable().optional(),
  summary: z.string().trim().max(600).nullable().optional(),
  club_name: z.string().trim().max(255).nullable().optional(),
  league: z.string().trim().max(255).nullable().optional(),
  international_country_code: CountryCode.nullable().optional(),
  international_caps: z.number().int().min(0).nullable().optional(),
  international_goals: z.number().int().min(0).nullable().optional(),
});
export type UpdatePlayerProfileDetailsRequest = z.infer<typeof UpdatePlayerProfileDetailsRequest>;

export const Country = z.object({ code: z.string(), name: z.string() });
export type Country = z.infer<typeof Country>;

export const MergePlayersRequest = z.object({
  into_player_id: z.string().uuid(),
  reason: z.string().trim().min(3).max(4000),
  evidence_id: z.string().uuid().optional(),
});
export type MergePlayersRequest = z.infer<typeof MergePlayersRequest>;

export const TrackDecisionState = z.enum(["UNRESOLVED", "CANDIDATE", "CONFIRMED", "REJECTED", "CONFLICT"]);

/** What an overlay may show for a track: a confirmed player, or "Unidentified Player" with the temporary track reference. */
export const TrackIdentity = z.object({
  track_id: z.string().uuid(),
  decision_id: z.string().uuid().nullable(),
  state: TrackDecisionState,
  player: PlayerIdentity.nullable(),
  display: z.object({
    kind: z.enum(["IDENTIFIED", "UNIDENTIFIED"]),
    label: z.string(),
  }),
});
export type TrackIdentity = z.infer<typeof TrackIdentity>;

/** v3 B.6 (ADR-084): every identity decision on a track, newest first: who decided what, when, on what basis and why (never rewritten) */
export const IdentityHistoryEntry = z.object({
  decision_id: z.string().uuid(),
  state: TrackDecisionState,
  player: z.object({ player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable() }).nullable(),
  basis: z.enum(["HUMAN", "AUTO_POLICY", "REGISTRY"]),
  decided_by: z.object({ user_id: z.string().uuid(), name: z.string() }).nullable(),
  decided_at: z.string(),
  reason: z.string().nullable(),
  /** this decision is the track's identity now (the others were superseded) */
  current: z.boolean(),
  supersedes_id: z.string().uuid().nullable(),
});
export type IdentityHistoryEntry = z.infer<typeof IdentityHistoryEntry>;

export const IdentityDecisionRequest = z.object({
  state: TrackDecisionState,
  player_id: z.string().uuid().nullable(),
  /** the decision this one corrects; required to change an existing identity (history is appended, never rewritten) */
  supersedes_id: z.string().uuid().nullable().default(null),
  reason: z.string().trim().max(4000).nullable().default(null),
  evidence_id: z.string().uuid().nullable().default(null),
});
export type IdentityDecisionRequest = z.infer<typeof IdentityDecisionRequest>;

/** One error shape for every API failure. `code` is stable and machine-readable; `message` is for people. */
export const Problem = z.object({ code: z.string(), message: z.string(), request_id: z.string() });
export type Problem = z.infer<typeof Problem>;

export function identityLabel(own: PlayerState): z.infer<typeof IdentityLabel> {
  switch (own) {
    case "REGISTERED": return "REGISTERED_PLAYER";
    case "RETIRED": return "RETIRED_PLAYER";
    case "MERGED": return "MERGED_DUPLICATE";
    default: return "PROVISIONAL_PLAYER";
  }
}
