/**
 * Job system v2 (v3 Phase A.2, ADR-060, migration 0045): one place to watch and manage every engine job of the organization.
 *
 *   GET  /v1/jobs                     the jobs waiting, running or paused, and those finished in the last 24 hours (newest first)
 *   GET  /v1/jobs?video_id=           every job of one video (its ingest, checks, runs, ball, pitch, lineups and its reels' renders), for
 *                                     the Processing page's job table and ribbon (A.4); an analysis carries the footage check's estimate
 *   POST /v1/jobs/:id/pause           hold a waiting job (the worker never claims a PAUSED job)
 *   POST /v1/jobs/:id/resume          put a held job back in the queue
 *   POST /v1/jobs/:id/priority        HIGH / NORMAL / LOW for a waiting or held job (the worker takes higher first, then older)
 *   POST /v1/jobs/:id/cancel          stop it, through the job's own module (an analysis run, a render, a playback copy), so the run,
 *                                     render or video says "cancelled" too; a short job (assessment, ball, pitch, lineups) only while it waits
 *   POST /v1/jobs/:id/retry           run a failed or cancelled job again through its own module: a NEW run / render / read is made and
 *                                     the old one is kept as it was (its record and audit stay)
 *
 * Each job carries only the actions that are possible now; the server re-checks every action. A job is shown with the video (or reel)
 * it works on; a job in a project hidden from the person is left out, and a change needs the Editor permission there.
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CreateAnalysisRequest, CreateRenderRequest, Job, JobAction, JobKind, JobList, JobPriority, SetJobPriorityRequest, WalletJobType } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { isHidden } from "../../core/access";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, forbidden, notFound } from "../../core/problem";
import { AnalysisService } from "../analysis/analysis";
import { AssessmentService, estimates } from "../analysis/assessment";
import { BallMarksService } from "../analysis/ball";
import { LineupsService } from "../analysis/lineups";
import { MediaService } from "../media/media";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { ReelsService } from "../reels/reels";
import { WalletService } from "../wallet/wallet";

export const KIND_LABEL: Record<JobKind, string> = {
  INGEST_UPLOAD: "Upload check", INGEST_URL: "Link import", PROXY: "Playback copy", ASSESS: "Footage check", ANALYZE: "Analysis",
  TRACK_BALL: "Ball & events", CALIBRATE_PITCH: "Pitch calibration", READ_LINEUPS: "Lineups", RENDER: "Render", SNAPSHOT: "Snapshot", BEAT_GRID: "Beat grid",
};
const PRIORITY_VALUE: Record<JobPriority, number> = { HIGH: 2, NORMAL: 5, LOW: 8 };
const priorityName = (n: number): JobPriority => (n <= 3 ? "HIGH" : n >= 7 ? "LOW" : "NORMAL");
/** jobs whose own module can stop them while they run (the worker notices within seconds) */
const STOPPABLE_RUNNING = new Set<JobKind>(["ANALYZE", "RENDER", "PROXY"]);
/** short jobs without a cancelled state of their own: stopped only while they wait; their row is closed as FAILED / CANCELLED */
const SUBJECT_TABLE: Partial<Record<JobKind, string>> = {
  ASSESS: "video_quality_assessments", TRACK_BALL: "ball_tracks", CALIBRATE_PITCH: "pitch_calibration_requests", READ_LINEUPS: "lineup_reads", SNAPSHOT: "snapshots", BEAT_GRID: "music_beat_grids",
};
const RETRYABLE = new Set<JobKind>(["ANALYZE", "RENDER", "PROXY", "ASSESS", "TRACK_BALL", "READ_LINEUPS"]);
const WRITE_PERMISSIONS = new Set(["FULL", "EDIT", "ADMIN"]);

interface JobRow extends RowDataPacket {
  id: string; kind: JobKind; subject_type: string; subject_id: string; state: Job["state"]; priority: number; progress: string | number;
  stage_message: string | null; error_code: string | null; error_detail: string | null; attempts: number; created_at: string;
  started_at: string | null; finished_at: string | null; vid: string | null; reel_id: string | null; reel_name: string | null;
  reel_project: string | null; requester: string | null; title: string | null; original_filename: string | null; project_id: string | null;
  removed_at: string | null; requester_name: string | null; run_config: unknown; render_config: unknown; worker_id: string | null;
}
/** "worker-<host>-<suffix>" (vie_worker.main) -> the host */
const machine = (w: string | null) => (w ? w.replace(/^worker-/, "").replace(/-[0-9a-f]{6}$/, "") : null);

const SELECT = `
  SELECT x.*, v.title, v.original_filename, v.project_id, v.removed_at, u.display_name AS requester_name
    FROM (SELECT j.id, j.kind, j.subject_type, j.subject_id, j.state, j.priority, j.progress, j.stage_message, j.error_code, j.error_detail,
                 j.attempts, j.created_at, j.started_at, j.finished_at, j.worker_id, pr.config AS run_config, rj.config AS render_config,
                 COALESCE(IF(j.subject_type = 'video', j.subject_id, NULL), pr.video_id, rp.video_id, qa.video_id, pc.video_id, bt.video_id, lr.video_id, sn.video_id) AS vid,
                 rp.id AS reel_id, rp.name AS reel_name, rp.project_id AS reel_project,
                 COALESCE(rj.requested_by, qa.requested_by, pc.requested_by, bt.requested_by, lr.requested_by, sn.requested_by) AS requester
            FROM worker_jobs j
            LEFT JOIN pipeline_runs pr ON j.subject_type = 'analysis_run' AND pr.id = j.subject_id
            LEFT JOIN render_jobs rj ON j.subject_type = 'render_job' AND rj.id = j.subject_id
            LEFT JOIN reel_projects rp ON rp.id = rj.reel_id
            LEFT JOIN video_quality_assessments qa ON j.subject_type = 'quality_assessment' AND qa.id = j.subject_id
            LEFT JOIN pitch_calibration_requests pc ON j.subject_type = 'pitch_calibration' AND pc.id = j.subject_id
            LEFT JOIN ball_tracks bt ON j.subject_type = 'ball_track' AND bt.id = j.subject_id
            LEFT JOIN lineup_reads lr ON j.subject_type = 'lineup_read' AND lr.id = j.subject_id
            LEFT JOIN snapshots sn ON j.subject_type = 'snapshot' AND sn.id = j.subject_id
           WHERE j.organization_id = ? %WHERE%) x
    LEFT JOIN video_sources v ON v.id = x.vid AND v.organization_id = ?
    LEFT JOIN users u ON u.id = COALESCE(x.requester, IF(x.subject_type = 'video', v.created_by, NULL))`;

const json = <T>(v: unknown): T | null => (v == null ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

@Injectable()
export class JobsService {
  constructor(private readonly db: Db, private readonly analysis: AnalysisService, private readonly reels: ReelsService, private readonly media: MediaService,
    private readonly assessment: AssessmentService, private readonly ball: BallMarksService, private readonly lineups: LineupsService,
    private readonly wallet: WalletService) {}

  private canWrite(r: JobRow, p: Principal): boolean {
    if (!(PROJECT_WRITERS as readonly string[]).includes(p.role)) return false;
    const pid = r.project_id ?? r.reel_project;
    const perm = pid ? p.access?.restricted.get(pid) : undefined;
    return !perm || WRITE_PERMISSIONS.has(perm);
  }

  private actions(r: JobRow, p: Principal, newest: boolean): JobAction[] {
    if (!this.canWrite(r, p)) return [];
    const waiting = r.state === "QUEUED" || r.state === "PAUSED";
    const ingest = r.kind === "INGEST_UPLOAD" || r.kind === "INGEST_URL";     // an ingest is the video's own check: remove the video instead
    const out: JobAction[] = [];
    if (r.state === "QUEUED") out.push("pause");
    if (r.state === "PAUSED") out.push("resume");
    if (waiting) out.push("priority");
    if (!ingest && (waiting || (r.state === "RUNNING" && STOPPABLE_RUNNING.has(r.kind)))) out.push("cancel");
    if ((r.state === "FAILED" || r.state === "CANCELLED") && RETRYABLE.has(r.kind) && newest && !r.removed_at) out.push("retry");
    return out;
  }

  private view(r: JobRow, p: Principal, newest: boolean, estimate: ((profile: string) => number | null) | null = null): Job {
    const title = r.kind === "RENDER" ? (r.reel_name ?? null) : (r.title ?? r.original_filename ?? null);
    const href = r.kind === "RENDER" ? (r.reel_id ? `/exports?reel=${r.reel_id}` : null)
      : !r.vid ? null
      : ["ANALYZE", "TRACK_BALL", "CALIBRATE_PITCH", "READ_LINEUPS", "SNAPSHOT"].includes(r.kind) ? `/analysis?video=${r.vid}` : `/processing?video=${r.vid}`;
    return Job.parse({
      id: r.id, kind: r.kind, kind_label: KIND_LABEL[r.kind], subject_title: title, video_id: r.vid, href: r.removed_at ? null : href, state: r.state,
      // the worker's step only while it waits or works; a finished job's last step ("Checking the rendered file") is history, not news
      priority: priorityName(Number(r.priority)), progress: r.state === "SUCCEEDED" ? 100 : Number(r.progress),
      stage: r.state === "RUNNING" || r.state === "QUEUED" || r.state === "PAUSED" ? r.stage_message : null,
      error: r.state === "FAILED" ? (r.error_detail ?? r.error_code) : null, attempts: Number(r.attempts), requested_by: r.requester_name,
      worker: machine(r.worker_id),
      estimate_s: r.kind === "ANALYZE" && estimate ? estimate(String(json<Record<string, unknown>>(r.run_config)?.profile ?? "STANDARD")) : null,
      created_at: new Date(r.created_at).toISOString(), started_at: r.started_at ? new Date(r.started_at).toISOString() : null, finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null, actions: this.actions(r, p, newest),
    });
  }

  /** a hidden project's jobs are left out; so are the finished jobs of a video in Trash (an active one stays, so it can be watched) */
  private visible(r: JobRow, p: Principal) {
    const active = r.state === "QUEUED" || r.state === "RUNNING" || r.state === "PAUSED";
    return !isHidden(p, r.project_id) && !isHidden(p, r.reel_project) && (active || !r.removed_at);
  }

  /** Auto-refund (ADR-140 §7, the refund-on-failure fix): the Python worker marks a run/render FAILED
   *  directly in the database and never calls the API, so no API code runs at the moment of failure to
   *  refund the charge — the cancel paths only refund a job cancelled before it started. The Jobs Center
   *  list is the observation point (polled every few seconds by the ActivityLine and the Jobs Center):
   *  when it sees a FAILED analysis or render that was charged, it refunds the full committed tokens via
   *  WalletService.refundForJob. That method is idempotent — it returns null when the job was never
   *  charged or was already refunded — so calling it on every poll is safe; a failure here never breaks
   *  the list (the next poll retries). Only the two charged kinds the worker runs are reconciled here;
   *  player reports, AI analysis and export packs fail inside the API and already refund synchronously.
   *  The refund is written as the system (actor null), not as the user who happened to list the jobs. */
  private async reconcileFailedRefunds(p: Principal, rows: JobRow[]): Promise<void> {
    for (const r of rows) {
      if (r.state !== "FAILED") continue;
      const job: { type: WalletJobType; id: string; reason: string } | null =
        r.kind === "ANALYZE" && r.subject_type === "analysis_run"
          ? { type: "ANALYSIS", id: r.subject_id, reason: "Analysis failed while running, so its tokens were returned." }
          : r.kind === "RENDER" && r.subject_type === "render_job"
          ? { type: "REEL_RENDER", id: r.subject_id, reason: "Render failed while running, so its tokens were returned." }
          : null;
      if (!job) continue;
      try {
        await this.db.tx(async (c) => {
          await this.wallet.refundForJob(c, p.organizationId, null, job);
        });
      } catch {
        // a transient failure must not break the job list; the next poll retries the refund.
      }
    }
  }

  async list(p: Principal, videoId?: string): Promise<JobList> {
    const where = videoId ? "HAVING vid = ?"
      : "AND (j.state IN ('QUEUED', 'RUNNING', 'PAUSED') OR j.finished_at >= CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY OR j.created_at >= CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY)";
    const rows = await this.db.rows<JobRow>(
      `${SELECT.replace("%WHERE%", where)}
        ORDER BY CASE x.state WHEN 'RUNNING' THEN 0 WHEN 'QUEUED' THEN 1 WHEN 'PAUSED' THEN 1 ELSE 2 END,
                 IF(x.state IN ('QUEUED', 'PAUSED'), x.priority, 0), COALESCE(x.finished_at, x.created_at) DESC LIMIT ${videoId ? 100 : 60}`,
      videoId ? [p.organizationId, videoId, p.organizationId] : [p.organizationId, p.organizationId]);
    // auto-refund for charged jobs the worker marked FAILED (ADR-140 §7): see reconcileFailedRefunds.
    await this.reconcileFailedRefunds(p, rows);
    // the footage check's per-profile estimate for this video's analyses (A.4 "estimate vs actual"); none without a finished check
    let estimate: ((profile: string) => number | null) | null = null;
    if (videoId) {
      const a = await this.db.one<RowDataPacket>(
        `SELECT q.metrics, v.duration_us FROM video_quality_assessments q JOIN video_sources v ON v.id = q.video_id
          WHERE q.video_id = ? AND q.organization_id = ? AND q.status = 'SUCCEEDED' ORDER BY q.created_at DESC LIMIT 1`, [videoId, p.organizationId]);
      if (a) {
        const est = estimates(json<Record<string, unknown>>(a.metrics), a.duration_us === null ? null : Number(a.duration_us));
        estimate = (profile) => est.find((e) => e.profile === profile)?.seconds ?? null;
      }
    }
    const seen = new Set<string>();
    // "newest": no later job of the same kind on the same video / reel in the list (a retry is offered on the latest attempt only)
    const byAge = [...rows].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const newest = new Set<string>();
    for (const r of byAge) {
      const k = `${r.kind}:${r.kind === "RENDER" ? r.reel_id : r.vid}`;
      if (!seen.has(k)) { seen.add(k); newest.add(r.id); }
    }
    const jobs = rows.filter((r) => this.visible(r, p)).map((r) => this.view(r, p, newest.has(r.id), estimate));
    return JobList.parse({
      jobs,
      active: jobs.filter((j) => j.state === "QUEUED" || j.state === "RUNNING" || j.state === "PAUSED").length,
      running: jobs.filter((j) => j.state === "RUNNING").length,
      failed_recent: jobs.filter((j) => j.state === "FAILED").length,
    });
  }

  private async row(id: string, p: Principal): Promise<JobRow> {
    const r = (await this.db.rows<JobRow>(SELECT.replace("%WHERE%", "AND j.id = ?"), [p.organizationId, id, p.organizationId]))[0];
    if (!r || !this.visible(r, p)) throw notFound("Job");
    if (!this.canWrite(r, p)) throw forbidden("PROJECT_READ_ONLY", "You can see this job but not change it.");
    return r;
  }

  async get(id: string, p: Principal): Promise<Job> {
    const r = (await this.db.rows<JobRow>(SELECT.replace("%WHERE%", "AND j.id = ?"), [p.organizationId, id, p.organizationId]))[0];
    if (!r || !this.visible(r, p)) throw notFound("Job");
    const later = await this.db.one<RowDataPacket>(
      `SELECT 1 FROM worker_jobs WHERE organization_id = ? AND kind = ? AND created_at > ? AND id <> ? AND subject_id IN (${r.kind === "RENDER" ? "SELECT id FROM render_jobs WHERE reel_id = ?" : "?"}) LIMIT 1`,
      [p.organizationId, r.kind, r.created_at, r.id, r.kind === "RENDER" ? r.reel_id : r.subject_id]);
    return this.view(r, p, !later);
  }

  private async setState(id: string, p: Principal, from: string, sql: string, args: unknown[], action: string, code: string, message: string) {
    await this.db.tx(async (c) => {
      const [res] = await c.query(`UPDATE worker_jobs SET ${sql} WHERE id = ? AND organization_id = ? AND state = '${from}'`, [...args, id, p.organizationId]);
      if (!(res as unknown as { affectedRows: number }).affectedRows) throw new ApiError(409, code, message);
      await recordChange(c, userActor(p), { action, entityType: "worker_job", entityId: id });
    });
  }

  async pause(id: string, p: Principal): Promise<Job> {
    await this.row(id, p);
    await this.setState(id, p, "QUEUED", "state = 'PAUSED', paused_at = CURRENT_TIMESTAMP(6), paused_by = ?", [p.userId], "job.paused",
      "JOB_NOT_WAITING", "Only a waiting job can be paused; a running job can be cancelled.");
    return this.get(id, p);
  }

  async resume(id: string, p: Principal): Promise<Job> {
    await this.row(id, p);
    await this.setState(id, p, "PAUSED", "state = 'QUEUED', available_at = CURRENT_TIMESTAMP(6)", [], "job.resumed", "JOB_NOT_PAUSED", "This job is not paused.");
    return this.get(id, p);
  }

  async priority(id: string, body: SetJobPriorityRequest, p: Principal): Promise<Job> {
    await this.row(id, p);
    await this.db.tx(async (c) => {
      const [res] = await c.query("UPDATE worker_jobs SET priority = ? WHERE id = ? AND organization_id = ? AND state IN ('QUEUED', 'PAUSED')",
        [PRIORITY_VALUE[body.priority], id, p.organizationId]);
      if (!(res as unknown as { affectedRows: number }).affectedRows) throw new ApiError(409, "JOB_NOT_WAITING", "Only a waiting job can change its place in the queue.");
      await recordChange(c, userActor(p), { action: "job.priority_changed", entityType: "worker_job", entityId: id, after: { priority: body.priority } });
    });
    return this.get(id, p);
  }

  async cancel(id: string, p: Principal): Promise<Job> {
    const r = await this.row(id, p);
    if (!this.actions(r, p, true).includes("cancel")) {
      throw new ApiError(409, "JOB_NOT_CANCELLABLE", r.state === "RUNNING" ? "This job is short and cannot be stopped once it runs; it finishes on its own." : "This job has already finished.");
    }
    if (r.kind === "ANALYZE") await this.analysis.cancel(r.subject_id, p);
    else if (r.kind === "RENDER") await this.reels.cancelRender(r.subject_id, p);
    else if (r.kind === "PROXY") await this.media.cancelPlaybackCopy(r.subject_id, p);
    else {
      const table = SUBJECT_TABLE[r.kind];
      if (!table) throw new ApiError(409, "JOB_NOT_CANCELLABLE", "This job cannot be cancelled here.");
      await this.db.tx(async (c) => {
        const [res] = await c.query("UPDATE worker_jobs SET state = 'CANCELLED', finished_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND organization_id = ? AND state IN ('QUEUED', 'PAUSED')",
          [id, p.organizationId]);
        if (!(res as unknown as { affectedRows: number }).affectedRows) throw new ApiError(409, "JOB_NOT_CANCELLABLE", "This job has started and finishes on its own.");
        // the row it works on has no cancelled state: it is closed as failed with the code CANCELLED, so the page can start it again
        await c.query(`UPDATE ${table} SET status = 'FAILED', failure_code = 'CANCELLED', finished_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')`,
          [r.subject_id, p.organizationId]);
        await recordChange(c, userActor(p), { action: "job.cancelled", entityType: "worker_job", entityId: id, after: { kind: r.kind } });
      });
    }
    return this.get(id, p);
  }

  /** a failed or cancelled job again, through its own module; returns the NEW job (the old one stays in the list as it was) */
  async retry(id: string, p: Principal): Promise<Job> {
    const r = await this.row(id, p);
    const current = await this.get(id, p);
    if (!current.actions.includes("retry")) throw new ApiError(409, "JOB_NOT_RETRYABLE", "Only the latest failed or cancelled attempt can be run again.");
    const vid = r.vid;
    if (!vid) throw notFound("Video");
    let subjectType: string, subjectId: string;
    if (r.kind === "ANALYZE") {
      const cfg = json<Record<string, unknown>>(r.run_config) ?? {};
      const asked = CreateAnalysisRequest.safeParse({ profile: cfg.profile ?? undefined, sample_fps: cfg.sample_fps, detector: cfg.detector ?? undefined });
      const run = await this.analysis.start(vid, asked.success ? asked.data : CreateAnalysisRequest.parse({}), p);
      [subjectType, subjectId] = ["analysis_run", run.id];
    } else if (r.kind === "RENDER") {
      const cfg = json<Record<string, unknown>>(r.render_config) ?? {};
      const asked = CreateRenderRequest.safeParse({ codec: cfg.codec, bitrate_mbps: cfg.bitrate_mbps });
      const render = await this.reels.startRender(r.reel_id as string, asked.success ? asked.data : CreateRenderRequest.parse({}), uuidv7(), p);
      [subjectType, subjectId] = ["render_job", render.id];
    } else if (r.kind === "PROXY") {
      await this.media.makePlaybackCopy(vid, p);
      return this.get(id, p);                                               // the playback copy re-queues its own job
    } else if (r.kind === "ASSESS") {
      const a = await this.assessment.request(vid, p);
      [subjectType, subjectId] = ["quality_assessment", a.id];
    } else if (r.kind === "TRACK_BALL") {
      await this.ball.start(vid, p);
      const b = await this.db.one<RowDataPacket>("SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 1", [vid, p.organizationId]);
      [subjectType, subjectId] = ["ball_track", b!.id as string];
    } else if (r.kind === "READ_LINEUPS") {
      await this.lineups.start(vid, p);
      const l = await this.db.one<RowDataPacket>("SELECT id FROM lineup_reads WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 1", [vid, p.organizationId]);
      [subjectType, subjectId] = ["lineup_read", l!.id as string];
    } else {
      throw new ApiError(409, "JOB_NOT_RETRYABLE", "Start this again on its page.");
    }
    // the new job is made by the outbox shortly after; answer with it when it is already there, else with the old one (the tray refreshes)
    const fresh = await this.db.one<RowDataPacket>("SELECT id FROM worker_jobs WHERE organization_id = ? AND subject_type = ? AND subject_id = ?", [p.organizationId, subjectType, subjectId]);
    return this.get((fresh?.id as string | undefined) ?? id, p);
  }
}

@Controller("v1/jobs")
@UseGuards(AuthGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Query("video_id") videoId: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.jobs.list(p, videoId ? uuidParam(videoId, "Video") : undefined);
  }

  @Post(":jobId/pause")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  pause(@Param("jobId") id: string, @CurrentPrincipal() p: Principal) {
    return this.jobs.pause(uuidParam(id, "Job"), p);
  }

  @Post(":jobId/resume")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  resume(@Param("jobId") id: string, @CurrentPrincipal() p: Principal) {
    return this.jobs.resume(uuidParam(id, "Job"), p);
  }

  @Post(":jobId/priority")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  priority(@Param("jobId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.jobs.priority(uuidParam(id, "Job"), SetJobPriorityRequest.parse(body ?? {}), p);
  }

  @Post(":jobId/cancel")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  cancel(@Param("jobId") id: string, @CurrentPrincipal() p: Principal) {
    return this.jobs.cancel(uuidParam(id, "Job"), p);
  }

  @Post(":jobId/retry")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  retry(@Param("jobId") id: string, @CurrentPrincipal() p: Principal) {
    return this.jobs.retry(uuidParam(id, "Job"), p);
  }
}
