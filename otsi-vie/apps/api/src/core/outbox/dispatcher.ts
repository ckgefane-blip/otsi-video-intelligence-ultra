/**
 * The outbox dispatcher (ADR-018): delivers committed `outbox_events` to in-process subscribers (job starters, notification fan-out,
 * search indexing, webhooks...). Delivery is AT-LEAST-ONCE; nothing here pretends external effects happen exactly once.
 *
 *  claim      one short transaction: open (not delivered, not dead), due, lease free, and no EARLIER open event for the same aggregate
 *             (per-aggregate order), `FOR UPDATE OF o SKIP LOCKED` so concurrent dispatchers take disjoint rows without waiting. The row
 *             gets a fresh claim token (fencing), a lease, and attempt_count + 1.
 *  deliver    per matching subscriber that has no receipt yet, in its OWN transaction: lock the event row and check the claim token is
 *             still ours (a dispatcher whose lease was taken over stops), insert the receipt, run the handler with that transaction.
 *             The handler's own database effects commit together with the receipt, so a local effect happens once; an external effect
 *             gets a stable idempotency key `<event id>:<subscriber>` to pass on to the remote side.
 *  complete   all receipts present -> delivered. A failure -> retried later with capped exponential back-off and jitter; after
 *             `maxAttempts` the event is dead-lettered (never claimed again until an operator re-drives it) and audited.
 *  crash      a dispatcher that dies holds no database locks; its lease expires and another dispatcher reclaims the row. Subscribers that
 *             had already completed are skipped thanks to their receipts.
 *  tenants    an event is offered only to subscribers whose `organizationId` (if set) equals the event's organization. Platform events
 *             (organization NULL) never reach a tenant-scoped subscriber.
 *  errors     `last_error` keeps "<subscriber>: <message>" redacted (redact.ts) and truncated; payloads and stack traces are not stored.
 */
import { Logger } from "@nestjs/common";
import { PoolConnection, RowDataPacket } from "mysql2/promise";
import { v4 as uuidv4 } from "uuid";
import { serviceActor, writeAudit } from "../audit";
import type { Db } from "../db";
import { redactText } from "../redact";

export interface OutboxEvent {
  id: number;
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  dedupeKey: string | null;
  /** 1 on the first delivery attempt */
  attempt: number;
  createdAt: string;
}

export interface DeliveryContext {
  /** the transaction that also records this subscriber's receipt: write local effects with it */
  tx: PoolConnection;
  /** stable across redeliveries of this event to this subscriber */
  idempotencyKey: string;
  /** aborted when the handler exceeds its time limit */
  signal: AbortSignal;
}

export interface Subscriber {
  /** stable identifier stored in receipts (lower-case, e.g. "jobs.starter"); renaming it makes old events look undelivered to it */
  name: string;
  /** event types handled, or "*" */
  eventTypes: readonly string[] | "*";
  /** a tenant-scoped subscriber (e.g. one organization's webhook) sees only that organization's events */
  organizationId?: string;
  handle(event: OutboxEvent, ctx: DeliveryContext): Promise<void>;
}

export interface DispatcherOptions {
  /** identifies this process in logs */
  workerId: string;
  batchSize: number;
  leaseMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  handlerTimeoutMs: number;
  /** jitter source, injectable for tests; returns [0, 1) */
  random: () => number;
}

export const DEFAULT_DISPATCHER_OPTIONS: DispatcherOptions = {
  workerId: `dispatcher-${uuidv4().slice(0, 8)}`,
  batchSize: 20,
  leaseMs: 60_000,
  maxAttempts: 10,
  backoffBaseMs: 2_000,
  backoffMaxMs: 15 * 60_000,
  handlerTimeoutMs: 30_000,
  random: Math.random,
};

export type Outcome = "delivered" | "retry" | "dead" | "lost";
export interface RunReport { claimed: number; delivered: number; retried: number; dead: number; lost: number }

export interface Claim { event: OutboxEvent; token: string }

interface EventRow extends RowDataPacket {
  id: number; organization_id: string | null; aggregate_type: string; aggregate_id: string; event_type: string;
  event_payload: unknown; dedupe_key: string | null; attempt_count: number; created_at: string;
}

const SUBSCRIBER_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;
const SERVICE = "outbox-dispatcher";

class LeaseLost extends Error {}
class HandlerTimeout extends Error {}

export class OutboxDispatcher {
  readonly opts: DispatcherOptions;
  private readonly log = new Logger("OutboxDispatcher");
  private running = false;
  private loop: Promise<void> | undefined;
  private wake: (() => void) | undefined;

  constructor(private readonly db: Db, private readonly subscribers: readonly Subscriber[], opts: Partial<DispatcherOptions> = {}) {
    this.opts = { ...DEFAULT_DISPATCHER_OPTIONS, ...opts };
    const names = new Set<string>();
    for (const s of subscribers) {
      if (!SUBSCRIBER_NAME.test(s.name)) throw new Error(`invalid subscriber name "${s.name}"`);
      if (names.has(s.name)) throw new Error(`duplicate subscriber name "${s.name}"`);
      names.add(s.name);
    }
    if (this.opts.maxAttempts < 1 || this.opts.batchSize < 1 || this.opts.leaseMs < 1) throw new Error("invalid dispatcher options");
  }

  private matching(e: OutboxEvent): Subscriber[] {
    return this.subscribers.filter((s) =>
      (s.eventTypes === "*" || s.eventTypes.includes(e.eventType)) &&
      (s.organizationId === undefined || s.organizationId === e.organizationId));
  }

  /** Claim up to `batchSize` due events (see the header for the rules). */
  async claim(limit = this.opts.batchSize): Promise<Claim[]> {
    const token = uuidv4();
    return this.db.retryTransient(() => this.db.tx(async (c) => {
      const [ids] = await c.query<RowDataPacket[]>(
        `SELECT o.id FROM outbox_events o
          WHERE o.delivered_at IS NULL AND o.dead_lettered_at IS NULL AND o.available_at <= CURRENT_TIMESTAMP(6)
            AND (o.lease_expires_at IS NULL OR o.lease_expires_at <= CURRENT_TIMESTAMP(6))
            AND NOT EXISTS (SELECT 1 FROM outbox_events p
                             WHERE p.aggregate_type = o.aggregate_type AND p.aggregate_id = o.aggregate_id AND p.id < o.id
                               AND p.delivered_at IS NULL AND p.dead_lettered_at IS NULL)
          ORDER BY o.id LIMIT ? FOR UPDATE OF o SKIP LOCKED`, [limit]);
      if (ids.length === 0) return [];
      const list = ids.map((r) => Number(r.id));
      await c.query(
        `UPDATE outbox_events SET claim_token = ?, claimed_at = CURRENT_TIMESTAMP(6), attempt_count = attempt_count + 1,
                lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND)
          WHERE id IN (?)`, [token, this.opts.leaseMs * 1000, list]);
      const [rows] = await c.query<EventRow[]>(
        `SELECT id, organization_id, aggregate_type, aggregate_id, event_type, event_payload, dedupe_key, attempt_count, created_at
           FROM outbox_events WHERE id IN (?) ORDER BY id`, [list]);
      return rows.map((r) => ({
        token,
        event: {
          id: Number(r.id), organizationId: r.organization_id, aggregateType: r.aggregate_type, aggregateId: r.aggregate_id,
          eventType: r.event_type, payload: typeof r.event_payload === "string" ? JSON.parse(r.event_payload) : r.event_payload,
          dedupeKey: r.dedupe_key, attempt: Number(r.attempt_count), createdAt: r.created_at,
        },
      }));
    }));
  }

  /** Run one subscriber in its own transaction, fenced by the claim token. */
  private async deliverTo(s: Subscriber, claim: Claim): Promise<void> {
    const c = await this.db.pool.getConnection();
    let destroy = false;
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      await c.beginTransaction();
      const [own] = await c.query<RowDataPacket[]>("SELECT claim_token FROM outbox_events WHERE id = ? FOR UPDATE", [claim.event.id]);
      if (own[0]?.claim_token !== claim.token) throw new LeaseLost();
      try {
        await c.query("INSERT INTO event_consumer_receipts (outbox_event_id, subscriber) VALUES (?, ?)", [claim.event.id, s.name]);
      } catch (e) {
        if ((e as { errno?: number }).errno === 1062) { await c.rollback(); return; }      // already completed by an earlier attempt
        throw e;
      }
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { ac.abort(); reject(new HandlerTimeout(`timed out after ${this.opts.handlerTimeoutMs} ms`)); }, this.opts.handlerTimeoutMs);
      });
      try {
        await Promise.race([s.handle(claim.event, { tx: c, idempotencyKey: `${claim.event.id}:${s.name}`, signal: ac.signal }), timeout]);
      } catch (e) {
        if (e instanceof HandlerTimeout) destroy = true;          // the handler may still be using the connection: never reuse it
        throw e;
      }
      await c.commit();
    } catch (e) {
      if (!destroy) await c.rollback().catch(() => { destroy = true; });
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
      if (destroy) c.destroy(); else c.release();
    }
  }

  private backoffMs(attempt: number): number {
    const exp = Math.min(this.opts.backoffMaxMs, this.opts.backoffBaseMs * 2 ** Math.max(0, attempt - 1));
    return Math.round(exp * (0.5 + 0.5 * this.opts.random()));            // "equal jitter": spreads retries, never zero
  }

  /** Deliver one claimed event to every matching subscriber and settle it. */
  async process(claim: Claim): Promise<Outcome> {
    const e = claim.event;
    // renew the lease now: events later in a batch would otherwise expire while earlier ones are processed
    const [renewed] = await this.db.pool.query(
      `UPDATE outbox_events SET lease_expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND)
        WHERE id = ? AND claim_token = ? AND lease_expires_at > CURRENT_TIMESTAMP(6)`, [this.opts.leaseMs * 1000, e.id, claim.token]);
    if ((renewed as { affectedRows: number }).affectedRows !== 1) return "lost";
    const [done] = await this.db.pool.query<RowDataPacket[]>("SELECT subscriber FROM event_consumer_receipts WHERE outbox_event_id = ?", [e.id]);
    const completed = new Set(done.map((r) => String(r.subscriber)));
    const failures: string[] = [];
    for (const s of this.matching(e)) {
      if (completed.has(s.name)) continue;
      try {
        await this.deliverTo(s, claim);
      } catch (err) {
        if (err instanceof LeaseLost) {
          this.log.warn(`event ${e.id}: lease lost to another dispatcher; stopping`);
          return "lost";
        }
        failures.push(`${s.name}: ${redactText(err instanceof Error ? err.message : String(err))}`);
      }
    }
    if (failures.length === 0) {
      const [r] = await this.db.pool.query(
        `UPDATE outbox_events SET delivered_at = CURRENT_TIMESTAMP(6), claim_token = NULL, lease_expires_at = NULL, last_error = NULL
          WHERE id = ? AND claim_token = ?`, [e.id, claim.token]);
      return (r as { affectedRows: number }).affectedRows === 1 ? "delivered" : "lost";
    }
    const lastError = failures.join(" | ").slice(0, 1000);
    if (e.attempt >= this.opts.maxAttempts) {
      const dead = await this.db.tx(async (c) => {
        const [r] = await c.query(
          `UPDATE outbox_events SET dead_lettered_at = CURRENT_TIMESTAMP(6), claim_token = NULL, lease_expires_at = NULL, last_error = ?
            WHERE id = ? AND claim_token = ?`, [lastError, e.id, claim.token]);
        if ((r as { affectedRows: number }).affectedRows !== 1) return false;
        if (e.organizationId) {
          await writeAudit(c, serviceActor(SERVICE, e.organizationId, `outbox:${e.id}`), {
            action: "outbox.event_dead_lettered", entityType: e.aggregateType, entityId: e.aggregateId,
            after: { outbox_event_id: e.id, event_type: e.eventType, attempts: e.attempt, last_error: lastError },
          });
        }
        return true;
      });
      if (dead) this.log.error(`event ${e.id} (${e.eventType}) dead-lettered after ${e.attempt} attempts: ${lastError}`);
      return dead ? "dead" : "lost";
    }
    const [r] = await this.db.pool.query(
      `UPDATE outbox_events SET available_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND),
              claim_token = NULL, lease_expires_at = NULL, last_error = ?
        WHERE id = ? AND claim_token = ?`, [this.backoffMs(e.attempt) * 1000, lastError, e.id, claim.token]);
    if ((r as { affectedRows: number }).affectedRows !== 1) return "lost";
    this.log.warn(`event ${e.id} (${e.eventType}) attempt ${e.attempt} failed; will retry: ${lastError}`);
    return "retry";
  }

  /** Claim one batch and process it. */
  async runOnce(): Promise<RunReport> {
    const claims = await this.claim();
    const report: RunReport = { claimed: claims.length, delivered: 0, retried: 0, dead: 0, lost: 0 };
    for (const c of claims) {
      const o = await this.process(c);
      if (o === "delivered") report.delivered++;
      else if (o === "retry") report.retried++;
      else if (o === "dead") report.dead++;
      else report.lost++;
    }
    return report;
  }

  /** Poll until `stop()`: immediately again after a full batch, otherwise after `pollMs`. */
  start(pollMs = 500): void {
    if (this.running) return;
    this.running = true;
    this.loop = (async () => {
      while (this.running) {
        let full = false;
        try {
          const r = await this.runOnce();
          full = r.claimed >= this.opts.batchSize;
        } catch (err) {
          this.log.error(`dispatch cycle failed: ${redactText(err instanceof Error ? err.message : String(err))}`);
        }
        if (!full && this.running) await new Promise<void>((res) => { this.wake = res; setTimeout(res, pollMs); });
      }
    })();
  }

  /** Stop polling and wait for the batch in progress to settle. */
  async stop(): Promise<void> {
    this.running = false;
    this.wake?.();
    await this.loop;
  }
}

export interface OutboxStats { due: number; scheduled: number; in_flight: number; dead_lettered: number; oldest_open_seconds: number | null }

/** Operator view of the outbox (metrics endpoint / dashboard, block 15). */
export async function outboxStats(db: Db): Promise<OutboxStats> {
  const [rows] = await db.pool.query<RowDataPacket[]>(
    `SELECT
       SUM(dead_lettered_at IS NULL AND available_at <= CURRENT_TIMESTAMP(6) AND (lease_expires_at IS NULL OR lease_expires_at <= CURRENT_TIMESTAMP(6))) AS due,
       SUM(dead_lettered_at IS NULL AND available_at > CURRENT_TIMESTAMP(6) AND lease_expires_at IS NULL) AS scheduled,
       SUM(dead_lettered_at IS NULL AND lease_expires_at > CURRENT_TIMESTAMP(6)) AS in_flight,
       SUM(dead_lettered_at IS NOT NULL) AS dead_lettered,
       TIMESTAMPDIFF(SECOND, MIN(IF(dead_lettered_at IS NULL, created_at, NULL)), CURRENT_TIMESTAMP(6)) AS oldest_open_seconds
     FROM outbox_events WHERE delivered_at IS NULL`);
  const r = rows[0]!;
  return {
    due: Number(r.due ?? 0), scheduled: Number(r.scheduled ?? 0), in_flight: Number(r.in_flight ?? 0),
    dead_lettered: Number(r.dead_lettered ?? 0), oldest_open_seconds: r.oldest_open_seconds === null ? null : Number(r.oldest_open_seconds),
  };
}

/**
 * Operator re-drive of a dead-lettered event (after fixing the cause): it becomes due again with a fresh attempt budget.
 * Receipts are kept, so subscribers that had succeeded are not repeated. Audited as the operator's action.
 */
export async function redrive(db: Db, eventId: number, operator: { userId: string; organizationId: string; requestId?: string }): Promise<boolean> {
  return db.tx(async (c) => {
    const [r] = await c.query(
      `UPDATE outbox_events SET dead_lettered_at = NULL, attempt_count = 0, available_at = CURRENT_TIMESTAMP(6), last_error = NULL
        WHERE id = ? AND dead_lettered_at IS NOT NULL AND organization_id = ?`, [eventId, operator.organizationId]);
    if ((r as { affectedRows: number }).affectedRows !== 1) return false;
    const [ev] = await c.query<RowDataPacket[]>("SELECT aggregate_type, aggregate_id, event_type FROM outbox_events WHERE id = ?", [eventId]);
    await writeAudit(c, { kind: "USER", ...operator }, {
      action: "outbox.event_redriven", entityType: String(ev[0]!.aggregate_type), entityId: String(ev[0]!.aggregate_id),
      after: { outbox_event_id: eventId, event_type: ev[0]!.event_type },
    });
    return true;
  });
}
