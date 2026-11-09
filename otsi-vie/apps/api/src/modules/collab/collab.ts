/**
 * Collaboration basics (Library Section 10, Library saved searches, Clip Studio notes).
 *
 *   GET    /v1/members                      the organization's active members (name and role): who can see its assets
 *   GET    /v1/saved-searches               the caller's own saved Library searches in this organization (not his Smart Bins, B.11)
 *   POST   /v1/saved-searches               save one (name unique per person; saving the same name again replaces it)
 *   DELETE /v1/saved-searches/:id           delete one of the caller's own
 *   GET    /v1/reels/:id/notes              notes on a reel's timeline, oldest first
 *   POST   /v1/reels/:id/notes              add a note at a source timestamp (writers)
 *   DELETE /v1/reels/:id/notes/:noteId      delete a note (its author, or an owner / admin)
 *
 * Everything is scoped to the caller's organization; another organization's ids answer 404. Notes are audited.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { CreateReelNoteRequest, CreateSavedSearchRequest, type Member, type ReelNote, type SavedSearch } from "@otsi-vie/contracts";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const iso = (v: unknown) => new Date(v as string).toISOString();
const obj = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;

@Injectable()
export class CollabService {
  constructor(private readonly db: Db) {}

  async members(p: Principal): Promise<Member[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT u.id, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? AND m.status = 'ACTIVE' ORDER BY u.display_name, u.id`, [p.organizationId]);
    return rows.map((r) => ({ user_id: r.id, display_name: r.display_name, role: r.role }));
  }

  async searches(p: Principal): Promise<SavedSearch[]> {
    const rows = await this.db.rows<RowDataPacket>(
      "SELECT id, name, query, created_at FROM saved_searches WHERE organization_id = ? AND user_id = ? AND JSON_EXTRACT(query, '$.smart') IS NULL ORDER BY created_at, id", [p.organizationId, p.userId]);
    return rows.map((r) => ({ id: r.id, name: r.name, query: obj(r.query), created_at: iso(r.created_at) }));
  }

  async saveSearch(body: CreateSavedSearchRequest, p: Principal): Promise<SavedSearch> {
    // B.11: a Smart Bin of the same name is not overwritten by a Library search (nor a Library search saved as a bin)
    if ("smart" in body.query) throw new ApiError(422, "BAD_SAVED_SEARCH", "Smart Bins are saved with POST /v1/smart-bins.");
    const bin = await this.db.one<RowDataPacket>("SELECT id FROM saved_searches WHERE organization_id = ? AND user_id = ? AND name = ? AND JSON_EXTRACT(query, '$.smart') IS NOT NULL",
      [p.organizationId, p.userId, body.name]);
    if (bin) throw new ApiError(409, "NAME_TAKEN", `“${body.name}” is already one of your Smart Bins. Choose another name.`);
    await this.db.pool.query(
      `INSERT INTO saved_searches (id, organization_id, user_id, name, query) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE query = VALUES(query)`, [uuidv7(), p.organizationId, p.userId, body.name, JSON.stringify(body.query)]);
    const r = await this.db.one<RowDataPacket>("SELECT id, name, query, created_at FROM saved_searches WHERE organization_id = ? AND user_id = ? AND name = ?",
      [p.organizationId, p.userId, body.name]);
    return { id: r!.id, name: r!.name, query: obj(r!.query), created_at: iso(r!.created_at) };
  }

  async deleteSearch(id: string, p: Principal): Promise<void> {
    const [res] = await this.db.pool.query<ResultSetHeader>("DELETE FROM saved_searches WHERE id = ? AND organization_id = ? AND user_id = ? AND JSON_EXTRACT(query, '$.smart') IS NULL", [id, p.organizationId, p.userId]);
    if (res.affectedRows === 0) throw notFound("Saved search");
  }

  private async reel(id: string, p: Principal) {
    const r = await this.db.one<RowDataPacket>("SELECT id, project_id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, p.organizationId]);
    if (!r) throw notFound("Reel");
    return r;
  }

  async notes(reelId: string, p: Principal): Promise<ReelNote[]> {
    await this.reel(reelId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT c.id, c.body, c.at_pts_us, c.created_at, u.id AS uid, u.display_name FROM comments c JOIN users u ON u.id = c.author_id
        WHERE c.reel_id = ? AND c.organization_id = ? AND c.share_link_id IS NULL ORDER BY c.created_at, c.id`, [reelId, p.organizationId]);
    return rows.map((r) => ({ id: r.id, body: r.body, at_pts_us: r.at_pts_us === null ? null : Number(r.at_pts_us),
      author: { user_id: r.uid, display_name: r.display_name }, created_at: iso(r.created_at) }));
  }

  async addNote(reelId: string, body: CreateReelNoteRequest, p: Principal): Promise<ReelNote> {
    const reel = await this.reel(reelId, p);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO comments (id, organization_id, project_id, reel_id, author_id, body, at_pts_us) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, reel.project_id, reelId, p.userId, body.body, body.at_pts_us]);
      await recordChange(c, userActor(p), { action: "reel.note_added", entityType: "reel", entityId: reelId, after: { note_id: id, at_pts_us: body.at_pts_us } });
    });
    return (await this.notes(reelId, p)).find((n) => n.id === id)!;
  }

  async deleteNote(reelId: string, noteId: string, p: Principal): Promise<void> {
    await this.reel(reelId, p);
    const n = await this.db.one<RowDataPacket>("SELECT author_id FROM comments WHERE id = ? AND reel_id = ? AND organization_id = ?", [noteId, reelId, p.organizationId]);
    if (!n) throw notFound("Note");
    if (n.author_id !== p.userId && !["OWNER", "ADMIN"].includes(p.role)) throw new ApiError(403, "NOT_YOUR_NOTE", "Only its author or an owner / admin can delete a note.");
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM comments WHERE id = ?", [noteId]);
      await recordChange(c, userActor(p), { action: "reel.note_deleted", entityType: "reel", entityId: reelId, before: { note_id: noteId } });
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class CollabController {
  constructor(private readonly collab: CollabService) {}

  @Get("members")
  members(@CurrentPrincipal() p: Principal) { return this.collab.members(p); }

  @Get("saved-searches")
  searches(@CurrentPrincipal() p: Principal) { return this.collab.searches(p); }

  @Post("saved-searches")
  save(@Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.collab.saveSearch(CreateSavedSearchRequest.parse(body), p); }

  @Delete("saved-searches/:id")
  @HttpCode(204)
  async unsave(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.collab.deleteSearch(uuidParam(id, "Saved search"), p); }

  @Get("reels/:reelId/notes")
  notes(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) { return this.collab.notes(uuidParam(id, "Reel"), p); }

  @Post("reels/:reelId/notes")
  @Roles(...PROJECT_WRITERS)
  addNote(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.collab.addNote(uuidParam(id, "Reel"), CreateReelNoteRequest.parse(body), p);
  }

  @Delete("reels/:reelId/notes/:noteId")
  @HttpCode(204)
  async deleteNote(@Param("reelId") id: string, @Param("noteId") noteId: string, @CurrentPrincipal() p: Principal) {
    await this.collab.deleteNote(uuidParam(id, "Reel"), uuidParam(noteId, "Note"), p);
  }
}
