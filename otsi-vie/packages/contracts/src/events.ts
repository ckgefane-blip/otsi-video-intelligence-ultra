/**
 * Possession and passes (migration 0031, ADR-040): found by the engine from its ball and the people it follows, in match time only.
 * Teams are the run's kit groups, named by a person's kit -> club assignment where there is one. A pass is a completed one (a team-mate
 * received the ball); where the other team won it the engine says only that possession changed. What it did not see is not counted.
 */
import { z } from "zod";

export const EventEvidence = z.enum(["DETECTED", "INFERRED"]);

/** ADR-118, Phase E.1: Analyst verification decisions on detected events */
export const EventDecisionType = z.enum(["CONFIRM", "REJECT", "EDIT", "NEEDS_REVIEW"]);
export type EventDecisionType = z.infer<typeof EventDecisionType>;

export const RecordEventDecisionRequest = z.object({
  decision: EventDecisionType,
  revised_start_us: z.number().int().optional(),
  revised_end_us: z.number().int().optional(),
  revised_type: z.string().optional(),
  reason: z.string().optional(),
});
export type RecordEventDecisionRequest = z.infer<typeof RecordEventDecisionRequest>;

export const EventDecisionRecord = z.object({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  decision: EventDecisionType,
  reviewer_id: z.string().uuid(),
  reviewer_name: z.string().nullable().default(null),
  revised_start_pts_us: z.number().int().nullable().default(null),
  revised_end_pts_us: z.number().int().nullable().default(null),
  revised_type: z.string().nullable().default(null),
  reason: z.string().nullable().default(null),
  decided_at: z.string(),
});
export type EventDecisionRecord = z.infer<typeof EventDecisionRecord>;

export const TeamPossession = z.object({
  kit_group: z.number().int(),
  club_id: z.string().uuid().nullable(),
  /** the club's name, or null when nobody has said which club wears this kit yet */
  name: z.string().nullable(),
  kit_rgb: z.string().nullable(),
  /** seconds of match time this team had the ball (its phases on the ball) */
  possession_s: z.number(),
  /** share of the time a team was seen with the ball, 0-100; null until teams were seen on the ball for a quarter of the counted time
   * (over less, the share says which kit the engine reads best, not who had the ball) */
  share: z.number().nullable(),
  passes: z.number().int(),
  /** times it won the ball from the other team */
  won: z.number().int(),
  /** times it pressed the other team's player on the ball (ADR-042), and how many of those won the ball back within 5 s */
  pressures: z.number().int(),
  press_regains: z.number().int(),
});
export type TeamPossession = z.infer<typeof TeamPossession>;

export const PassEvent = z.object({
  id: z.string().uuid(),
  /** the ball left the passer / reached the receiver */
  start_us: z.number().int(),
  end_us: z.number().int(),
  from_track_id: z.string().uuid().nullable(),
  to_track_id: z.string().uuid().nullable(),
  /** confirmed identities of passer and receiver, when a person said who they are */
  from_player_id: z.string().uuid().nullable(),
  to_player_id: z.string().uuid().nullable(),
  kit_group: z.number().int().nullable(),
  length_m: z.number().nullable(),
  evidence: EventEvidence,
  confidence: z.number(),
  /** the receiver shot from that same spell on the ball (a key pass, ADR-041) */
  key: z.boolean(),
  /** where the ball left the passer / reached the receiver: normalised picture points of those moments (null when not recorded) */
  from_xy: z.tuple([z.number(), z.number()]).nullable().default(null),
  to_xy: z.tuple([z.number(), z.number()]).nullable().default(null),
  decision: EventDecisionType.nullable().default(null),
  reviewer_id: z.string().uuid().nullable().default(null),
});
export type PassEvent = z.infer<typeof PassEvent>;

export const PossessionChange = z.object({
  id: z.string().uuid(),
  at_us: z.number().int(),
  /** who lost it and who won it */
  lost_track_id: z.string().uuid().nullable(),
  won_track_id: z.string().uuid().nullable(),
  won_player_id: z.string().uuid().nullable(),
  from_kit_group: z.number().int().nullable(),
  to_kit_group: z.number().int().nullable(),
  evidence: EventEvidence,
  /** how the engine's rule reads it (ADR-041): won at the loser's feet (TACKLE) or in flight (INTERCEPTION); null: neither clearly.
   * A possible kind, about half right when checked by eye on wide footage: shown as "possible" */
  how: z.enum(["TACKLE", "INTERCEPTION"]).nullable(),
  decision: EventDecisionType.nullable().default(null),
  reviewer_id: z.string().uuid().nullable().default(null),
});
export type PossessionChange = z.infer<typeof PossessionChange>;

/** a shot (ADR-041): a fast ball towards goal from within 32 m of it, found only where the pitch is measured */
export const ShotEvent = z.object({
  id: z.string().uuid(),
  at_us: z.number().int(),
  track_id: z.string().uuid().nullable(),
  player_id: z.string().uuid().nullable(),
  kit_group: z.number().int().nullable(),
  speed_ms: z.number().nullable(),
  distance_m: z.number().nullable(),
  evidence: EventEvidence,
  decision: EventDecisionType.nullable().default(null),
  reviewer_id: z.string().uuid().nullable().default(null),
});
export type ShotEvent = z.infer<typeof ShotEvent>;

/** a pressure (ADR-042): a player of the other team closing down the player on the ball, in the wide view of play */
export const PressureEvent = z.object({
  id: z.string().uuid(),
  start_us: z.number().int(),
  end_us: z.number().int(),
  presser_track_id: z.string().uuid().nullable(),
  presser_player_id: z.string().uuid().nullable(),
  pressed_track_id: z.string().uuid().nullable(),
  kit_group: z.number().int().nullable(),
  /** his team won the ball within 5 s */
  regain: z.boolean(),
  decision: EventDecisionType.nullable().default(null),
  reviewer_id: z.string().uuid().nullable().default(null),
});
export type PressureEvent = z.infer<typeof PressureEvent>;

/** ADR-048: the kinds of restart, from where the ball stood (null: the pitch is not measured there) */
export const SetPieceKind = z.enum(["KICK_OFF", "PENALTY", "CORNER", "GOAL_KICK", "THROW_IN", "FREE_KICK"]);
export type SetPieceKind = z.infer<typeof SetPieceKind>;
/** a set piece (ADR-048): the ball dead for a while, then kicked or thrown; the taker when one person was clearly at the ball */
export const SetPieceEvent = z.object({
  id: z.string().uuid(),
  /** the restart, and when the ball was first seen dead */
  at_us: z.number().int(),
  dead_from_us: z.number().int(),
  kind: SetPieceKind.nullable(),
  track_id: z.string().uuid().nullable(),
  player_id: z.string().uuid().nullable(),
  kit_group: z.number().int().nullable(),
  decision: EventDecisionType.nullable().default(null),
  reviewer_id: z.string().uuid().nullable().default(null),
});
export type SetPieceEvent = z.infer<typeof SetPieceEvent>;

/** a goal (ADR-049), INFERRED from the broadcast scoreboard changing by one; the clip is the last live play before the change */
export const GoalEvent = z.object({
  id: z.string().uuid(),
  /** the attack and the first seconds of the celebration */
  start_us: z.number().int(),
  end_us: z.number().int(),
  /** when the scoreboard first showed the new score */
  scoreboard_us: z.number().int(),
  /** which number on the scoreboard went up: 0 the first team printed, 1 the second */
  side: z.number().int().min(0).max(1),
  /** the score after the goal, as printed */
  score: z.tuple([z.number().int(), z.number().int()]),
  /** the possible scorer: the last player on the ball in that play (null: nobody clearly) */
  track_id: z.string().uuid().nullable(),
  player_id: z.string().uuid().nullable(),
  kit_group: z.number().int().nullable(),
  /** a set piece just before it (a free-kick goal, a corner goal...); null: from open play or not seen */
  set_piece: SetPieceKind.nullable(),
  set_piece_by_scorer: z.boolean(),
  decision: EventDecisionType.nullable().default(null),
  reviewer_id: z.string().uuid().nullable().default(null),
});
export type GoalEvent = z.infer<typeof GoalEvent>;

export const MatchEvents = z.object({
  video_id: z.string().uuid(),
  /** NONE: the ball was never followed; RUNNING: it is being followed; READY: the answer below */
  state: z.enum(["NONE", "RUNNING", "READY"]),
  ball_track_id: z.string().uuid().nullable(),
  /** only the halves were counted (match periods known) */
  match_time: z.boolean(),
  /** seconds of match time counted, and how many of them a team was seen with the ball */
  counted_s: z.number(),
  possession_known_s: z.number(),
  teams: z.array(TeamPossession),
  passes: z.array(PassEvent),
  /** the ball won from the other team: tackles, interceptions and misplaced passes alike; `how` gives the possible kind */
  changes: z.array(PossessionChange),
  shots: z.array(ShotEvent),
  pressures: z.array(PressureEvent),
  set_pieces: z.array(SetPieceEvent),
  goals: z.array(GoalEvent),
  /** count of rejected events hidden from the analysis (ADR-118) */
  rejected_events_count: z.number().int().default(0),
});
export type MatchEvents = z.infer<typeof MatchEvents>;

/** times a player (or one track) won the ball from the other team */
export function ballWonBy(ev: MatchEvents | null, who: { player_id?: string | null; track_ids: string[] }): number {
  if (!ev) return 0;
  return ev.changes.filter((c) => (who.player_id && c.won_player_id === who.player_id) || (!!c.won_track_id && who.track_ids.includes(c.won_track_id))).length;
}

/** times a player (or one track) pressed the player on the ball */
export function pressuresBy(ev: MatchEvents | null, who: { player_id?: string | null; track_ids: string[] }): number {
  if (!ev) return 0;
  return ev.pressures.filter((p) => (who.player_id && p.presser_player_id === who.player_id) || (!!p.presser_track_id && who.track_ids.includes(p.presser_track_id))).length;
}

/** a player's (or one track's) completed passes: made and received */
export function passesOf(ev: MatchEvents | null, who: { player_id?: string | null; track_ids: string[] }): { made: number; received: number; metres: number | null } {
  if (!ev) return { made: 0, received: 0, metres: null };
  const tracks = new Set(who.track_ids);
  const mine = (player: string | null, track: string | null) => (who.player_id && player === who.player_id) || (!!track && tracks.has(track));
  const made = ev.passes.filter((p) => mine(p.from_player_id, p.from_track_id));
  const lengths = made.map((p) => p.length_m).filter((m): m is number => m !== null);
  return { made: made.length, received: ev.passes.filter((p) => mine(p.to_player_id, p.to_track_id)).length,
    metres: lengths.length ? Math.round(lengths.reduce((a, b) => a + b, 0)) : null };
}

/**
 * "Is this him?" (ADR-046): for the player whose reel is being made, the unnamed players in the engine's events who could be him (his kit's
 * colour or unknown, never on screen with one of his named tracks, never marked "not him"), most alike to him first, then the most events.
 * The person answers Yes (an identity decision on the track: all of its events count for him) or No ("not him"), or skips.
 */
export const WhoMomentKind = z.enum(["PASS_FROM", "PASS_TO", "BALL_WON", "PRESSURE", "SHOT", "SET_PIECE"]);
export type WhoMomentKind = z.infer<typeof WhoMomentKind>;
export const WhoItem = z.object({
  track_id: z.string().uuid(),
  track_number: z.number().int(),
  first_pts_us: z.number().int(),
  last_pts_us: z.number().int(),
  has_thumbnail: z.boolean(),
  kit_group: z.number().int().nullable(),
  /** how many of the engine's events (match time) this track is in */
  events: z.number().int(),
  moment: z.object({ kind: WhoMomentKind, start_us: z.number().int(), end_us: z.number().int() }),
  /** appearance likeness to his named tracks (look x shirt colour, ADR-045), null when not among their look-alikes; not a probability */
  look: z.number().nullable(),
  /** a person already said this track is not him (served only when asked to revisit those) */
  said_not_him: z.boolean(),
});
export type WhoItem = z.infer<typeof WhoItem>;
export const WhoIsThis = z.object({
  video_id: z.string().uuid(),
  run_id: z.string().uuid().nullable(),
  player: z.object({ player_id: z.string().uuid(), display_name: z.string() }),
  /** his named tracks in this run, and the colour group most of them are in (null: not known) */
  his_tracks: z.number().int(),
  kit_group: z.number().int().nullable(),
  /** when his named tracks are on screen: a player seen at the same time is someone else */
  his_spans: z.array(z.object({ track_id: z.string().uuid(), first_pts_us: z.number().int(), last_pts_us: z.number().int() })),
  /** NONE: the ball was not followed yet (no events) */
  state: z.enum(["NONE", "READY"]),
  items: z.array(WhoItem),
  /** candidates beyond these */
  more: z.number().int(),
  /** events in match time already counted for him (on his named tracks) */
  his_events: z.number().int(),
});
export type WhoIsThis = z.infer<typeof WhoIsThis>;
/** Page 08 Event Timeline and Action Map: the engine's events this player took part in, on tracks a person CONFIRMED as him, in match time of
 * each video's latest followed ball (the rules of GET /v1/videos/:id/events). Pass ends are placed on the pitch (metres from the centre spot,
 * x along the length) only where a pitch calibration covers that moment; otherwise null: listed, never drawn. All engine readings. */
export const PlayerEventKind = z.enum(["PASS", "PASS_RECEIVED", "BALL_WON", "PRESSURE", "SHOT", "SET_PIECE", "GOAL"]);
export type PlayerEventKind = z.infer<typeof PlayerEventKind>;
const PitchPt = z.tuple([z.number(), z.number()]);
export const PlayerEvent = z.object({
  id: z.string().uuid(),
  video_id: z.string().uuid(),
  video_title: z.string(),
  kind: PlayerEventKind,
  start_us: z.number().int(),
  end_us: z.number().int(),
  evidence: z.string(),
  key: z.boolean(),
  /** BALL_WON: the rule's possible kind */
  how: z.enum(["TACKLE", "INTERCEPTION"]).nullable(),
  set_piece: SetPieceKind.nullable(),
  /** PRESSURE: the ball was won back within 5 s */
  regain: z.boolean().nullable(),
  /** the other player (receiver, passer), named only when confirmed */
  partner_player_id: z.string().uuid().nullable(),
  partner_name: z.string().nullable(),
  length_m: z.number().nullable(),
  from_m: PitchPt.nullable(),
  to_m: PitchPt.nullable(),
});
export type PlayerEvent = z.infer<typeof PlayerEvent>;
export const PlayerEvents = z.object({
  player_id: z.string().uuid(),
  half: z.union([z.literal(1), z.literal(2)]).nullable(),
  /** videos of his whose ball was followed (events exist only there) */
  videos: z.number().int(),
  length_m: z.number(),
  width_m: z.number(),
  items: z.array(PlayerEvent),
});
export type PlayerEvents = z.infer<typeof PlayerEvents>;
