/**
 * Track -> player identity (ADR-016 section 8). A track is temporary and belongs to one processing run of one organization; it shows
 * as "Unidentified Player" until a CONFIRMED decision names a player. Decisions are appended, never edited: a correction names the
 * decision it supersedes (optimistic concurrency: superseding anything but the CURRENT decision is a 409), carries a reason, and is
 * published on the outbox in the same transaction so events, metrics, reels and reports depending on the track are re-evaluated.
 */
import { Injectable } from "@nestjs/common";
import { IdentityDecisionRequest, IdentityHistoryEntry, TrackIdentity } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { Principal } from "../../core/auth";
import { Db, Executor } from "../../core/db";
import { ApiError, fromDatabase, notFound } from "../../core/problem";
import { PlayersService } from "../players/players.service";

interface CurrentRow extends RowDataPacket {
  decision_id: string;
  state: TrackIdentity["state"];
  player_id: string | null;
}

@Injectable()
export class TrackIdentityService {
  constructor(private readonly db: Db, private readonly players: PlayersService) {}

  /** The track, only if it belongs to the caller's organization (404 otherwise: another tenant's track does not exist for you). */
  private async scope(trackId: string, p: Principal, ex: Executor = this.db.pool, lock = false): Promise<{ internal_track_number: number }> {
    const t = await this.db.one<RowDataPacket>(
      `SELECT t.id, t.internal_track_number, r.organization_id FROM tracks t JOIN pipeline_runs r ON r.id = t.run_id WHERE t.id = ?${lock ? " FOR UPDATE" : ""}`,
      [trackId], ex);
    if (!t || t.organization_id !== p.organizationId) throw notFound("Track");
    return { internal_track_number: Number(t.internal_track_number) };
  }

  private current(trackId: string, ex: Executor = this.db.pool): Promise<CurrentRow | undefined> {
    return this.db.one<CurrentRow>("SELECT decision_id, state, player_id FROM v_track_current_identity WHERE track_id = ?", [trackId], ex);
  }

  async identity(trackId: string, p: Principal): Promise<TrackIdentity> {
    const t = await this.scope(trackId, p);
    const cur = await this.current(trackId);
    const player = cur?.player_id ? await this.players.identity(cur.player_id, p) : null;
    const identified = cur?.state === "CONFIRMED" && player !== null;
    return TrackIdentity.parse({
      track_id: trackId,
      decision_id: cur?.decision_id ?? null,
      state: cur?.state ?? "UNRESOLVED",
      player: identified ? player : null,           // a candidate is never presented as the player
      display: identified
        ? { kind: "IDENTIFIED", label: player!.canonical_otsi_id ? `${player!.display_name} · ${player!.canonical_otsi_id}` : `${player!.display_name} (provisional, no OTSI ID yet)` }
        : { kind: "UNIDENTIFIED", label: `Unidentified Player · track ${t.internal_track_number}` },
    });
  }

  /** v3 B.6 (ADR-084): every decision on the track, newest first, with who made it, when, on what basis and why */
  async history(trackId: string, p: Principal): Promise<IdentityHistoryEntry[]> {
    await this.scope(trackId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT d.id, d.state, d.player_id, d.basis, d.decided_by, u.display_name AS decider, d.decided_at, d.reason, d.supersedes_id,
              ci.decision_id AS current_id, pi.display_name, pi.canonical_otsi_id
         FROM track_identity_decisions d
         LEFT JOIN users u ON u.id = d.decided_by
         LEFT JOIN v_track_current_identity ci ON ci.track_id = d.track_id
         LEFT JOIN v_player_identity pi ON pi.player_id = d.player_id
        WHERE d.track_id = ? ORDER BY d.decided_at DESC, d.id DESC LIMIT 100`, [trackId]);
    return rows.map((r) => IdentityHistoryEntry.parse({
      decision_id: r.id, state: r.state, basis: r.basis, reason: r.reason ?? null, supersedes_id: r.supersedes_id ?? null, current: r.id === r.current_id,
      player: r.player_id ? { player_id: r.player_id, display_name: r.display_name ?? "A player no longer visible", canonical_otsi_id: r.canonical_otsi_id ?? null } : null,
      decided_by: r.decided_by ? { user_id: r.decided_by, name: r.decider ?? "A former member" } : null,
      decided_at: new Date(r.decided_at).toISOString(),
    }));
  }

  async decide(trackId: string, body: IdentityDecisionRequest, p: Principal): Promise<TrackIdentity> {
    if (body.state === "CONFIRMED" && !body.player_id) throw new ApiError(422, "PLAYER_REQUIRED", "A confirmation names the player.");
    if (body.player_id) await this.players.identity(body.player_id, p);                 // the player must be visible to this organization
    const decisionId = uuidv7();
    try {
      await this.db.tx(async (c) => {
        await this.scope(trackId, p, c, true);                                           // lock the track: decisions on it are serialized
        const cur = await this.current(trackId, c);
        if ((cur?.decision_id ?? null) !== (body.supersedes_id ?? null)) {
          throw new ApiError(409, "STALE_DECISION", "Someone changed this track's identity meanwhile; reload and decide again.");
        }
        await c.query(
          `INSERT INTO track_identity_decisions (id, track_id, player_id, state, decided_by, basis, evidence_id, supersedes_id, reason)
           VALUES (?, ?, ?, ?, ?, 'HUMAN', ?, ?, ?)`,
          [decisionId, trackId, body.player_id, body.state, p.userId, body.evidence_id, body.supersedes_id, body.reason]);
        await c.query("UPDATE tracks SET identity_state = ? WHERE id = ?", [body.state, trackId]);
        const kind = body.supersedes_id ? "track.identity_corrected" : "track.identity_decided";
        const payload = { track_id: trackId, decision_id: decisionId, supersedes_id: body.supersedes_id, state: body.state, player_id: body.player_id };
        await recordChange(c, userActor(p), {
          action: kind, entityType: "track", entityId: trackId, after: payload,
          before: cur ? { decision_id: cur.decision_id, state: cur.state, player_id: cur.player_id } : null,
          event: { eventType: kind, payload, dedupeKey: `track-identity:${decisionId}` },
        });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return this.identity(trackId, p);
  }
}
