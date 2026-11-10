/**
 * v3 Phase B.24 (ADR-099): the report's publish gate (contracts reportGate). A report is made, shared, or its assessment published only
 * while a person has confirmed at least one track as this player in the organization; the API refuses otherwise (409 IDENTITY_UNCONFIRMED).
 */
import { reportGate, type ReportGate } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";

export async function identityGate(db: Db, playerId: string, organizationId: string): Promise<ReportGate> {
  return reportGate({ confirmed_tracks: await confirmedTrackCount(db, playerId, organizationId) });
}

/** ADR-130: how many tracks a person confirmed as this player in the organization (the badge rule's second leg) */
export async function confirmedTrackCount(db: Db, playerId: string, organizationId: string): Promise<number> {
  const r = await db.one<RowDataPacket>(
    `SELECT COUNT(*) AS n FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN pipeline_runs r ON r.id = t.run_id
      WHERE ci.player_id = ? AND ci.state = 'CONFIRMED' AND r.organization_id = ? AND t.class_name = 'PERSON'`, [playerId, organizationId]);
  return Number(r?.n ?? 0);
}

export async function requireIdentity(db: Db, playerId: string, organizationId: string): Promise<void> {
  const g = await identityGate(db, playerId, organizationId);
  if (!g.ok) throw new ApiError(409, "IDENTITY_UNCONFIRMED", g.reasons.join(" "));
}
