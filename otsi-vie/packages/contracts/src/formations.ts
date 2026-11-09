/**
 * v3 Phase E.3 (ADR-123): Formations by name from calibrated pitch positions.
 *
 * Line-based clustering (defenders, midfielders, forwards) over calibrated pitch coordinates,
 * labelled INFERRED; person can confirm or override via formation_decisions.
 */
import { z } from "zod";

export const FormationName = z.enum([
  "4-3-3",
  "4-2-3-1",
  "4-4-2",
  "3-5-2",
  "3-4-3",
  "5-3-2",
  "5-4-1",
  "4-1-4-1",
  "4-5-1",
  "3-4-2-1",
  "CUSTOM",
]);
export type FormationName = z.infer<typeof FormationName>;

export const FormationPeriod = z.enum(["FULL", "H1", "H2"]);
export type FormationPeriod = z.infer<typeof FormationPeriod>;

export const FormationState = z.enum(["INFERRED", "CONFIRMED"]);
export type FormationState = z.infer<typeof FormationState>;

export const TeamFormation = z.object({
  kit_group: z.number().int(),
  period: FormationPeriod,
  formation: FormationName,
  formation_display: z.string(),
  state: FormationState,
  confidence: z.number().min(0).max(1),
  stability_pct: z.number().min(0).max(100),
  defensive_line_height_m: z.number().nullable(),
  defensive_line_height_pct: z.number().nullable(),
  buildup_shape: z.string().nullable(),
  defensive_shape: z.string().nullable(),
  evaluated_moments: z.number().int(),
  lines: z.object({
    defenders: z.number().int(),
    midfielders: z.number().int(),
    forwards: z.number().int(),
  }),
  decided_by: z.string().nullable(),
  decided_by_name: z.string().nullable().optional(),
  decided_at: z.string().datetime().nullable(),
  is_calibrated: z.boolean(),
  not_measured_reason: z.string().nullable().optional(),
});
export type TeamFormation = z.infer<typeof TeamFormation>;

export const ConfirmFormationRequest = z.object({
  kit_group: z.number().int(),
  period: FormationPeriod.default("FULL"),
  formation: FormationName,
  reason: z.string().trim().max(1000).optional(),
});
export type ConfirmFormationRequest = z.infer<typeof ConfirmFormationRequest>;

export const FormationsAnalysis = z.object({
  video_id: z.string().uuid(),
  teams: z.array(TeamFormation),
});
export type FormationsAnalysis = z.infer<typeof FormationsAnalysis>;
