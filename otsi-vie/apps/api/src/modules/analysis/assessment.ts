/**
 * Footage-quality assessment (ADR-034).
 *
 *   POST /v1/videos/:id/assessments          measure the footage (ASSESS worker job): quality, player size, detector cost
 *   GET  /v1/videos/:id/assessments/latest   the latest assessment, its issues, the recommended profile and per-profile estimates
 *
 * The recommendation is advice; the user picks the profile when starting the analysis. Estimates are computed from the detector cost
 * measured on this very footage and are labelled as estimates.
 */
import { Controller, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { AnalysisProfile, PROFILES, passesPerFrame, QualityAssessment } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

/** overhead of tracking, appearance and shirt numbers on top of detection (measured on the evaluation clips: about 25 %) */
const PIPELINE_OVERHEAD = 1.25;
const MODEL_MB = 900;            // detector + embedder + OCR models loaded at once (OpenVINO, FP16/FP32)
const OCR_BUDGET_MB = 1200;      // bounded crop buffers (vie_worker.jersey.OcrBudget)

export function estimates(metrics: Record<string, unknown> | null, durationUs: number | null) {
  const cost = (metrics?.cost ?? {}) as { seconds_per_pass?: number };
  const res = (metrics?.resolution ?? {}) as { width?: number; height?: number };
  return AnalysisProfile.options.map((profile) => {
    const p = PROFILES[profile];
    const frames = Math.round(((durationUs ?? 0) / 1e6) * p.sample_fps);
    const passes = passesPerFrame(p.grids);
    const seconds = cost.seconds_per_pass ? Math.round(frames * passes * cost.seconds_per_pass * PIPELINE_OVERHEAD) : null;
    const frameMb = res.width && res.height ? (res.width * res.height * 3) / 1e6 : null;
    const peak = frameMb === null ? null : Math.round(MODEL_MB + OCR_BUDGET_MB + frameMb * 8 * (1 + passes / 4));
    return { profile, frames, passes_per_frame: passes, seconds, peak_memory_mb: peak };
  });
}

@Injectable()
export class AssessmentService {
  constructor(private readonly db: Db) {}

  private async video(id: string, p: Principal): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id, state, duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  private view(r: RowDataPacket, durationUs: number | null): QualityAssessment {
    const m = json<Record<string, unknown>>(r.metrics);
    return QualityAssessment.parse({
      id: r.id, video_id: r.video_id, status: r.status, recommended_profile: r.recommended_profile ?? null, metrics: m,
      issues: (m?.issues as unknown[]) ?? [], estimates: estimates(m, durationUs),
      failure_code: r.failure_code ?? null, failure_detail: r.failure_detail ?? null,
      created_at: new Date(r.created_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    });
  }

  async request(videoId: string, p: Principal): Promise<QualityAssessment> {
    const v = await this.video(videoId, p);
    if (v.state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video can be assessed.");
    const open = await this.db.one<RowDataPacket>("SELECT * FROM video_quality_assessments WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [videoId, p.organizationId]);
    if (open) return this.view(open, v.duration_us === null ? null : Number(v.duration_us));
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO video_quality_assessments (id, organization_id, video_id, requested_by) VALUES (?, ?, ?, ?)", [id, p.organizationId, videoId, p.userId]);
      await recordChange(c, userActor(p), { action: "video.assessment_requested", entityType: "video", entityId: videoId, after: { assessment_id: id },
        event: { eventType: "video.assessment_requested", payload: { assessment_id: id, video_id: videoId }, dedupeKey: `assessment:${id}` } });
    });
    return this.latest(videoId, p) as Promise<QualityAssessment>;
  }

  async latest(videoId: string, p: Principal): Promise<QualityAssessment> {
    const v = await this.video(videoId, p);
    const r = await this.db.one<RowDataPacket>("SELECT * FROM video_quality_assessments WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [videoId, p.organizationId]);
    if (!r) throw new ApiError(404, "NOT_ASSESSED", "This video has not been assessed yet.");
    return this.view(r, v.duration_us === null ? null : Number(v.duration_us));
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class AssessmentController {
  constructor(private readonly a: AssessmentService) {}

  @Post("videos/:videoId/assessments")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  request(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) { return this.a.request(uuidParam(id, "Video"), p); }

  @Get("videos/:videoId/assessments/latest")
  latest(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) { return this.a.latest(uuidParam(id, "Video"), p); }
}
