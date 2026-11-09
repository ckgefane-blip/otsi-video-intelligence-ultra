/**
 * The general audit writer (F59, ADR-019). Every module records its changes through `writeAudit` / `recordChange` — never with its
 * own INSERT — so every row has the same shape: who (a user, or a named SERVICE / SYSTEM component), for which organization, what
 * (a dotted action name), on which entity, the request that caused it, and redacted before/after states.
 *
 * Rows are written with the caller's executor, i.e. inside the business transaction: the audit row exists if and only if the change
 * committed. `recordChange` also publishes the matching outbox event in that transaction (audit and event never disagree).
 * The table is append-only in the database (0005 triggers, runtime account has SELECT + INSERT only; ADR-013).
 */
import type { Principal } from "./auth";
import type { Executor } from "./db";
import { OutboxMessage, publish } from "./outbox/publish";
import { redact } from "./redact";

export const AUDIT_ACTION = /^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/;
const ENTITY_TYPE = /^[a-z][a-z0-9_]*$/;
const SERVICE_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** a state larger than this is stored as a size marker: audit rows describe changes, they do not archive documents */
export const MAX_STATE_BYTES = 64 * 1024;

export type Actor =
  | { kind: "USER"; userId: string; organizationId: string; requestId?: string | undefined }
  | { kind: "SERVICE" | "SYSTEM"; service: string; organizationId: string; requestId?: string | undefined };

/** The actor of an authenticated API request: the user, in the organization the request acts for, with its request id. */
export const userActor = (p: Principal): Actor => ({ kind: "USER", userId: p.userId, organizationId: p.organizationId, requestId: p.requestId });
export const serviceActor = (service: string, organizationId: string, requestId?: string): Actor => ({ kind: "SERVICE", service, organizationId, requestId });

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function state(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(redact(v));
  const bytes = Buffer.byteLength(s, "utf8");
  return bytes > MAX_STATE_BYTES ? JSON.stringify({ _omitted: "state too large for the audit log", bytes }) : s;
}

/** Append one audit row; returns its id. Throws (and so rolls the caller's transaction back) on an invalid entry. */
export async function writeAudit(ex: Executor, actor: Actor, e: AuditEntry): Promise<number> {
  if (!AUDIT_ACTION.test(e.action)) throw new Error(`invalid audit action "${e.action}" (dotted lower-case, e.g. match.created)`);
  if (!ENTITY_TYPE.test(e.entityType)) throw new Error(`invalid audit entity type "${e.entityType}"`);
  if (e.entityId != null && !UUID.test(e.entityId)) throw new Error("audit entity id must be a UUID");
  if (!UUID.test(actor.organizationId)) throw new Error("audit organization id must be a UUID");
  if (actor.kind !== "USER" && !SERVICE_NAME.test(actor.service)) throw new Error(`invalid service name "${actor.service}"`);
  const [r] = await ex.query(
    `INSERT INTO audit_events (organization_id, actor_id, actor_kind, actor_service, action, entity_type, entity_id, request_id, before_state, after_state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [actor.organizationId, actor.kind === "USER" ? actor.userId : null, actor.kind, actor.kind === "USER" ? null : actor.service,
     e.action, e.entityType, e.entityId ?? null, actor.requestId?.slice(0, 255) ?? null, state(e.before), state(e.after)]);
  return Number((r as { insertId: number }).insertId);
}

export interface Change extends AuditEntry {
  /** the outbox event announcing this change (same organization; aggregate defaults to the audited entity) */
  event?: Omit<OutboxMessage, "organizationId" | "aggregateType" | "aggregateId"> & { aggregateType?: string; aggregateId?: string };
}

/** Audit a change and publish its event in the caller's transaction. */
export async function recordChange(ex: Executor, actor: Actor, c: Change): Promise<{ auditId: number; outboxId: number | null }> {
  const auditId = await writeAudit(ex, actor, c);
  if (!c.event) return { auditId, outboxId: null };
  const aggregateId = c.event.aggregateId ?? c.entityId;
  if (!aggregateId) throw new Error("an event needs an aggregate id (or an audited entity id)");
  const out = await publish(ex, {
    ...c.event,
    organizationId: actor.organizationId,
    aggregateType: c.event.aggregateType ?? c.entityType,
    aggregateId,
  });
  return { auditId, outboxId: out.id };
}
