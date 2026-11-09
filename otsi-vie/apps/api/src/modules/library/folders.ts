/**
 * Library folders (ADR-052, migration 0039; approved spec 09 `otsi_folder_items`). A folder only groups Library items: putting an item in
 * a folder, or taking it out, changes one row and nothing else. An item is in at most one folder. Deleting a folder goes through
 * Library › Delete (removal.ts) and never deletes what is in it.
 *
 *   GET   /v1/library/folders                     the organization's folders with how many items each holds
 *   POST  /v1/library/folders {name}              a new folder
 *   PATCH /v1/library/folders/:id {version,name}  rename (optimistic: a stale version is refused)
 *   GET   /v1/library/folder-items                which folder each item is in
 *   PUT   /v1/library/folder-items/:kind/:id {folder_id|null}   put an item in a folder, or take it out
 *
 * Tenant-scoped in SQL: another organization's folder or item is a 404. Changes are audited.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Patch, Post, Put, UseGuards } from "@nestjs/common";
import { CreateFolderRequest, FolderItemKind, FolderMembership, LibraryFolder, PlaceItemRequest, RenameFolderRequest } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { libraryItemNotHidden } from "../../core/access";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

/** the live row behind each kind of item (removed items cannot be filed) */
const ITEM: Record<FolderItemKind, [string, string]> = {
  reel: ["SELECT id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Reel"],
  render: ["SELECT id FROM render_jobs WHERE id = ? AND organization_id = ? AND removed_at IS NULL AND state = 'SUCCEEDED'", "Rendered file"],
  video: ["SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Video"],
  match: ["SELECT id FROM matches WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Match"],
  project: ["SELECT id FROM projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Project"],
};

@Injectable()
export class LibraryFoldersService {
  constructor(private readonly db: Db) {}

  private async folder(id: string, p: Principal, ex: Executor = this.db.pool): Promise<LibraryFolder> {
    const [[r]] = await ex.query<RowDataPacket[]>(
      `SELECT f.*, (SELECT COUNT(*) FROM library_folder_items i WHERE i.folder_id = f.id) AS item_count FROM library_folders f
        WHERE f.id = ? AND f.organization_id = ? AND f.removed_at IS NULL`, [id, p.organizationId]) as unknown as [RowDataPacket[]];
    if (!r) throw notFound("Folder");
    return toFolder(r);
  }

  async list(p: Principal): Promise<LibraryFolder[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT f.*, (SELECT COUNT(*) FROM library_folder_items i WHERE i.folder_id = f.id${libraryItemNotHidden(p, "i.item_kind", "i.item_id")}) AS item_count FROM library_folders f
        WHERE f.organization_id = ? AND f.removed_at IS NULL ORDER BY f.name, f.created_at`, [p.organizationId]);
    return rows.map(toFolder);
  }

  async create(body: CreateFolderRequest, p: Principal): Promise<LibraryFolder> {
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO library_folders (id, organization_id, name, created_by) VALUES (?, ?, ?, ?)", [id, p.organizationId, body.name, p.userId]);
      await recordChange(c, userActor(p), { action: "folder.created", entityType: "folder", entityId: id, after: { name: body.name } });
    });
    return this.folder(id, p);
  }

  async rename(id: string, body: RenameFolderRequest, p: Principal): Promise<LibraryFolder> {
    await this.db.tx(async (c) => {
      const [[r]] = await c.query<RowDataPacket[]>("SELECT name, version FROM library_folders WHERE id = ? AND organization_id = ? AND removed_at IS NULL FOR UPDATE",
        [id, p.organizationId]) as unknown as [RowDataPacket[]];
      if (!r) throw notFound("Folder");
      if (Number(r.version) !== body.version) throw new ApiError(409, "STALE_VERSION", "Someone changed this folder meanwhile; reload and try again.");
      await c.query("UPDATE library_folders SET name = ?, version = version + 1 WHERE id = ?", [body.name, id]);
      await recordChange(c, userActor(p), { action: "folder.renamed", entityType: "folder", entityId: id, before: { name: r.name }, after: { name: body.name } });
    });
    return this.folder(id, p);
  }

  /** memberships of live items in live folders */
  async memberships(p: Principal): Promise<FolderMembership[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT i.item_kind, i.item_id, i.folder_id FROM library_folder_items i JOIN library_folders f ON f.id = i.folder_id AND f.removed_at IS NULL
        WHERE i.organization_id = ?${libraryItemNotHidden(p, "i.item_kind", "i.item_id")}`, [p.organizationId]);
    return rows.map((r) => FolderMembership.parse({ item_kind: r.item_kind, item_id: r.item_id, folder_id: r.folder_id }));
  }

  async place(kind: FolderItemKind, itemId: string, body: PlaceItemRequest, p: Principal): Promise<{ folder_id: string | null }> {
    const org = p.organizationId;
    await this.db.tx(async (c) => {
      const [sql, what] = ITEM[kind];
      const [[it]] = await c.query<RowDataPacket[]>(sql, [itemId, org]) as unknown as [RowDataPacket[]];
      if (!it) throw notFound(what);
      const [[cur]] = await c.query<RowDataPacket[]>(
        `SELECT i.folder_id FROM library_folder_items i JOIN library_folders f ON f.id = i.folder_id AND f.removed_at IS NULL
          WHERE i.organization_id = ? AND i.item_kind = ? AND i.item_id = ? FOR UPDATE`, [org, kind, itemId]) as unknown as [RowDataPacket[]];
      const from = (cur?.folder_id as string | undefined) ?? null;
      if (body.folder_id) await this.folder(body.folder_id, p, c);
      if (from === body.folder_id) return;
      await c.query("DELETE FROM library_folder_items WHERE organization_id = ? AND item_kind = ? AND item_id = ?", [org, kind, itemId]);
      if (body.folder_id) {
        await c.query("INSERT INTO library_folder_items (organization_id, item_kind, item_id, folder_id, added_by) VALUES (?, ?, ?, ?, ?)",
          [org, kind, itemId, body.folder_id, p.userId]);
      }
      await recordChange(c, userActor(p), { action: "folder.item_placed", entityType: kind, entityId: itemId, before: { folder_id: from }, after: { folder_id: body.folder_id } });
    });
    return { folder_id: body.folder_id };
  }
}

const toFolder = (r: RowDataPacket): LibraryFolder => LibraryFolder.parse({
  id: r.id, name: r.name, item_count: Number(r.item_count), version: Number(r.version), created_by: r.created_by,
  created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(),
});

@Controller("v1/library")
@UseGuards(AuthGuard)
export class LibraryFoldersController {
  constructor(private readonly folders: LibraryFoldersService) {}

  @Get("folders")
  list(@CurrentPrincipal() p: Principal) {
    return this.folders.list(p);
  }

  @Post("folders")
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.folders.create(CreateFolderRequest.parse(body), p);
  }

  @Patch("folders/:id")
  @Roles(...PROJECT_WRITERS)
  rename(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.folders.rename(uuidParam(id, "Folder"), RenameFolderRequest.parse(body), p);
  }

  @Get("folder-items")
  memberships(@CurrentPrincipal() p: Principal) {
    return this.folders.memberships(p);
  }

  @Put("folder-items/:kind/:id")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  place(@Param("kind") kind: string, @Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const k = FolderItemKind.safeParse(kind);
    if (!k.success) throw new ApiError(400, "BAD_KIND", "Only a reel, rendered file, video, match or project can be put in a folder.");
    return this.folders.place(k.data, uuidParam(id, "Item"), PlaceItemRequest.parse(body), p);
  }
}
