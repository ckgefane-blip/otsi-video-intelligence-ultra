/**
 * v3 Phase D.4 (ADR-112): Retention policies, trash expiry countdown, and subject erasure integration tests.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
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
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-retention-"));
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

describe("Retention & Erasure API (v3 Phase D.4, ADR-112)", () => {
  it("enforces role guards: only OWNER and ADMIN can access retention endpoints", async () => {
    const aRes = await call(analyst, "GET", "/v1/admin/retention");
    expect(aRes.status).toBe(403);
    expect(aRes.body.code).toBe("ROLE_NOT_ALLOWED");

    const vRes = await call(viewer, "GET", "/v1/admin/retention");
    expect(vRes.status).toBe(403);

    const oRes = await call(owner, "GET", "/v1/admin/retention");
    expect(oRes.status).toBe(200);

    const admRes = await call(admin, "GET", "/v1/admin/retention");
    expect(admRes.status).toBe(200);
  });

  it("fetches defaults and updates retention policy", async () => {
    const getRes = await call(owner, "GET", "/v1/admin/retention");
    expect(getRes.status).toBe(200);
    expect(getRes.body.trash_days).toBe(30);
    expect(getRes.body.audit_log_days).toBe(365);
    expect(getRes.body.auto_purge_enabled).toBe(false);

    const patchRes = await call(owner, "PATCH", "/v1/admin/retention", {
      trash_days: 14,
      auto_purge_enabled: true,
    });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.trash_days).toBe(14);
    expect(patchRes.body.auto_purge_enabled).toBe(true);

    const checkRes = await call(admin, "GET", "/v1/admin/retention");
    expect(checkRes.status).toBe(200);
    expect(checkRes.body.trash_days).toBe(14);
    expect(checkRes.body.auto_purge_enabled).toBe(true);
  });

  it("purges expired trash items based on policy", async () => {
    const oldDelId = uuidv7();
    const newDelId = uuidv7();
    const assetId1 = uuidv7();
    const assetId2 = uuidv7();

    // Insert an old expired deletion (30 days ago, while trash_days is 14)
    await root.query(
      `INSERT INTO library_deletions (id, organization_id, item_kind, item_id, title, deleted_by, deleted_at)
       VALUES (?, ?, 'video', ?, 'old_clip.mp4', ?, DATE_SUB(NOW(), INTERVAL 30 DAY))`,
      [oldDelId, owner.orgId, assetId1, owner.userId],
    );
    await root.query(
      "INSERT INTO library_deletion_items (deletion_id, item_kind, item_id) VALUES (?, 'video', ?)",
      [oldDelId, assetId1],
    );

    // Insert a fresh deletion (1 day ago)
    await root.query(
      `INSERT INTO library_deletions (id, organization_id, item_kind, item_id, title, deleted_by, deleted_at)
       VALUES (?, ?, 'video', ?, 'fresh_clip.mp4', ?, DATE_SUB(NOW(), INTERVAL 1 DAY))`,
      [newDelId, owner.orgId, assetId2, owner.userId],
    );
    await root.query(
      "INSERT INTO library_deletion_items (deletion_id, item_kind, item_id) VALUES (?, 'video', ?)",
      [newDelId, assetId2],
    );

    const purgeRes = await call(owner, "POST", "/v1/admin/retention/trash/purge", {});
    expect(purgeRes.status).toBe(200);
    expect(purgeRes.body.purged_count).toBeGreaterThanOrEqual(1);

    // Check old is gone, new is retained
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT id FROM library_deletions WHERE id IN (?, ?)",
      [oldDelId, newDelId],
    );
    const remainingIds = rows.map((r) => r.id);
    expect(remainingIds).not.toContain(oldDelId);
    expect(remainingIds).toContain(newDelId);
  });

  it("executes GDPR subject erasure for a player: pseudonymization and redaction", async () => {
    const playerId = uuidv7();
    const projId = uuidv7();

    // Create a project and player
    await root.query(
      "INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'Test Project', ?)",
      [projId, owner.orgId, owner.userId],
    );
    await root.query(
      `INSERT INTO players (id, display_name, birth_date, created_by_organization_id, creation_key)
       VALUES (?, 'Lionel Andres Messi', '1987-06-24', ?, ?)`,
      [playerId, owner.orgId, uuidv7()],
    );

    // Insert audit event with personal data
    await root.query(
      `INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, before_state, after_state)
       VALUES (?, ?, 'player.updated', 'player', ?, 
               JSON_OBJECT('name', 'Lionel Messi', 'birth_date', '1987-06-24'),
               JSON_OBJECT('name', 'Lionel Andres Messi', 'birth_date', '1987-06-24'))`,
      [owner.orgId, owner.userId, playerId],
    );

    // Call erasure
    const eraseRes = await call(owner, "POST", "/v1/admin/retention/erasure", {
      subject_kind: "PLAYER",
      subject_id: playerId,
      reason: "GDPR Article 17 Right to Erasure request",
    });
    expect(eraseRes.status).toBe(200);
    expect(eraseRes.body.summary.pseudonymized_name).toMatch(/^Anonymized Player/);
    expect(eraseRes.body.summary.redacted_audit_records).toBeGreaterThanOrEqual(1);

    // Verify DB state: player is anonymized
    const [pRows] = await root.query<RowDataPacket[]>(
      "SELECT display_name, birth_date FROM players WHERE id = ?",
      [playerId],
    );
    expect(pRows[0]!.display_name).toMatch(/^Anonymized Player/);
    expect(pRows[0]!.birth_date).toBeNull();

    // Verify audit event subject.erased exists
    const [aRows] = await root.query<RowDataPacket[]>(
      "SELECT action, entity_id FROM audit_events WHERE entity_id = ? AND action = 'subject.erased'",
      [playerId],
    );
    expect(aRows.length).toBe(1);

    // Verify subject_erasure_requests log
    const [eRows] = await root.query<RowDataPacket[]>(
      "SELECT id, subject_kind, subject_id, executed_at FROM subject_erasure_requests WHERE subject_id = ?",
      [playerId],
    );
    expect(eRows.length).toBe(1);
    expect(eRows[0]!.subject_kind).toBe("PLAYER");

    // Verify GET /v1/admin/retention/erasures
    const listRes = await call(owner, "GET", "/v1/admin/retention/erasures");
    expect(listRes.status).toBe(200);
    expect(listRes.body.some((e: any) => e.subject_id === playerId)).toBe(true);
  });

  it("handles GDPR subject erasure for a user: prevents erasing last owner, succeeds for member", async () => {
    // 1. Attempt to erase sole owner -> 409
    const errRes = await call(owner, "POST", "/v1/admin/retention/erasure", {
      subject_kind: "USER",
      subject_id: owner.userId,
      reason: "Erasing owner",
    });
    expect(errRes.status).toBe(409);
    expect(errRes.body.code).toBe("CANNOT_ERASE_LAST_OWNER");

    // 2. Erase analyst user
    const eraseUserRes = await call(owner, "POST", "/v1/admin/retention/erasure", {
      subject_kind: "USER",
      subject_id: analyst.userId,
      reason: "Employee left organization - GDPR erasure",
    });
    expect(eraseUserRes.status).toBe(200);
    expect(eraseUserRes.body.summary.pseudonymized_name).toBe("Former Member");

    // Check user table
    const [uRows] = await root.query<RowDataPacket[]>(
      "SELECT display_name, email FROM users WHERE id = ?",
      [analyst.userId],
    );
    expect(uRows[0]!.display_name).toBe("Former Member");
    expect(uRows[0]!.email).toMatch(/^erased-/);

    // Check membership removed
    const [mRows] = await root.query<RowDataPacket[]>(
      "SELECT * FROM memberships WHERE user_id = ? AND organization_id = ?",
      [analyst.userId, owner.orgId],
    );
    expect(mRows.length).toBe(0);
  });
});
