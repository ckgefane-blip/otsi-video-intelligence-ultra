/**
 * Clip Studio Templates (page 07 Media Bin, ADR-055): a reel's look saved under a name for the organization, applied to another reel in one
 * click. A template is an effect preset (effect_presets, schema_version "reel-look/1", config {aspect, settings}).
 *
 *   GET    /v1/reel-templates                 the organization's templates, newest change first
 *   POST   /v1/reel-templates                 save a reel's look as a new template {name, reel_id} (409 NAME_TAKEN)
 *   PUT    /v1/reel-templates/:id             save a reel's look into an existing template {reel_id}
 *   DELETE /v1/reel-templates/:id             remove a template (the reels that used it keep their look)
 *   POST   /v1/reels/:id/apply-template       give the reel the template's look {template_id, version}; a logo, music or video that is no longer
 *                                             there or whose rights are not in force is left out, and the answer names it
 *
 * E4 (ADR-067): a template can also keep the reel's structure (with_structure: per clip the kind of moment, its length and its speed effect).
 * Applied with clips FILL, every slot is filled with the best unused moment of that kind of this reel's player; a slot with none is left out
 * and named. Update keeps whether a template has slots.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, UseGuards } from "@nestjs/common";
import { ApplyReelTemplateRequest, CreateReelTemplateRequest, Reel, ReelAspect, ReelStructure, ReelTemplate, SpotlightSettings, fillSlots, slotsFromClips } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { BrandService, rightsOk } from "./brand";
import { ReelsService } from "./reels";

const SCHEMA = "reel-look/1";
const ASSETS = ["competition_logo_id", "custom_logo_id", "music_id", "intro_id", "outro_id"] as const;
const MAX_REEL_US = 10 * 60_000_000;
const UpdateTemplateRequest = z.object({ reel_id: z.string().uuid() });

@Injectable()
export class ReelTemplatesService {
  constructor(private readonly db: Db, @Inject(ReelsService) private readonly reels: ReelsService, @Inject(BrandService) private readonly brand: BrandService) {}

  private parse(r: RowDataPacket): ReelTemplate {
    const cfg = (typeof r.config === "string" ? JSON.parse(r.config) : r.config) as { aspect?: string; settings?: Record<string, unknown>; structure?: unknown };
    const structure = ReelStructure.safeParse(cfg.structure);
    return ReelTemplate.parse({ id: r.id, name: r.name, aspect: ReelAspect.catch("16:9").parse(cfg.aspect), settings: SpotlightSettings.parse(cfg.settings ?? {}),
      structure: structure.success ? structure.data : null,
      created_by: r.created_by ?? null, created_at: String(r.created_at), updated_at: String(r.updated_at) });
  }

  async list(p: Principal): Promise<ReelTemplate[]> {
    const rows = await this.db.rows<RowDataPacket>("SELECT * FROM effect_presets WHERE organization_id = ? AND schema_version = ? ORDER BY updated_at DESC, name LIMIT 200", [p.organizationId, SCHEMA]);
    return rows.map((r) => this.parse(r));
  }

  private async one(id: string, p: Principal): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>("SELECT * FROM effect_presets WHERE id = ? AND organization_id = ? AND schema_version = ?", [id, p.organizationId, SCHEMA]);
    if (!r) throw notFound("Template");
    return r;
  }

  /** E4: the template's config from a reel: the look, and its structure when asked */
  private async configOf(reel: Reel, withStructure: boolean, p: Principal) {
    if (!withStructure) return { aspect: reel.aspect, settings: reel.settings };
    if (!reel.clips.length) throw new ApiError(422, "REEL_EMPTY", "Add clips to the reel first: the template keeps what kind of moment each clip is.");
    const slots = slotsFromClips(reel.clips, await this.reels.moments(reel.id, p));
    return { aspect: reel.aspect, settings: reel.settings, structure: { slots } };
  }

  async create(body: CreateReelTemplateRequest, p: Principal): Promise<ReelTemplate> {
    const reel = await this.reels.get(body.reel_id, p);
    const config = await this.configOf(reel, body.with_structure, p);
    const taken = await this.db.one<RowDataPacket>("SELECT id FROM effect_presets WHERE organization_id = ? AND name = ? AND version = '1'", [p.organizationId, body.name]);
    if (taken) throw new ApiError(409, "NAME_TAKEN", `A template called "${body.name}" exists: choose another name, or save into that one.`);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO effect_presets (id, organization_id, name, version, schema_version, config, created_by) VALUES (?, ?, ?, '1', ?, ?, ?)",
        [id, p.organizationId, body.name, SCHEMA, JSON.stringify(config), p.userId]);
      await recordChange(c, userActor(p), { action: "reel_template.created", entityType: "effect_preset", entityId: id,
        after: { name: body.name, from_reel_id: reel.id, slots: "structure" in config ? config.structure.slots.length : 0 } });
    });
    return this.parse(await this.one(id, p));
  }

  async update(id: string, reelId: string, p: Principal): Promise<ReelTemplate> {
    const t = await this.one(id, p);
    const reel = await this.reels.get(reelId, p);
    const config = await this.configOf(reel, this.parse(t).structure !== null, p);
    await this.db.tx(async (c) => {
      await c.query("UPDATE effect_presets SET config = ? WHERE id = ?", [JSON.stringify(config), id]);
      await recordChange(c, userActor(p), { action: "reel_template.updated", entityType: "effect_preset", entityId: id, after: { name: t.name, from_reel_id: reel.id } });
    });
    return this.parse(await this.one(id, p));
  }

  async remove(id: string, p: Principal): Promise<void> {
    const t = await this.one(id, p);
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM effect_presets WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "reel_template.deleted", entityType: "effect_preset", entityId: id, before: { name: t.name } });
    });
  }

  async apply(reelId: string, body: ApplyReelTemplateRequest, p: Principal): Promise<{ reel: Reel; left_out: string[] }> {
    const t = this.parse(await this.one(body.template_id, p));
    if (body.clips === "FILL" && !t.structure) throw new ApiError(422, "TEMPLATE_HAS_NO_SLOTS", "This template keeps a look only, no clips to fill.");
    const settings: SpotlightSettings = { ...t.settings };
    const left: string[] = [];
    for (const f of ASSETS) {
      const aid = settings[f];
      if (!aid) continue;
      const a = await this.brand.row(aid, p.organizationId).catch(() => null);
      if (!a || !rightsOk(a)) { settings[f] = null; left.push(a ? `${a.name as string} (rights not in force)` : "an asset that was removed"); }
    }
    let reel = await this.reels.update(reelId, { version: body.version, aspect: t.aspect, settings }, p);
    if (body.clips === "FILL" && t.structure) {            // E4: the slots filled with this reel's player's moments
      const filled = fillSlots(t.structure.slots, await this.reels.moments(reelId, p), MAX_REEL_US);
      left.push(...filled.left_out);
      if (filled.clips.length) reel = await this.reels.replaceClips(reelId, filled.clips, p, "reel.template_filled", { template_id: t.id, slots: t.structure.slots.length }, true);
      else left.push("no slot could be filled: the reel's clips were kept");
    }
    await this.db.tx(async (c) => {
      await recordChange(c, userActor(p), { action: "reel.template_applied", entityType: "reel", entityId: reelId, after: { template_id: t.id, name: t.name, clips: body.clips, left_out: left } });
    });
    return { reel, left_out: left };
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class ReelTemplatesController {
  constructor(private readonly templates: ReelTemplatesService) {}

  @Get("reel-templates")
  list(@CurrentPrincipal() p: Principal) {
    return this.templates.list(p);
  }

  @Post("reel-templates")
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.templates.create(CreateReelTemplateRequest.parse(body), p);
  }

  @Put("reel-templates/:id")
  @Roles(...PROJECT_WRITERS)
  update(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.templates.update(uuidParam(id, "Template"), UpdateTemplateRequest.parse(body).reel_id, p);
  }

  @Delete("reel-templates/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    await this.templates.remove(uuidParam(id, "Template"), p);
  }

  @Post("reels/:reelId/apply-template")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  apply(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.templates.apply(uuidParam(id, "Reel"), ApplyReelTemplateRequest.parse(body), p);
  }
}
