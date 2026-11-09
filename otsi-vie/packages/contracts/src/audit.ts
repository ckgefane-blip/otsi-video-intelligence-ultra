/**
 * Audit log contracts (F59, ADR-019). The log is read per organization by its OWNER / ADMIN; it is never edited through the API.
 */
import { z } from "zod";

export const AuditActorKind = z.enum(["USER", "SERVICE", "SYSTEM"]);

export const AuditEventView = z.object({
  id: z.number().int().positive(),
  occurred_at: z.string(),
  actor_kind: AuditActorKind,
  /** the user, for USER rows */
  actor_id: z.string().uuid().nullable(),
  /** the component, for SERVICE / SYSTEM rows (e.g. "outbox-dispatcher") */
  actor_service: z.string().nullable(),
  action: z.string(),
  entity_type: z.string(),
  entity_id: z.string().uuid().nullable(),
  /** the API request that caused the change (the X-Request-Id of that response) */
  request_id: z.string().nullable(),
  before_state: z.unknown().nullable(),
  after_state: z.unknown().nullable(),
});
export type AuditEventView = z.infer<typeof AuditEventView>;

export const AuditQuery = z.object({
  entity_type: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
  entity_id: z.string().uuid().optional(),
  action: z.string().regex(/^[a-z][a-z0-9_]*([.][a-z][a-z0-9_]*)+$/).optional(),
  /** newest first; pass the previous page's `next_before_id` to continue */
  before_id: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

export const AuditPage = z.object({ items: z.array(AuditEventView), next_before_id: z.number().int().positive().nullable() });
export type AuditPage = z.infer<typeof AuditPage>;
