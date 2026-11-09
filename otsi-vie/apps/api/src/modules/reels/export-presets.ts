/**
 * v3 Phase B.22 (ADR-097, migration 0058): the export preset library.
 *
 *   GET    /v1/export-presets        the built-in presets, the organization's, and the caller's own (newest first within each)
 *   POST   /v1/export-presets        save a preset { name, scope ORGANIZATION | PERSONAL, note, spec }: an organization preset needs an owner
 *                                    or admin; a personal one any member who can export (a writer)
 *   DELETE /v1/export-presets/:id    an organization preset: an owner or admin; a personal one: its owner only
 *
 * Every query is scoped to the caller's organization; another member's personal presets are never listed or deleted.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { BUILTIN_PRESETS, CreateExportPresetRequest, ExportPreset, ExportPresetSpec } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const ADMINS = ["OWNER", "ADMIN"];

@Injectable()
export class ExportPresetsService {
  constructor(private readonly db: Db) {}

  private toPreset(r: RowDataPacket, p: Principal): ExportPreset {
    const personal = r.owner_user_id !== null;
    return ExportPreset.parse({ id: r.id, name: r.name, scope: personal ? "PERSONAL" : "ORGANIZATION", note: r.note ?? "",
      spec: ExportPresetSpec.parse(typeof r.spec === "string" ? JSON.parse(r.spec) : r.spec), created_by: r.created_by_name ?? null,
      created_at: new Date(r.created_at).toISOString(), can_delete: personal ? r.owner_user_id === p.userId : ADMINS.includes(p.role) });
  }

  async list(p: Principal): Promise<ExportPreset[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT e.*, u.display_name AS created_by_name FROM export_presets e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.organization_id = ? AND (e.owner_user_id IS NULL OR e.owner_user_id = ?) ORDER BY e.owner_user_id IS NOT NULL, e.created_at DESC, e.id DESC LIMIT 200`,
      [p.organizationId, p.userId]);
    return [...BUILTIN_PRESETS, ...rows.map((r) => this.toPreset(r, p))];
  }

  async create(body: CreateExportPresetRequest, p: Principal): Promise<ExportPreset> {
    if (body.scope === "ORGANIZATION" && !ADMINS.includes(p.role)) throw new ApiError(403, "ROLE_NOT_ALLOWED", "Only an owner or admin can save a preset for the whole organization.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO export_presets (id, organization_id, owner_user_id, name, note, spec, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, body.scope === "PERSONAL" ? p.userId : null, body.name, body.note, JSON.stringify(body.spec), p.userId]);
      await recordChange(c, userActor(p), { action: "export_preset.saved", entityType: "export_preset", entityId: id, after: { name: body.name, scope: body.scope, spec: body.spec } });
    });
    const r = await this.db.one<RowDataPacket>("SELECT e.*, u.display_name AS created_by_name FROM export_presets e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = ?", [id]);
    return this.toPreset(r!, p);
  }

  async remove(id: string, p: Principal): Promise<void> {
    const r = await this.db.one<RowDataPacket>("SELECT * FROM export_presets WHERE id = ? AND organization_id = ? AND (owner_user_id IS NULL OR owner_user_id = ?)", [id, p.organizationId, p.userId]);
    if (!r) throw notFound("Preset");
    if (r.owner_user_id === null && !ADMINS.includes(p.role)) throw new ApiError(403, "ROLE_NOT_ALLOWED", "Only an owner or admin can delete the organization's presets.");
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM export_presets WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "export_preset.deleted", entityType: "export_preset", entityId: id, before: { name: r.name } });
    });
  }
}

@Controller("v1/export-presets")
@UseGuards(AuthGuard)
export class ExportPresetsController {
  constructor(private readonly presets: ExportPresetsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) { return this.presets.list(p); }

  @Post()
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.presets.create(CreateExportPresetRequest.parse(body), p); }

  @Delete(":id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.presets.remove(uuidParam(id, "Preset"), p); }
}
