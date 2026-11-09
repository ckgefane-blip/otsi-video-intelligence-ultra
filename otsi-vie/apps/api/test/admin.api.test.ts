/**
 * v3 Phase D.3 (ADR-111): Admin Console integration tests.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let owner: Member, admin: Member, analyst: Member, viewer: Member, otherOrg: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-admin-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  admin = await seedMember(root, "ADMIN", owner.orgId);
  analyst = await seedMember(root, "ANALYST", owner.orgId);
  viewer = await seedMember(root, "VIEWER", owner.orgId);
  otherOrg = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await root?.end();
  if (dir) await rm(dir, { recursive: true, force: true });
});

describe("Admin Console API (v3 Phase D.3, ADR-111)", () => {
  it("enforces role guards: only OWNER and ADMIN can access admin endpoints", async () => {
    // Analyst gets 403
    const analystRes = await call(analyst, "GET", "/v1/admin/dashboard");
    expect(analystRes.status).toBe(403);
    expect(analystRes.body.code).toBe("ROLE_NOT_ALLOWED");

    // Viewer gets 403
    const viewerRes = await call(viewer, "GET", "/v1/admin/dashboard");
    expect(viewerRes.status).toBe(403);

    // Owner gets 200
    const ownerRes = await call(owner, "GET", "/v1/admin/dashboard");
    expect(ownerRes.status).toBe(200);

    // Admin gets 200
    const adminRes = await call(admin, "GET", "/v1/admin/dashboard");
    expect(adminRes.status).toBe(200);
  });

  it("dashboard: returns aggregate organization, members, models, concurrency and resources", async () => {
    const res = await call(admin, "GET", "/v1/admin/dashboard");
    expect(res.status).toBe(200);
    const d = res.body;

    // Organization stats
    expect(d.organization).toBeDefined();
    expect(d.organization.id).toBe(owner.orgId);
    expect(d.organization.member_count).toBeGreaterThanOrEqual(4); // owner, admin, analyst, viewer

    // Members list
    expect(Array.isArray(d.members)).toBe(true);
    expect(d.members.some((m: any) => m.user_id === owner.userId && m.role === "OWNER")).toBe(true);
    expect(d.members.some((m: any) => m.user_id === admin.userId && m.role === "ADMIN")).toBe(true);

    // Models registry
    expect(Array.isArray(d.models)).toBe(true);
    expect(d.models.length).toBeGreaterThan(0);
    expect(d.models.some((m: any) => m.task === "DETECT" && m.key.includes("rtdetr"))).toBe(true);

    // Concurrency and worker groups
    expect(d.concurrency).toBeDefined();
    expect(d.concurrency.max_concurrent_renders).toBeGreaterThan(0);
    expect(Array.isArray(d.workers)).toBe(true);
    expect(d.workers.some((w: any) => w.group_name === "jobs-analysis")).toBe(true);

    // System resources
    expect(d.system_resources).toBeDefined();
    expect(typeof d.system_resources.connected).toBe("boolean");
  });

  it("members: lists organization members with role and owner status", async () => {
    const res = await call(owner, "GET", "/v1/admin/members");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const mems = res.body;
    expect(mems.length).toBeGreaterThanOrEqual(4);

    const ownerEntry = mems.find((m: any) => m.user_id === owner.userId);
    expect(ownerEntry.is_owner).toBe(true);
    expect(ownerEntry.role).toBe("OWNER");

    const analystEntry = mems.find((m: any) => m.user_id === analyst.userId);
    expect(analystEntry.is_owner).toBe(false);
    expect(analystEntry.role).toBe("ANALYST");
  });

  it("models: lists models with file expected hashes and verification fields", async () => {
    const res = await call(admin, "GET", "/v1/admin/models");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const ddet = res.body.find((m: any) => m.key === "rtdetr_v2_r18vd");
    expect(ddet).toBeDefined();
    expect(ddet.task).toBe("DETECT");
    expect(ddet.family).toBe("RT-DETRv2");
    expect(ddet.weights_license).toContain("Apache-2.0");
    expect(Array.isArray(ddet.files)).toBe(true);
    expect(ddet.files.some((f: any) => f.name === "model.safetensors")).toBe(true);
  });

  it("concurrency: updates concurrency settings and records audit log", async () => {
    // Current concurrency
    const initial = await call(admin, "GET", "/v1/admin/concurrency");
    expect(initial.status).toBe(200);

    // Update max renders to 4 and analysis to 2
    const updated = await call(admin, "PATCH", "/v1/admin/concurrency", {
      max_concurrent_renders: 4,
      max_concurrent_analysis: 2,
    });
    expect(updated.status).toBe(200);
    expect(updated.body.max_concurrent_renders).toBe(4);
    expect(updated.body.max_concurrent_analysis).toBe(2);

    // Verify audit event
    const [auditRow] = await root.query<RowDataPacket[]>(
      "SELECT action, before_state, after_state FROM audit_events WHERE organization_id = ? AND action = 'admin.concurrency_updated' ORDER BY id DESC LIMIT 1",
      [owner.orgId],
    );
    expect(auditRow).toBeDefined();
    expect(auditRow[0]!.action).toBe("admin.concurrency_updated");
    const afterState = typeof auditRow[0]!.after_state === "string" ? JSON.parse(auditRow[0]!.after_state) : auditRow[0]!.after_state;
    expect(afterState.max_concurrent_renders).toBe(4);
  });

  it("audit: searches and paginates organization audit events", async () => {
    const res = await call(admin, "GET", "/v1/admin/audit?limit=10");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);
    expect(res.body.items.some((e: any) => e.action === "admin.concurrency_updated")).toBe(true);

    // Filter by action
    const filtered = await call(admin, "GET", "/v1/admin/audit?action=admin.concurrency_updated");
    expect(filtered.status).toBe(200);
    expect(filtered.body.items.every((e: any) => e.action === "admin.concurrency_updated")).toBe(true);
  });

  it("backups: returns disaster recovery status and verified backup records", async () => {
    const res = await call(owner, "GET", "/v1/admin/backups");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.backups)).toBe(true);
    expect(res.body.backups.length).toBeGreaterThan(0);
    const latest = res.body.backups[0];
    expect(latest.tables).toBeGreaterThan(100);
    expect(latest.rows).toBeGreaterThan(1000);
    expect(res.body.healthy).toBe(true);
  });
});
