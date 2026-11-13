/**
 * The organisation's current plan code, read the same way the licence reads it (licence.ts `subscription`): the newest
 * TRIALING or ACTIVE subscription; none is the Free plan. Used where the approved price list depends on the plan — the
 * top-up rate and the upload limit per video (owner, 2026-11-13). One query, so the wallet, uploads and the licence agree.
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Db, Executor } from "./db";

export async function currentPlanCode(db: Db, organizationId: string, ex?: Executor): Promise<string> {
  const row = await db.one<RowDataPacket>(
    `SELECT p.code AS plan_code
       FROM subscriptions s
       JOIN plan_versions pv ON pv.id = s.plan_version_id
       JOIN plans p ON p.id = pv.plan_id
      WHERE s.organization_id = ? AND s.state IN ('TRIALING', 'ACTIVE')
      ORDER BY (s.period_end IS NULL) DESC, s.period_end DESC, s.created_at DESC LIMIT 1`,
    [organizationId], ex);
  return row ? String(row.plan_code) : "FREE";
}
