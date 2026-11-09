/**
 * Producer side of the ONE transactional outbox (ADR-012, ADR-018). A producer calls `publish` with the SAME executor (transaction)
 * that writes its business change, so the event exists if and only if the change committed. Domain and billing events use the same
 * table; a producer that may run twice for one logical event (a replayed provider webhook, a retried request) passes a `dedupeKey`
 * and the second write is reported as a duplicate instead of creating a second event.
 */
import { RowDataPacket } from "mysql2/promise";
import type { Executor } from "../db";

export const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const AGGREGATE_TYPE = /^[a-z][a-z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** payloads are references and small facts, not documents: large data lives in assets and is referenced by id */
export const MAX_PAYLOAD_BYTES = 64 * 1024;

export interface OutboxMessage {
  /** the tenant the event belongs to; null only for platform-level events (never delivered to a tenant subscriber) */
  organizationId: string | null;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  dedupeKey?: string | null;
  /** deliver no earlier than this (scheduled events); default now */
  delayMs?: number;
}

export interface Published { id: number; duplicate: boolean }

export async function publish(ex: Executor, m: OutboxMessage): Promise<Published> {
  if (!EVENT_TYPE.test(m.eventType)) throw new Error(`invalid event type "${m.eventType}" (dotted lower-case, e.g. track.identity_decided)`);
  if (!AGGREGATE_TYPE.test(m.aggregateType)) throw new Error(`invalid aggregate type "${m.aggregateType}"`);
  if (!UUID.test(m.aggregateId)) throw new Error("aggregate id must be a UUID");
  if (m.organizationId !== null && !UUID.test(m.organizationId)) throw new Error("organization id must be a UUID or null");
  if (m.dedupeKey != null && (m.dedupeKey.length === 0 || m.dedupeKey.length > 191)) throw new Error("dedupe key must be 1-191 characters");
  const body = JSON.stringify(m.payload ?? {});
  if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) throw new Error(`event payload exceeds ${MAX_PAYLOAD_BYTES} bytes; reference an asset instead`);
  try {
    const [r] = await ex.query(
      `INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload, dedupe_key, available_at)
       VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND))`,
      [m.organizationId, m.aggregateType, m.aggregateId, m.eventType, body, m.dedupeKey ?? null, Math.max(0, Math.round((m.delayMs ?? 0) * 1000))]);
    return { id: Number((r as { insertId: number }).insertId), duplicate: false };
  } catch (e) {
    const err = e as { errno?: number; sqlMessage?: string };
    // a 1062 on the dedupe key is the expected answer to a replay; any other duplicate is a real error
    if (err.errno === 1062 && m.dedupeKey != null && /uq_outbox_dedupe/.test(err.sqlMessage ?? "")) {
      const [rows] = await ex.query<RowDataPacket[]>("SELECT id FROM outbox_events WHERE dedupe_key = ?", [m.dedupeKey]);
      return { id: Number(rows[0]!.id), duplicate: true };
    }
    throw e;
  }
}
