/**
 * The ball answer key (migration 0027; contract `ball.ts`).
 *
 *   GET    /v1/videos/:id/ball-marks         the video's marks in time order, with how many show the ball and how many say it is not visible
 *   PUT    /v1/videos/:id/ball-marks         mark one moment (writers): the ball's place, or "not visible"; marking it again replaces it
 *   DELETE /v1/ball-marks/:id                remove a mark (writers)
 *   GET    /v1/videos/:id/ball               the engine's ball (ADR-037): the latest ball track, its positions, and how it compares with the marks
 *   POST   /v1/videos/:id/ball               follow the ball again in the latest finished analysis (writers) -> a TRACK_BALL job (202)
 *
 * The engine follows the ball by itself when an analysis finishes (outbox subscriber jobs.auto_ball); marks are for the moments it cannot see.
 * Marks are measurement ground truth made by a person, kept with who made them and when (updated_at); they are not audited one by one.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Put, UseGuards } from "@nestjs/common";
import { BallMarkInput, BallMarks, BallPath, BallTrack, checkBall } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

@Injectable()
export class BallMarksService {
  constructor(private readonly db: Db) {}

  private async video(id: string, p: Principal): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id, duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  async list(videoId: string, p: Principal): Promise<BallMarks> {
    await this.video(videoId, p);
    const rows = await this.db.rows<RowDataPacket>("SELECT * FROM ball_marks WHERE video_id = ? AND organization_id = ? ORDER BY pts_us", [videoId, p.organizationId]);
    const marks = rows.map((r) => ({ id: r.id, pts_us: Number(r.pts_us), visible: !!Number(r.visible), x: r.x === null ? null : Number(r.x), y: r.y === null ? null : Number(r.y),
      marked_by: r.marked_by, updated_at: new Date(r.updated_at).toISOString() }));
    return BallMarks.parse({ video_id: videoId, marks, visible: marks.filter((m) => m.visible).length, hidden: marks.filter((m) => !m.visible).length });
  }

  async mark(videoId: string, m: BallMarkInput, p: Principal): Promise<BallMarks> {
    const v = await this.video(videoId, p);
    if (v.duration_us !== null && m.pts_us > Number(v.duration_us)) throw new ApiError(422, "MARK_OUTSIDE_VIDEO", "That moment is after the end of the video.");
    await this.db.rows(
      `INSERT INTO ball_marks (id, organization_id, video_id, pts_us, visible, x, y, marked_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE visible = VALUES(visible), x = VALUES(x), y = VALUES(y), marked_by = VALUES(marked_by)`,
      [uuidv7(), p.organizationId, videoId, m.pts_us, m.visible, m.x, m.y, p.userId]);
    return this.list(videoId, p);
  }

  async remove(id: string, p: Principal): Promise<void> {
    const r = await this.db.one<RowDataPacket>("SELECT id FROM ball_marks WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
    if (!r) throw notFound("Ball mark");
    await this.db.rows("DELETE FROM ball_marks WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
  }

  /** The video's latest ball track with its positions; `check` compares them with the marks as they are now. */
  async path(videoId: string, p: Principal): Promise<BallPath> {
    const v = await this.db.one<RowDataPacket>("SELECT id, width, height FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    const r = await this.db.one<RowDataPacket>(
      `SELECT b.*, (SELECT j.progress FROM worker_jobs j WHERE j.organization_id = b.organization_id AND j.subject_type = 'ball_track' AND j.subject_id = b.id ORDER BY j.created_at DESC LIMIT 1) AS progress,
              (SELECT j.stage_message FROM worker_jobs j WHERE j.organization_id = b.organization_id AND j.subject_type = 'ball_track' AND j.subject_id = b.id ORDER BY j.created_at DESC LIMIT 1) AS stage_message
         FROM ball_tracks b WHERE b.video_id = ? AND b.organization_id = ? ORDER BY b.created_at DESC LIMIT 1`, [videoId, p.organizationId]);
    const empty = { video_id: videoId, t: [], s: "", x: [], y: [], c: [], check: null };
    if (!r) return BallPath.parse({ ...empty, track: null });
    const metrics = r.metrics === null ? null : typeof r.metrics === "string" ? JSON.parse(r.metrics) : r.metrics;
    const track = BallTrack.parse({ id: r.id, run_id: r.run_id, status: r.status, automatic: r.requested_by === null, progress: r.progress === null ? null : Number(r.progress),
      stage_message: r.stage_message ?? null, metrics, failure_code: r.failure_code ?? null, failure_detail: r.failure_detail ?? null,
      created_at: new Date(r.created_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null });
    if (r.status !== "SUCCEEDED") return BallPath.parse({ ...empty, track });
    const rows = await this.db.rows<RowDataPacket>("SELECT pts_us, state, x, y, confidence FROM ball_positions WHERE ball_track_id = ? ORDER BY pts_us", [r.id]);
    const out = { video_id: videoId, track, t: rows.map((q) => Number(q.pts_us)), s: rows.map((q) => (q.state === "DETECTED" ? "D" : "I")).join(""),
      x: rows.map((q) => Math.round(Number(q.x) * 1e5) / 1e5), y: rows.map((q) => Math.round(Number(q.y) * 1e5) / 1e5), c: rows.map((q) => Math.round(Number(q.confidence) * 1e3) / 1e3) };
    const marks = (await this.list(videoId, p)).marks;
    const step = Number(metrics?.step_us) || 500_000;
    const check = marks.length ? checkBall(out, marks, step, Number(v.width) || 1280, Number(v.height) || 720) : null;
    return BallPath.parse({ ...out, check });
  }

  /** Follow the ball again in the video's latest finished analysis (the engine already does this by itself when an analysis finishes). */
  async start(videoId: string, p: Principal): Promise<BallPath> {
    await this.video(videoId, p);
    const run = await this.db.one<RowDataPacket>("SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [videoId, p.organizationId]);
    if (!run) throw new ApiError(409, "NO_FINISHED_ANALYSIS", "The video has no finished analysis yet: the engine follows the ball in an analysis's detections.");
    const open = await this.db.one<RowDataPacket>("SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [videoId, p.organizationId]);
    if (open) throw new ApiError(409, "BALL_TRACK_RUNNING", "The engine is already following the ball in this video.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, requested_by) VALUES (?, ?, ?, ?, ?)", [id, p.organizationId, videoId, run.id, p.userId]);
      await recordChange(c, userActor(p), { action: "video.ball_track_requested", entityType: "video", entityId: videoId, after: { ball_track_id: id, run_id: run.id },
        event: { eventType: "video.ball_track_requested", payload: { ball_track_id: id, video_id: videoId }, dedupeKey: `ball-track:${id}` } });
    });
    return this.path(videoId, p);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class BallMarksController {
  constructor(private readonly ball: BallMarksService) {}

  @Get("videos/:id/ball-marks")
  list(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.ball.list(uuidParam(id, "Video"), p); }

  @Put("videos/:id/ball-marks")
  @Roles(...PROJECT_WRITERS)
  mark(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.ball.mark(uuidParam(id, "Video"), BallMarkInput.parse(body ?? {}), p); }

  @Get("videos/:id/ball")
  path(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.ball.path(uuidParam(id, "Video"), p); }

  @Post("videos/:id/ball")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  start(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.ball.start(uuidParam(id, "Video"), p); }

  @Delete("ball-marks/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.ball.remove(uuidParam(id, "Ball mark"), p); }
}
