/**
 * The outbox dispatcher (ADR-018) against the real MySQL schema with the least-privilege runtime account: delivery, consumer
 * idempotency, replayed billing events, concurrent dispatchers, crash/lease recovery and fencing, retry with back-off, dead letters
 * and re-drive, per-aggregate ordering, organization boundaries, handler time-outs, and atomicity of a subscriber's local effect.
 */
import type mysql from "mysql2/promise";
import { PoolConnection, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { serviceActor, writeAudit } from "../src/core/audit";
import type { Db } from "../src/core/db";
import { DispatcherOptions, OutboxDispatcher, OutboxEvent, outboxStats, redrive, Subscriber } from "../src/core/outbox/dispatcher";
import { publish } from "../src/core/outbox/publish";
import { appDb, Member, rootDb, seedMember, sleep } from "./helpers";

let db: Db;
let root: mysql.Connection;
let a: Member;
let b: Member;

const FAST: Partial<DispatcherOptions> = { backoffBaseMs: 40, backoffMaxMs: 400, random: () => 0, leaseMs: 5_000 };

beforeAll(async () => {
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await db?.onModuleDestroy();
  await root?.end();
});
// events left open by other test files would otherwise be claimed here: settle them first (fixture, root account)
beforeEach(async () => {
  await root.query("UPDATE outbox_events SET delivered_at = NOW(6), claim_token = NULL, lease_expires_at = NULL WHERE delivered_at IS NULL AND dead_lettered_at IS NULL");
});

interface RecorderOptions {
  types?: string[];
  org?: string;
  fail?: (e: OutboxEvent, n: number) => string | undefined;
  effect?: (e: OutboxEvent, tx: PoolConnection) => Promise<void>;
  delayMs?: number;
}

function recorder(name: string, o: RecorderOptions = {}) {
  const seen: OutboxEvent[] = [];
  const sub: Subscriber = {
    name,
    eventTypes: o.types ?? "*",
    ...(o.org ? { organizationId: o.org } : {}),
    async handle(e, ctx) {
      seen.push(e);
      if (o.delayMs) await sleep(o.delayMs);
      if (o.effect) await o.effect(e, ctx.tx);
      const msg = o.fail?.(e, seen.filter((x) => x.id === e.id).length);
      if (msg) throw new Error(msg);
    },
  };
  return { seen, sub, count: (id: number) => seen.filter((x) => x.id === id).length };
}

async function emit(org: string | null, over: { agg?: string; type?: string } = {}): Promise<number> {
  const r = await publish(db.pool, { organizationId: org, aggregateType: "test", aggregateId: over.agg ?? uuidv7(), eventType: over.type ?? "test.happened", payload: { n: 1 } });
  return r.id;
}

async function row(id: number): Promise<RowDataPacket> {
  const [r] = await root.query<RowDataPacket[]>("SELECT * FROM outbox_events WHERE id = ?", [id]);
  return r[0]!;
}

async function scalar(sql: string, args: unknown[]): Promise<number> {
  const [r] = await root.query<RowDataPacket[]>(sql, args);
  return Number(r[0]!.n);
}

async function drain(d: OutboxDispatcher, cycles = 10): Promise<void> {
  for (let i = 0; i < cycles; i++) if ((await d.runOnce()).claimed === 0) return;
}

describe("delivery", () => {
  it("delivers a committed event once to every matching subscriber, then never again", async () => {
    const all = recorder("test.all"), typed = recorder("test.typed", { types: ["test.happened"] }), other = recorder("test.other", { types: ["billing.paid"] });
    const d = new OutboxDispatcher(db, [all.sub, typed.sub, other.sub], FAST);
    const id = await emit(a.orgId);
    expect((await d.runOnce()).delivered).toBe(1);
    expect([all.count(id), typed.count(id), other.count(id)]).toEqual([1, 1, 0]);
    expect(all.seen[0]).toMatchObject({ id, organizationId: a.orgId, eventType: "test.happened", payload: { n: 1 }, attempt: 1 });
    const r = await row(id);
    expect(r.delivered_at).not.toBeNull();
    expect([r.claim_token, r.lease_expires_at, r.last_error, r.attempt_count]).toEqual([null, null, null, 1]);
    const [receipts] = await root.query<RowDataPacket[]>("SELECT subscriber FROM event_consumer_receipts WHERE outbox_event_id = ? ORDER BY 1", [id]);
    expect(receipts.map((x) => x.subscriber)).toEqual(["test.all", "test.typed"]);
    expect((await d.runOnce()).claimed).toBe(0);
    expect(all.count(id)).toBe(1);
  });

  it("stores and delivers a replayed billing event once (dedupe key)", async () => {
    const billing = recorder("billing.entitlements");
    const d = new OutboxDispatcher(db, [billing.sub], FAST);
    const dedupeKey = `billing:stripe:evt_${uuidv7()}:subscription.activated`;
    const msg = { organizationId: a.orgId, aggregateType: "subscription", aggregateId: uuidv7(), eventType: "billing.subscription_activated", payload: {}, dedupeKey };
    const first = await publish(db.pool, msg);
    const replay = await publish(db.pool, msg);
    expect(first.duplicate).toBe(false);
    expect(replay).toEqual({ id: first.id, duplicate: true });
    await drain(d);
    expect(await publish(db.pool, msg)).toEqual({ id: first.id, duplicate: true });        // a replay after delivery is still refused
    await drain(d);
    expect(billing.count(first.id)).toBe(1);
    expect(await scalar("SELECT COUNT(*) AS n FROM outbox_events WHERE dedupe_key = ?", [dedupeKey])).toBe(1);
  });

  it("publishes atomically with the producer's transaction", async () => {
    const agg = uuidv7();
    await expect(db.tx(async (c) => {
      await publish(c, { organizationId: a.orgId, aggregateType: "test", aggregateId: agg, eventType: "test.happened", payload: {} });
      throw new Error("the business change failed");
    })).rejects.toThrow("the business change failed");
    expect(await scalar("SELECT COUNT(*) AS n FROM outbox_events WHERE aggregate_id = ?", [agg])).toBe(0);
  });

  it("refuses malformed events before they reach the table", async () => {
    const base = { organizationId: a.orgId, aggregateType: "test", aggregateId: uuidv7(), eventType: "test.happened", payload: {} };
    await expect(publish(db.pool, { ...base, eventType: "TestHappened" })).rejects.toThrow(/invalid event type/);
    await expect(publish(db.pool, { ...base, aggregateId: "not-a-uuid" })).rejects.toThrow(/UUID/);
    await expect(publish(db.pool, { ...base, payload: { big: "x".repeat(70_000) } })).rejects.toThrow(/exceeds/);
  });
});

describe("concurrency, crashes and fencing", () => {
  it("two dispatchers running at once deliver each event exactly once to a subscriber", async () => {
    const shared = recorder("test.shared");
    const d1 = new OutboxDispatcher(db, [shared.sub], { ...FAST, batchSize: 4 });
    const d2 = new OutboxDispatcher(db, [shared.sub], { ...FAST, batchSize: 4 });
    const ids: number[] = [];
    for (let i = 0; i < 30; i++) ids.push(await emit(i % 2 ? a.orgId : b.orgId));
    await Promise.all([drain(d1, 20), drain(d2, 20)]);
    expect(ids.map((id) => shared.count(id))).toEqual(ids.map(() => 1));
    expect(await scalar("SELECT COUNT(*) AS n FROM outbox_events WHERE id IN (?) AND delivered_at IS NULL", [ids])).toBe(0);
  });

  it("recovers events claimed by a crashed dispatcher once the lease expires; the crashed one is fenced off", async () => {
    const sub = recorder("test.recovery");
    const crashed = new OutboxDispatcher(db, [sub.sub], { ...FAST, leaseMs: 300 });
    const healthy = new OutboxDispatcher(db, [sub.sub], { ...FAST, leaseMs: 300 });
    const id = await emit(a.orgId);
    const [stale] = await crashed.claim();                           // claimed, then the process "dies" before delivering
    expect(stale!.event.id).toBe(id);
    expect((await healthy.runOnce()).claimed).toBe(0);              // the lease is still held
    await sleep(400);
    expect((await healthy.runOnce()).delivered).toBe(1);
    expect(await crashed.process(stale!)).toBe("lost");             // a late completion with the old claim token changes nothing
    expect(sub.count(id)).toBe(1);
    expect((await row(id)).attempt_count).toBe(2);
  });

  it("on a retry, skips subscribers that already completed (receipts)", async () => {
    const steady = recorder("test.steady"), flaky = recorder("test.flaky", { fail: (_e, n) => (n === 1 ? "boom" : undefined) });
    const d = new OutboxDispatcher(db, [steady.sub, flaky.sub], FAST);
    const id = await emit(a.orgId);
    expect((await d.runOnce()).retried).toBe(1);
    await sleep(60);
    expect((await d.runOnce()).delivered).toBe(1);
    expect([steady.count(id), flaky.count(id)]).toEqual([1, 2]);
  });
});

describe("failures", () => {
  it("retries with back-off and keeps a redacted error", async () => {
    const secret = "connect mysql://svc:hunter2@db.internal:3306/x failed; password=hunter2; Bearer abc.def.ghi";
    const leaky = recorder("test.leaky", { fail: (_e, n) => (n === 1 ? secret : undefined) });
    const d = new OutboxDispatcher(db, [leaky.sub], { ...FAST, backoffBaseMs: 300 });
    const id = await emit(a.orgId);
    expect((await d.runOnce()).retried).toBe(1);
    const r = await row(id);
    expect(r.last_error).toMatch(/^test\.leaky: /);
    expect(r.last_error).not.toContain("hunter2");
    expect(r.last_error).not.toContain("abc.def.ghi");
    expect([r.claim_token, r.delivered_at, r.dead_lettered_at]).toEqual([null, null, null]);
    expect((await d.runOnce()).claimed).toBe(0);                     // not due yet (back-off >= 150 ms with this jitter)
    expect((await outboxStats(db)).scheduled).toBeGreaterThanOrEqual(1);
    await sleep(350);
    expect((await d.runOnce()).delivered).toBe(1);
    expect((await row(id)).last_error).toBeNull();
  });

  it("dead-letters a poison event after maxAttempts, audits it, and an operator can re-drive it", async () => {
    let broken = true;
    const poison = recorder("test.poison", { fail: () => (broken ? "cannot handle this" : undefined) });
    const d = new OutboxDispatcher(db, [poison.sub], { ...FAST, maxAttempts: 2 });
    const agg = uuidv7();
    const id = await emit(a.orgId, { agg });
    expect((await d.runOnce()).retried).toBe(1);
    await sleep(60);
    expect((await d.runOnce()).dead).toBe(1);
    await sleep(60);
    expect((await d.runOnce()).claimed).toBe(0);                     // never claimed again
    expect(poison.count(id)).toBe(2);
    expect((await row(id)).dead_lettered_at).not.toBeNull();
    expect((await outboxStats(db)).dead_lettered).toBeGreaterThanOrEqual(1);
    const [aud] = await root.query<RowDataPacket[]>(
      "SELECT actor_kind, actor_service, actor_id, organization_id, request_id FROM audit_events WHERE action = 'outbox.event_dead_lettered' AND entity_id = ?", [agg]);
    expect(aud[0]).toMatchObject({ actor_kind: "SERVICE", actor_service: "outbox-dispatcher", actor_id: null, organization_id: a.orgId, request_id: `outbox:${id}` });

    expect(await redrive(db, id, { userId: b.userId, organizationId: b.orgId })).toBe(false);   // another tenant cannot touch it
    broken = false;
    expect(await redrive(db, id, { userId: a.userId, organizationId: a.orgId })).toBe(true);
    expect((await d.runOnce()).delivered).toBe(1);
    const [re] = await root.query<RowDataPacket[]>("SELECT actor_kind, actor_id FROM audit_events WHERE action = 'outbox.event_redriven' AND entity_id = ?", [agg]);
    expect(re[0]).toMatchObject({ actor_kind: "USER", actor_id: a.userId });
  });

  it("times out a hung handler and retries the event", async () => {
    const hung = recorder("test.hung", { delayMs: 1_500 });
    const d = new OutboxDispatcher(db, [hung.sub], { ...FAST, handlerTimeoutMs: 150 });
    const id = await emit(a.orgId);
    expect((await d.runOnce()).retried).toBe(1);
    expect((await row(id)).last_error).toMatch(/timed out after 150 ms/);
    // no receipt: the timed-out attempt does not count as done
    expect(await scalar("SELECT COUNT(*) AS n FROM event_consumer_receipts WHERE outbox_event_id = ?", [id])).toBe(0);
    await sleep(1_400);                                               // let the abandoned handler finish before the next test
  });

  it("rolls a subscriber's local database effect back together with its failed delivery", async () => {
    const entity = uuidv7();
    const writer = recorder("test.writer", {
      effect: async (_e, tx) => { await writeAudit(tx, serviceActor("test-writer", a.orgId), { action: "test.effect_written", entityType: "test", entityId: entity }); },
      fail: (_e, n) => (n === 1 ? "failed after writing" : undefined),
    });
    const d = new OutboxDispatcher(db, [writer.sub], FAST);
    await emit(a.orgId);
    await d.runOnce();
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ?", [entity])).toBe(0);
    await sleep(60);
    await d.runOnce();
    expect(await scalar("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ?", [entity])).toBe(1);   // committed once, with its receipt
  });
});

describe("ordering and tenants", () => {
  it("keeps events of one aggregate in order, without holding up other aggregates", async () => {
    const order: number[] = [];
    let e1 = 0;
    const seq: Subscriber = {
      name: "test.sequence", eventTypes: "*",
      async handle(e) {
        order.push(e.id);
        if (e.id === e1 && order.filter((x) => x === e1).length === 1) throw new Error("first try fails");
      },
    };
    const d = new OutboxDispatcher(db, [seq], { ...FAST, backoffBaseMs: 400 });
    const x = uuidv7();
    e1 = await emit(a.orgId, { agg: x });
    const e2 = await emit(a.orgId, { agg: x });
    const e3 = await emit(a.orgId);
    expect((await d.runOnce()).claimed).toBe(2);                      // e1 and e3; e2 waits behind e1
    expect((await d.runOnce()).claimed).toBe(0);                     // e1 backing off still holds e2 back
    await sleep(450);
    await drain(d);
    expect(order.filter((id) => id === e1 || id === e2)).toEqual([e1, e1, e2]);
    expect(order).toContain(e3);
  });

  it("offers an event only to subscribers of the same organization", async () => {
    const tenantA = recorder("test.tenant_a_webhook", { org: a.orgId }), platform = recorder("test.platform");
    const d = new OutboxDispatcher(db, [tenantA.sub, platform.sub], FAST);
    const ea = await emit(a.orgId), eb = await emit(b.orgId), ep = await emit(null);
    await drain(d);
    expect(tenantA.seen.map((e) => e.id)).toEqual([ea]);
    expect([platform.count(ea), platform.count(eb), platform.count(ep)]).toEqual([1, 1, 1]);
    for (const id of [ea, eb, ep]) expect((await row(id)).delivered_at).not.toBeNull();
  });

  it("rejects ambiguous subscriber registrations", () => {
    const s = recorder("test.same").sub;
    expect(() => new OutboxDispatcher(db, [s, s])).toThrow(/duplicate subscriber/);
    expect(() => new OutboxDispatcher(db, [{ ...s, name: "Bad Name" }])).toThrow(/invalid subscriber/);
  });
});
