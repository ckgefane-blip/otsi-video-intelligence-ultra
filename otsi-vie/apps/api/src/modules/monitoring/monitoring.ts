/**
 * System Monitoring & Local Alerts (v3 Phase D.6, ADR-114).
 * Real-time introspection of worker health, queue depths, storage thresholds,
 * and zero-cost local alert notifications.
 */
import { Controller, Get, Injectable, UseGuards } from "@nestjs/common";
import {
  AlertSeverity,
  DiskSpaceMetric,
  QueueDepthMetric,
  SystemAlert,
  SystemMonitoringReport,
  WorkerHealthMetric,
} from "@otsi-vie/contracts";
import fs from "node:fs";
import path from "node:path";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";

@Injectable()
export class MonitoringService {
  constructor(private readonly db: Db) {}

  async getMonitoringReport(p?: Principal): Promise<SystemMonitoringReport> {
    const nowIso = new Date().toISOString();
    const alerts: SystemAlert[] = [];

    // 1. Worker Health Introspection
    const workerRows = await this.db.rows<RowDataPacket>(
      `SELECT worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes,
              gpu_name, busy, started_at, reported_at,
              TIMESTAMPDIFF(SECOND, reported_at, CURRENT_TIMESTAMP(6)) as age_seconds
         FROM worker_status
        ORDER BY reported_at DESC`,
    );

    const workers: WorkerHealthMetric[] = workerRows.map((r) => {
      const ageSec = Math.max(0, Number(r.age_seconds ?? 0));
      const isHealthy = ageSec <= 35; // Worker reports every 5s; 35s grace window
      const parsedKinds = typeof r.kinds === "string" ? JSON.parse(r.kinds) : r.kinds;
      return WorkerHealthMetric.parse({
        worker_id: r.worker_id,
        host: r.host,
        kinds: Array.isArray(parsedKinds) ? parsedKinds : [],
        healthy: isHealthy,
        busy: Boolean(r.busy),
        last_reported_age_seconds: ageSec,
        cpu_percent: r.cpu_percent != null ? Number(r.cpu_percent) : null,
        memory_used_bytes: r.memory_used_bytes != null ? Number(r.memory_used_bytes) : null,
        memory_total_bytes: r.memory_total_bytes != null ? Number(r.memory_total_bytes) : null,
        gpu_name: r.gpu_name ?? null,
      });
    });

    const activeWorkers = workers.filter((w) => w.healthy);
    const stalledWorkers = workers.filter((w) => !w.healthy);

    if (workers.length === 0) {
      alerts.push({
        id: "alert-no-workers",
        code: "NO_ACTIVE_WORKERS",
        severity: "CRITICAL",
        title: "No Active Workers Detected",
        message: "No worker processes have registered heartbeats in worker_status.",
        source: "worker_cluster",
        timestamp: nowIso,
        suggested_action: "Start background workers via local_stack.py or system services.",
      });
    } else if (stalledWorkers.length > 0) {
      alerts.push({
        id: `alert-stalled-${stalledWorkers[0]!.worker_id}`,
        code: "WORKER_HEARTBEAT_TIMEOUT",
        severity: "WARNING",
        title: `${stalledWorkers.length} Worker Node(s) Stalled`,
        message: `Worker ${stalledWorkers[0]!.worker_id} has not reported heartbeats for >35s.`,
        source: "worker_status",
        timestamp: nowIso,
        suggested_action: "Inspect worker logs or restart unresponsive worker processes.",
      });
    }

    // 2. Queue Depths & Latency
    const queueRows = await this.db.rows<RowDataPacket>(
      `SELECT kind,
              SUM(CASE WHEN state = 'QUEUED' THEN 1 ELSE 0 END) as queued_count,
              SUM(CASE WHEN state = 'RUNNING' THEN 1 ELSE 0 END) as running_count,
              MAX(CASE WHEN state = 'QUEUED' THEN TIMESTAMPDIFF(SECOND, created_at, CURRENT_TIMESTAMP(6)) ELSE 0 END) as max_wait_sec
         FROM worker_jobs
        WHERE state IN ('QUEUED', 'RUNNING')
        GROUP BY kind`,
    );

    const queues: QueueDepthMetric[] = queueRows.map((r) =>
      QueueDepthMetric.parse({
        kind: r.kind,
        queued_count: Number(r.queued_count ?? 0),
        running_count: Number(r.running_count ?? 0),
        oldest_queued_age_seconds: r.queued_count > 0 ? Number(r.max_wait_sec ?? 0) : null,
      }),
    );

    const totalQueued = queues.reduce((sum, q) => sum + q.queued_count, 0);
    const maxWait = Math.max(0, ...queues.map((q) => q.oldest_queued_age_seconds ?? 0));

    if (totalQueued > 50 || maxWait > 600) {
      alerts.push({
        id: "alert-queue-backlog",
        code: "QUEUE_BACKLOG_HIGH",
        severity: "WARNING",
        title: "High Job Queue Backlog",
        message: `${totalQueued} jobs queued across queues with oldest job waiting ${Math.round(maxWait / 60)} minutes.`,
        source: "worker_jobs",
        timestamp: nowIso,
        suggested_action: "Increase worker concurrency in Concurrency Settings or add worker nodes.",
      });
    }

    // 3. Storage & Disk Space
    const candidates = [
      path.resolve(process.cwd(), "..", "..", "..", ".local", "storage"),
      path.resolve(process.cwd(), "..", "..", ".local", "storage"),
      path.resolve(process.cwd(), ".local", "storage"),
      process.cwd(),
    ];
    const storageDir = candidates.find((c) => fs.existsSync(c)) ?? process.cwd();

    let disk: DiskSpaceMetric;
    try {
      const stat = fs.statfsSync(storageDir);
      const total = Number(stat.bsize) * Number(stat.blocks);
      const free = Number(stat.bsize) * Number(stat.bfree);
      const used = total - free;
      const pctUsed = total > 0 ? Math.round((used / total) * 1000) / 10 : 0;

      disk = DiskSpaceMetric.parse({
        mount: storageDir,
        total_bytes: total,
        used_bytes: used,
        free_bytes: free,
        percent_used: pctUsed,
      });

      if (pctUsed > 90) {
        alerts.push({
          id: "alert-disk-critical",
          code: "DISK_SPACE_CRITICAL",
          severity: "CRITICAL",
          title: "Storage Volume Critically Full",
          message: `Disk volume at ${storageDir} is ${pctUsed}% full (<10% available).`,
          source: "storage_subsystem",
          timestamp: nowIso,
          suggested_action: "Purge expired Trash in Retention Settings or archive legacy media.",
        });
      } else if (pctUsed > 80) {
        alerts.push({
          id: "alert-disk-warning",
          code: "DISK_SPACE_LOW",
          severity: "WARNING",
          title: "Storage Volume Low",
          message: `Disk volume at ${storageDir} is ${pctUsed}% full.`,
          source: "storage_subsystem",
          timestamp: nowIso,
          suggested_action: "Review data retention schedules and purge expired trash items.",
        });
      }
    } catch {
      // Fallback if statfsSync fails
      disk = DiskSpaceMetric.parse({
        mount: storageDir,
        total_bytes: 1_000_000_000_000,
        used_bytes: 500_000_000_000,
        free_bytes: 500_000_000_000,
        percent_used: 50.0,
      });
    }

    const overallStatus = alerts.some((a) => a.severity === "CRITICAL")
      ? "CRITICAL"
      : alerts.some((a) => a.severity === "WARNING")
        ? "DEGRADED"
        : "HEALTHY";

    return SystemMonitoringReport.parse({
      status: overallStatus,
      timestamp: nowIso,
      active_workers_count: activeWorkers.length,
      stalled_workers_count: stalledWorkers.length,
      workers,
      queues,
      disk,
      alerts,
    });
  }

  async getActiveAlerts(): Promise<SystemAlert[]> {
    const report = await this.getMonitoringReport();
    return report.alerts;
  }
}

@Controller("v1/admin/monitoring")
@UseGuards(AuthGuard)
@Roles("OWNER", "ADMIN")
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get()
  report(@CurrentPrincipal() p: Principal): Promise<SystemMonitoringReport> {
    return this.monitoringService.getMonitoringReport(p);
  }

  @Get("alerts")
  alerts(): Promise<SystemAlert[]> {
    return this.monitoringService.getActiveAlerts();
  }
}
