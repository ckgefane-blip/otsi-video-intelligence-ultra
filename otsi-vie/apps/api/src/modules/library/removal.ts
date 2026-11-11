/**
 * Library delete and Trash (ADR-052, migration 0039): the one implementation every page uses to delete a reel, a rendered file, a
 * video, a match, a project or a folder.
 *
 *   GET    /v1/library/:kind/:id/removal      what goes with it, and what blocks it (a render still running, something still using it)
 *   DELETE /v1/library/:kind/:id              deletes only that item (a reel: with its own rendered files), as ONE Trash entry
 *   GET    /v1/library/trash                   the Trash: open entries, newest first, with what each took and whether it can come back
 *   POST   /v1/library/trash/:id/restore       brings back everything that entry removed
 *   POST   /v1/library/:kind/:id/restore       the same, found by the item (Upload › Undo)
 *
 * Delete removes only what the person chose (owner 2026-11-06, ADR-074): a reel takes its own rendered files; a rendered file goes alone;
 * a match goes and its videos stay in the Library, unlinked (a restore links them again); a video still used by reels, or a project
 * that still holds videos or reels, is refused with the list of what to delete first. A folder takes nothing: it only groups items,
 * which stay in the Library. Nothing is erased: rows are marked removed,
 * share links to removed files are revoked (they stay off after a restore), queued or running analyses of removed videos are stopped
 * (they stay stopped). An upload cancelled before it finished cannot come back. Tenant-scoped in SQL; another organization's item is
 * a 404. Every delete and restore is audited.
 */
import { Controller, Delete, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { RemovableKind, RemovalPreview, TrashEntry } from "@otsi-vie/contracts";
import { PoolConnection, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { libraryItemNotHidden } from "../../core/access";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { insertRun } from "../analysis/run";
import { MediaService } from "../media/media";
import { WalletService } from "../wallet/wallet";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

type Row = { id: string; title: string };
interface Plan {
  kind: RemovableKind;
  id: string;
  title: string;
  projects: Row[];
  matches: Row[];
  videos: (Row & { state: string })[];
  reels: Row[];
  /** rendered files: those of the removed reels, or the one deleted alone */
  renders: Row[];
  folders: Row[];
  /** a match's videos: they stay, only leave the match */
  unlinked: Row[];
  /** what still uses the item; it is refused until these are deleted */
  inUse: (Row & { kind: RemovableKind })[];
}

const list = (xs: string[]) => (xs.length ? xs : [""]);
const MATCH_TITLE = "COALESCE(CONCAT(h.canonical_name, ' v ', a.canonical_name), m.competition, 'Match')";
const NOUN: Record<RemovableKind, string> = { reel: "reel", render: "rendered file", video: "video", match: "match", project: "project", folder: "folder" };

@Injectable()
export class LibraryRemovalService {
  constructor(private readonly db: Db, private readonly media: MediaService, private readonly wallet: WalletService) {}

  // ---------------------------------------------------------------- what a delete takes

  private async plan(kind: RemovableKind, id: string, p: Principal, ex: Executor, lock = false): Promise<Plan> {
    const fu = lock ? " FOR UPDATE" : "", org = p.organizationId;
    const q = async (sql: string, params: unknown[]) => (await ex.query<RowDataPacket[]>(sql + fu, params))[0];
    const pl: Plan = { kind, id, title: "", projects: [], matches: [], videos: [], reels: [], renders: [], folders: [], unlinked: [], inUse: [] };
    const root = async (sql: string, what: string) => {
      const r = (await q(sql, [id, org]))[0];
      if (!r) throw notFound(what);
      pl.title = r.title as string;
      return r;
    };
    const videosWhere = async (where: string, params: unknown[]) => (await q(
      `SELECT id, COALESCE(title, original_filename, 'Video') AS title, state FROM video_sources WHERE ${where} AND organization_id = ? AND removed_at IS NULL ORDER BY created_at`,
      [...params, org])).map((r) => ({ id: r.id as string, title: r.title as string, state: r.state as string }));
    const reelsWhere = async (where: string, params: unknown[]) => (await q(
      `SELECT id, name AS title FROM reel_projects WHERE ${where} AND organization_id = ? AND removed_at IS NULL ORDER BY created_at`, [...params, org]))
      .map((r) => ({ id: r.id as string, title: r.title as string }));

    if (kind === "folder") {
      await root("SELECT name AS title FROM library_folders WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Folder");
      pl.folders = [{ id, title: pl.title }];
      return pl;
    }
    if (kind === "render") {
      await root(`SELECT CONCAT(COALESCE(r.name, 'Reel'), ' · rendered') AS title FROM render_jobs j LEFT JOIN reel_projects r ON r.id = j.reel_id
                   WHERE j.id = ? AND j.organization_id = ? AND j.removed_at IS NULL`, "Rendered file");
      pl.renders = [{ id, title: pl.title }];
      return pl;
    }
    if (kind === "project") {
      await root("SELECT name AS title FROM projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Project");
      pl.projects = [{ id, title: pl.title }];
      const videos = await videosWhere("project_id = ?", [id]);
      const reels = await reelsWhere("(project_id = ? OR video_id IN (?))", [id, list(videos.map((v) => v.id))]);
      pl.inUse = [...videos.map(({ id: i, title }) => ({ id: i, title, kind: "video" as const })), ...reels.map((r) => ({ ...r, kind: "reel" as const }))];
      return pl;
    } else if (kind === "match") {
      await root(`SELECT ${MATCH_TITLE} AS title FROM matches m LEFT JOIN clubs h ON h.id = m.home_club_id LEFT JOIN clubs a ON a.id = m.away_club_id
                   WHERE m.id = ? AND m.organization_id = ? AND m.removed_at IS NULL`, "Match");
      pl.matches = [{ id, title: pl.title }];
      pl.unlinked = (await videosWhere("match_id = ?", [id])).map(({ id: i, title }) => ({ id: i, title }));
      return pl;
    } else if (kind === "video") {
      const r = await root("SELECT COALESCE(title, original_filename, 'Video') AS title, state FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Video");
      pl.videos = [{ id, title: pl.title, state: r.state as string }];
      pl.inUse = (await reelsWhere("video_id = ?", [id])).map((x) => ({ ...x, kind: "reel" as const }));
      return pl;
    } else {
      await root("SELECT name AS title FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", "Reel");
      pl.reels = [{ id, title: pl.title }];
    }
    pl.renders = (await q(
      `SELECT j.id, CONCAT(r.name, ' · rendered') AS title FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id
        WHERE j.reel_id IN (?) AND j.organization_id = ? AND j.removed_at IS NULL AND j.state = 'SUCCEEDED'`, [list(pl.reels.map((r) => r.id)), org]))
      .map((r) => ({ id: r.id as string, title: r.title as string }));
    return pl;
  }

  private async effects(pl: Plan, p: Principal, ex: Executor) {
    const org = p.organizationId, reels = list(pl.reels.map((r) => r.id)), renders = list(pl.renders.map((r) => r.id));
    const [[r]] = await ex.query<RowDataPacket[]>(
      `SELECT (SELECT COUNT(*) FROM render_jobs WHERE organization_id = ? AND removed_at IS NULL AND state IN ('QUEUED', 'RUNNING') AND (reel_id IN (?) OR id IN (?))) AS rendering,
              (SELECT COUNT(*) FROM share_links s JOIN render_jobs j ON j.output_asset_id = s.asset_id AND j.organization_id = s.organization_id
                WHERE s.organization_id = ? AND s.revoked_at IS NULL AND j.id IN (?)) AS links,
              (SELECT COUNT(*) FROM pipeline_runs WHERE organization_id = ? AND video_id IN (?) AND status IN ('QUEUED', 'RUNNING')) AS running,
              (SELECT COUNT(*) FROM library_folder_items i WHERE i.organization_id = ? AND i.folder_id IN (?)) AS kept`,
      [org, reels, renders, org, renders, org, list(pl.videos.map((v) => v.id)), org, list(pl.folders.map((f) => f.id))]) as unknown as [RowDataPacket[]];
    const rendering = Number(r!.rendering);
    return {
      share_links: Number(r!.links), running_analyses: Number(r!.running), kept_items: Number(r!.kept),
      blocked: pl.inUse.length ? inUseText(pl) : rendering ? (pl.kind === "render" ? "This render is still running. Stop it in Export first." :
        `${rendering === 1 ? "A render" : `${rendering} renders`} of this reel ${rendering === 1 ? "is" : "are"} still running. Stop ${rendering === 1 ? "it" : "them"} in Export first, then delete.`) : null,
    };
  }

  async preview(kind: RemovableKind, id: string, p: Principal): Promise<RemovalPreview> {
    const pl = await this.plan(kind, id, p, this.db.pool);
    const e = await this.effects(pl, p, this.db.pool);
    const others = (xs: Row[]) => xs.filter((x) => x.id !== id).map(({ id: i, title }) => ({ id: i, title }));
    return RemovalPreview.parse({ kind, id, title: pl.title, videos: others(pl.videos), reels: others(pl.reels),
      renders: kind === "render" ? 0 : pl.renders.length, ...e, unlinked: pl.unlinked, in_use: pl.inUse });
  }

  // ---------------------------------------------------------------- delete

  async remove(kind: RemovableKind, id: string, p: Principal): Promise<{ trash_id: string }> {
    const uploads: string[] = [];
    const trashId = uuidv7();
    await this.db.tx(async (c) => {
      const pl = await this.plan(kind, id, p, c, true);
      const e = await this.effects(pl, p, c);
      if (e.blocked) throw new ApiError(409, pl.inUse.length ? "IN_USE" : kind === "render" ? "RENDER_RUNNING" : "REEL_RENDERING", e.blocked);
      const org = p.organizationId, items: [string, string, object][] = [];
      await c.query("INSERT INTO library_deletions (id, organization_id, item_kind, item_id, title, deleted_by) VALUES (?, ?, ?, ?, ?, ?)",
        [trashId, org, kind, id, pl.title.slice(0, 512), p.userId]);
      const mark = async (table: string, ids: string[]) => {
        if (ids.length) await c.query(`UPDATE ${table} SET removed_at = CURRENT_TIMESTAMP(6), removed_by = ? WHERE id IN (?) AND organization_id = ?`, [p.userId, ids, org]);
      };
      // share links to the removed files stop working
      if (pl.renders.length) {
        await c.query(`UPDATE share_links s JOIN render_jobs j ON j.output_asset_id = s.asset_id AND j.organization_id = s.organization_id
                          SET s.revoked_at = CURRENT_TIMESTAMP(6) WHERE s.organization_id = ? AND s.revoked_at IS NULL AND j.id IN (?)`, [org, pl.renders.map((r) => r.id)]);
      }
      await mark("render_jobs", pl.renders.map((r) => r.id));
      for (const r of pl.renders) items.push(["render", r.id, {}]);
      await mark("reel_projects", pl.reels.map((r) => r.id));
      for (const r of pl.reels) items.push(["reel", r.id, {}]);
      for (const v of pl.videos) { uploads.push(...await this.removeVideo(c, p, v)); items.push(["video", v.id, { state: v.state }]); }
      // a match's videos stay in the Library: they only leave the match, and the Trash entry remembers which (a restore links them again)
      if (pl.unlinked.length) await c.query("UPDATE video_sources SET match_id = NULL WHERE id IN (?) AND organization_id = ? AND match_id = ?", [pl.unlinked.map((v) => v.id), org, id]);
      await mark("matches", pl.matches.map((m) => m.id));
      for (const m of pl.matches) items.push(["match", m.id, m.id === id ? { unlinked_videos: pl.unlinked.map((v) => v.id) } : {}]);
      await mark("projects", pl.projects.map((x) => x.id));
      for (const x of pl.projects) items.push(["project", x.id, {}]);
      await mark("library_folders", pl.folders.map((f) => f.id));
      for (const f of pl.folders) items.push(["folder", f.id, {}]);
      await c.query("INSERT INTO library_deletion_items (deletion_id, item_kind, item_id, prior) VALUES ?",
        [items.map(([k, i, prior]) => [trashId, k, i, JSON.stringify(prior)])]);
      await recordChange(c, userActor(p), { action: `${kind}.deleted`, entityType: kind, entityId: id, before: { title: pl.title },
        after: { trash_id: trashId, videos: pl.videos.length, reels: pl.reels.length, renders: pl.renders.length, share_links_revoked: e.share_links, videos_unlinked: pl.unlinked.length } });
    });
    await this.media.dropUploads(uploads);
    return { trash_id: trashId };
  }

  /** a video leaves the lists; its queued or running work stops; an upload not finished yet is marked failed (it cannot come back) */
  private async removeVideo(c: PoolConnection, p: Principal, v: Plan["videos"][number]): Promise<string[]> {
    const org = p.organizationId;
    await c.query("UPDATE pipeline_runs SET status = 'CANCELLED', finished_at = CURRENT_TIMESTAMP(6) WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [v.id, org]);
    await c.query("UPDATE pipeline_steps SET status = 'CANCELLED' WHERE status IN ('QUEUED', 'RUNNING') AND run_id IN (SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'CANCELLED')", [v.id, org]);
    await c.query("UPDATE worker_jobs SET state = 'CANCELLED', finished_at = CURRENT_TIMESTAMP(6) WHERE organization_id = ? AND subject_type = 'analysis_run' AND state IN ('QUEUED', 'PAUSED') AND subject_id IN (SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'CANCELLED')", [org, v.id, org]);
    await c.query(
      "UPDATE worker_jobs SET state = 'CANCELLED', claim_token = NULL, lease_expires_at = NULL, finished_at = CURRENT_TIMESTAMP(6) WHERE organization_id = ? AND subject_type = 'video' AND subject_id = ? AND state IN ('QUEUED', 'RUNNING', 'PAUSED')",
      [org, v.id]);
    const [open] = await c.query<RowDataPacket[]>("SELECT id FROM upload_sessions WHERE video_id = ? AND organization_id = ? AND status IN ('INITIALIZED', 'UPLOADING', 'VERIFYING')", [v.id, org]);
    if (open.length) await c.query("UPDATE upload_sessions SET status = 'ABORTED' WHERE video_id = ? AND organization_id = ? AND status IN ('INITIALIZED', 'UPLOADING', 'VERIFYING')", [v.id, org]);
    if (v.state === "INGESTED") await c.query("UPDATE video_sources SET removed_at = CURRENT_TIMESTAMP(6), removed_by = ? WHERE id = ?", [p.userId, v.id]);
    else await c.query("UPDATE video_sources SET state = 'FAILED', failure_code = 'REMOVED_BY_USER', failure_detail = 'Removed by a person.', removed_at = CURRENT_TIMESTAMP(6), removed_by = ? WHERE id = ?", [p.userId, v.id]);
    return open.map((s) => s.id as string);
  }

  // ---------------------------------------------------------------- Trash and restore

  /** what stops an entry coming back: something it needs is still in the Trash under another entry */
  private async blockers(c: Executor, org: string, deletionId: string): Promise<string | null> {
    const [items] = await c.query<RowDataPacket[]>("SELECT item_kind, item_id FROM library_deletion_items WHERE deletion_id = ?", [deletionId]);
    const has = (k: string, i: string) => items.some((x) => x.item_kind === k && x.item_id === i);
    const one = async (sql: string, params: unknown[]) => (await c.query<RowDataPacket[]>(sql, params))[0][0];
    for (const it of items) {
      if (it.item_kind === "video") {
        const r = await one("SELECT pr.id AS pid, pr.name, pr.removed_at FROM video_sources v JOIN projects pr ON pr.id = v.project_id WHERE v.id = ? AND v.organization_id = ?", [it.item_id, org]);
        if (r?.removed_at && !has("project", r.pid as string)) return `Its project “${r.name as string}” is in the Trash. Restore that first.`;
      } else if (it.item_kind === "reel") {
        const r = await one(`SELECT v.id AS vid, COALESCE(v.title, v.original_filename, 'Video') AS title, v.removed_at, pr.id AS pid, pr.name, pr.removed_at AS premoved
                               FROM reel_projects r JOIN video_sources v ON v.id = r.video_id JOIN projects pr ON pr.id = r.project_id WHERE r.id = ? AND r.organization_id = ?`, [it.item_id, org]);
        if (r?.removed_at && !has("video", r.vid as string)) return `Its video “${r.title as string}” is in the Trash. Restore that first.`;
        if (r?.premoved && !has("project", r.pid as string)) return `Its project “${r.name as string}” is in the Trash. Restore that first.`;
      } else if (it.item_kind === "render") {
        const r = await one("SELECT r.id AS rid, r.name, r.removed_at FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id WHERE j.id = ? AND j.organization_id = ?", [it.item_id, org]);
        if (r?.removed_at && !has("reel", r.rid as string)) return `Its reel “${r.name as string}” is in the Trash. Restore that first.`;
      }
    }
    return null;
  }

  async trash(p: Principal): Promise<TrashEntry[]> {
    const org = p.organizationId;
    const policyRow = await this.db.one<RowDataPacket>(
      "SELECT trash_days FROM org_retention_policies WHERE organization_id = ?",
      [org],
    );
    const trashDays = policyRow?.trash_days != null ? Number(policyRow.trash_days) : 30;

    const rows = await this.db.rows<RowDataPacket>(
      `SELECT d.id, d.item_kind, d.item_id, d.title, d.deleted_at, u.display_name,
              (SELECT COUNT(*) FROM library_deletion_items i WHERE i.deletion_id = d.id AND i.item_kind = 'video' AND i.item_id <> d.item_id) AS videos,
              (SELECT COUNT(*) FROM library_deletion_items i WHERE i.deletion_id = d.id AND i.item_kind = 'reel' AND i.item_id <> d.item_id) AS reels,
              (SELECT COUNT(*) FROM library_deletion_items i WHERE i.deletion_id = d.id AND i.item_kind = 'render' AND i.item_id <> d.item_id) AS renders
         FROM library_deletions d LEFT JOIN users u ON u.id = d.deleted_by
        WHERE d.organization_id = ? AND d.restored_at IS NULL${libraryItemNotHidden(p, "d.item_kind", "d.item_id")} ORDER BY d.deleted_at DESC LIMIT 200`, [org]);
    const out: TrashEntry[] = [];
    const now = new Date();
    for (const r of rows) {
      const deletedAt = new Date(r.deleted_at);
      const expiresAt = new Date(deletedAt.getTime() + trashDays * 86400000);
      const diffMs = expiresAt.getTime() - now.getTime();
      const daysRemaining = Math.max(0, Math.ceil(diffMs / 86400000));
      const canPurge = daysRemaining <= 0 || trashDays === 0;

      out.push(TrashEntry.parse({
        id: r.id,
        kind: r.item_kind,
        item_id: r.item_id,
        title: r.title,
        deleted_at: deletedAt.toISOString(),
        deleted_by: r.display_name ?? null,
        with: { videos: Number(r.videos), reels: Number(r.reels), renders: Number(r.renders) },
        blocked: await this.blockers(this.db.pool, org, r.id as string),
        expires_at: expiresAt.toISOString(),
        days_remaining: daysRemaining,
        can_purge: canPurge,
      }));
    }
    return out;
  }

  async restore(deletionId: string, p: Principal): Promise<{ restored: number; not_restorable: number }> {
    const org = p.organizationId;
    return this.db.tx(async (c) => {
      const [[d]] = await c.query<RowDataPacket[]>("SELECT id, item_kind, item_id FROM library_deletions WHERE id = ? AND organization_id = ? AND restored_at IS NULL FOR UPDATE",
        [deletionId, org]) as unknown as [RowDataPacket[]];
      if (!d) throw notFound("Trash entry");
      const blocked = await this.blockers(c, org, deletionId);
      if (blocked) throw new ApiError(409, "RESTORE_BLOCKED", blocked);
      const [items] = await c.query<RowDataPacket[]>("SELECT item_kind, item_id, prior FROM library_deletion_items WHERE deletion_id = ?", [deletionId]);
      const ids = (k: string) => items.filter((i) => i.item_kind === k).map((i) => i.item_id as string);
      const unmark = async (table: string, xs: string[]) => {
        if (xs.length) await c.query(`UPDATE ${table} SET removed_at = NULL, removed_by = NULL WHERE id IN (?) AND organization_id = ?`, [xs, org]);
        return xs.length;
      };
      let restored = 0, gone = 0;
      restored += await unmark("projects", ids("project"));
      restored += await unmark("matches", ids("match"));
      // ADR-074: the videos a match delete unlinked join it again, unless they were linked to another match since
      for (const it of items.filter((i) => i.item_kind === "match")) {
        const prior = (typeof it.prior === "string" ? JSON.parse(it.prior) : it.prior) as { unlinked_videos?: string[] };
        if (prior.unlinked_videos?.length) await c.query("UPDATE video_sources SET match_id = ? WHERE id IN (?) AND organization_id = ? AND match_id IS NULL", [it.item_id, prior.unlinked_videos, org]);
      }
      for (const it of items.filter((i) => i.item_kind === "video")) {
        const prior = (typeof it.prior === "string" ? JSON.parse(it.prior) : it.prior) as { state?: string };
        if (prior.state && prior.state !== "INGESTED") { gone++; continue; }       // an upload stopped before it finished cannot come back
        await this.restoreVideo(c, p, it.item_id as string); restored++;
      }
      restored += await unmark("reel_projects", ids("reel"));
      restored += await unmark("render_jobs", ids("render"));
      restored += await unmark("library_folders", ids("folder"));
      await c.query("UPDATE library_deletions SET restored_at = CURRENT_TIMESTAMP(6), restored_by = ? WHERE id = ?", [p.userId, deletionId]);
      await recordChange(c, userActor(p), { action: `${d.item_kind as string}.restored`, entityType: d.item_kind as string, entityId: d.item_id as string,
        after: { trash_id: deletionId, restored, not_restorable: gone } });
      return { restored, not_restorable: gone };
    });
  }

  /** Upload › Undo: the newest open Trash entry for that item */
  async restoreItem(kind: RemovableKind, id: string, p: Principal) {
    const d = await this.db.one<RowDataPacket>(
      "SELECT id FROM library_deletions WHERE organization_id = ? AND item_kind = ? AND item_id = ? AND restored_at IS NULL ORDER BY deleted_at DESC LIMIT 1", [p.organizationId, kind, id]);
    if (!d) throw notFound(`Deleted ${NOUN[kind]}`);
    return this.restore(d.id as string, p);
  }

  /** a verified video back in the lists: its playback copy that the delete stopped is queued again, and the automatic analysis it asked
   *  for starts if it never ran (an analysis the delete stopped stays stopped: start it again in Processing) */
  private async restoreVideo(c: PoolConnection, p: Principal, id: string) {
    await c.query("UPDATE video_sources SET removed_at = NULL, removed_by = NULL WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
    await c.query(
      "UPDATE worker_jobs SET state = 'QUEUED', attempts = 0, progress = 0, stage_message = NULL, started_at = NULL, finished_at = NULL WHERE organization_id = ? AND subject_type = 'video' AND subject_id = ? AND kind = 'PROXY' AND state = 'CANCELLED' AND (SELECT proxy_asset_id FROM video_sources WHERE id = ?) IS NULL",
      [p.organizationId, id, id]);
    const [o] = await c.query<RowDataPacket[]>("SELECT stabilize_video, send_to_analysis FROM video_ingest_options WHERE video_id = ? AND organization_id = ? FOR UPDATE", [id, p.organizationId]);
    const [runs] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM pipeline_runs WHERE video_id = ? AND organization_id = ?", [id, p.organizationId]);
    if (o[0]?.send_to_analysis && Number(runs[0]!.n) === 0) {
      // A.11: a video whose rights do not allow analysis comes back without one (the analysis can be started once they are recorded)
      const runId = await insertRun(c, userActor(p), p.organizationId, id, { profile: o[0].stabilize_video ? "HIGH_ACCURACY" : "STANDARD" }, this.wallet)
        .catch((e: unknown) => { if (e instanceof ApiError && (e.code === "RIGHTS_REQUIRED" || e.code === "INSUFFICIENT_TOKENS")) return null; throw e; });
      if (runId) await c.query("UPDATE video_ingest_options SET auto_outcome = 'STARTED', auto_run_id = ?, auto_detail = NULL, auto_decided_at = CURRENT_TIMESTAMP(6) WHERE video_id = ?", [runId, id]);
    }
  }
}

/** ADR-074: why a video or project cannot be deleted yet, and what to delete first */
function inUseText(pl: Plan): string {
  const count = (k: RemovableKind, w: string) => { const c = pl.inUse.filter((x) => x.kind === k).length; return c ? `${c} ${w}${c === 1 ? "" : "s"}` : ""; };
  const what = [count("video", "video"), count("reel", "reel")].filter(Boolean).join(" and ");
  const all = pl.inUse.map((x) => `“${x.title}”`);
  const shown = all.length > 6 ? `${all.slice(0, 6).join(", ")} and ${all.length - 6} more` : all.join(", ");
  const them = pl.inUse.length === 1 ? "it" : "them";
  return pl.kind === "project"
    ? `This project still holds ${what}. Delete ${them} first: ${shown}.`
    : `${what[0]!.toUpperCase()}${what.slice(1)} ${pl.inUse.length === 1 ? "is" : "are"} made from this video. Delete ${them} first: ${shown}.`;
}

export const kindParam = (k: string): RemovableKind => {
  const r = RemovableKind.safeParse(k);
  if (!r.success) throw new ApiError(400, "BAD_KIND", "Only a reel, rendered file, video, match, project or folder can be deleted here.");
  return r.data;
};

@Controller("v1/library")
@UseGuards(AuthGuard)
export class LibraryRemovalController {
  constructor(private readonly removal: LibraryRemovalService) {}

  @Get("trash")
  trash(@CurrentPrincipal() p: Principal) {
    return this.removal.trash(p);
  }

  @Post("trash/:id/restore")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  restore(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.removal.restore(uuidParam(id, "Trash entry"), p);
  }

  @Get(":kind/:id/removal")
  @Roles(...PROJECT_WRITERS)
  preview(@Param("kind") kind: string, @Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.removal.preview(kindParam(kind), uuidParam(id, "Item"), p);
  }

  @Post(":kind/:id/restore")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  restoreItem(@Param("kind") kind: string, @Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.removal.restoreItem(kindParam(kind), uuidParam(id, "Item"), p);
  }

  @Delete(":kind/:id")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  remove(@Param("kind") kind: string, @Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.removal.remove(kindParam(kind), uuidParam(id, "Item"), p);
  }
}
