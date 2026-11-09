/**
 * Projects (F04): the container a match video, its analysis, reels and reports belong to. Tenant-scoped in SQL; another organization's
 * project is a 404. Edits use optimistic concurrency (`version`), every change is audited and published.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { CreateProjectRequest, Project, ProjectAccessView, ProjectPermission, SetCollaboratorRequest, SetProjectAccessRequest, UpdateProjectRequest } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { loadAccess, notHidden, SEES_EVERY_PROJECT } from "../../core/access";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";

export const PROJECT_WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"] as const;

const SELECT = `SELECT p.id, p.name, p.description, p.status, p.created_by, p.created_at, p.updated_at, p.version, p.access,
                       (SELECT COUNT(*) FROM video_sources v WHERE v.project_id = p.id AND v.organization_id = p.organization_id AND v.removed_at IS NULL) AS video_count
                  FROM projects p`;

const toProject = (r: RowDataPacket): Project => Project.parse({ ...r, video_count: Number(r.video_count), version: Number(r.version) });

/** what a person can do in a project: the lower of his organization role and his project permission (ADR-057) */
const ROLE_CAP: Record<string, number> = { OWNER: 4, ADMIN: 4, ANALYST: 3, EDITOR: 3, SCOUT: 2, VIEWER: 1 };
const PERM_CAP: Record<ProjectPermission, number> = { READ: 1, REVIEW: 2, EDIT: 3, ADMIN: 4 };
const CAP_NAME = ["VIEW", "VIEW", "REVIEW", "EDIT", "MANAGE"] as const;
export const effectiveCap = (role: string, perm: ProjectPermission) =>
  CAP_NAME[SEES_EVERY_PROJECT.has(role) ? 4 : Math.min(ROLE_CAP[role] ?? 1, PERM_CAP[perm])]!;

@Injectable()
export class ProjectsService {
  constructor(private readonly db: Db) {}

  async list(p: Principal): Promise<Project[]> {
    const rows = await this.db.rows<RowDataPacket>(`${SELECT} WHERE p.organization_id = ? AND p.removed_at IS NULL${notHidden(p, "p.id")} ORDER BY p.status = 'ARCHIVED', p.updated_at DESC LIMIT 500`, [p.organizationId]);
    return this.withPeople(rows, p);
  }

  async get(id: string, p: Principal, ex?: Executor): Promise<Project> {
    const r = await this.db.one<RowDataPacket>(`${SELECT} WHERE p.id = ? AND p.organization_id = ? AND p.removed_at IS NULL${notHidden(p, "p.id")}`, [id, p.organizationId], ex);
    if (!r) throw notFound("Project");
    return (await this.withPeople([r], p, ex))[0]!;
  }

  /** each project's people (its list), your permission, Shared With Me, and whether you may manage it */
  private async withPeople(rows: RowDataPacket[], p: Principal, ex?: Executor): Promise<Project[]> {
    if (!rows.length) return [];
    const acl = await this.db.rows<RowDataPacket>(
      `SELECT a.project_id, a.user_id, a.permission, u.display_name FROM project_acl a JOIN users u ON u.id = a.user_id
         JOIN memberships m ON m.user_id = a.user_id AND m.organization_id = ? AND m.status = 'ACTIVE'
        WHERE a.project_id IN (?) ORDER BY a.granted_at, u.display_name`, [p.organizationId, rows.map((r) => r.id)], ex);
    const by = new Map<string, RowDataPacket[]>();
    for (const a of acl) by.set(a.project_id as string, [...(by.get(a.project_id as string) ?? []), a]);
    return rows.map((r) => {
      const people = by.get(r.id as string) ?? [];
      const mine = (people.find((a) => a.user_id === p.userId)?.permission as ProjectPermission | undefined) ?? null;
      return toProject({ ...r, collaborators: people.map((a) => ({ user_id: a.user_id, display_name: a.display_name, permission: a.permission })),
        my_permission: mine, shared_with_me: !!mine && r.created_by !== p.userId, can_manage_access: this.mayManage(p, mine) } as unknown as RowDataPacket);
    });
  }

  private mayManage(p: Principal, mine: ProjectPermission | null) {
    return SEES_EVERY_PROJECT.has(p.role) || (mine === "ADMIN" && (PROJECT_WRITERS as readonly string[]).includes(p.role));
  }

  // ------------------------------------------------------------------ Manage Access (ADR-057)
  async access(id: string, p: Principal): Promise<ProjectAccessView> {
    const pr = await this.get(id, p);
    const people = await this.db.rows<RowDataPacket>(
      `SELECT a.user_id, a.permission, a.granted_at, u.display_name, u.email, m.role, g.display_name AS granted_by_name
         FROM project_acl a JOIN users u ON u.id = a.user_id JOIN memberships m ON m.user_id = a.user_id AND m.organization_id = ? AND m.status = 'ACTIVE'
         LEFT JOIN users g ON g.id = a.granted_by
        WHERE a.project_id = ? ORDER BY a.granted_at, u.display_name`, [p.organizationId, id]);
    const members = await this.db.rows<RowDataPacket>(
      `SELECT u.id, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.status = 'ACTIVE' ORDER BY u.display_name, u.id`,
      [p.organizationId]);
    const on = new Set(people.map((x) => x.user_id as string));
    const manage = pr.can_manage_access;
    return ProjectAccessView.parse({
      project_id: id, access: pr.access, can_manage: manage,
      people: people.map((x) => ({ user_id: x.user_id, display_name: x.display_name, email: manage ? x.email : null, role: x.role, permission: x.permission,
        effective: effectiveCap(x.role as string, x.permission as ProjectPermission), granted_by_name: x.granted_by_name ?? null, granted_at: new Date(x.granted_at).toISOString() })),
      addable: manage ? members.filter((m) => !on.has(m.id as string)).map((m) => ({ user_id: m.id, display_name: m.display_name, role: m.role })) : [],
      always: members.filter((m) => SEES_EVERY_PROJECT.has(m.role as string)).map((m) => ({ user_id: m.id, display_name: m.display_name, role: m.role })),
    });
  }

  private async mustManage(id: string, p: Principal) {
    const pr = await this.get(id, p);
    if (!pr.can_manage_access) throw new ApiError(403, "NOT_PROJECT_MANAGER", "Only an Owner, an Admin or this project's Manager can choose who is on it.");
    return pr;
  }

  async setAccess(id: string, body: SetProjectAccessRequest, p: Principal): Promise<ProjectAccessView> {
    const pr = await this.mustManage(id, p);
    if (pr.access !== body.access) {
      await this.db.tx(async (c) => {
        await c.query("UPDATE projects SET access = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND organization_id = ?", [body.access, id, p.organizationId]);
        await recordChange(c, userActor(p), { action: "project.access_changed", entityType: "project", entityId: id, before: { access: pr.access }, after: { access: body.access },
          event: { eventType: "project.updated", payload: { project_id: id } } });
      });
    }
    return this.access(id, p);
  }

  async setPerson(id: string, userId: string, body: SetCollaboratorRequest, p: Principal): Promise<ProjectAccessView> {
    const pr = await this.mustManage(id, p);
    if (userId === p.userId && !SEES_EVERY_PROJECT.has(p.role) && body.permission !== "ADMIN")
      throw new ApiError(409, "OWN_MANAGER_ACCESS", "You cannot lower your own Manager access. Ask an Owner or an Admin.");
    await this.db.tx(async (c) => {
      const [m] = await c.query<RowDataPacket[]>("SELECT 1 FROM memberships WHERE user_id = ? AND organization_id = ? AND status = 'ACTIVE'", [userId, p.organizationId]);
      if (!m.length) throw notFound("Member");
      const [prev] = await c.query<RowDataPacket[]>("SELECT permission FROM project_acl WHERE project_id = ? AND user_id = ? FOR UPDATE", [id, userId]);
      const before = (prev[0]?.permission as string | undefined) ?? null;
      if (before === body.permission && prev.length === 1) return;
      await c.query("DELETE FROM project_acl WHERE project_id = ? AND user_id = ?", [id, userId]);       // one permission per person
      await c.query("INSERT INTO project_acl (project_id, user_id, permission, granted_by) VALUES (?, ?, ?, ?)", [id, userId, body.permission, p.userId]);
      await recordChange(c, userActor(p), { action: before ? "project.member_changed" : "project.member_added", entityType: "project", entityId: id,
        before: before ? { user_id: userId, permission: before } : undefined, after: { user_id: userId, permission: body.permission, access: pr.access } });
    });
    return this.access(id, p);
  }

  async removePerson(id: string, userId: string, p: Principal): Promise<ProjectAccessView> {
    await this.mustManage(id, p);
    if (userId === p.userId && !SEES_EVERY_PROJECT.has(p.role))
      throw new ApiError(409, "OWN_MANAGER_ACCESS", "You cannot take yourself off the project. Ask an Owner or an Admin.");
    await this.db.tx(async (c) => {
      const [prev] = await c.query<RowDataPacket[]>("SELECT permission FROM project_acl WHERE project_id = ? AND user_id = ? FOR UPDATE", [id, userId]);
      if (!prev.length) throw notFound("Person on this project");
      await c.query("DELETE FROM project_acl WHERE project_id = ? AND user_id = ?", [id, userId]);
      await recordChange(c, userActor(p), { action: "project.member_removed", entityType: "project", entityId: id, before: { user_id: userId, permission: prev[0]!.permission } });
    });
    return this.access(id, p);
  }

  async create(body: CreateProjectRequest, p: Principal): Promise<Project> {
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO projects (id, organization_id, name, description, created_by, access) VALUES (?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, body.name, body.description ?? null, p.userId, body.access ?? "ORGANIZATION"]);
      // a restricted project starts with its creator as its Manager (he must still see what he made)
      if (body.access === "RESTRICTED") await c.query("INSERT INTO project_acl (project_id, user_id, permission, granted_by) VALUES (?, ?, 'ADMIN', ?)", [id, p.userId, p.userId]);
      await recordChange(c, userActor(p), {
        action: "project.created", entityType: "project", entityId: id, after: { name: body.name, description: body.description ?? null, access: body.access ?? "ORGANIZATION" },
        event: { eventType: "project.created", payload: { project_id: id } },
      });
    });
    // the creator was not on the list when access was loaded for this request: read it as he will see it from now on
    if (body.access === "RESTRICTED") p.access = await loadAccess(this.db, p.userId, p.organizationId, p.role);
    return this.get(id, p);
  }

  /** Library › Delete (owner 2026-11-05, migration 0038): an empty folder leaves every list; one holding videos or reels is refused. */

  async update(id: string, body: UpdateProjectRequest, p: Principal): Promise<Project> {
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT name, description, status, version FROM projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL FOR UPDATE", [id, p.organizationId]);
      const before = rows[0];
      if (!before) throw notFound("Project");
      if (Number(before.version) !== body.version) throw new ApiError(409, "STALE_VERSION", "Someone changed this project meanwhile; reload and try again.");
      const after = { name: body.name ?? before.name, description: body.description === undefined ? before.description : body.description, status: body.status ?? before.status };
      await c.query("UPDATE projects SET name = ?, description = ?, status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
        [after.name, after.description, after.status, id]);
      await recordChange(c, userActor(p), {
        action: "project.updated", entityType: "project", entityId: id,
        before: { name: before.name, description: before.description, status: before.status }, after,
        event: { eventType: "project.updated", payload: { project_id: id, version: body.version + 1 } },
      });
    });
    return this.get(id, p);
  }
}

@Controller("v1/projects")
@UseGuards(AuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) {
    return this.projects.list(p);
  }

  @Post()
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.projects.create(CreateProjectRequest.parse(body), p);
  }

  @Get(":projectId")
  get(@Param("projectId") id: string, @CurrentPrincipal() p: Principal) {
    return this.projects.get(uuidParam(id, "Project"), p);
  }


  @Patch(":projectId")
  @Roles(...PROJECT_WRITERS)
  update(@Param("projectId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.projects.update(uuidParam(id, "Project"), UpdateProjectRequest.parse(body), p);
  }

  @Get(":projectId/access")
  access(@Param("projectId") id: string, @CurrentPrincipal() p: Principal) {
    return this.projects.access(uuidParam(id, "Project"), p);
  }

  @Put(":projectId/access")
  @Roles(...PROJECT_WRITERS)
  setAccess(@Param("projectId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.projects.setAccess(uuidParam(id, "Project"), SetProjectAccessRequest.parse(body), p);
  }

  @Put(":projectId/access/people/:userId")
  @Roles(...PROJECT_WRITERS)
  setPerson(@Param("projectId") id: string, @Param("userId") userId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.projects.setPerson(uuidParam(id, "Project"), uuidParam(userId, "Member"), SetCollaboratorRequest.parse(body), p);
  }

  @Delete(":projectId/access/people/:userId")
  @Roles(...PROJECT_WRITERS)
  removePerson(@Param("projectId") id: string, @Param("userId") userId: string, @CurrentPrincipal() p: Principal) {
    return this.projects.removePerson(uuidParam(id, "Project"), uuidParam(userId, "Member"), p);
  }
}
