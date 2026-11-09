import { z } from "zod";

/**
 * Retention Policies and Subject Erasure (v3 Phase D.4, ADR-112).
 * Manages organization-level retention schedules across Trash, footage, renders, and audit logs,
 * plus GDPR/privacy subject erasure (right to be forgotten) with append-only redaction.
 */

export const OrgRetentionPolicy = z.object({
  organization_id: z.string().uuid(),
  trash_days: z.number().int().min(0).max(3650).default(30),
  raw_footage_days: z.number().int().min(0).max(3650).nullable().default(null),
  rendered_reels_days: z.number().int().min(0).max(3650).nullable().default(null),
  audit_log_days: z.number().int().min(30).max(3650).default(365),
  auto_purge_enabled: z.boolean().default(false),
  updated_at: z.string(),
  updated_by: z.string().uuid().nullable(),
});
export type OrgRetentionPolicy = z.infer<typeof OrgRetentionPolicy>;

export const UpdateRetentionPolicyRequest = z.object({
  trash_days: z.number().int().min(0).max(3650).optional(),
  raw_footage_days: z.number().int().min(0).max(3650).nullable().optional(),
  rendered_reels_days: z.number().int().min(0).max(3650).nullable().optional(),
  audit_log_days: z.number().int().min(30).max(3650).optional(),
  auto_purge_enabled: z.boolean().optional(),
});
export type UpdateRetentionPolicyRequest = z.infer<typeof UpdateRetentionPolicyRequest>;

export const SubjectKind = z.enum(["PLAYER", "USER"]);
export type SubjectKind = z.infer<typeof SubjectKind>;

export const SubjectErasureRequest = z.object({
  subject_kind: SubjectKind,
  subject_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});
export type SubjectErasureRequest = z.infer<typeof SubjectErasureRequest>;

export const SubjectErasureSummary = z.object({
  pseudonymized_name: z.string(),
  redacted_audit_records: z.number().int().nonnegative(),
  cleared_identities: z.number().int().nonnegative(),
  cleared_dossiers: z.number().int().nonnegative(),
  cleared_assessments: z.number().int().nonnegative(),
  cleared_tags: z.number().int().nonnegative(),
});
export type SubjectErasureSummary = z.infer<typeof SubjectErasureSummary>;

export const SubjectErasureRecord = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  subject_kind: SubjectKind,
  subject_id: z.string().uuid(),
  subject_ref: z.string().nullable(),
  requested_by: z.string().uuid(),
  executed_at: z.string(),
  summary: SubjectErasureSummary,
});
export type SubjectErasureRecord = z.infer<typeof SubjectErasureRecord>;

export const PurgeTrashRequest = z.object({
  older_than_days: z.number().int().min(0).max(3650).optional(),
  all: z.boolean().optional(),
});
export type PurgeTrashRequest = z.infer<typeof PurgeTrashRequest>;

export const PurgedItem = z.object({
  id: z.string().uuid(),
  title: z.string(),
  kind: z.string(),
});
export type PurgedItem = z.infer<typeof PurgedItem>;

export const PurgeTrashResult = z.object({
  purged_count: z.number().int().nonnegative(),
  purged_items: z.array(PurgedItem),
  freed_bytes: z.number().int().nonnegative(),
  retention_days: z.number().int().nonnegative(),
});
export type PurgeTrashResult = z.infer<typeof PurgeTrashResult>;
