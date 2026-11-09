/**
 * v3 Phase B.3 (ADR-082): the Analysis timeline's engine lanes and the video's markers.
 *
 *   GET    /v1/videos/:id/lanes                  shots of the latest finished analysis, where the ball was seen, where the pitch is measured,
 *                                                and the markers (only what was recorded; an empty lane says nothing was found there)
 *   POST   /v1/videos/:id/markers                pin a note at a time {at_pts_us, body} (writers)
 *   DELETE /v1/videos/:id/markers/:markerId      remove one (its author, or an owner / admin); kept in the table as removed, audited
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { CreateMarkerRequest, VideoLanes, VideoMarker, joinSpans } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { videoNotHidden } from "../../core/access";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

/** detected ball positions under this far apart are one stretch of "ball found" */
const BALL_GAP_US = 1_000_000;
/** pitch calibrations (often one per frame) under this far apart are drawn as one measured stretch, its quality weighted by duration */
const CAL_GAP_US = 250_000;

export function joinCalibrations(rows: { start_us: number; end_us: number; quality: number | null }[]) {
  const out: { start_us: number; end_us: number; q: number; w: number; qw: number }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    const w = Math.max(1, r.end_us - r.start_us);
    if (last && r.start_us - last.end_us <= CAL_GAP_US) { last.end_us = Math.max(last.end_us, r.end_us); if (r.quality !== null) { last.q += r.quality * w; last.qw += w; } }
    else out.push({ start_us: r.start_us, end_us: r.end_us, q: r.quality === null ? 0 : r.quality * w, w, qw: r.quality === null ? 0 : w });
  }
  return out.map((s) => ({ start_us: s.start_us, end_us: s.end_us, quality: s.qw ? s.q / s.qw : null }));
}

@Injectable()
export class LanesService {
  constructor(private readonly db: Db) {}

  private async video(id: string, p: Principal) {
    const v = await this.db.one<RowDataPacket>(
      `SELECT v.id, v.duration_us FROM video_sources v WHERE v.id = ? AND v.organization_id = ? AND v.removed_at IS NULL${videoNotHidden(p, "v.id")}`, [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  async markers(videoId: string, p: Principal): Promise<VideoMarker[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT m.id, m.at_pts_us, m.body, m.created_by, u.display_name, m.created_at FROM video_markers m LEFT JOIN users u ON u.id = m.created_by
        WHERE m.video_id = ? AND m.organization_id = ? AND m.removed_at IS NULL ORDER BY m.at_pts_us, m.created_at LIMIT 1000`, [videoId, p.organizationId]);
    return rows.map((r) => VideoMarker.parse({ id: r.id, at_pts_us: Number(r.at_pts_us), body: r.body,
      author: r.created_by ? { user_id: r.created_by, name: r.display_name ?? "A former member" } : null, mine: r.created_by === p.userId,
      created_at: new Date(r.created_at).toISOString() }));
  }

  async lanes(videoId: string, p: Principal): Promise<VideoLanes> {
    const v = await this.video(videoId, p);
    const run = await this.db.one<RowDataPacket>(
      "SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY finished_at DESC, created_at DESC LIMIT 1", [videoId, p.organizationId]);
    const shots = run ? await this.db.rows<RowDataPacket>("SELECT shot_number, start_pts_us, end_pts_us FROM video_shots WHERE run_id = ? ORDER BY start_pts_us", [run.id]) : [];
    const bt = await this.db.one<RowDataPacket>(
      "SELECT id, metrics FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [videoId, p.organizationId]);
    let ball: { start_us: number; end_us: number }[] | null = null;
    if (bt) {
      const pts = await this.db.rows<RowDataPacket>("SELECT pts_us FROM ball_positions WHERE ball_track_id = ? AND state = 'DETECTED' ORDER BY pts_us", [bt.id]);
      const m = typeof bt.metrics === "string" ? JSON.parse(bt.metrics) as Record<string, unknown> : (bt.metrics as Record<string, unknown> | null);
      const step = Number(m?.step_us) || 500_000;
      ball = joinSpans(pts.map((r) => Number(r.pts_us)), Math.max(BALL_GAP_US, step * 1.5), step);
    }
    const cal = await this.db.rows<RowDataPacket>("SELECT start_pts_us, end_pts_us, quality_score FROM pitch_calibrations WHERE video_id = ? ORDER BY start_pts_us", [videoId]);
    return VideoLanes.parse({
      video_id: videoId, run_id: run?.id ?? null, duration_us: v.duration_us === null ? null : Number(v.duration_us),
      shots: shots.map((s) => ({ shot_number: Number(s.shot_number), start_us: Number(s.start_pts_us), end_us: Number(s.end_pts_us) })),
      ball,
      calibrated: joinCalibrations(cal.map((c) => ({ start_us: Number(c.start_pts_us), end_us: Number(c.end_pts_us), quality: c.quality_score === null ? null : Number(c.quality_score) }))),
      markers: await this.markers(videoId, p),
    });
  }

  async addMarker(videoId: string, body: CreateMarkerRequest, p: Principal): Promise<VideoMarker[]> {
    const v = await this.video(videoId, p);
    if (v.duration_us !== null && body.at_pts_us > Number(v.duration_us)) throw new ApiError(422, "MARKER_OUTSIDE_VIDEO", "The marker is after the end of the video.");
    await this.db.tx(async (c) => {
      const id = uuidv7();
      await c.query("INSERT INTO video_markers (id, organization_id, video_id, at_pts_us, body, created_by) VALUES (?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, videoId, body.at_pts_us, body.body, p.userId]);
      await recordChange(c, userActor(p), { action: "video.marker_added", entityType: "video", entityId: videoId, after: { marker_id: id, at_pts_us: body.at_pts_us } });
    });
    return this.markers(videoId, p);
  }

  async removeMarker(videoId: string, markerId: string, p: Principal): Promise<VideoMarker[]> {
    await this.video(videoId, p);
    const m = await this.db.one<RowDataPacket>("SELECT id, created_by, body FROM video_markers WHERE id = ? AND video_id = ? AND organization_id = ? AND removed_at IS NULL",
      [markerId, videoId, p.organizationId]);
    if (!m) throw notFound("Marker");
    if (m.created_by !== p.userId && !["OWNER", "ADMIN"].includes(p.role)) throw new ApiError(403, "NOT_YOUR_MARKER", "Only its author or an owner / admin can remove a marker.");
    await this.db.tx(async (c) => {
      await c.query("UPDATE video_markers SET removed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [markerId]);
      await recordChange(c, userActor(p), { action: "video.marker_removed", entityType: "video", entityId: videoId, before: { marker_id: markerId, body: m.body } });
    });
    return this.markers(videoId, p);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class LanesController {
  constructor(private readonly lanes: LanesService) {}

  @Get("videos/:videoId/lanes")
  get(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.lanes.lanes(uuidParam(id, "Video"), p);
  }

  @Post("videos/:videoId/markers")
  @HttpCode(201)
  @Roles(...PROJECT_WRITERS)
  add(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.lanes.addMarker(uuidParam(id, "Video"), CreateMarkerRequest.parse(body), p);
  }

  @Delete("videos/:videoId/markers/:markerId")
  @Roles(...PROJECT_WRITERS)
  remove(@Param("videoId") id: string, @Param("markerId") markerId: string, @CurrentPrincipal() p: Principal) {
    return this.lanes.removeMarker(uuidParam(id, "Video"), uuidParam(markerId, "Marker"), p);
  }
}
