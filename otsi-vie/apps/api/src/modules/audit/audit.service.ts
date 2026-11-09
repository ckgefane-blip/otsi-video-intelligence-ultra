/**
 * Reading the audit log (F59). Always scoped to the caller's organization: the filter is applied in SQL, so another tenant's rows are
 * never loaded, whatever the query parameters say.
 */
import { Injectable } from "@nestjs/common";
import { AuditEventView, AuditPage, AuditQuery } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { Principal } from "../../core/auth";
import { Db } from "../../core/db";

@Injectable()
export class AuditService {
  constructor(private readonly db: Db) {}

  async list(q: AuditQuery, p: Principal): Promise<AuditPage> {
    const where = ["organization_id = ?"];
    const args: unknown[] = [p.organizationId];
    if (q.entity_type) { where.push("entity_type = ?"); args.push(q.entity_type); }
    if (q.entity_id) { where.push("entity_id = ?"); args.push(q.entity_id); }
    if (q.action) { where.push("action = ?"); args.push(q.action); }
    if (q.before_id) { where.push("id < ?"); args.push(q.before_id); }
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT id, occurred_at, actor_kind, actor_id, actor_service, action, entity_type, entity_id, request_id, before_state, after_state
         FROM audit_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`, [...args, q.limit + 1]);
    const page = rows.slice(0, q.limit);
    return AuditPage.parse({
      items: page.map((r) => AuditEventView.parse({ ...r, id: Number(r.id) })),
      next_before_id: rows.length > q.limit ? Number(page[page.length - 1]!.id) : null,
    });
  }
}
