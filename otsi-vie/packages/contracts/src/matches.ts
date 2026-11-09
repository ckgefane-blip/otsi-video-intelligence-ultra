/**
 * Matches, clubs, rosters, team identity, shirt-number evidence and combined identity candidates (Block 07, ADR-033).
 * None of these is an identity: the permanent canonical OTSI Player ID comes only from the player registry and CONFIRMED decisions.
 */
import { z } from "zod";

export const Club = z.object({ id: z.string().uuid(), name: z.string(), short_name: z.string().nullable(), shared: z.boolean() });
export type Club = z.infer<typeof Club>;
export const CreateClubRequest = z.object({ name: z.string().trim().min(2).max(255), short_name: z.string().trim().max(32).optional() });
export type CreateClubRequest = z.infer<typeof CreateClubRequest>;

export const RosterRole = z.enum(["STARTER", "SUBSTITUTE"]);
export const Position = z.enum(["GK", "RB", "CB", "LB", "RWB", "LWB", "DM", "CM", "AM", "RM", "LM", "RW", "LW", "CF", "ST", "DF", "MF", "FW"]);

export const RosterEntry = z.object({
  player_id: z.string().uuid(),
  display_name: z.string(),
  /** the permanent ID when the player is registered; null for a provisional record (never a shirt number) */
  canonical_otsi_id: z.string().nullable(),
  club_id: z.string().uuid(),
  jersey_number: z.number().int().min(0).max(99).nullable(),
  role: RosterRole,
  position: Position.nullable(),
  captain: z.boolean(),
  verified: z.boolean(),
  verified_at: z.string().nullable(),
});
export type RosterEntry = z.infer<typeof RosterEntry>;

export const Match = z.object({
  id: z.string().uuid(),
  competition: z.string().nullable(),
  season: z.string().nullable(),
  kickoff_at: z.string().nullable(),
  venue: z.string().nullable(),
  home: Club.nullable(),
  away: Club.nullable(),
  home_score: z.number().int().nullable(),
  away_score: z.number().int().nullable(),
  version: z.number().int(),
  video_ids: z.array(z.string().uuid()),
  roster: z.array(RosterEntry),
});
export type Match = z.infer<typeof Match>;

export const CreateMatchRequest = z.object({
  home_club_id: z.string().uuid(),
  away_club_id: z.string().uuid(),
  competition: z.string().trim().max(255).optional(),
  season: z.string().trim().max(64).optional(),
  kickoff_at: z.string().datetime({ offset: true }).optional(),
  venue: z.string().trim().max(255).optional(),
  /** link this video to the match at once */
  video_id: z.string().uuid().optional(),
}).refine((m) => m.home_club_id !== m.away_club_id, { message: "home and away must be different clubs" });
export type CreateMatchRequest = z.infer<typeof CreateMatchRequest>;

export const UpdateMatchRequest = z.object({
  version: z.number().int().positive(),
  competition: z.string().trim().max(255).nullable().optional(),
  season: z.string().trim().max(64).nullable().optional(),
  kickoff_at: z.string().datetime({ offset: true }).nullable().optional(),
  venue: z.string().trim().max(255).nullable().optional(),
  home_score: z.number().int().min(0).max(99).nullable().optional(),
  away_score: z.number().int().min(0).max(99).nullable().optional(),
});
export type UpdateMatchRequest = z.infer<typeof UpdateMatchRequest>;

export const RosterUpsertRequest = z.object({
  player_id: z.string().uuid(),
  club_id: z.string().uuid(),
  jersey_number: z.number().int().min(0).max(99).nullable().default(null),
  role: RosterRole.default("STARTER"),
  position: Position.nullable().default(null),
  captain: z.boolean().default(false),
  /** why an existing entry is changed or removed (kept in the roster history) */
  reason: z.string().trim().max(2000).nullable().default(null),
});
export type RosterUpsertRequest = z.infer<typeof RosterUpsertRequest>;

export const RosterChange = z.object({
  id: z.string().uuid(),
  player_id: z.string().uuid(),
  display_name: z.string(),
  action: z.enum(["ADDED", "UPDATED", "REMOVED", "VERIFIED", "UNVERIFIED"]),
  before: z.record(z.unknown()).nullable(),
  after: z.record(z.unknown()).nullable(),
  changed_by: z.string(),
  reason: z.string().nullable(),
  changed_at: z.string(),
});
export type RosterChange = z.infer<typeof RosterChange>;

/** A colour cluster of one analysis run and the team a PERSON assigned to it (colour similarity alone proves nothing). */
export const KitGroup = z.object({
  kit_group: z.number().int(),
  kit_rgb: z.string().nullable(),
  tracks: z.number().int(),
  /** the confirmed match team, or null = "not a team" (referees, staff); undefined assignment = not decided yet */
  assignment: z.object({ assignment_id: z.string().uuid(), club_id: z.string().uuid().nullable(), club_name: z.string().nullable() }).nullable(),
  /** up to 8 typical people of the group to show a person: the longest-followed tracks with a picture, spread over the video */
  sample_track_ids: z.array(z.string().uuid()).default([]),
});
export type KitGroup = z.infer<typeof KitGroup>;

export const TeamAssignmentRequest = z.object({
  club_id: z.string().uuid().nullable(),
  supersedes_id: z.string().uuid().nullable().default(null),
  reason: z.string().trim().max(2000).nullable().default(null),
});
export type TeamAssignmentRequest = z.infer<typeof TeamAssignmentRequest>;

export const JerseyState = z.enum(["RECOGNIZED", "UNCERTAIN", "UNREADABLE", "TOO_SMALL"]);

export const JerseyEvidence = z.object({
  track_id: z.string().uuid(),
  state: JerseyState,
  number: z.string().nullable(),
  confidence: z.number().nullable(),
  side: z.enum(["BACK", "FRONT", "UNKNOWN"]),
  candidate_frames: z.number().int(),
  /** every frame that was read: when, what, how sure */
  frames: z.array(z.object({ pts_us: z.number().int(), number: z.string().nullable(), confidence: z.number(), texts: z.array(z.string()) })),
  alternatives: z.array(z.object({ number: z.string(), frames: z.number().int(), confidence: z.number() })),
  /** a person's verdict, if any */
  decision: z.object({ decision_id: z.string().uuid(), state: z.enum(["CONFIRMED", "UNREADABLE"]), number: z.string().nullable() }).nullable(),
});
export type JerseyEvidence = z.infer<typeof JerseyEvidence>;

export const JerseyDecisionRequest = z.object({
  state: z.enum(["CONFIRMED", "UNREADABLE"]),
  number: z.string().regex(/^\d{1,2}$/).nullable().default(null),
  supersedes_id: z.string().uuid().nullable().default(null),
  reason: z.string().trim().max(2000).nullable().default(null),
}).refine((d) => d.state !== "CONFIRMED" || d.number !== null, { message: "a confirmed shirt number needs the number" });
export type JerseyDecisionRequest = z.infer<typeof JerseyDecisionRequest>;

/** One piece of evidence for (or against) a candidate player. `kind` says where it comes from; correlated kinds are not added up. */
export const CandidateSignal = z.object({
  kind: z.enum(["SHIRT_NUMBER", "CONFIRMED_LINK", "SUGGESTED_LINK", "LOOK_ALIKE", "TEAM", "CONFLICT"]),
  detail: z.string(),
  weight: z.number(),
});

export const IdentityCandidate = z.object({
  player_id: z.string().uuid(),
  display_name: z.string(),
  canonical_otsi_id: z.string().nullable(),
  /** ranking strength 0..1 from the listed signals; NOT a probability, NOT a decision */
  strength: z.number(),
  signals: z.array(CandidateSignal),
  conflicts: z.array(z.string()),
});
export type IdentityCandidate = z.infer<typeof IdentityCandidate>;

/** The kit groups of one analysis run, with the match (if the video is linked to one) whose two teams they can be assigned to. */
export const RunTeams = z.object({
  run_id: z.string().uuid(),
  match_id: z.string().uuid().nullable(),
  teams: z.array(Club),
  roster_verified: z.boolean(),
  groups: z.array(KitGroup),
});
export type RunTeams = z.infer<typeof RunTeams>;

/** What the engine and people know about one track's identity, for review: shirt number, team, candidates. Never a decision. */
export const TrackCandidates = z.object({
  track_id: z.string().uuid(),
  match_id: z.string().uuid().nullable(),
  team: Club.nullable(),
  shirt_number: z.object({ number: z.string(), source: z.enum(["CONFIRMED", "RECOGNIZED", "UNCERTAIN"]) }).nullable(),
  candidates: z.array(IdentityCandidate),
});
export type TrackCandidates = z.infer<typeof TrackCandidates>;

/**
 * Tracks the engine can name from a shirt number and the match roster (ADR-039): every person track of the run with a number read (or
 * confirmed by a person), the team of its kit colour group, and the roster player wearing that number for that team. `accept` is the
 * engine's default tick for bulk acceptance: only a clear reading with a known team and no conflict is ticked. Nothing is decided here.
 */
export const NumberProposal = z.object({
  track_id: z.string().uuid(),
  track_number: z.number().int(),
  first_pts_us: z.number().int(),
  last_pts_us: z.number().int(),
  has_thumbnail: z.boolean(),
  shirt: z.object({ number: z.string(), source: z.enum(["CONFIRMED", "RECOGNIZED", "UNCERTAIN"]), confidence: z.number().nullable() }),
  team: z.object({ club_id: z.string().uuid(), name: z.string(), from: z.enum(["KIT", "ROSTER"]) }).nullable(),
  player: z.object({ player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable() }).nullable(),
  /** why it is not ticked, or why there is no player: team unknown, number not on the roster, on screen with another track proposed as him */
  note: z.string().nullable(),
  accept: z.boolean(),
});
export type NumberProposal = z.infer<typeof NumberProposal>;

export const NumberProposals = z.object({
  run_id: z.string().uuid(),
  match_id: z.string().uuid().nullable(),
  /** kit groups without a team decision: assigning them makes more proposals certain */
  kits_unassigned: z.number().int(),
  proposals: z.array(NumberProposal),
});
export type NumberProposals = z.infer<typeof NumberProposals>;

/** The players named on at least one track of a run, with how many tracks and one of them (the start of a look-alike search). */
export const NamedPlayers = z.array(z.object({
  player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable(), tracks: z.number().int(), track_id: z.string().uuid(),
}));
export type NamedPlayers = z.infer<typeof NamedPlayers>;
