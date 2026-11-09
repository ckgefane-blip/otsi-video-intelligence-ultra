/**
 * v3 Phase E.7 (ADR-121): Pressing metrics from existing pressing events.
 *
 * Tactical pressing intelligence:
 *   - High Press Success: percentage and count of pressures in opposition half leading to a regain within 5s.
 *   - Final Third Regains: regains won in the opponent's defensive third (the pressing team's final third).
 *   - Average Press Height: average distance along pitch axis from defending goal line (metres and %).
 *
 * Evidence rules:
 *   - When pitch calibrations cover the moment, pitch coordinates and press height are measured from player feet.
 *   - When uncalibrated, average press height is marked unmeasured (null) with clear reason; never fabricated.
 *   - Excludes any event marked REJECT in event_decisions (ADR-118).
 */
import { z } from "zod";

export const PressingPoint = z.object({
  id: z.string().uuid(),
  start_us: z.number().int(),
  end_us: z.number().int(),
  kit_group: z.number().int(),
  presser_track_id: z.string().uuid().nullable(),
  presser_player_id: z.string().uuid().nullable(),
  presser_name: z.string().nullable().optional(),
  pressed_track_id: z.string().uuid().nullable(),
  pressed_player_id: z.string().uuid().nullable(),
  pressed_name: z.string().nullable().optional(),
  /** whether the pressing team regained the ball within 5 seconds */
  regain: z.boolean(),
  /** pitch coordinates if calibrated (metres from pitch center: -L/2 to +L/2, -W/2 to +W/2) */
  pitch_x: z.number().nullable(),
  pitch_y: z.number().nullable(),
  /** normalized height from defending goal line (0 = own goal line, 100 = opponent goal line) */
  press_height_pct: z.number().nullable(),
  press_height_m: z.number().nullable(),
  is_high_press: z.boolean().nullable(),
  is_final_third: z.boolean().nullable(),
});
export type PressingPoint = z.infer<typeof PressingPoint>;

export const TeamPressingStats = z.object({
  kit_group: z.number().int(),
  team_name: z.string().nullable(),
  total_pressures: z.number().int(),
  total_regains: z.number().int(),
  overall_success_pct: z.number().nullable(),
  /** high press: initiated in opponent's half (press_height_pct >= 50%) */
  high_pressures: z.number().int(),
  high_press_regains: z.number().int(),
  high_press_success_pct: z.number().nullable(),
  /** final third: initiated in opponent's defensive third (press_height_pct >= 66.7%) */
  final_third_pressures: z.number().int(),
  final_third_regains: z.number().int(),
  /** average height of pressures from own goal line (metres and percentage) */
  avg_press_height_m: z.number().nullable(),
  avg_press_height_pct: z.number().nullable(),
  measured_pressures: z.number().int(),
  /** PPDA (Passes Allowed Per Defensive Action): opponent passes in defensive 60% / defensive actions in that zone */
  ppda: z.number().nullable().optional(),
  ppda_status: z.enum(["MEASURED", "NOT_MEASURED"]).optional(),
  ppda_reason: z.string().nullable().optional(),
});
export type TeamPressingStats = z.infer<typeof TeamPressingStats>;

export const PressingAnalysis = z.object({
  video_id: z.string().uuid(),
  ball_track_id: z.string().uuid().nullable(),
  is_calibrated: z.boolean(),
  pitch_length_m: z.number(),
  pitch_width_m: z.number(),
  teams: z.array(TeamPressingStats),
  pressures: z.array(PressingPoint),
  not_measured_reason: z.string().nullable(),
});
export type PressingAnalysis = z.infer<typeof PressingAnalysis>;
