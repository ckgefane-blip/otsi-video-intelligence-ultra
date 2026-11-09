import { z } from "zod";

/**
 * Release gates G01–G15 status and non-negotiable release policy (v3 Phase D.10, ADR-117).
 * Defined in master release and test matrix (09_RELEASE_AND_TEST_MATRIX.md).
 *
 * Covers DB integrity, security isolation, UI parity, upload limits, AI model accuracy
 * holdouts (G05-G07), tactical calibration, render QC, rights, billing, admin auditing,
 * operational disaster recovery, and commercial licensing.
 */

export const GateStatus = z.enum(["NOT_STARTED", "MEASURING", "PASSED", "FAILED", "WAIVED"]);
export type GateStatus = z.infer<typeof GateStatus>;

export const GateCategory = z.enum([
  "INFRASTRUCTURE",
  "SECURITY",
  "MEDIA",
  "AI_ACCURACY",
  "GOVERNANCE",
]);
export type GateCategory = z.infer<typeof GateCategory>;

export const ReleaseGateId = z.enum([
  "G01",
  "G02",
  "G03",
  "G04",
  "G05",
  "G06",
  "G07",
  "G08",
  "G09",
  "G10",
  "G11",
  "G12",
  "G13",
  "G14",
  "G15",
]);
export type ReleaseGateId = z.infer<typeof ReleaseGateId>;

export const ReleaseGateRecord = z.object({
  id: ReleaseGateId,
  name: z.string(),
  category: GateCategory,
  status: GateStatus,
  what: z.string(),
  evidence_required: z.string(),
  release_rule: z.string(),
  evidence_reference: z.string().optional(),
  last_verified_at: z.string().nullable().optional(),
  notes: z.string().optional(),
});
export type ReleaseGateRecord = z.infer<typeof ReleaseGateRecord>;

export const ReleaseGatesReport = z.object({
  timestamp: z.string(),
  passed_count: z.number().int().nonnegative(),
  total_count: z.number().int().positive(),
  accuracy_measured: z.boolean(),
  all_passed: z.boolean(),
  gates: z.array(ReleaseGateRecord),
});
export type ReleaseGatesReport = z.infer<typeof ReleaseGatesReport>;

/** Backwards-compatible interface for legacy accuracy gates consumers */
export interface ReleaseGate {
  id: string;
  name: string;
  status: GateStatus;
  what: string;
}

export const ACCURACY_GATES: readonly ReleaseGate[] = [
  { id: "G05", name: "Detection", status: "NOT_STARTED", what: "players and ball found in each frame, measured on labelled football footage" },
  { id: "G06", name: "Tracking", status: "NOT_STARTED", what: "the same person followed over time (HOTA, IDF1, identity switches, camera cuts)" },
  { id: "G07", name: "Identity", status: "NOT_STARTED", what: "no wrong player confirmed; unknown, referees, substitutes and similar numbers handled" },
];

/** true only when every accuracy gate has passed */
export const accuracyMeasured = (gates: readonly ReleaseGate[] = ACCURACY_GATES) =>
  gates.every((g) => g.status === "PASSED");
