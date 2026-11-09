/**
 * The general audit writer and the audit log API (F59, ADR-019): one row shape for every change, request correlation, redaction,
 * atomicity with the business change and its outbox event, append-only storage, and tenant / role isolation of reads.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordChange, serviceActor, writeAudit } from "../src/core/audit";
import type { Db } from "../src/core/db";
import { REDACTED } from "../src/core/redact";
import { appDb, key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member;
let b: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, requestId: r.headers["x-request-id"] as string | undefined };
}

beforeAll(async () => {
  app = await startApi();
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("audit rows written by the API", () => {
  it("record the user, organization, request id and before/after state, with the outbox event in the same transaction", async () => {
    const player = await call(a, "POST", "/v1/players", { display_name: "Audited Player" }, { "idempotency-key": key() });
    const { trackIds: [track] } = await seedTracks(root, a);
    const first = await call(a, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CANDIDATE", player_id: player.body.player_id });
    expect(first.status).toBe(201);
    expect(first.requestId).toMatch(/^[0-9a-f-]{36}$/);
    const second = await call(a, "POST", `/v1/tracks/${track}/identity-decisions`,
      { state: "CONFIRMED", player_id: player.body.player_id, supersedes_id: first.body.decision_id, reason: "jersey and face match" });
    expect(second.status).toBe(201);

    const [rows] = await root.query<RowDataPacket[]>("SELECT * FROM audit_events WHERE entity_type = 'track' AND entity_id = ? ORDER BY id", [track]);
    expect(rows.map((r) => r.action)).toEqual(["track.identity_decided", "track.identity_corrected"]);
    expect(rows[1]).toMatchObject({ organization_id: a.orgId, actor_kind: "USER", actor_id: a.userId, actor_service: null, request_id: second.requestId });
    expect(rows[1]!.before_state).toMatchObject({ decision_id: first.body.decision_id, state: "CANDIDATE" });
    expect(rows[1]!.after_state).toMatchObject({ state: "CONFIRMED", supersedes_id: first.body.decision_id });
    const [events] = await root.query<RowDataPacket[]>("SELECT event_type, organization_id FROM outbox_events WHERE aggregate_id = ? ORDER BY id", [track]);
    expect(events).toEqual([
      { event_type: "track.identity_decided", organization_id: a.orgId },
      { event_type: "track.identity_corrected", organization_id: a.orgId },
    ]);
  });
});

describe("the audit writer", () => {
  it("redacts credentials in states before they are stored", async () => {
    const entity = uuidv7();
    await writeAudit(db.pool, serviceActor("test-redaction", a.orgId), {
      action: "test.redaction_checked", entityType: "test", entityId: entity,
      before: { password: "hunter2" },
      after: { api_key: "k-123", nested: { client_secret: "s", note: "called with Bearer abc.def.ghi", list: [{ access_token: "t" }] }, card_number: "4111", kept: "visible" },
    });
    const [r] = await root.query<RowDataPacket[]>("SELECT before_state, after_state FROM audit_events WHERE entity_id = ?", [entity]);
    expect(r[0]!.before_state).toEqual({ password: REDACTED });
    expect(r[0]!.after_state).toEqual({
      api_key: REDACTED, card_number: REDACTED, kept: "visible",
      nested: { client_secret: REDACTED, note: `called with Bearer ${REDACTED}`, list: [{ access_token: REDACTED }] },
    });
  });

  it("refuses malformed entries, and stores a size marker instead of an oversized state", async () => {
    const actor = serviceActor("test-validation", a.orgId);
    await expect(writeAudit(db.pool, actor, { action: "Created", entityType: "test" })).rejects.toThrow(/invalid audit action/);
    await expect(writeAudit(db.pool, actor, { action: "test.created", entityType: "Test Thing" })).rejects.toThrow(/entity type/);
    await expect(writeAudit(db.pool, actor, { action: "test.created", entityType: "test", entityId: "42" })).rejects.toThrow(/UUID/);
    await expect(writeAudit(db.pool, serviceActor("Bad Service", a.orgId), { action: "test.created", entityType: "test" })).rejects.toThrow(/service name/);
    const entity = uuidv7();
    await writeAudit(db.pool, actor, { action: "test.big_state", entityType: "test", entityId: entity, after: { blob: "x".repeat(70_000) } });
    const [r] = await root.query<RowDataPacket[]>("SELECT after_state FROM audit_events WHERE entity_id = ?", [entity]);
    expect(r[0]!.after_state).toMatchObject({ _omitted: "state too large for the audit log" });
  });

  it("commits the audit row and the outbox event with the change, or neither", async () => {
    const entity = uuidv7();
    const actor = { kind: "USER" as const, userId: a.userId, organizationId: a.orgId, requestId: "req-test" };
    await expect(db.tx(async (c) => {
      await recordChange(c, actor, { action: "test.changed", entityType: "test", entityId: entity, after: { v: 1 }, event: { eventType: "test.changed", payload: { v: 1 } } });
      throw new Error("the change failed later in the transaction");
    })).rejects.toThrow();
    const count = async (t: string, col: string) => Number((await root.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?`, [entity]))[0][0]!.n);
    expect([await count("audit_events", "entity_id"), await count("outbox_events", "aggregate_id")]).toEqual([0, 0]);
    const out = await db.tx((c) => recordChange(c, actor, { action: "test.changed", entityType: "test", entityId: entity, event: { eventType: "test.changed", payload: {} } }));
    expect(out.outboxId).not.toBeNull();
    expect([await count("audit_events", "entity_id"), await count("outbox_events", "aggregate_id")]).toEqual([1, 1]);
  });

  it("cannot rewrite or delete history with the runtime account", async () => {
    const id = await writeAudit(db.pool, serviceActor("test-immutable", a.orgId), { action: "test.immutable_checked", entityType: "test" });
    await expect(db.pool.query("UPDATE audit_events SET action = 'test.rewritten' WHERE id = ?", [id])).rejects.toMatchObject({ errno: 1142 });
    await expect(db.pool.query("DELETE FROM audit_events WHERE id = ?", [id])).rejects.toMatchObject({ errno: 1142 });
  });
});

describe("reading the audit log", () => {
  it("shows an organization only its own rows, to OWNER and ADMIN only", async () => {
    const entity = uuidv7();
    for (let i = 0; i < 3; i++) await writeAudit(db.pool, serviceActor("test-reader", a.orgId), { action: "test.listed", entityType: "test", entityId: entity, after: { i } });
    const mine = await call(a, "GET", `/v1/audit-events?entity_type=test&entity_id=${entity}`);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((r: { after_state: { i: number } }) => r.after_state.i)).toEqual([2, 1, 0]);
    expect(mine.body.items[0]).toMatchObject({ actor_kind: "SERVICE", actor_service: "test-reader", action: "test.listed", entity_id: entity });

    const foreign = await call(b, "GET", `/v1/audit-events?entity_type=test&entity_id=${entity}`);   // another tenant asks for the same entity
    expect([foreign.status, foreign.body.items]).toEqual([200, []]);

    const admin = await seedMember(root, "ADMIN", a.orgId);
    expect((await call(admin, "GET", `/v1/audit-events?entity_id=${entity}`)).body.items).toHaveLength(3);
    for (const role of ["ANALYST", "EDITOR", "SCOUT", "VIEWER"]) {
      const m = await seedMember(root, role, a.orgId);
      const r = await call(m, "GET", `/v1/audit-events?entity_id=${entity}`);
      expect([r.status, r.body.code]).toEqual([403, "ROLE_NOT_ALLOWED"]);
    }
  });

  it("pages newest first and validates its query", async () => {
    const entity = uuidv7();
    for (let i = 0; i < 5; i++) await writeAudit(db.pool, serviceActor("test-pager", a.orgId), { action: "test.paged", entityType: "test", entityId: entity, after: { i } });
    const p1 = await call(a, "GET", `/v1/audit-events?entity_id=${entity}&limit=2`);
    expect(p1.body.items).toHaveLength(2);
    const p2 = await call(a, "GET", `/v1/audit-events?entity_id=${entity}&limit=2&before_id=${p1.body.next_before_id}`);
    const p3 = await call(a, "GET", `/v1/audit-events?entity_id=${entity}&limit=2&before_id=${p2.body.next_before_id}`);
    const seen = [...p1.body.items, ...p2.body.items, ...p3.body.items].map((r: { after_state: { i: number } }) => r.after_state.i);
    expect(seen).toEqual([4, 3, 2, 1, 0]);
    expect(p3.body.next_before_id).toBeNull();
    for (const bad of ["limit=0", "limit=500", "entity_id=nope", "action=Bad", "entity_type=Not%20Valid"]) {
      const r = await call(a, "GET", `/v1/audit-events?${bad}`);
      expect([r.status, r.body.code]).toEqual([422, "INVALID_REQUEST"]);
    }
  });
});
