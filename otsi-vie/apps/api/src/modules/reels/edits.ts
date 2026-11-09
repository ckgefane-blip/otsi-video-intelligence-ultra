/**
 * v3 Phase B.1 (ADR-081, S11): a reel's edit history on the server, shared by Reel Builder and Clip Studio.
 *
 *   GET  /v1/reels/:id/history          the reel's edits, undos and redos (newest first) and what Undo / Redo would do now
 *   POST /v1/reels/:id/history/undo     put back the state before the latest active edit ({to_edit_id}: before that edit, undoing all after it)
 *   POST /v1/reels/:id/history/redo     put back the state after the most recently undone edit
 *
 * Every content change of a reel (ReelsService) runs inside a transaction that snapshots the reel's editable state first (locking the reel)
 * and records one EDIT row with the state before and after, if anything changed. Undo / Redo are compensating changes: they write a recorded
 * state back and add their own row; nothing is deleted, so the history stays complete and auditable. Undo is refused (409) when the reel is no
 * longer what the edit left it (a change that was not recorded), so it never overwrites someone's work. A clip with review decisions cannot be
 * taken out by an undo (409), as it cannot be removed by hand.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { ReelHistory, ReelUndoRequest, type Reel } from "@otsi-vie/contracts";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { ReelsService } from "./reels";
import { insertRow, parse, restore, snapshot, stateHash, type EditState } from "./edit-state";

@Injectable()
export class ReelHistoryService {
  constructor(private readonly db: Db, private readonly reels: ReelsService) {}

  private async reel(id: string, p: Principal, c?: PoolConnection) {
    const r = await this.db.one<RowDataPacket>(`SELECT id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL${c ? " FOR UPDATE" : ""}`,
      [id, p.organizationId], c ?? this.db.pool);
    if (!r) throw notFound("Reel");
  }

  async history(id: string, p: Principal): Promise<ReelHistory> {
    await this.reel(id, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT e.id, e.seq, e.kind, e.action, e.label, e.state, e.target_edit_id, e.actor_user_id, u.display_name, e.created_at
         FROM reel_edits e LEFT JOIN users u ON u.id = e.actor_user_id
        WHERE e.reel_id = ? AND e.organization_id = ? ORDER BY e.seq DESC LIMIT 200`, [id, p.organizationId]);
    const undo = await this.db.one<RowDataPacket>("SELECT label FROM reel_edits WHERE reel_id = ? AND kind = 'EDIT' AND state = 'ACTIVE' ORDER BY seq DESC LIMIT 1", [id]);
    const redo = await this.db.one<RowDataPacket>("SELECT label FROM reel_edits WHERE reel_id = ? AND kind = 'EDIT' AND state = 'UNDONE' ORDER BY seq ASC LIMIT 1", [id]);
    return ReelHistory.parse({
      entries: rows.map((r) => ({ id: r.id, seq: Number(r.seq), kind: r.kind, action: r.action, label: r.label, state: r.state ?? null, target_edit_id: r.target_edit_id ?? null,
        actor: r.actor_user_id ? { user_id: r.actor_user_id, name: r.display_name ?? "A former member" } : null, created_at: new Date(r.created_at).toISOString() })),
      can_undo: !!undo, can_redo: !!redo, undo_label: (undo?.label as string | undefined) ?? null, redo_label: (redo?.label as string | undefined) ?? null,
    });
  }

  async undo(id: string, body: ReelUndoRequest, p: Principal): Promise<Reel> {
    await this.db.tx(async (c) => {
      await this.reel(id, p, c);
      const [active] = await c.query<RowDataPacket[]>(
        "SELECT id, seq, label, before_state, after_hash FROM reel_edits WHERE reel_id = ? AND kind = 'EDIT' AND state = 'ACTIVE' ORDER BY seq DESC", [id]);
      if (!active.length) throw new ApiError(409, "NOTHING_TO_UNDO", "There is nothing to undo in this reel.");
      let upto = 1;
      if (body.to_edit_id) {
        upto = active.findIndex((e) => e.id === body.to_edit_id) + 1;
        if (!upto) throw new ApiError(409, "NOT_UNDOABLE", "That edit is not in the reel any more (it was undone already).");
      }
      for (const e of active.slice(0, upto)) {
        const cur = await snapshot(c, id);
        if (stateHash(cur) !== e.after_hash) throw new ApiError(409, "REEL_CHANGED", "The reel was changed in a way the history did not record; it cannot be undone safely.");
        const to = parse(e.before_state) as EditState;
        await restore(c, id, to);
        await c.query("UPDATE reel_edits SET state = 'UNDONE' WHERE id = ?", [e.id]);
        await insertRow(c, p.organizationId, id, { kind: "UNDO", action: "reel.undo", label: `Undo: ${e.label as string}`, state: null, target: e.id, actor: p.userId, before: cur, after: to });
      }
      await recordChange(c, userActor(p), { action: "reel.undone", entityType: "reel", entityId: id, after: { edits: active.slice(0, upto).map((e) => e.id) } });
    });
    return this.reels.get(id, p);
  }

  async redo(id: string, p: Principal): Promise<Reel> {
    await this.db.tx(async (c) => {
      await this.reel(id, p, c);
      const [rows] = await c.query<RowDataPacket[]>(
        "SELECT id, label, before_hash, after_state FROM reel_edits WHERE reel_id = ? AND kind = 'EDIT' AND state = 'UNDONE' ORDER BY seq ASC LIMIT 1", [id]);
      const e = rows[0];
      if (!e) throw new ApiError(409, "NOTHING_TO_REDO", "There is nothing to redo in this reel.");
      const cur = await snapshot(c, id);
      if (stateHash(cur) !== e.before_hash) throw new ApiError(409, "REEL_CHANGED", "The reel was changed in a way the history did not record; it cannot be redone safely.");
      const to = parse(e.after_state) as EditState;
      await restore(c, id, to);
      await c.query("UPDATE reel_edits SET state = 'ACTIVE' WHERE id = ?", [e.id]);
      await insertRow(c, p.organizationId, id, { kind: "REDO", action: "reel.redo", label: `Redo: ${e.label as string}`, state: null, target: e.id, actor: p.userId, before: cur, after: to });
      await recordChange(c, userActor(p), { action: "reel.redone", entityType: "reel", entityId: id, after: { edit: e.id } });
    });
    return this.reels.get(id, p);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class ReelHistoryController {
  constructor(private readonly history: ReelHistoryService) {}

  @Get("reels/:reelId/history")
  list(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.history.history(uuidParam(id, "Reel"), p);
  }

  @Post("reels/:reelId/history/undo")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  undo(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.history.undo(uuidParam(id, "Reel"), ReelUndoRequest.parse(body ?? {}), p);
  }

  @Post("reels/:reelId/history/redo")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  redo(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.history.redo(uuidParam(id, "Reel"), p);
  }
}
