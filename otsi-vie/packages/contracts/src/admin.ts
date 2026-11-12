/**
 * v3 Phase D.3 (ADR-111): Admin console contracts.
 * Comprehensive system and organization governance for Owners and Admins:
 * - Members & Roles management with safeguards
 * - Organization profiles and usage statistics
 * - Model registry introspection and hash verification
 * - Worker groups, queued/running jobs, and job concurrency settings
 * - Preset & template governance
 * - Comprehensive audit viewer
 */
import { z } from "zod";
import { MembershipRole } from "./auth";

export const AdminMember = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
  role: MembershipRole,
  is_owner: z.boolean(),
  two_step: z.boolean(),
  created_at: z.string(),
});
export type AdminMember = z.infer<typeof AdminMember>;

export const AdminOrganizationStats = z.object({
  id: z.string().uuid(),
  name: z.string(),
  created_at: z.string(),
  member_count: z.number().int().nonnegative(),
  video_count: z.number().int().nonnegative(),
  reel_count: z.number().int().nonnegative(),
  storage_bytes: z.number().int().nonnegative(),
});
export type AdminOrganizationStats = z.infer<typeof AdminOrganizationStats>;

export const AdminModelFile = z.object({
  name: z.string(),
  expected_sha256: z.string().nullable(),
  present: z.boolean(),
  verified: z.boolean(),
});
export type AdminModelFile = z.infer<typeof AdminModelFile>;

export const AdminModelEntry = z.object({
  key: z.string(),
  task: z.string(),
  family: z.string(),
  adapter: z.string(),
  source: z.string(),
  revision: z.string(),
  weights_license: z.string(),
  status: z.string(),
  files: z.array(AdminModelFile),
});
export type AdminModelEntry = z.infer<typeof AdminModelEntry>;

export const WorkerGroupStatus = z.object({
  group_name: z.string(),
  kinds: z.array(z.string()),
  active_workers: z.number().int().nonnegative(),
  queued_jobs: z.number().int().nonnegative(),
  running_jobs: z.number().int().nonnegative(),
});
export type WorkerGroupStatus = z.infer<typeof WorkerGroupStatus>;

export const AdminConcurrencySettings = z.object({
  max_concurrent_renders: z.number().int().min(1).max(16).default(2),
  max_concurrent_analysis: z.number().int().min(1).max(16).default(1),
  max_concurrent_ingest: z.number().int().min(1).max(16).default(2),
  queue_paused: z.boolean().default(false),
  analysis_paused: z.boolean().default(false),
  renders_paused: z.boolean().default(false),
  ingest_paused: z.boolean().default(false),
});
export type AdminConcurrencySettings = z.infer<typeof AdminConcurrencySettings>;

export const UpdateConcurrencyRequest = AdminConcurrencySettings.partial();
export type UpdateConcurrencyRequest = z.infer<typeof UpdateConcurrencyRequest>;

export const AdminAuditEntry = z.object({
  id: z.number().int().positive(),
  occurred_at: z.string(),
  actor_kind: z.string(),
  actor_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().nullable(),
  request_id: z.string().nullable(),
  before_state: z.unknown().nullable(),
  after_state: z.unknown().nullable(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntry>;

export const AdminDashboard = z.object({
  organization: AdminOrganizationStats,
  members: z.array(AdminMember),
  models: z.array(AdminModelEntry),
  workers: z.array(WorkerGroupStatus),
  concurrency: AdminConcurrencySettings,
  recent_audit: z.array(AdminAuditEntry),
  system_resources: z.object({
    connected: z.boolean(),
    workers: z.number().int().nonnegative(),
    busy_workers: z.number().int().nonnegative(),
    host: z.string().nullable(),
    cpu_percent: z.number().nullable(),
    cpu_count: z.number().int().nullable(),
    memory_used_bytes: z.number().nullable(),
    memory_total_bytes: z.number().nullable(),
    gpu_name: z.string().nullable(),
  }),
});
export type AdminDashboard = z.infer<typeof AdminDashboard>;

export const AdminBackupRecord = z.object({
  id: z.string(),
  timestamp: z.string(),
  db_bytes: z.number().int().nonnegative(),
  tables: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative(),
  storage_files: z.number().int().nonnegative(),
  storage_bytes: z.number().int().nonnegative(),
  verified: z.boolean(),
  verified_at: z.string().nullable(),
  verification_ok: z.boolean().nullable(),
});
export type AdminBackupRecord = z.infer<typeof AdminBackupRecord>;

export const AdminBackupsStatus = z.object({
  backups: z.array(AdminBackupRecord),
  latest_backup_at: z.string().nullable(),
  latest_verified_at: z.string().nullable(),
  healthy: z.boolean(),
});
export type AdminBackupsStatus = z.infer<typeof AdminBackupsStatus>;
