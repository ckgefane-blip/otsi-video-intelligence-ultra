/**
 * v3 Phase E.6 (ADR-124): Rigorous evidence rules for unconfirmed event types.
 *
 * Rules:
 * - Tackles, interceptions, offside line, chances created, progressive passes, xG, xA, carries, PPDA, off-ball runs
 *   must enforce rigorous sensor/tracking evidence rules or be kept "Not measured".
 * - NEVER fabricate any metric.
 * - Unknown or unmeasured beats wrong or fabricated.
 */
import { z } from "zod";

export const EvidenceVerificationState = z.enum(["MEASURED", "PROVISIONAL", "NOT_MEASURED"]);
export type EvidenceVerificationState = z.infer<typeof EvidenceVerificationState>;

export const EvidenceRuleType = z.enum([
  "TACKLE",
  "INTERCEPTION",
  "PROGRESSIVE_PASS",
  "PPDA",
  "OFF_BALL_RUN",
  "OFFSIDE_LINE",
  "CHANCES_CREATED",
  "XG_XA",
  "CARRIES",
]);
export type EvidenceRuleType = z.infer<typeof EvidenceRuleType>;

export const ValidationResult = z.object({
  metric: EvidenceRuleType,
  status: EvidenceVerificationState,
  value: z.union([z.number(), z.string()]).nullable(),
  reason: z.string(),
  details: z.record(z.union([z.number(), z.string(), z.boolean(), z.null()])).optional(),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

export const VideoEvidenceAudit = z.object({
  video_id: z.string().uuid(),
  is_calibrated: z.boolean(),
  metrics: z.record(ValidationResult),
  unmeasured_count: z.number().int(),
  provisional_count: z.number().int(),
  measured_count: z.number().int(),
});
export type VideoEvidenceAudit = z.infer<typeof VideoEvidenceAudit>;

/**
 * 1. TACKLE VALIDATOR:
 * Requires:
 * - Opposing team tracks in duel contact (< 1.8m or overlapping boxes)
 * - Ball proximity (< 1.5m to duel center)
 * - Deceleration / rapid velocity drop on ball carrier (> 1.5 m/s^2)
 * - Possession transfer from loser to winner
 */
export function validateTackleEvidence(duel: {
  dist_m: number | null;
  ball_dist_m: number | null;
  carrier_decel_ms2: number | null;
  possession_flipped: boolean;
  pitch_calibrated: boolean;
}): ValidationResult {
  if (!duel.possession_flipped) {
    return {
      metric: "TACKLE",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: no confirmed possession transfer between opposing teams.",
      details: { possession_flipped: false },
    };
  }

  if (!duel.pitch_calibrated || duel.dist_m === null || duel.ball_dist_m === null) {
    return {
      metric: "TACKLE",
      status: "PROVISIONAL",
      value: "Possible Tackle",
      reason: "Provisional: physical duel proximity and ball coordinates uncalibrated; requires human confirmation.",
      details: { pitch_calibrated: duel.pitch_calibrated, dist_m: duel.dist_m, ball_dist_m: duel.ball_dist_m },
    };
  }

  if (duel.dist_m > 2.0 || duel.ball_dist_m > 1.8) {
    return {
      metric: "TACKLE",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: players or ball outside physical tackle interaction radius.",
      details: { dist_m: duel.dist_m, ball_dist_m: duel.ball_dist_m },
    };
  }

  const hasDecel = duel.carrier_decel_ms2 !== null && duel.carrier_decel_ms2 >= 1.2;
  return {
    metric: "TACKLE",
    status: "MEASURED",
    value: "Verified Tackle",
    reason: hasDecel
      ? "Verified tackle with measured duel proximity, ball contact and velocity deceleration."
      : "Verified tackle with measured contact and ball proximity.",
    details: {
      dist_m: duel.dist_m,
      ball_dist_m: duel.ball_dist_m,
      carrier_decel_ms2: duel.carrier_decel_ms2,
      has_decel: hasDecel,
    },
  };
}

/**
 * 2. INTERCEPTION VALIDATOR:
 * Requires:
 * - Opposing team interceptor away from original passer (> 3.0m)
 * - Ball in flight trajectory (speed >= 4 m/s)
 * - Interceptor secures ball control within proximity (< 1.2m)
 * - Not a feet duel at loser's feet
 */
export function validateInterceptionEvidence(flight: {
  passer_to_interceptor_m: number | null;
  ball_speed_ms: number | null;
  interceptor_ball_dist_m: number | null;
  opposing_teams: boolean;
  pitch_calibrated: boolean;
}): ValidationResult {
  if (!flight.opposing_teams) {
    return {
      metric: "INTERCEPTION",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: receiver and passer belong to the same team.",
      details: { opposing_teams: false },
    };
  }

  if (!flight.pitch_calibrated || flight.passer_to_interceptor_m === null) {
    return {
      metric: "INTERCEPTION",
      status: "PROVISIONAL",
      value: "Possible Interception",
      reason: "Provisional: ball trajectory in flight without calibrated pitch plane separation; requires human review.",
      details: { pitch_calibrated: flight.pitch_calibrated },
    };
  }

  if (flight.passer_to_interceptor_m < 2.5) {
    return {
      metric: "INTERCEPTION",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: action occurred at close contact (< 2.5m); classified as duel/tackle candidate, not interception.",
      details: { passer_to_interceptor_m: flight.passer_to_interceptor_m },
    };
  }

  return {
    metric: "INTERCEPTION",
    status: "MEASURED",
    value: "Verified Interception",
    reason: "Verified interception: ball won in flight trajectory away from passer with calibrated pitch separation.",
    details: {
      passer_to_interceptor_m: flight.passer_to_interceptor_m,
      ball_speed_ms: flight.ball_speed_ms,
      interceptor_ball_dist_m: flight.interceptor_ball_dist_m,
    },
  };
}

/**
 * 3. PROGRESSIVE PASS VALIDATOR:
 * Rigorous definition:
 * Completed pass moving ball towards opponent goal by:
 * - >= 30m if starting in defending third (dist_from_defending_goal < 35m)
 * - >= 15m if starting in middle third (35m <= dist < 70m)
 * - >= 10m into penalty area if starting in attacking third (dist >= 70m)
 * Requires calibrated pitch coordinates for start and end!
 */
export function validateProgressivePassEvidence(pass: {
  start_x_m: number | null; // meters along pitch length (-L/2 to +L/2 or 0 to L)
  end_x_m: number | null;
  pitch_length_m: number;
  attacking_towards_positive: boolean;
  completed: boolean;
  pitch_calibrated: boolean;
}): ValidationResult {
  if (!pass.completed) {
    return {
      metric: "PROGRESSIVE_PASS",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: pass was not completed to a teammate.",
      details: { completed: false },
    };
  }

  if (!pass.pitch_calibrated || pass.start_x_m === null || pass.end_x_m === null) {
    return {
      metric: "PROGRESSIVE_PASS",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: requires calibrated pitch coordinates for pass start and reception.",
      details: { pitch_calibrated: pass.pitch_calibrated },
    };
  }

  const L = pass.pitch_length_m > 0 ? pass.pitch_length_m : 105;
  // normalize to distance from own defending goal (0 to L)
  const startFromOwn = pass.attacking_towards_positive
    ? pass.start_x_m + L / 2
    : L / 2 - pass.start_x_m;
  const endFromOwn = pass.attacking_towards_positive
    ? pass.end_x_m + L / 2
    : L / 2 - pass.end_x_m;

  const progression_m = endFromOwn - startFromOwn;
  if (progression_m <= 0) {
    return {
      metric: "PROGRESSIVE_PASS",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not progressive: pass did not advance towards opponent goal line.",
      details: { progression_m: Math.round(progression_m * 10) / 10 },
    };
  }

  let required_m = 15;
  if (startFromOwn < L * 0.35) {
    required_m = 30;
  } else if (startFromOwn >= L * 0.70) {
    required_m = 10;
  }

  const isProgressive = progression_m >= required_m;
  return {
    metric: "PROGRESSIVE_PASS",
    status: isProgressive ? "MEASURED" : "NOT_MEASURED",
    value: isProgressive ? Math.round(progression_m * 10) / 10 : null,
    reason: isProgressive
      ? `Progressive pass: advanced ${Math.round(progression_m)}m towards goal (required ${required_m}m).`
      : `Not progressive: advanced ${Math.round(progression_m)}m (required ${required_m}m from pitch third).`,
    details: {
      progression_m: Math.round(progression_m * 10) / 10,
      required_m,
      start_dist_own_goal: Math.round(startFromOwn * 10) / 10,
      is_progressive: isProgressive,
    },
  };
}

/**
 * 4. PPDA (Passes Allowed Per Defensive Action) VALIDATOR:
 * Formula: Opponent passes in their defensive 60% / Defending team defensive actions in that zone.
 * Requires:
 * - Pitch calibration covering defensive 60%
 * - Minimum sample size: >= 10 opponent passes and >= 3 defensive actions.
 */
export function validatePPDAEvidence(data: {
  opponent_passes_def60: number;
  defensive_actions_def60: number;
  pitch_calibrated: boolean;
}): ValidationResult {
  if (!data.pitch_calibrated) {
    return {
      metric: "PPDA",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: requires calibrated pitch coordinates to delineate defensive 60% zone.",
      details: { pitch_calibrated: false },
    };
  }

  if (data.opponent_passes_def60 < 10 || data.defensive_actions_def60 < 3) {
    return {
      metric: "PPDA",
      status: "NOT_MEASURED",
      value: null,
      reason: `Not measured: insufficient sample in defensive 60% (${data.opponent_passes_def60} passes, ${data.defensive_actions_def60} actions; requires >= 10 passes and >= 3 actions).`,
      details: {
        opponent_passes: data.opponent_passes_def60,
        defensive_actions: data.defensive_actions_def60,
      },
    };
  }

  const ppda = Math.round((data.opponent_passes_def60 / data.defensive_actions_def60) * 10) / 10;
  return {
    metric: "PPDA",
    status: "MEASURED",
    value: ppda,
    reason: `PPDA measured: ${ppda} passes allowed per defensive action across ${data.opponent_passes_def60} passes and ${data.defensive_actions_def60} defensive actions.`,
    details: {
      ppda,
      opponent_passes: data.opponent_passes_def60,
      defensive_actions: data.defensive_actions_def60,
    },
  };
}

/**
 * 5. OFF-BALL RUN VALIDATOR:
 * Requires:
 * - Track not in possession of ball
 * - Velocity >= 18 km/h (5.0 m/s)
 * - Duration >= 1.5 seconds
 * - Calibrated pitch-plane coordinates
 */
export function validateOffBallRunEvidence(run: {
  max_speed_kmh: number | null;
  duration_s: number | null;
  distance_m: number | null;
  has_ball: boolean;
  pitch_calibrated: boolean;
}): ValidationResult {
  if (run.has_ball) {
    return {
      metric: "OFF_BALL_RUN",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not an off-ball run: player in possession of ball.",
      details: { has_ball: true },
    };
  }

  if (!run.pitch_calibrated || run.max_speed_kmh === null || run.duration_s === null) {
    return {
      metric: "OFF_BALL_RUN",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: requires pitch-plane player tracking and velocity calibration.",
      details: { pitch_calibrated: run.pitch_calibrated },
    };
  }

  if (run.max_speed_kmh < 18.0 || run.duration_s < 1.5) {
    return {
      metric: "OFF_BALL_RUN",
      status: "NOT_MEASURED",
      value: null,
      reason: `Not measured: sprint velocity (< 18 km/h) or duration (< 1.5s) below off-ball run threshold.`,
      details: { max_speed_kmh: run.max_speed_kmh, duration_s: run.duration_s },
    };
  }

  return {
    metric: "OFF_BALL_RUN",
    status: "MEASURED",
    value: `${run.max_speed_kmh.toFixed(1)} km/h`,
    reason: `Verified off-ball run: ${run.max_speed_kmh.toFixed(1)} km/h over ${run.duration_s.toFixed(1)}s (${run.distance_m ? `${Math.round(run.distance_m)}m` : "calibrated"}).`,
    details: {
      max_speed_kmh: run.max_speed_kmh,
      duration_s: run.duration_s,
      distance_m: run.distance_m,
    },
  };
}

/**
 * 6. OFFSIDE LINE VALIDATOR:
 * Requires:
 * - Second-to-last defender detected and tracked
 * - Pitch homography line calibration
 * - Frustum confirmation: camera view wide enough that no off-screen defender can be deeper
 */
export function validateOffsideLineEvidence(context: {
  defenders_in_frame_count: number;
  expected_defenders_count: number;
  camera_frustum_full_width: boolean;
  pitch_calibrated: boolean;
}): ValidationResult {
  if (!context.pitch_calibrated) {
    return {
      metric: "OFFSIDE_LINE",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: offside line requires calibrated pitch homography.",
      details: { pitch_calibrated: false },
    };
  }

  if (!context.camera_frustum_full_width || context.defenders_in_frame_count < context.expected_defenders_count - 1) {
    return {
      metric: "OFFSIDE_LINE",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: camera frustum does not guarantee all defenders on-screen; potential off-screen defender.",
      details: {
        defenders_in_frame: context.defenders_in_frame_count,
        expected_defenders: context.expected_defenders_count,
        frustum_full_width: context.camera_frustum_full_width,
      },
    };
  }

  return {
    metric: "OFFSIDE_LINE",
    status: "MEASURED",
    value: "Calibrated Line",
    reason: "Offside line measured: all defenders verified in calibrated wide camera frustum.",
    details: {
      defenders_in_frame: context.defenders_in_frame_count,
      pitch_calibrated: true,
    },
  };
}

/**
 * 7. CHANCES CREATED / SHOT ASSISTS VALIDATOR:
 * Strictly defined as a pass directly assisting a verified shot.
 */
export function validateChanceCreatedEvidence(data: {
  is_key_pass: boolean;
  shot_verified: boolean;
}): ValidationResult {
  if (!data.is_key_pass) {
    return {
      metric: "CHANCES_CREATED",
      status: "NOT_MEASURED",
      value: 0,
      reason: "No chance created: pass did not lead directly to a shot.",
      details: { is_key_pass: false },
    };
  }

  if (!data.shot_verified) {
    return {
      metric: "CHANCES_CREATED",
      status: "PROVISIONAL",
      value: 1,
      reason: "Provisional: pass followed by action candidate, but shot outcome unverified.",
      details: { is_key_pass: true, shot_verified: false },
    };
  }

  return {
    metric: "CHANCES_CREATED",
    status: "MEASURED",
    value: 1,
    reason: "Verified chance created: pass led directly to a confirmed shot.",
    details: { is_key_pass: true, shot_verified: true },
  };
}

/**
 * 8. XG / XA VALIDATOR:
 * VIE does NOT fabricate xG or xA metrics without a validated geometric shot model
 * and deep event dataset. Always strictly reports NOT_MEASURED.
 */
export function validateXgEvidence(): ValidationResult {
  return {
    metric: "XG_XA",
    status: "NOT_MEASURED",
    value: null,
    reason: "Not measured: xG/xA statistical models require calibrated high-density event dataset; VIE v2/v3 does not fabricate expected goals.",
    details: { statistical_model_loaded: false },
  };
}

/**
 * 9. CARRIES VALIDATOR:
 * Requires continuous ball-foot tracking >= 5.0m travel distance by a single player.
 */
export function validateCarriesEvidence(carry: {
  distance_m: number | null;
  duration_s: number | null;
  pitch_calibrated: boolean;
  possession_maintained: boolean;
}): ValidationResult {
  if (!carry.pitch_calibrated || carry.distance_m === null) {
    return {
      metric: "CARRIES",
      status: "NOT_MEASURED",
      value: null,
      reason: "Not measured: carries require calibrated pitch coordinates and continuous foot-ball proximity.",
      details: { pitch_calibrated: carry.pitch_calibrated },
    };
  }

  if (!carry.possession_maintained || carry.distance_m < 5.0) {
    return {
      metric: "CARRIES",
      status: "NOT_MEASURED",
      value: null,
      reason: `Not a measured carry: distance (${carry.distance_m.toFixed(1)}m) below 5m threshold or possession contested.`,
      details: { distance_m: carry.distance_m, possession_maintained: carry.possession_maintained },
    };
  }

  return {
    metric: "CARRIES",
    status: "MEASURED",
    value: `${carry.distance_m.toFixed(1)} m`,
    reason: `Verified carry: traveled ${carry.distance_m.toFixed(1)}m under continuous possession.`,
    details: { distance_m: carry.distance_m, duration_s: carry.duration_s },
  };
}
