/**
 * v3 Phase D.6 (ADR-114): System Monitoring and Local Alerts integration tests.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let owner: Member, admin: Member, analyst: Member, viewer: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-monitoring-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  admin = await seedMember(root, "ADMIN", owner.orgId);
  analyst = await seedMember(root, "ANALYST", owner.orgId);
  viewer = await seedMember(root, "VIEWER", owner.orgId);
});

afterAll(async () => {
  await app?.close();
  await root?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("System Monitoring & Alerts API (v3 Phase D.6, ADR-114)", () => {
  it("enforces role guards: only OWNER and ADMIN can access monitoring endpoints", async () => {
    const aRes = await call(analyst, "GET", "/v1/admin/monitoring");
    expect(aRes.status).toBe(403);

    const vRes = await call(viewer, "GET", "/v1/admin/monitoring");
    expect(vRes.status).toBe(403);

    const oRes = await call(owner, "GET", "/v1/admin/monitoring");
    expect(oRes.status).toBe(200);

    const admRes = await call(admin, "GET", "/v1/admin/monitoring");
    expect(admRes.status).toBe(200);
  });

  it("returns monitoring report with workers, queues, disk and alerts", async () => {
    // Seed an active worker
    await root.query(
      `INSERT INTO worker_status 
         (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name, busy, started_at, reported_at)
       VALUES ('worker-test-mon-1', 'host-alpha', '["INGEST","RENDER"]', 24.5, 8, 4294967296, 17179869184, 'NVIDIA RTX 4090', 0, NOW(), NOW())
       ON DUPLICATE KEY UPDATE reported_at = NOW()`,
    );

    const res = await call(owner, "GET", "/v1/admin/monitoring");
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.active_workers_count).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(res.body.workers)).toBe(true);
    expect(res.body.workers.some((w: any) => w.worker_id === "worker-test-mon-1" && w.healthy)).toBe(true);
    expect(res.body.disk).toBeDefined();
    expect(res.body.disk.total_bytes).toBeGreaterThan(0);
    expect(res.body.disk.free_bytes).toBeGreaterThan(0);
  });

  it("detects stalled workers and generates warnings", async () => {
    // Seed a stalled worker (>35 seconds old)
    await root.query(
      `INSERT INTO worker_status 
         (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name, busy, started_at, reported_at)
       VALUES ('worker-stalled-node', 'host-beta', '["ANALYSIS"]', 10.0, 4, 1073741824, 8589934592, NULL, 0, 
               DATE_SUB(NOW(), INTERVAL 10 MINUTE), DATE_SUB(NOW(), INTERVAL 90 SECOND))
       ON DUPLICATE KEY UPDATE reported_at = DATE_SUB(NOW(), INTERVAL 90 SECOND)`,
    );

    const res = await call(owner, "GET", "/v1/admin/monitoring");
    expect(res.status).toBe(200);
    expect(res.body.stalled_workers_count).toBeGreaterThanOrEqual(1);
    expect(res.body.alerts.some((a: any) => a.code === "WORKER_HEARTBEAT_TIMEOUT")).toBe(true);

    // Verify GET /v1/admin/monitoring/alerts
    const alertsRes = await call(owner, "GET", "/v1/admin/monitoring/alerts");
    expect(alertsRes.status).toBe(200);
    expect(Array.isArray(alertsRes.body)).toBe(true);
    expect(alertsRes.body.some((a: any) => a.code === "WORKER_HEARTBEAT_TIMEOUT")).toBe(true);
  });
});
