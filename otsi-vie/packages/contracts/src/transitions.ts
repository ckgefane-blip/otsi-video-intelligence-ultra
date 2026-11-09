/**
 * Transitions analysis (v3 Phase E.4, ADR-119):
 * Tracks ball turnover moments (turnover won / turnover lost) through to the subsequent action
 * (shot, key pass, pass, dispossession, or sustained retention) within match time.
 * Labelled strictly as INFERRED because transition linkages connect discrete event candidates.
 * Excludes events marked REJECT in event_decisions (E.1).
 */
import { z } from "zod";

export const TransitionType = z.enum(["ATTACKING", "DEFENSIVE"]);
export type TransitionType = z.infer<typeof TransitionType>;

export const TransitionTrigger = z.enum(["TACKLE", "INTERCEPTION", "BALL_WON", "BALL_LOST"]);
export type TransitionTrigger = z.infer<typeof TransitionTrigger>;

export const TransitionOutcome = z.enum([
  "SHOT",
  "GOAL",
  "KEY_PASS",
  "PASS",
  "RETAINED",
  "DISPOSSESSED",
  "STOPPAGE",
]);
export type TransitionOutcome = z.infer<typeof TransitionOutcome>;

export const TransitionNextAction = z.object({
  event_id: z.string().uuid().nullable(),
  event_type: z.string(),
  pts_us: z.number().int(),
  duration_s: z.number(),
  outcome: TransitionOutcome,
  detail: z.string().nullable().default(null),
});
export type TransitionNextAction = z.infer<typeof TransitionNextAction>;

export const TransitionItem = z.object({
  id: z.string().uuid(),
  trigger_event_id: z.string().uuid(),
  trigger_pts_us: z.number().int(),
  transition_type: TransitionType,
  trigger_kind: TransitionTrigger,
  kit_group: z.number().int(),
  player_id: z.string().uuid().nullable().default(null),
  track_id: z.string().uuid().nullable().default(null),
  next_action: TransitionNextAction,
  evidence: z.literal("INFERRED"),
});
export type TransitionItem = z.infer<typeof TransitionItem>;

export const TeamTransitionStats = z.object({
  kit_group: z.number().int(),
  club_id: z.string().uuid().nullable(),
  name: z.string().nullable(),
  attacking_transitions: z.number().int(),
  shots_from_transitions: z.number().int(),
  transitions_retained: z.number().int(),
  transitions_lost: z.number().int(),
  avg_duration_to_action_s: z.number().nullable(),
  counter_press_regains: z.number().int(),
});
export type TeamTransitionStats = z.infer<typeof TeamTransitionStats>;

export const TransitionsAnalysis = z.object({
  video_id: z.string().uuid(),
  state: z.enum(["NONE", "READY"]),
  evidence: z.literal("INFERRED"),
  counted_s: z.number(),
  summary: z.object({
    teams: z.array(TeamTransitionStats),
  }),
  items: z.array(TransitionItem),
});
export type TransitionsAnalysis = z.infer<typeof TransitionsAnalysis>;
