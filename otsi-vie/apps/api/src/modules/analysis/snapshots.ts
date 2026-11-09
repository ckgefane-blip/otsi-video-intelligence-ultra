/**
 * v3 Phase B.5 (ADR-083): snapshots, one still picture of a video at a time at full resolution, made by the SNAPSHOT worker job.
 *
 *   POST   /v1/videos/:id/snapshots        {at_pts_us, overlays}  ask for one (writers; the video's rights must allow PRODUCE) -> 202
 *   GET    /v1/videos/:id/snapshots        the video's snapshots, newest first
 *   GET    /v1/snapshots/:id               one (the page asks again until it has finished)
 *   GET    /v1/snapshots/:id/image         the PNG (?download=1: as a file to save); members of the organization only
 *   DELETE /v1/snapshots/:id               remove one (its requester, or an owner / admin); kept as removed, audited
 *
 * The worker draws only what was recorded: the frame, and if asked the boxes of the latest finished analysis at that frame, names only for
 * confirmed identities. A snapshot stays inside the organization: sharing it outside goes through Export like any other output.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { CreateSnapshotRequest, Snapshot, SnapshotOverlays, snapshotFileName } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { videoNotHidden } from "../../core/access";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { analysisRightsBlock } from "../sharing/rights";

const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
/** a person may have this many snapshots waiting or being made at once */
const OPEN_LIMIT = 5;

@Injectable()
export class SnapshotsService {
  private readonly store: LocalStore | null;
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private async video(id: string, p: Principal) {
    const v = await this.db.one<RowDataPacket>(
      `SELECT v.id, v.state, v.duration_us FROM video_sources v
        WHERE v.id = ? AND v.organization_id = ? AND v.removed_at IS NULL${videoNotHidden(p, "v.id")}`, [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  private view(r: RowDataPacket): Snapshot {
    return Snapshot.parse({
      id: r.id, video_id: r.video_id, pts_us: Number(r.pts_us), frame_pts_us: r.frame_pts_us === null ? null : Number(r.frame_pts_us),
      overlays: SnapshotOverlays.parse(json(r.overlays) ?? {}), status: r.status,
      width: r.width ?? null, height: r.height ?? null, boxes_drawn: r.boxes_drawn ?? null,
      failure: r.status === "FAILED" ? (r.failure_detail ?? r.failure_code ?? "The snapshot could not be made.") : null,
      requested_by: r.requested_by ? { user_id: r.requested_by, name: r.display_name ?? "A former member" } : null,
      created_at: new Date(r.created_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    });
  }

  private readonly SELECT = `SELECT s.*, u.display_name, v.title, v.original_filename FROM snapshots s LEFT JOIN users u ON u.id = s.requested_by
      JOIN video_sources v ON v.id = s.video_id AND v.organization_id = s.organization_id AND v.removed_at IS NULL`;

  async list(videoId: string, p: Principal): Promise<Snapshot[]> {
    await this.video(videoId, p);
    const rows = await this.db.rows<RowDataPacket>(`${this.SELECT} WHERE s.video_id = ? AND s.organization_id = ? AND s.removed_at IS NULL ORDER BY s.created_at DESC LIMIT 50`,
      [videoId, p.organizationId]);
    return rows.map((r) => this.view(r));
  }

  private async row(id: string, p: Principal) {
    const r = await this.db.one<RowDataPacket>(`${this.SELECT} WHERE s.id = ? AND s.organization_id = ? AND s.removed_at IS NULL${videoNotHidden(p, "v.id")}`, [id, p.organizationId]);
    if (!r) throw notFound("Snapshot");
    return r;
  }

  async get(id: string, p: Principal): Promise<Snapshot> {
    return this.view(await this.row(id, p));
  }

  async create(videoId: string, req: CreateSnapshotRequest, p: Principal): Promise<Snapshot> {
    const v = await this.video(videoId, p);
    if (v.state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video can be pictured.");
    if (v.duration_us !== null && req.at_pts_us > Number(v.duration_us)) throw new ApiError(422, "SNAPSHOT_OUTSIDE_VIDEO", "That time is after the end of the video.");
    const block = await analysisRightsBlock(this.db.pool, p.organizationId, videoId, "PRODUCE");
    if (block) throw new ApiError(409, "SNAPSHOT_NOT_ALLOWED", block.code === "NOT_FOR_ANALYSIS" ? "This video's rights do not allow making pictures from it." : block.text);
    const overlays = SnapshotOverlays.parse(req.overlays ?? {});
    if (overlays.selected_track_id) {
      const t = await this.db.one<RowDataPacket>("SELECT id FROM tracks WHERE id = ? AND video_id = ?", [overlays.selected_track_id, videoId]);
      if (!t) throw new ApiError(422, "TRACK_NOT_IN_VIDEO", "That player is not tracked in this video.");
    }
    const open = await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n FROM snapshots WHERE requested_by = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')",
      [p.userId, p.organizationId]);
    if (Number(open?.n ?? 0) >= OPEN_LIMIT) throw new ApiError(429, "TOO_MANY_SNAPSHOTS", `You have ${OPEN_LIMIT} snapshots being made; wait for one to finish.`);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO snapshots (id, organization_id, video_id, pts_us, overlays, requested_by) VALUES (?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, videoId, req.at_pts_us, JSON.stringify(overlays), p.userId]);
      await recordChange(c, userActor(p), { action: "video.snapshot_requested", entityType: "video", entityId: videoId, after: { snapshot_id: id, at_pts_us: req.at_pts_us, overlays },
        event: { eventType: "video.snapshot_requested", payload: { snapshot_id: id, video_id: videoId }, dedupeKey: `snapshot:${id}` } });
    });
    return this.get(id, p);
  }

  async image(id: string, p: Principal): Promise<{ path: string; bytes: number; name: string }> {
    const r = await this.row(id, p);
    if (r.status !== "SUCCEEDED" || !r.asset_id) throw new ApiError(409, "SNAPSHOT_NOT_READY", "The snapshot is not ready yet.");
    const a = await this.db.one<RowDataPacket>("SELECT object_key, byte_size FROM assets WHERE id = ? AND organization_id = ?", [r.asset_id, p.organizationId]);
    if (!a) throw notFound("Snapshot image");
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return { path: this.store.resolve(a.object_key as string), bytes: Number(a.byte_size), name: snapshotFileName(r.title ?? r.original_filename ?? null, Number(r.frame_pts_us ?? r.pts_us)) };
  }

  async remove(id: string, p: Principal): Promise<void> {
    const r = await this.row(id, p);
    if (r.requested_by !== p.userId && !["OWNER", "ADMIN"].includes(p.role)) throw new ApiError(403, "NOT_YOUR_SNAPSHOT", "Only the person who made it or an owner / admin can remove a snapshot.");
    if (r.status === "QUEUED" || r.status === "RUNNING") throw new ApiError(409, "SNAPSHOT_BEING_MADE", "Wait for the snapshot to finish, then remove it.");
    await this.db.tx(async (c) => {
      await c.query("UPDATE snapshots SET removed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "video.snapshot_removed", entityType: "video", entityId: r.video_id, before: { snapshot_id: id } });
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class SnapshotsController {
  constructor(private readonly snaps: SnapshotsService) {}

  @Get("videos/:videoId/snapshots")
  list(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) { return this.snaps.list(uuidParam(id, "Video"), p); }

  @Post("videos/:videoId/snapshots")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  create(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.snaps.create(uuidParam(id, "Video"), CreateSnapshotRequest.parse(body ?? {}), p);
  }

  @Get("snapshots/:id")
  get(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.snaps.get(uuidParam(id, "Snapshot"), p); }

  @Get("snapshots/:id/image")
  async image(@Param("id") id: string, @Query("download") dl: string | undefined, @CurrentPrincipal() p: Principal, @Res() res: FastifyReply) {
    const f = await this.snaps.image(uuidParam(id, "Snapshot"), p);
    void res.header("content-type", "image/png").header("content-length", f.bytes).header("cache-control", "private, max-age=3600");
    if (dl === "1") void res.header("content-disposition", `attachment; filename="snapshot.png"; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    void res.send(createReadStream(f.path));
  }

  @Delete("snapshots/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.snaps.remove(uuidParam(id, "Snapshot"), p); }
}
