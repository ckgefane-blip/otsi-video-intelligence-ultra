import { z } from "zod";

/**
 * System Monitoring & Local Alerts (v3 Phase D.6, ADR-114).
 * Real-time introspection of worker health, queue depths, storage disk thresholds,
 * and zero-cost local alert notifications.
 */

export const AlertSeverity = z.enum(["INFO", "WARNING", "CRITICAL"]);
export type AlertSeverity = z.infer<typeof AlertSeverity>;

export const SystemAlert = z.object({
  id: z.string(),
  code: z.string(),
  severity: AlertSeverity,
  title: z.string(),
  message: z.string(),
  source: z.string(),
  timestamp: z.string(),
  suggested_action: z.string().optional(),
});
export type SystemAlert = z.infer<typeof SystemAlert>;

export const QueueDepthMetric = z.object({
  kind: z.string(),
  queued_count: z.number().int().nonnegative(),
  running_count: z.number().int().nonnegative(),
  oldest_queued_age_seconds: z.number().nonnegative().nullable(),
});
export type QueueDepthMetric = z.infer<typeof QueueDepthMetric>;

export const DiskSpaceMetric = z.object({
  mount: z.string(),
  total_bytes: z.number().nonnegative(),
  used_bytes: z.number().nonnegative(),
  free_bytes: z.number().nonnegative(),
  percent_used: z.number().min(0).max(100),
});
export type DiskSpaceMetric = z.infer<typeof DiskSpaceMetric>;

export const WorkerHealthMetric = z.object({
  worker_id: z.string(),
  host: z.string(),
  kinds: z.array(z.string()),
  healthy: z.boolean(),
  busy: z.boolean(),
  last_reported_age_seconds: z.number().nonnegative(),
  cpu_percent: z.number().nullable(),
  memory_used_bytes: z.number().nullable(),
  memory_total_bytes: z.number().nullable(),
  gpu_name: z.string().nullable(),
});
export type WorkerHealthMetric = z.infer<typeof WorkerHealthMetric>;

export const SystemMonitoringReport = z.object({
  status: z.enum(["HEALTHY", "DEGRADED", "CRITICAL"]),
  timestamp: z.string(),
  active_workers_count: z.number().int().nonnegative(),
  stalled_workers_count: z.number().int().nonnegative(),
  workers: z.array(WorkerHealthMetric),
  queues: z.array(QueueDepthMetric),
  disk: DiskSpaceMetric,
  alerts: z.array(SystemAlert),
});
export type SystemMonitoringReport = z.infer<typeof SystemMonitoringReport>;
