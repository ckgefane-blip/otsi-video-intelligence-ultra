/**
 * Reel Builder and rendering (Blocks 10-11, ADR-032). A reel follows ONE player a person confirmed; it is assembled by the user (clips with
 * in/out points, in order) and rendered by the worker into a validated MP4 with the cinematic spotlight. The spotlight only follows
 * positions that were detected (or interpolated between nearby detections, and labelled so); where the player was not seen there is no
 * spotlight. Times are microseconds on the source video's media clock (pts_us).
 */
import { z } from "zod";
import { PlayerProfile } from "./identity";
import { ClipEffect, NO_EFFECT } from "./retime";
import { CandidateKey, ReelStructure, ReelTheme } from "./assembly";
import { ClipFx, Look, NEUTRAL_LOOK, NO_FX } from "./look";

export const ReelAspect = z.enum(["16:9", "9:16", "1:1", "4:5"]);
export type ReelAspectT = z.infer<typeof ReelAspect>;
/** ADR-080: the frame's width / height for the cropped frames (16:9 keeps the source picture); the same numbers as render/reel.py ASPECT_RATIO */
export const ASPECT_RATIO: Record<ReelAspectT, number | null> = { "16:9": null, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5 };

/** Spotlight look and overlays. Every value has a safe default; the renderer clamps them. */
export const SpotlightSettings = z.object({
  /** how dark everything outside the spotlight becomes: 0 = not at all, 1 = black */
  dim: z.number().min(0).max(0.9).default(0.55),
  /** softness of the spotlight edge, as a share of the player's height */
  feather: z.number().min(0.05).max(1.5).default(0.6),
  /** spotlight size relative to the player's box */
  size: z.number().min(0.8).max(3).default(1.6),
  /** glowing ring at the player's feet */
  ring: z.boolean().default(true),
  ring_color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default("#17D1F8"),
  /** caption with the player's name (and OTSI Player ID when registered) */
  name_caption: z.boolean().default(true),
  /** ADR-044. darkening of the picture's corners: 0 = none, 1 = strong */
  vignette: z.number().min(0).max(1).default(0),
  /** how readily the spotlight bridges a gap where the player was not found: 0 = strict (short gaps only, re-analysis points must lie very
   * close to his path), 1 = tolerant (longer gaps); 0.5 = the ADR-032 rules. It never follows anyone who is not the confirmed player. */
  lock: z.number().min(0).max(1).default(0.5),
  /** on: the player is re-found 10 times a second in every clip (smooth spotlight, slower render); off: the analysis positions only */
  auto_track: z.boolean().default(true),
  /** team names and the match clock (from the match halves a person confirmed); the score is not measured and is not shown */
  score_bug: z.boolean().default(false),
  /** the player's name, OTSI Player ID and club sliding in at the start of each clip */
  lower_third: z.boolean().default(false),
  /** a small "OTSI VIE" mark in the corner */
  watermark: z.boolean().default(false),
  /** a closing card after the last clip: the player, his ID and club, the reel's title */
  end_screen: z.boolean().default(false),
  /** brand assets (with a rights declaration) shown in the corner; null = off */
  competition_logo_id: z.string().uuid().nullable().default(null),
  custom_logo_id: z.string().uuid().nullable().default(null),
  /** ADR-047: music uploaded with a rights declaration, under the whole reel; null = the clips' match sound only */
  music_id: z.string().uuid().nullable().default(null),
  /** the music's loudness, and the match sound's under it (0 = silent, 1 = as recorded) */
  music_volume: z.number().min(0).max(1).default(0.8),
  match_volume: z.number().min(0).max(1).default(0.3),
  /** ADR-050: each clip's moment written on screen as it starts ("Free kick", "Goal (scoreboard)", "Tackle (possible)") */
  event_tags: z.boolean().default(true),
  /** ADR-050: an opening card with the match: the clubs, the competition, the date and the venue (from the match record) */
  match_card: z.boolean().default(true),
  /** ADR-050: a video uploaded with a rights declaration, played before the first clip / after the last; null = none */
  intro_id: z.string().uuid().nullable().default(null),
  outro_id: z.string().uuid().nullable().default(null),
  /** ADR-130: the Player Profile Intro — the generated 16:9 opening segment with the selected player's real profile, placed at the
   *  very beginning of the reel, before the first football clip (and before the intro video and the match card). On by default: the
   *  intro is automatic; a person turns it off here. The worker draws it from the render snapshot's `profile`, never from a guess. */
  profile_intro: z.boolean().default(true),
  /** E3 (ADR-066): how fast a 9:16 / 1:1 frame follows the player: 0 = calm, 1 = quick */
  reframe_speed: z.number().min(0).max(1).default(0.5),
  /** E3 (ADR-066): the music dips while the match sound is loud (crowd, whistle, commentary) */
  duck_music: z.boolean().default(true),
  /** B.20 (ADR-095): the loudness every file of this reel is set to (LUFS, integrated); null = each export profile's own */
  loudness_lufs: z.number().min(-31).max(-9).nullable().default(null),
  /** E5 (ADR-068): the colour look of the match picture (look.ts) */
  look: Look.default(NEUTRAL_LOOK),
});
export type SpotlightSettings = z.infer<typeof SpotlightSettings>;

/** B.20 (ADR-095): the loudness targets a person can choose (EBU R128 broadcast, common online and social levels) */
export const LOUDNESS_TARGETS: { lufs: number | null; label: string; note: string }[] = [
  { lufs: null, label: "Automatic", note: "Each file at its own level: the reel and the scout cut −16, the social cut −14, the archive master −23 LUFS" },
  { lufs: -23, label: "Broadcast −23", note: "EBU R128, for television and archives" },
  { lufs: -16, label: "Online −16", note: "Web players and presentations" },
  { lufs: -14, label: "Social −14", note: "Social apps and streaming services" },
];

/** E3 (ADR-066): export profiles: several files from one edit. aspect null = the reel's own; lufs = the loudness the sound is set to */
export const ExportProfile = z.enum(["REEL", "SCOUT", "SOCIAL", "ARCHIVE"]);
export type ExportProfile = z.infer<typeof ExportProfile>;
export const EXPORT_PROFILES: Record<ExportProfile, { label: string; aspect: ReelAspectT | null; lufs: number; bitrate_mbps: number | null }> = {
  REEL: { label: "Highlights reel", aspect: null, lufs: -16, bitrate_mbps: null },
  SCOUT: { label: "Scout cut 16:9", aspect: "16:9", lufs: -16, bitrate_mbps: null },
  SOCIAL: { label: "Social cut 9:16", aspect: "9:16", lufs: -14, bitrate_mbps: null },
  ARCHIVE: { label: "Archive master 16:9", aspect: "16:9", lufs: -23, bitrate_mbps: 20 },
};

/** ADR-044. A logo an organization uploaded for its reels, with the rights declaration a person made when uploading it. */
export const BrandAssetKind = z.enum(["COMPETITION_LOGO", "CUSTOM_LOGO", "MUSIC", "REEL_VIDEO"]);
export type BrandAssetKind = z.infer<typeof BrandAssetKind>;
export const BrandRightsBasis = z.enum(["OWN_BRAND", "LICENSED", "PERMISSION", "FREE_LICENCE"]);
export type BrandRightsBasis = z.infer<typeof BrandRightsBasis>;
export const BrandAsset = z.object({
  id: z.string().uuid(),
  kind: BrandAssetKind,
  name: z.string(),
  mime: z.string(),
  byte_size: z.number().int(),
  rights_holder: z.string(),
  rights_basis: BrandRightsBasis,
  /** false when the rights grant has expired or was withdrawn: the logo cannot be rendered */
  rights_ok: z.boolean(),
  uploaded_by: z.string().uuid().nullable(),
  created_at: z.string(),
});
export type BrandAsset = z.infer<typeof BrandAsset>;
export const BRAND_MAX_BYTES = 512 * 1024;
/** ADR-047: a music file (MP3, WAV, M4A/AAC, OGG or FLAC) is sent as raw bytes, at most this size */
export const MUSIC_MAX_BYTES = 25 * 1024 * 1024;
export const MUSIC_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/ogg", "audio/flac", "audio/x-flac"] as const;
/** the music's name and the rights declaration, sent with the bytes (header `x-asset-meta`, base64url JSON) */
export const MusicMeta = z.object({
  name: z.string().trim().min(1).max(120),
  rights_holder: z.string().trim().min(2).max(255),
  rights_basis: BrandRightsBasis,
  /** the person confirms the organization may use this music in its reels */
  confirm_rights: z.literal(true),
});
export type MusicMeta = z.infer<typeof MusicMeta>;
/** ADR-050: an intro / outro video (MP4, MOV or WebM) is sent as raw bytes, at most this size; the render plays at most VIDEO_MAX_S of it */
export const VIDEO_MAX_BYTES = 80 * 1024 * 1024;
export const VIDEO_MAX_S = 30;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const CreateBrandAssetRequest = z.object({
  kind: z.enum(["COMPETITION_LOGO", "CUSTOM_LOGO"]),
  name: z.string().trim().min(1).max(120),
  rights_holder: z.string().trim().min(2).max(255),
  rights_basis: BrandRightsBasis,
  /** the person confirms the organization may show this image in its reels */
  confirm_rights: z.literal(true),
  /** a PNG or JPEG, base64, at most BRAND_MAX_BYTES */
  data_base64: z.string().min(16).max(Math.ceil((BRAND_MAX_BYTES * 4) / 3) + 8),
});
export type CreateBrandAssetRequest = z.infer<typeof CreateBrandAssetRequest>;

/**
 * ADR-131: a reel is one player, one match (source MATCH, video_id set) — or one player, ALL his matches (source ALL_MATCHES,
 * video_id absent, length_s from 90 / 180 / 300, default 180). A cross-match reel pins targets across every video where he has
 * confirmed tracks, and its clips each carry their own source video.
 */
export const CrossMatchSource = z.enum(["MATCH", "ALL_MATCHES"]);
export type CrossMatchSource = z.infer<typeof CrossMatchSource>;
export const CreateReelRequest = z.object({
  video_id: z.string().uuid().optional(),
  player_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200).optional(),
  source: CrossMatchSource.default("MATCH"),
  /** cross-match only: the reel's length (90 / 180 / 300 s, default 180); ignored for a single-match reel */
  length_s: z.union([z.literal(90), z.literal(180), z.literal(300)]).optional(),
}).superRefine((b, ctx) => {
  if (b.source === "MATCH" && !b.video_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["video_id"], message: "video_id is required for a single-match reel" });
  if (b.source === "ALL_MATCHES" && b.video_id) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["video_id"], message: "video_id is not used for a cross-match reel: it spans all the player's matches" });
});
export type CreateReelRequest = z.infer<typeof CreateReelRequest>;

export const UpdateReelRequest = z.object({
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  aspect: ReelAspect.optional(),
  settings: SpotlightSettings.partial().optional(),
});
export type UpdateReelRequest = z.infer<typeof UpdateReelRequest>;

export const ReelClip = z.object({
  id: z.string().uuid(),
  sequence_index: z.number().int(),
  /** ADR-131: the video this clip comes from (the reel's video for a single-match reel) */
  source_video_id: z.string().uuid(),
  in_pts_us: z.number().int(),
  out_pts_us: z.number().int(),
  origin: z.enum(["SUGGESTED", "MANUAL"]),
  label: z.string().nullable(),
  /** E2 (ADR-065): slow motion, freeze frame or hero ramp; the reel length counts it (retime.ts clipOutputUs) */
  effect: ClipEffect.default(NO_EFFECT),
  /** E5 (ADR-068): keyframed zoom on the player and telestration (arrows, lines, circles drawn on) */
  fx: ClipFx.default(NO_FX),
});
export type ReelClip = z.infer<typeof ReelClip>;

/** E5 (ADR-068): what a reviewer wrote through a share link of one of the reel's renders, at a time of that file */
export const ReviewComment = z.object({
  id: z.string().uuid(), name: z.string(), body: z.string(), at_s: z.number().nullable(), created_at: z.string(),
  render_id: z.string().uuid(), render_completed_at: z.string().nullable(),
  /** seconds of intro and match card before the first clip in that file (null for files made before E5: then not placed on the timeline) */
  lead_s: z.number().nullable(),
});
export type ReviewComment = z.infer<typeof ReviewComment>;

/** ADR-055. A transition into a clip (from the clip before it), drawn over that clip's first moments: the picture of the clip before keeps
 * running past its out point (its handle) and blends into this one, so the reel's length and its sound do not change. FADE goes through
 * black on purpose; the others never show a black frame. */
export const TransitionKind = z.enum(["FADE", "DISSOLVE", "ZOOM", "SPIN"]);
export type TransitionKind = z.infer<typeof TransitionKind>;
export const TRANSITION_MIN_MS = 200, TRANSITION_MAX_MS = 1000, TRANSITION_DEFAULT_MS = 600;
export const ReelTransition = z.object({
  /** the clip it leads into (never the first clip) */
  clip_id: z.string().uuid(),
  kind: TransitionKind,
  duration_ms: z.number().int().min(TRANSITION_MIN_MS).max(TRANSITION_MAX_MS),
});
export type ReelTransition = z.infer<typeof ReelTransition>;
/** PATCH /v1/reels/:id/transitions: set (kind) or remove (kind null) the transition into one clip */
export const SetTransitionRequest = z.object({
  clip_id: z.string().uuid(),
  kind: TransitionKind.nullable(),
  duration_ms: z.number().int().min(TRANSITION_MIN_MS).max(TRANSITION_MAX_MS).default(TRANSITION_DEFAULT_MS),
});
export type SetTransitionRequest = z.infer<typeof SetTransitionRequest>;

/** ADR-055. A saved reel look (Clip Studio Templates): the aspect and spotlight settings of a reel, kept under a name for the organization */
export const ReelTemplate = z.object({
  id: z.string().uuid(),
  name: z.string(),
  aspect: ReelAspect,
  settings: SpotlightSettings,
  /** E4 (ADR-067): the reel's structure as slots (null = the look only) */
  structure: ReelStructure.nullable().default(null),
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type ReelTemplate = z.infer<typeof ReelTemplate>;
export const CreateReelTemplateRequest = z.object({ name: z.string().trim().min(1).max(80), reel_id: z.string().uuid(), with_structure: z.boolean().default(false) });
export type CreateReelTemplateRequest = z.infer<typeof CreateReelTemplateRequest>;
/** E4: clips KEEP = the look only; FILL = the look and the template's slots filled with this reel's player's moments (replacing its clips) */
export const ApplyReelTemplateRequest = z.object({ template_id: z.string().uuid(), version: z.number().int().positive(), clips: z.enum(["KEEP", "FILL"]).default("KEEP") });
export type ApplyReelTemplateRequest = z.infer<typeof ApplyReelTemplateRequest>;

export const ReelTarget = z.object({
  track_id: z.string().uuid(),
  track_number: z.number().int(),
  first_pts_us: z.number().int(),
  last_pts_us: z.number().int(),
  /** false when the identity decision this reel was built on has been superseded (the reel is then stale) */
  decision_current: z.boolean(),
});
export type ReelTarget = z.infer<typeof ReelTarget>;

export const RenderState = z.enum(["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED", "BLOCKED", "REVIEW_REQUIRED"]);

export const RenderJob = z.object({
  id: z.string().uuid(),
  reel_id: z.string().uuid(),
  state: RenderState,
  config: z.record(z.unknown()),
  /** measured by the worker: frames, duration, spotlight frames detected / interpolated / without the player, encoder, validation */
  result: z.record(z.unknown()).nullable(),
  failure_code: z.string().nullable(),
  failure_detail: z.string().nullable(),
  progress: z.number().nullable(),
  stage_message: z.string().nullable(),
  created_at: z.string(),
  completed_at: z.string().nullable(),
  has_output: z.boolean(),
  /** taken off the Export queue by "Clear All" (the render and its file stay) */
  cleared: z.boolean().default(false),
});
export type RenderJob = z.infer<typeof RenderJob>;

export const Reel = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: z.string(),
  version: z.number().int(),
  /** null for a cross-match reel (ADR-131): it spans all the player's matches, not one video */
  video_id: z.string().uuid().nullable(),
  /** ADR-131: MATCH = one player, one match; ALL_MATCHES = one player, all his matches */
  source: CrossMatchSource.default("MATCH"),
  /** cross-match only: the chosen reel length in seconds (90 / 180 / 300); null for a single-match reel */
  cross_match_length_s: z.number().int().nullable().optional(),
  /** cross-match only: the best-moments rule version the reel was built with (ADR-131); null for a single-match reel */
  best_moments_rule_version: z.string().nullable().optional(),
  run_id: z.string().uuid().nullable(),
  player: z.object({ player_id: z.string().uuid(), display_name: z.string(), canonical_otsi_id: z.string().nullable(), profile: PlayerProfile.optional() }).nullable(),
  /** the player's entry on the team sheet of the video's match (team, shirt number, position), as recorded; null = not on it */
  player_roster: z.object({ match_id: z.string().uuid(), club_id: z.string().uuid(), team: z.string(), jersey_number: z.number().int().nullable(),
    position: z.string().nullable(), role: z.string(), captain: z.boolean() }).nullable().optional(),
  aspect: ReelAspect,
  settings: SpotlightSettings,
  targets: z.array(ReelTarget),
  /** a target's identity decision changed: refresh the targets before rendering */
  stale: z.boolean(),
  clips: z.array(ReelClip),
  /** ADR-055: the transitions into clips 2, 3, ... (a transition into the clip that is now first is kept but not drawn, and not listed) */
  transitions: z.array(ReelTransition).default([]),
  duration_us: z.number().int(),
  latest_render: RenderJob.nullable(),
  /** the newest render that finished with a playable file (owner 2026-11-02: Home, Library and Export stayed empty while a new render
   *  ran, because they only looked at the latest render); null = none yet */
  last_good_render: RenderJob.nullable().optional(),
  /** E3 (ADR-066): the newest playable file of each export profile and frame (newest first) */
  formats: z.array(z.object({ render_id: z.string().uuid(), profile: ExportProfile, aspect: ReelAspect, width: z.number().int().nullable(),
    height: z.number().int().nullable(), completed_at: z.string().nullable() })).default([]),
  /** ADR-044. what the score / time overlay and the lower third can show: the video's match (null when it is not linked to one), the player's
   * club in its roster, and whether the halves were confirmed by a person (the clock is shown only then) */
  match: z.object({
    home: z.string().nullable(),
    away: z.string().nullable(),
    competition: z.string().nullable(),
    clock: z.enum(["CONFIRMED", "PROPOSED", "NONE"]),
  }).nullable().optional(),
  player_club: z.string().nullable().optional(),
  /** who created it (a member of the organization) */
  created_by: z.string().uuid().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Reel = z.infer<typeof Reel>;

/** E1 (ADR-064): where the reel's CONFIRMED player is inside its clips, for the live spotlight preview in Clip Studio. Only the analysis's own
 * positions of the pinned target tracks (the render adds a dense re-analysis on top, so the preview is approximate and the render exact).
 * Empty when a target's identity decision has changed (stale): no preview spotlight on a man who may not be the player. */
export const ReelPathPoint = z.object({ pts_us: z.number().int(), x: z.number(), y: z.number(), w: z.number(), h: z.number(),
  /** B.14 (ADR-090): the observation's state as recorded (DETECTED; anything else is drawn as interpolated) */
  state: z.string().optional() });
export type ReelPathPoint = z.infer<typeof ReelPathPoint>;
export const ReelPath = z.object({
  stale: z.boolean(),
  /** the longest gap between two positions that is bridged (the renderer's rule for its Target Lock setting without Auto Track) */
  max_interp_s: z.number(),
  points: z.array(ReelPathPoint),
});
export type ReelPath = z.infer<typeof ReelPath>;

/** what the player did in a moment, from the engine's events (ADR-040-043) */
export const MomentEvent = z.enum(["GOAL", "FREE_KICK_GOAL", "PENALTY_GOAL", "SHOT", "KEY_PASS", "PENALTY", "FREE_KICK", "CORNER", "TACKLE", "INTERCEPTION", "BALL_WON", "PRESSURE_REGAIN", "PRESSURE",
  "SET_PIECE", "PASS", "THROW_IN", "GOAL_KICK", "KICK_OFF", "PASS_RECEIVED"]);
export type MomentEvent = z.infer<typeof MomentEvent>;

/** A suggested moment (ADR-043): EVENT - the engine's events the player took part in, on his confirmed tracks, in match time, ranked;
 * VISIBLE - a stretch where he is visible on confirmed tracks and did nothing the engine detected. */
export const ReelMoment = z.object({
  kind: z.enum(["EVENT", "VISIBLE"]),
  /** EVENT only: what he did, best first */
  events: z.array(MomentEvent),
  /** EVENT only: the ranking (higher first); VISIBLE: 0 */
  score: z.number().int(),
  in_pts_us: z.number().int(),
  out_pts_us: z.number().int(),
  visible_us: z.number().int(),
  observations: z.number().int(),
  track_numbers: z.array(z.number().int()),
  in_reel: z.boolean(),
  label: z.string(),
  /** E4 (ADR-067), EVENT only: when his best event in it happens (a clip cut shorter keeps it; a freeze or ramp is set there) */
  key_at_us: z.number().int().nullable().default(null),
  /** B.15 (ADR-091): the share of the moment in which he has a recorded position (null: not measured) */
  coverage: z.number().min(0).max(1).nullable().default(null),
  /** B.15: a person said "Not this one" for this reel */
  rejected: z.boolean().default(false),
});
export type ReelMoment = z.infer<typeof ReelMoment>;

/** E4 (ADR-067): plain inputs for draft reels */
export const CandidatesRequest = z.object({ target_s: z.number().int().min(15).max(600).default(60), theme: ReelTheme.default("BEST") });
export type CandidatesRequest = z.infer<typeof CandidatesRequest>;
export const ReelCandidate = z.object({
  key: CandidateKey, title: z.string(), why: z.string(), duration_us: z.number().int(), score: z.number(), short: z.boolean(),
  clips: z.array(z.object({ in_pts_us: z.number().int(), out_pts_us: z.number().int(), label: z.string(), kind: z.enum(["EVENT", "VISIBLE"]),
    events: z.array(MomentEvent), key_at_us: z.number().int().nullable(), effect: ClipEffect })),
});
export type ReelCandidate = z.infer<typeof ReelCandidate>;
export const CandidatesResponse = z.object({ candidates: z.array(ReelCandidate), moments: z.number().int(), available_us: z.number().int() });
export type CandidatesResponse = z.infer<typeof CandidatesResponse>;
/** use a draft: the reel's clips become the draft's (replace = true when it has clips) */
export const AssembleRequest = CandidatesRequest.extend({ key: CandidateKey, version: z.number().int().positive(), replace: z.boolean().default(false) });
export type AssembleRequest = z.infer<typeof AssembleRequest>;

export const AddClipRequest = z.object({
  in_pts_us: z.number().int().min(0),
  out_pts_us: z.number().int().positive(),
  origin: z.enum(["SUGGESTED", "MANUAL"]).default("MANUAL"),
  label: z.string().trim().max(255).nullable().default(null),
  /** ADR-131: the clip's video for a cross-match reel (required there — a cross-match reel has no single video);
   *  for a single-match reel it must be the reel's video when given, and defaults to it when not */
  source_video_id: z.string().uuid().optional(),
}).refine((c) => c.out_pts_us > c.in_pts_us, { message: "out_pts_us must be after in_pts_us" });
export type AddClipRequest = z.infer<typeof AddClipRequest>;

export const UpdateClipRequest = z.object({
  in_pts_us: z.number().int().min(0),
  out_pts_us: z.number().int().positive(),
}).refine((c) => c.out_pts_us > c.in_pts_us, { message: "out_pts_us must be after in_pts_us" });
export type UpdateClipRequest = z.infer<typeof UpdateClipRequest>;

export const ReorderClipsRequest = z.object({ clip_ids: z.array(z.string().uuid()).min(1).max(200) });
export type ReorderClipsRequest = z.infer<typeof ReorderClipsRequest>;

export const CreateRenderRequest = z.object({
  /** video codec family; the encoder backend is chosen by the worker (Intel hardware preferred, ADR-029) */
  codec: z.enum(["h264", "av1", "vp9"]).default("h264"),
  /** target bitrate for 1080p output, Mbit/s */
  bitrate_mbps: z.number().min(2).max(20).default(8),
  /** E3 (ADR-066): which file of the edit: the reel as set, the 16:9 scout cut, the 9:16 social cut or the archive master */
  profile: ExportProfile.default("REEL"),
  /** B.22 (ADR-097): the reel profile's frame for this file (null = the reel's own); the other profiles have their own */
  aspect: ReelAspect.nullable().default(null),
  /** B.22: this file's loudness (null = the reel's target, else the profile's level) */
  loudness_lufs: z.number().min(-31).max(-9).nullable().default(null),
});
export type CreateRenderRequest = z.infer<typeof CreateRenderRequest>;
