/**
 * Pitch calibration (Blueprint 03 step 8 `geometry`; Page 04 pitch minimap).
 *
 *   POST   /v1/videos/:id/pitch-calibrations      a person's landmark clicks on one frame -> a CALIBRATE_PITCH worker job (202)
 *   GET    /v1/videos/:id/pitch-calibrations      the video's calibrations, newest first: status, progress, what was measured, the span with positions
 *   DELETE /v1/pitch-calibrations/:id             remove one calibration and all its measured samples (audited)
 *   GET    /v1/videos/:id/pitch-camera             the match camera joined from the video's moments (newest), or null
 *   POST   /v1/videos/:id/pitch-calibrations/auto  the whole video calibrated by the engine, nobody clicking (ADR-036) -> a CALIBRATE_PITCH job (202)
 *
 * The clicks are checked here before any work is queued (enough points, known landmark names, not on one line, not mirrored, agreeing with each
 * other); the worker checks them again and fits the pitch lines to the real white lines. A calibration only ever adds rows for moments it could
 * measure: a moment without a row is "not measured", and the observations endpoint then gives no pitch position.
 * A moment may have only 2-3 clicks: the worker joins it with the video's other moments through the one match camera (0025, `camera.solve`)
 * and it WAITS until enough moments pin it down. All moments of a video use one pitch size (the camera is one).
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { CreateAutoPitchCalibration, CreatePitchCalibration, DEFAULT_PITCH_LENGTH_M, DEFAULT_PITCH_WIDTH_M, fitFromPoints, MIN_PITCH_EQUATIONS, PitchCalibration, PitchCamera, pitchEquations, pitchLandmarks, pitchLines, type Pt } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const MAX_CLICK_PX = 14;          // of a 640 px wide picture: the marked points must agree with a pitch to within this
const MIN_APART_PX = 6;           // of a 640 px wide picture: two marked places closer than this are one place clicked twice
const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

@Injectable()
export class PitchCalibrationService {
  constructor(private readonly db: Db) {}

  private async video(id: string, p: Principal): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id, state, width, height, duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  async create(videoId: string, body: CreatePitchCalibration, p: Principal): Promise<PitchCalibration> {
    const v = await this.video(videoId, p);
    if (v.state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video can be calibrated.");
    if (v.duration_us !== null && body.anchor_pts_us > Number(v.duration_us)) throw new ApiError(422, "ANCHOR_OUTSIDE_VIDEO", "That moment is after the end of the video.");
    const lm = pitchLandmarks(body.pitch_length_m, body.pitch_width_m);
    const names = body.points.map((q) => q.landmark);
    const unknown = names.find((n) => !(n in lm));
    if (unknown) throw new ApiError(422, "UNKNOWN_LANDMARK", `"${unknown}" is not a pitch landmark.`);
    if (new Set(names).size !== names.length) throw new ApiError(422, "DUPLICATE_LANDMARK", "Each landmark can be marked once.");
    const lineNames = Object.keys(pitchLines(body.pitch_length_m, body.pitch_width_m));
    const badLine = body.lines.find((q) => !lineNames.includes(q.line));
    if (badLine) throw new ApiError(422, "UNKNOWN_LINE", `"${badLine.line}" is not a pitch line.`);
    if (pitchEquations(body.points.length, body.lines.length) < MIN_PITCH_EQUATIONS)
      throw new ApiError(422, "TOO_FEW_CLICKS", "Mark at least two places, or one place and two clicks on lines.");
    const pitch = names.map((n) => lm[n]!) as Pt[], image = body.points.map((q) => [q.x, q.y] as Pt);
    const h640 = v.width && v.height ? Math.round((640 * Number(v.height)) / Number(v.width)) : 360;
    if (pitch.length >= 4) {                                                       // four or more may fix a pitch alone: they must make sense alone
      const fit = fitFromPoints(pitch, image, 640, h640);
      // on one line: never alone, but fine for a moment joined through the match camera (fewer than six; the centre landmarks all lie on the halfway line)
      if (fit.collinear && pitch.length >= 6) throw new ApiError(422, "POINTS_ON_ONE_LINE", "The points you marked lie on one line, which cannot fix the pitch alone. Mark points off that line, or fewer than six to join this moment with your others.");
      if (!fit.collinear && fit.mirrored) throw new ApiError(422, "POINTS_MIRRORED", "The points look mirrored: the pitch would be seen back to front. Check which landmark each click is.");
      if (!fit.collinear && !(fit.rmsPx <= MAX_CLICK_PX)) throw new ApiError(422, "POINTS_INCONSISTENT", `The marked points do not agree with each other (they are off by about ${Math.round(fit.rmsPx)} px). Check the landmark names and click again.`);
    }
    const all = [...image, ...body.lines.map((q) => [q.x, q.y] as Pt)];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (Math.hypot((all[i]![0] - all[j]![0]) * 640, (all[i]![1] - all[j]![1]) * h640) < MIN_APART_PX)
        throw new ApiError(422, "POINTS_TOO_CLOSE", "Two of the places you marked are on top of each other in the picture. Mark places that are spread across the picture.");
    }
    const other = await this.db.one<RowDataPacket>(`SELECT pitch_length_m, pitch_width_m FROM pitch_calibration_requests WHERE video_id = ? AND organization_id = ?
                                                    AND status <> 'FAILED' AND (ABS(pitch_length_m - ?) > 0.01 OR ABS(pitch_width_m - ?) > 0.01) LIMIT 1`,
      [videoId, p.organizationId, body.pitch_length_m, body.pitch_width_m]);
    if (other) throw new ApiError(422, "PITCH_SIZE_DIFFERS", `This video's other moments use a ${Number(other.pitch_length_m)} × ${Number(other.pitch_width_m)} m pitch. One match has one pitch: use the same size, or remove those moments first.`);
    const open = await this.db.one<RowDataPacket>("SELECT id FROM pitch_calibration_requests WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [videoId, p.organizationId]);
    if (open) throw new ApiError(409, "CALIBRATION_ALREADY_RUNNING", "A pitch calibration of this video is already running.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO pitch_calibration_requests (id, organization_id, video_id, anchor_pts_us, points, pitch_length_m, pitch_width_m, requested_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, p.organizationId, videoId, body.anchor_pts_us, JSON.stringify([...body.points, ...body.lines]), body.pitch_length_m, body.pitch_width_m, p.userId]);
      await recordChange(c, userActor(p), { action: "video.pitch_calibration_requested", entityType: "video", entityId: videoId, after: { request_id: id, anchor_pts_us: body.anchor_pts_us, points: body.points.length, line_clicks: body.lines.length },
        event: { eventType: "video.pitch_calibration_requested", payload: { request_id: id, video_id: videoId }, dedupeKey: `pitch-calibration:${id}` } });
    });
    return (await this.list(videoId, p)).find((r) => r.id === id)!;
  }

  async createAuto(videoId: string, body: CreateAutoPitchCalibration, p: Principal): Promise<PitchCalibration> {
    const v = await this.video(videoId, p);
    if (v.state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video can be calibrated.");
    const size = await this.db.one<RowDataPacket>("SELECT pitch_length_m, pitch_width_m FROM pitch_calibration_requests WHERE video_id = ? AND organization_id = ? AND status <> 'FAILED' ORDER BY created_at LIMIT 1",
      [videoId, p.organizationId]);
    const length = size ? Number(size.pitch_length_m) : body.pitch_length_m ?? DEFAULT_PITCH_LENGTH_M, width = size ? Number(size.pitch_width_m) : body.pitch_width_m ?? DEFAULT_PITCH_WIDTH_M;
    if (size && ((body.pitch_length_m !== undefined && Math.abs(body.pitch_length_m - length) > 0.01) || (body.pitch_width_m !== undefined && Math.abs(body.pitch_width_m - width) > 0.01)))
      throw new ApiError(422, "PITCH_SIZE_DIFFERS", `This video's other moments use a ${length} × ${width} m pitch. One match has one pitch: use the same size, or remove those moments first.`);
    const open = await this.db.one<RowDataPacket>("SELECT id FROM pitch_calibration_requests WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [videoId, p.organizationId]);
    if (open) throw new ApiError(409, "CALIBRATION_ALREADY_RUNNING", "A pitch calibration of this video is already running.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO pitch_calibration_requests (id, organization_id, video_id, mode, anchor_pts_us, points, pitch_length_m, pitch_width_m, requested_by)
                     VALUES (?, ?, ?, 'AUTO', 0, '[]', ?, ?, ?)`, [id, p.organizationId, videoId, length, width, p.userId]);
      await recordChange(c, userActor(p), { action: "video.pitch_calibration_requested", entityType: "video", entityId: videoId, after: { request_id: id, mode: "AUTO" },
        event: { eventType: "video.pitch_calibration_requested", payload: { request_id: id, video_id: videoId }, dedupeKey: `pitch-calibration:${id}` } });
    });
    return (await this.list(videoId, p)).find((r) => r.id === id)!;
  }

  async list(videoId: string, p: Principal): Promise<PitchCalibration[]> {
    await this.video(videoId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT r.*, (SELECT COUNT(*) FROM pitch_calibrations c WHERE c.request_id = r.id) AS samples,
              (SELECT MIN(c.start_pts_us) FROM pitch_calibrations c WHERE c.request_id = r.id) AS first_us,
              (SELECT MAX(c.end_pts_us) FROM pitch_calibrations c WHERE c.request_id = r.id) AS last_us,
              (SELECT j.progress FROM worker_jobs j WHERE j.organization_id = r.organization_id AND j.subject_type = 'pitch_calibration' AND j.subject_id = r.id ORDER BY j.created_at DESC LIMIT 1) AS progress,
              (SELECT j.stage_message FROM worker_jobs j WHERE j.organization_id = r.organization_id AND j.subject_type = 'pitch_calibration' AND j.subject_id = r.id ORDER BY j.created_at DESC LIMIT 1) AS stage_message
         FROM pitch_calibration_requests r WHERE r.video_id = ? AND r.organization_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 50`, [videoId, p.organizationId]);
    return rows.map((r) => PitchCalibration.parse({
      id: r.id, video_id: r.video_id, anchor_pts_us: Number(r.anchor_pts_us), status: r.status, mode: r.mode, progress: r.progress === null || r.progress === undefined ? null : Number(r.progress),
      stage_message: r.stage_message ?? null, point_count: (json<unknown[]>(r.points) ?? []).length,
      landmarks: (json<{ landmark?: string }[]>(r.points) ?? []).flatMap((q) => (q.landmark ? [q.landmark] : [])),
      lines: (json<{ line?: string }[]>(r.points) ?? []).flatMap((q) => (q.line ? [q.line] : [])), pitch_length_m: Number(r.pitch_length_m), pitch_width_m: Number(r.pitch_width_m),
      metrics: json<Record<string, unknown>>(r.metrics), coverage: { samples: Number(r.samples ?? 0), first_pts_us: r.first_us === null ? null : Number(r.first_us), last_pts_us: r.last_us === null ? null : Number(r.last_us) },
      failure_code: r.failure_code ?? null, failure_detail: r.failure_detail ?? null,
      created_at: new Date(r.created_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    }));
  }

  async camera(videoId: string, p: Principal): Promise<PitchCamera | null> {
    await this.video(videoId, p);
    const r = await this.db.one<RowDataPacket>("SELECT * FROM pitch_cameras WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [videoId, p.organizationId]);
    if (!r) return null;
    return PitchCamera.parse({ id: r.id, position_m: [Number(r.centre_x_m), Number(r.centre_y_m)], height_m: Number(r.height_m), roll_deg: Number(r.roll_deg),
      moments: (json<string[]>(r.moments) ?? []).length, points: Number(r.points), click_rms_px: Number(r.click_rms_px), created_at: new Date(r.created_at).toISOString() });
  }

  async remove(id: string, p: Principal): Promise<void> {
    const r = await this.db.one<RowDataPacket>("SELECT id, video_id, status FROM pitch_calibration_requests WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
    if (!r) throw notFound("Pitch calibration");
    if (r.status === "RUNNING") throw new ApiError(409, "CALIBRATION_RUNNING", "Wait until the calibration has finished, then remove it.");
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM pitch_calibration_requests WHERE id = ? AND organization_id = ?", [id, p.organizationId]);       // the measured samples go with it (ON DELETE CASCADE)
      await c.query("DELETE FROM pitch_cameras WHERE video_id = ? AND organization_id = ? AND JSON_CONTAINS(moments, JSON_QUOTE(?))", [r.video_id, p.organizationId, id]);   // a camera built on it no longer stands
      await recordChange(c, userActor(p), { action: "video.pitch_calibration_removed", entityType: "video", entityId: String(r.video_id), before: { request_id: id } });
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class PitchCalibrationController {
  constructor(private readonly pitch: PitchCalibrationService) {}

  @Post("videos/:videoId/pitch-calibrations")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  create(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.pitch.create(uuidParam(id, "Video"), CreatePitchCalibration.parse(body ?? {}), p); }

  @Post("videos/:videoId/pitch-calibrations/auto")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  createAuto(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.pitch.createAuto(uuidParam(id, "Video"), CreateAutoPitchCalibration.parse(body ?? {}), p); }

  @Get("videos/:videoId/pitch-calibrations")
  list(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) { return this.pitch.list(uuidParam(id, "Video"), p); }

  @Get("videos/:videoId/pitch-camera")
  async camera(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) { return { camera: await this.pitch.camera(uuidParam(id, "Video"), p) }; }

  @Delete("pitch-calibrations/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.pitch.remove(uuidParam(id, "Pitch calibration"), p); }
}
