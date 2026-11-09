/**
 * v3 Phase C.10 (ADR-109, migration 0062): Organization Templates for Spotlight, Style and Branding.
 *
 *   GET    /v1/templates?kind=...                   list organization and built-in templates
 *   GET    /v1/templates/:id                        get one template
 *   POST   /v1/templates                            save template { name, kind, description?, reel_id? | spec? }
 *   PUT    /v1/templates/:id                        update template metadata or spec
 *   DELETE /v1/templates/:id                        delete template
 *   POST   /v1/reels/:reelId/apply-org-template     selectively apply template sections to a reel
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import {
  ApplyOrgTemplateRequest,
  BUILTIN_ORG_TEMPLATES,
  CreateOrgTemplateRequest,
  OrgTemplate,
  OrgTemplateKind,
  OrgTemplateSpec,
  SpotlightSettings,
  UpdateOrgTemplateRequest,
  applyTemplateSpec,
  extractTemplateSpec,
} from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { BrandService, rightsOk } from "./brand";
import { ReelsService } from "./reels";

const BRAND_FIELDS = ["competition_logo_id", "custom_logo_id", "music_id", "intro_id", "outro_id"] as const;

@Injectable()
export class OrgTemplatesService {
  constructor(
    private readonly db: Db,
    @Inject(ReelsService) private readonly reels: ReelsService,
    @Inject(BrandService) private readonly brand: BrandService
  ) {}

  private toTemplate(r: RowDataPacket): OrgTemplate {
    const spec = typeof r.spec === "string" ? JSON.parse(r.spec) : r.spec;
    return OrgTemplate.parse({
      id: r.id,
      organization_id: r.organization_id,
      name: r.name,
      description: r.description ?? "",
      kind: r.kind,
      spec: OrgTemplateSpec.parse(spec),
      is_shared: Boolean(r.is_shared),
      created_by: r.created_by ?? null,
      created_at: new Date(r.created_at).toISOString(),
      updated_at: new Date(r.updated_at).toISOString(),
      is_builtin: false,
    });
  }

  async list(kind: string | undefined, p: Principal): Promise<OrgTemplate[]> {
    const k = kind ? OrgTemplateKind.safeParse(kind) : null;
    const filterKind = k && k.success ? k.data : null;

    const builtins = BUILTIN_ORG_TEMPLATES.filter((b) => !filterKind || b.kind === filterKind || b.kind === "FULL");

    let query = "SELECT * FROM org_templates WHERE organization_id = ?";
    const params: unknown[] = [p.organizationId];
    if (filterKind) {
      query += " AND (kind = ? OR kind = 'FULL')";
      params.push(filterKind);
    }
    query += " ORDER BY updated_at DESC, name ASC LIMIT 200";

    const rows = await this.db.rows<RowDataPacket>(query, params);
    return [...builtins, ...rows.map((r) => this.toTemplate(r))];
  }

  async get(id: string, p: Principal): Promise<OrgTemplate> {
    const builtin = BUILTIN_ORG_TEMPLATES.find((b) => b.id === id);
    if (builtin) return builtin;

    const r = await this.db.one<RowDataPacket>(
      "SELECT * FROM org_templates WHERE id = ? AND organization_id = ?",
      [id, p.organizationId]
    );
    if (!r) throw notFound("Template");
    return this.toTemplate(r);
  }

  async create(body: CreateOrgTemplateRequest, p: Principal): Promise<OrgTemplate> {
    let spec: OrgTemplateSpec;
    if (body.reel_id) {
      const reel = await this.reels.get(body.reel_id, p);
      spec = extractTemplateSpec(body.kind, reel.settings);
    } else if (body.spec) {
      spec = OrgTemplateSpec.parse(body.spec);
    } else {
      throw new ApiError(400, "SPEC_OR_REEL_REQUIRED", "Either a reel_id or a template spec must be provided.");
    }

    // Verify brand assets in spec if branding section present
    if (spec.branding) {
      for (const f of BRAND_FIELDS) {
        const aid = spec.branding[f];
        if (aid) {
          const a = await this.brand.row(aid, p.organizationId).catch(() => null);
          if (!a || !rightsOk(a)) {
            throw new ApiError(400, "BRAND_ASSET_INVALID", `Brand asset ${f} does not exist or lacks active rights declaration.`);
          }
        }
      }
    }

    // Unique name check in org
    const taken = await this.db.one<RowDataPacket>(
      "SELECT id FROM org_templates WHERE organization_id = ? AND name = ?",
      [p.organizationId, body.name]
    );
    if (taken) {
      throw new ApiError(409, "NAME_TAKEN", `A template called "${body.name}" already exists: choose another name.`);
    }

    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(
        "INSERT INTO org_templates (id, organization_id, name, description, kind, spec, is_shared, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, body.name, body.description ?? "", body.kind, JSON.stringify(spec), body.is_shared, p.userId]
      );
      await recordChange(c, userActor(p), {
        action: "org_template.created",
        entityType: "org_template",
        entityId: id,
        after: { name: body.name, kind: body.kind, is_shared: body.is_shared },
      });
    });

    return this.get(id, p);
  }

  async update(id: string, body: UpdateOrgTemplateRequest, p: Principal): Promise<OrgTemplate> {
    if (BUILTIN_ORG_TEMPLATES.some((b) => b.id === id)) {
      throw new ApiError(403, "BUILTIN_READ_ONLY", "Built-in templates cannot be modified.");
    }

    const t = await this.get(id, p);
    const name = body.name ?? t.name;
    const description = body.description ?? t.description;
    const spec = body.spec ? OrgTemplateSpec.parse(body.spec) : t.spec;
    const isShared = body.is_shared ?? t.is_shared;

    if (body.name && body.name !== t.name) {
      const taken = await this.db.one<RowDataPacket>(
        "SELECT id FROM org_templates WHERE organization_id = ? AND name = ? AND id != ?",
        [p.organizationId, body.name, id]
      );
      if (taken) {
        throw new ApiError(409, "NAME_TAKEN", `A template called "${body.name}" already exists.`);
      }
    }

    await this.db.tx(async (c) => {
      await c.query(
        "UPDATE org_templates SET name = ?, description = ?, spec = ?, is_shared = ? WHERE id = ?",
        [name, description, JSON.stringify(spec), isShared, id]
      );
      await recordChange(c, userActor(p), {
        action: "org_template.updated",
        entityType: "org_template",
        entityId: id,
        after: { name, description, is_shared: isShared },
      });
    });

    return this.get(id, p);
  }

  async remove(id: string, p: Principal): Promise<void> {
    if (BUILTIN_ORG_TEMPLATES.some((b) => b.id === id)) {
      throw new ApiError(403, "BUILTIN_CANNOT_BE_DELETED", "Built-in templates cannot be deleted.");
    }

    const t = await this.get(id, p);
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM org_templates WHERE id = ?", [id]);
      await recordChange(c, userActor(p), {
        action: "org_template.deleted",
        entityType: "org_template",
        entityId: id,
        before: { name: t.name, kind: t.kind },
      });
    });
  }

  async apply(reelId: string, body: ApplyOrgTemplateRequest, p: Principal): Promise<{ reel: any; applied_kinds: OrgTemplateKind[] }> {
    const t = await this.get(body.template_id, p);
    const reel = await this.reels.get(reelId, p);

    const { settings: targetSettings, applied } = applyTemplateSpec(reel.settings, t, body.apply_kinds);

    // Verify any branding assets that will be newly applied
    for (const f of BRAND_FIELDS) {
      const aid = targetSettings[f];
      if (aid && aid !== reel.settings[f]) {
        const a = await this.brand.row(aid, p.organizationId).catch(() => null);
        if (!a || !rightsOk(a)) {
          targetSettings[f] = null;
        }
      }
    }

    const updatedReel = await this.reels.update(reelId, { version: body.version, settings: targetSettings }, p);

    await this.db.tx(async (c) => {
      await recordChange(c, userActor(p), {
        action: "reel.org_template_applied",
        entityType: "reel",
        entityId: reelId,
        after: { template_id: t.id, name: t.name, applied_kinds: applied },
      });
    });

    return { reel: updatedReel, applied_kinds: applied };
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class OrgTemplatesController {
  constructor(private readonly templates: OrgTemplatesService) {}

  @Get("templates")
  list(@Query("kind") kind: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.templates.list(kind, p);
  }

  @Get("templates/:id")
  get(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.templates.get(uuidParam(id, "Template"), p);
  }

  @Post("templates")
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.templates.create(CreateOrgTemplateRequest.parse(body), p);
  }

  @Put("templates/:id")
  @Roles(...PROJECT_WRITERS)
  update(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.templates.update(uuidParam(id, "Template"), UpdateOrgTemplateRequest.parse(body), p);
  }

  @Delete("templates/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    await this.templates.remove(uuidParam(id, "Template"), p);
  }

  @Post("reels/:reelId/apply-org-template")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  apply(@Param("reelId") reelId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.templates.apply(uuidParam(reelId, "Reel"), ApplyOrgTemplateRequest.parse(body), p);
  }
}
