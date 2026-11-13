/**
 * Analysis runs, playback and tracking results (Blocks 04-06). Everything is what the engine recorded; nothing is interpolated.
 * Times are microseconds since the video's first frame (the one media clock of detections, tracks and the playback copy).
 * A track is a temporary reference inside one run ("track 7"); it carries no identity unless a CONFIRMED decision names a player.
 */
import { z } from "zod";

export const StepStatus = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED", "REVIEW_REQUIRED"]);

/**
 * Analysis profiles (ADR-034). They differ in how the footage is examined, never in what counts as evidence for an identity:
 * every profile keeps the same identity rules (only a person's confirmation names a player).
 *  - STANDARD         broadcast-like footage: 2 frames/s, full frame + 2x2 tiles.
 *  - HIGH_ACCURACY    poorer footage (compression, blur, shake, low light): 6 frames/s, distance-aware association, camera-motion compensation.
 *  - ULTRA_SENSITIVE  grassroots footage with tiny, distant players: 6 frames/s, multi-scale (full frame + 2x2 + 3x3 overlapping tiles,
 *                     small tiles enlarged to the detector's input), low-confidence boxes kept as CANDIDATES that only become part of a
 *                     track after temporal confirmation (several hits and at least one confident detection), touchline-aware pitch filter,
 *                     camera-motion compensation.
 *                     Recall is raised by looking harder and confirming over time — not by accepting weak single detections.
 */
export const AnalysisProfile = z.enum(["STANDARD", "HIGH_ACCURACY", "ULTRA_SENSITIVE"]);
export type AnalysisProfile = z.infer<typeof AnalysisProfile>;

export interface ProfileSpec {
  label: string;
  summary: string;
  sample_fps: number;
  /** tile grids added to the full-frame pass: [2] = 2x2; [2, 3] = 2x2 and 3x3 */
  grids: number[];
  /** detector output kept (as raw evidence and as candidates for association) */
  score_floor: number;
  /** kit_gate: a track may not take a box whose shirt colour clearly differs from its own (0.7 measured: mixed light/dark-shirt tracks 17% -> 8%) */
  tracker: { high: number; low: number; min_hits: number; distance_weight: number; kit_gate?: number };
  /** a track is kept only with this many detections and at least one at or above min_peak (temporal confirmation) */
  confirm: { min_hits: number; min_peak: number };
  /** pitch filter: STRICT = feet on grass; TOUCHLINE = also feet within a small margin of the grass edge */
  pitch: "STRICT" | "TOUCHLINE";
  /** compensate camera pans and shake between analysed frames (global motion by phase correlation) before associating boxes */
  stabilize: boolean;
}

export const PROFILES: Record<AnalysisProfile, ProfileSpec> = {
  STANDARD: { label: "Standard", summary: "Fewer passes, faster results", sample_fps: 2, grids: [2], score_floor: 0.2,
    tracker: { high: 0.5, low: 0.15, min_hits: 2, distance_weight: 0, kit_gate: 0.7 }, confirm: { min_hits: 2, min_peak: 0.5 }, pitch: "STRICT", stabilize: false },
  HIGH_ACCURACY: { label: "High Accuracy", summary: "Extra tracking and identity passes", sample_fps: 6, grids: [2], score_floor: 0.2,
    tracker: { high: 0.5, low: 0.15, min_hits: 2, distance_weight: 0.3, kit_gate: 0.7 }, confirm: { min_hits: 3, min_peak: 0.5 }, pitch: "STRICT", stabilize: true },
  ULTRA_SENSITIVE: { label: "Ultra-Sensitive", summary: "Distant or small players, slowest", sample_fps: 6, grids: [2, 3], score_floor: 0.1,
    tracker: { high: 0.4, low: 0.1, min_hits: 3, distance_weight: 0.4 }, confirm: { min_hits: 4, min_peak: 0.4 }, pitch: "TOUCHLINE", stabilize: true },
};

/** detector passes per analysed frame: the full frame plus every tile */
export const passesPerFrame = (grids: number[]) => 1 + grids.reduce((n, g) => n + g * g, 0);

export const CreateAnalysisRequest = z.object({
  /** the analysis profile (default STANDARD); the fields below override single settings of it */
  profile: AnalysisProfile.default("STANDARD"),
  /** frames analysed per second of video (cost scales with it) */
  sample_fps: z.number().min(0.5).max(10).optional(),
  /** legacy: 1 = full frame only, 2 = full frame + 2x2 tiles (overrides the profile's grids) */
  tiles: z.union([z.literal(1), z.literal(2)]).optional(),
  /** registered detector key; default = the registry default */
  detector: z.string().regex(/^[a-z0-9_]{3,64}$/).optional(),
  /** re-track: id of an earlier FINISHED run of the same video whose saved detections are tracked again (no detector run); the new run
   *  keeps that run's sampling and settings, with the current pitch filter, tracking and kit grouping */
  retrack_from: z.string().uuid().optional(),
  /** the moment (microseconds) where the two teams stand on separate halves (the kickoff): the engine reads both shirt colours there and from then on never gives a box of one team to a track of the other */
  team_seed_pts_us: z.number().int().min(0).optional(),
});
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequest>;

export const QualityIssue = z.object({ code: z.string(), text: z.string() });

/** A footage-quality assessment (ADR-034): measurements on sampled frames, a recommended profile and per-profile estimates. */
export const QualityAssessment = z.object({
  id: z.string().uuid(),
  video_id: z.string().uuid(),
  status: z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]),
  recommended_profile: AnalysisProfile.nullable(),
  metrics: z.record(z.unknown()).nullable(),
  issues: z.array(QualityIssue),
  /** per profile: estimated processing time and peak memory, from the measured detector cost on this footage (estimates) */
  estimates: z.array(z.object({ profile: AnalysisProfile, frames: z.number().int(), passes_per_frame: z.number().int(), seconds: z.number().nullable(), peak_memory_mb: z.number().nullable() })),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export type QualityAssessment = z.infer<typeof QualityAssessment>;

export const AnalysisRun = z.object({
  id: z.string().uuid(),
  video_id: z.string().uuid(),
  status: StepStatus,
  config: z.object({ sample_fps: z.number(), tiles: z.number(), detector: z.string().nullable(), profile: AnalysisProfile.nullable(), grids: z.array(z.number().int()), team_seed_pts_us: z.number().int().nullable().optional() }),
  steps: z.array(z.object({ name: z.string(), status: StepStatus, progress: z.number(), error_code: z.string().nullable() })),
  /** measured by the worker when the run finished */
  result: z.record(z.unknown()).nullable(),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  job: z.object({ state: z.string(), progress: z.number(), stage_message: z.string().nullable() }).nullable(),
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});
export type AnalysisRun = z.infer<typeof AnalysisRun>;

export const TrackIdentityState = z.enum(["UNRESOLVED", "CANDIDATE", "CONFIRMED", "REJECTED", "CONFLICT"]);

export const TrackSummary = z.object({
  track_id: z.string().uuid(),
  track_number: z.number().int().positive(),
  class_name: z.enum(["PERSON", "PLAYER", "GOALKEEPER", "REFEREE", "BALL", "OTHER"]),
  shot_number: z.number().int().positive().nullable(),
  first_pts_us: z.number().int(),
  last_pts_us: z.number().int(),
  observation_count: z.number().int(),
  mean_confidence: z.number().nullable(),
  identity_state: TrackIdentityState,
  /** what an overlay may say: a confirmed player's name and OTSI Player ID, or "Unidentified person · track N" */
  label: z.string(),
  canonical_otsi_id: z.string().nullable(),
  /** the confirmed player's line for the identity row (SOT Analysis): shirt number, position and club, from the
   *  latest roster row in this organisation (the match team sheet first, the player's usual position where the sheet
   *  has none). Nulls when nothing is recorded — never guessed. */
  jersey_number: z.number().int().nullable(),
  position: z.string().nullable(),
  club: z.string().nullable(),
  /** appearance evidence (ADR-031): a colour cluster within this run (NOT a team name), the dominant kit colour, and whether the track's
   *  appearance changed so much between its start and end that it may contain two people (review before using it) */
  kit_group: z.number().int().nullable().optional(),
  kit_rgb: z.string().nullable().optional(),
  possible_identity_switch: z.boolean().optional(),
  has_thumbnail: z.boolean().optional(),
  /** same-person suggestions still waiting for a decision, and confirmed links */
  links_proposed: z.number().int().optional(),
  links_confirmed: z.number().int().optional(),
  /** evidence profile (ADR-034): strongest detection, typical height in source pixels, share of low-confidence (< 0.5) detections kept
   *  by temporal confirmation, and the shirt-number reading state */
  evidence: z.object({ peak_confidence: z.number().nullable(), mean_height_px: z.number().nullable(), low_confidence_share: z.number().nullable(),
    shirt_number_state: z.string().nullable() }).optional(),
});
export type TrackSummary = z.infer<typeof TrackSummary>;

export const LinkState = z.enum(["PROPOSED", "CONFIRMED", "REJECTED", "UNRESOLVED"]);

/** A suggestion that two tracks show the same person (across an occlusion or a camera cut). Evidence only: a person decides. */
export const TrackLink = z.object({
  link_id: z.string().uuid(),
  /** the other track is BEFORE or AFTER this one in time (they never overlap) */
  direction: z.enum(["before", "after"]),
  other: z.object({
    track_id: z.string().uuid(),
    track_number: z.number().int(),
    first_pts_us: z.number().int(),
    last_pts_us: z.number().int(),
    label: z.string(),
    identity_state: TrackIdentityState,
    /** the player CONFIRMED on the other track, if any: the basis of an identity suggestion */
    confirmed_player: z.object({ player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable() }).nullable(),
    kit_rgb: z.string().nullable(),
    has_thumbnail: z.boolean(),
  }),
  /** ranking score 0..1 (appearance + kit colour); not a calibrated probability */
  score: z.number(),
  crosses_cut: z.boolean(),
  gap_us: z.number().int(),
  state: LinkState,
  decision_id: z.string().uuid().nullable(),
});
export type TrackLink = z.infer<typeof TrackLink>;

/** Tracks anywhere in the run that LOOK like this person (appearance embeddings, ADR-031): gathered from every track already confirmed as
 * the same player (or this track alone), without tracks on screen at the same time as one of his (they cannot be him), tracks a person
 * marked "not him", and tracks confirmed as someone. Evidence only: "This is him" is an identity decision a person makes per track. */
export const LookAlikes = z.object({
  track_id: z.string().uuid(),
  player: z.object({ player_id: z.string().uuid(), display_name: z.string() }).nullable(),
  /** how many of his tracks the search started from */
  seeds: z.number().int(),
  items: z.array(z.object({
    other: TrackLink.shape.other,
    /** the best appearance similarity to any of his tracks (cosine, 0..1); not a probability */
    similarity: z.number(),
    /** how many of his tracks this one resembles */
    resembles: z.number().int(),
    /** shirt-colour similarity to the most alike of his tracks (0..1) */
    kit_similarity: z.number(),
    /** the ranking: similarity weighted by shirt colour (ADR-045); not a probability */
    score: z.number(),
  })),
  /** look-alikes left after this page (they come up as the person decides these) */
  more: z.number().int(),
});
export type LookAlikes = z.infer<typeof LookAlikes>;

export const LinkDecisionRequest = z.object({
  state: z.enum(["CONFIRMED", "REJECTED", "UNRESOLVED"]),
  /** the current decision this one replaces (null for the first decision); a replacement needs a reason */
  supersedes_id: z.string().uuid().nullable().default(null),
  reason: z.string().trim().max(4000).nullable().default(null),
});
export type LinkDecisionRequest = z.infer<typeof LinkDecisionRequest>;

/** Tracks joined by CONFIRMED same-person links (one person across occlusions and cuts), in time order, with their identities. */
export const PersonGroup = z.object({
  track_ids: z.array(z.string().uuid()),
  tracks: z.array(z.object({ track_id: z.string().uuid(), track_number: z.number().int(), first_pts_us: z.number().int(), last_pts_us: z.number().int(),
    identity_state: TrackIdentityState, player_id: z.string().uuid().nullable() })),
  /** distinct players CONFIRMED on tracks of the group: more than one means the group or a decision is wrong (shown as a conflict) */
  confirmed_player_ids: z.array(z.string().uuid()),
});
export type PersonGroup = z.infer<typeof PersonGroup>;

export const Observation = z.object({
  track_id: z.string().uuid(),
  track_number: z.number().int().positive(),
  class_name: z.string(),
  pts_us: z.number().int(),
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  score: z.number().nullable(),
  /** the track's shirt-colour group (0, 1 team colours; 2 officials), null when not measured: the box colour, independent of the (capped) track list */
  kit_group: z.number().int().nullable().optional(),
  /** where the person's feet are on the pitch, metres from the centre spot: only where the pitch was calibrated and measured at that moment, else null (not measured) */
  pitch_x: z.number().nullable().optional(),
  pitch_y: z.number().nullable().optional(),
});
export type Observation = z.infer<typeof Observation>;

export const ObservationWindow = z.object({
  from_us: z.number().int(),
  to_us: z.number().int(),
  observations: z.array(Observation),
  /** shot boundaries in the window: boxes never continue across them */
  shots: z.array(z.object({ shot_number: z.number().int(), start_pts_us: z.number().int(), end_pts_us: z.number().int() })),
  /** the pitch calibration samples covering the window: `H` maps pitch metres (centre spot origin) to the normalised picture of that
   * moment. The video pages use them to draw pitch-placed overlays (trails, team shapes, heat, pass arrows) on the moving camera picture;
   * a moment no sample covers has no such overlay. */
  calibrations: z.array(z.object({ start_us: z.number().int(), end_us: z.number().int(), H: z.array(z.array(z.number()).length(3)).length(3),
    length_m: z.number(), width_m: z.number(), quality: z.number() })).default([]),
});
export type ObservationWindow = z.infer<typeof ObservationWindow>;

export const Playback = z.object({
  available: z.boolean(),
  /** short-lived signed URL of the playback copy (WebM VP9/Opus) */
  url: z.string().nullable(),
  mime: z.string().nullable(),
  expires_at: z.string().nullable(),
  /** why there is no playback yet */
  reason: z.string().nullable(),
});
export type Playback = z.infer<typeof Playback>;
