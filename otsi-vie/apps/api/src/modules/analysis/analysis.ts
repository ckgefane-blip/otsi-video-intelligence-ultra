/**
 * Analysis runs, playback and tracking results (Blocks 04-06; F09, F11-F14 partially).
 *
 *   POST /v1/videos/:id/analysis-runs           start: a QUEUED run with steps SHOTS, DETECT, TRACK; event analysis.requested -> worker job
 *   GET  /v1/videos/:id/analysis-runs           the video's runs, newest first
 *   GET  /v1/analysis-runs/:id                  one run: steps, progress, measured result or failure
 *   POST /v1/analysis-runs/:id/cancel           stops at the worker's next batch
 *   GET  /v1/analysis-runs/:id/tracks           track list with the identity label an overlay may show
 *   GET  /v1/analysis-runs/:id/observations     the boxes between two times (at most 20 s), for the video overlay
 *   GET  /v1/videos/:id/playback                a short-lived signed URL of the playback copy
 *   GET  /v1/media/:assetId?exp&sig             the signed media gateway (no bearer: a <video> element cannot send one), HTTP Range
 *
 * Tenant scope is applied in every query (runs carry organization_id; tracks are reached only through a run of the organization).
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { AnalysisRun, CreateAnalysisRequest, feetPosition, type Mat3, ObservationWindow, Playback, TrackSummary } from "@otsi-vie/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { RowDataPacket } from "mysql2/promise";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { uuidParam } from "../players/players.controller";
import { insertRun } from "./run";

const MAX_WINDOW_US = 20_000_000;
/** appearance cosine of a track's first and last thirds below this: it may contain two people (worker: vie_worker.analyze.DRIFT_WARNING) */
const DRIFT_WARNING = 0.6;
const PLAYBACK_TTL_S = 4 * 3600;

function json<T>(v: unknown): T | null {
  if (v === null || v === undefined) return null;
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

@Injectable()
export class AnalysisService {
  private readonly store: LocalStore | null;
  private readonly key: Buffer;

  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
    // signing key for media URLs: configured in deployments; otherwise per process (URLs then end with a restart)
    this.key = cfg.mediaSigningKey ? Buffer.from(cfg.mediaSigningKey, "utf8") : randomBytes(32);
  }

  private async run(id: string, p: Principal): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>("SELECT * FROM pipeline_runs WHERE id = ? AND organization_id = ?", [id, p.organizationId]);
    if (!r) throw notFound("Analysis run");
    return r;
  }

  private async view(r: RowDataPacket): Promise<AnalysisRun> {
    const steps = await this.db.rows<RowDataPacket>(
      "SELECT step_name, status, progress, error_code FROM pipeline_steps WHERE run_id = ? ORDER BY FIELD(step_name, 'SHOTS', 'DETECT', 'TRACK', 'IDENTIFY')", [r.id]);
    const job = await this.db.one<RowDataPacket>(
      "SELECT state, progress, stage_message FROM worker_jobs WHERE organization_id = ? AND subject_type = 'analysis_run' AND subject_id = ? ORDER BY created_at DESC LIMIT 1",
      [r.organization_id, r.id]);
    const cfg = json<Record<string, unknown>>(r.config) ?? {};
    return AnalysisRun.parse({
      id: r.id, video_id: r.video_id, status: r.status,
      config: { sample_fps: Number(cfg.sample_fps ?? 0), tiles: Number(cfg.tiles ?? 1), detector: (cfg.detector as string | null) ?? null,
        profile: (cfg.profile as AnalysisRun["config"]["profile"]) ?? null, grids: Array.isArray(cfg.grids) ? (cfg.grids as number[]) : Number(cfg.tiles ?? 1) > 1 ? [Number(cfg.tiles)] : [] },
      steps: steps.map((s) => ({ name: s.step_name, status: s.status, progress: Number(s.progress), error_code: s.error_code })),
      result: (cfg.result as Record<string, unknown> | undefined) ?? null,
      failure_code: r.failure_code, failure_detail: r.failure_detail,
      job: job ? { state: job.state, progress: Number(job.progress), stage_message: job.stage_message } : null,
      created_at: r.created_at, started_at: r.started_at, finished_at: r.finished_at,
    });
  }

  async start(videoId: string, body: CreateAnalysisRequest, p: Principal): Promise<AnalysisRun> {
    const v = await this.db.one<RowDataPacket>("SELECT state FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    if (v.state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video can be analysed.");
    const open = await this.db.one<RowDataPacket>("SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [videoId, p.organizationId]);
    if (open) throw new ApiError(409, "ANALYSIS_ALREADY_RUNNING", "This video is already being analysed.");
    const id = await this.db.tx((c) => insertRun(c, userActor(p), p.organizationId, videoId, body));
    return this.view(await this.run(id, p));
  }

  async list(videoId: string, p: Principal): Promise<AnalysisRun[]> {
    const rows = await this.db.rows<RowDataPacket>("SELECT * FROM pipeline_runs WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC LIMIT 50", [videoId, p.organizationId]);
    return Promise.all(rows.map((r) => this.view(r)));
  }

  async get(id: string, p: Principal): Promise<AnalysisRun> {
    return this.view(await this.run(id, p));
  }

  async cancel(id: string, p: Principal): Promise<AnalysisRun> {
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT status FROM pipeline_runs WHERE id = ? AND organization_id = ? FOR UPDATE", [id, p.organizationId]);
      if (!rows[0]) throw notFound("Analysis run");
      if (!["QUEUED", "RUNNING"].includes(rows[0].status as string)) throw new ApiError(409, "RUN_NOT_ACTIVE", "This run has already finished.");
      await c.query("UPDATE pipeline_runs SET status = 'CANCELLED', finished_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [id]);
      await c.query("UPDATE pipeline_steps SET status = 'CANCELLED' WHERE run_id = ? AND status IN ('QUEUED', 'RUNNING')", [id]);
      await c.query("UPDATE worker_jobs SET state = 'CANCELLED', finished_at = CURRENT_TIMESTAMP(6) WHERE organization_id = ? AND subject_type = 'analysis_run' AND subject_id = ? AND state IN ('QUEUED', 'PAUSED')",
        [p.organizationId, id]);
      await recordChange(c, userActor(p), { action: "analysis.cancelled", entityType: "analysis_run", entityId: id });
    });
    return this.get(id, p);
  }

  async tracks(id: string, p: Principal): Promise<TrackSummary[]> {
    await this.run(id, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.internal_track_number, t.class_name, s.shot_number, t.first_pts_us, t.last_pts_us, t.observation_count, t.mean_confidence,
              COALESCE(ci.state, 'UNRESOLVED') AS identity_state, pi.display_name, pi.canonical_otsi_id,
              ta.kit_group, ta.kit_rgb, ta.drift_score, ta.thumbnail_asset_id,
              ev.peak, ev.mean_h * v.height AS mean_h_px, ev.low_share, je.state AS shirt_state
         FROM tracks t
         JOIN video_sources v ON v.id = t.video_id
         LEFT JOIN (SELECT o.track_id, MAX(o.detector_confidence) AS peak, AVG(o.bbox_h) AS mean_h, AVG(o.detector_confidence < 0.5) AS low_share
                      FROM track_observations o WHERE o.track_id IN (SELECT id FROM (SELECT id FROM tracks WHERE run_id = ? ORDER BY internal_track_number LIMIT 5000) page) GROUP BY o.track_id) ev ON ev.track_id = t.id
         LEFT JOIN track_jersey_evidence je ON je.track_id = t.id
         LEFT JOIN track_appearance ta ON ta.track_id = t.id
         LEFT JOIN video_shots s ON s.id = t.shot_id
         LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id
         LEFT JOIN v_player_identity pi ON pi.player_id = ci.player_id AND ci.state = 'CONFIRMED'
        WHERE t.run_id = ? ORDER BY t.internal_track_number LIMIT 5000`, [id, id]);
    // link counts for the whole run in one pass (a correlated count per track took ~30 s on a 12 000-track run)
    const linkRows = await this.db.rows<RowDataPacket>(
      `SELECT x.track_id, x.state, COUNT(*) AS n FROM (SELECT track_a_id AS track_id, state FROM v_track_link_current WHERE run_id = ? AND state IN ('PROPOSED', 'CONFIRMED')
                                                      UNION ALL SELECT track_b_id, state FROM v_track_link_current WHERE run_id = ? AND state IN ('PROPOSED', 'CONFIRMED')) x GROUP BY x.track_id, x.state`, [id, id]);
    const links = new Map<string, { PROPOSED: number; CONFIRMED: number }>();
    for (const l of linkRows) {
      const e = links.get(l.track_id as string) ?? { PROPOSED: 0, CONFIRMED: 0 };
      e[l.state as "PROPOSED" | "CONFIRMED"] = Number(l.n);
      links.set(l.track_id as string, e);
    }
    return rows.map((r) => {
      const n = Number(r.internal_track_number);
      const confirmed = r.identity_state === "CONFIRMED" && r.display_name;
      const label = confirmed
        ? `${r.display_name} · ${r.canonical_otsi_id ?? "provisional, no OTSI Player ID yet"}`
        : r.class_name === "BALL" ? `Ball · track ${n}` : r.class_name === "PERSON" ? `Unidentified person · track ${n}` : `Unidentified ${String(r.class_name).toLowerCase()} · track ${n}`;
      return TrackSummary.parse({
        track_id: r.id, track_number: n, class_name: r.class_name, shot_number: r.shot_number === null ? null : Number(r.shot_number),
        first_pts_us: Number(r.first_pts_us), last_pts_us: Number(r.last_pts_us), observation_count: Number(r.observation_count),
        mean_confidence: r.mean_confidence === null ? null : Number(r.mean_confidence), identity_state: r.identity_state, label,
        canonical_otsi_id: confirmed ? r.canonical_otsi_id : null,
        kit_group: r.kit_group === null || r.kit_group === undefined ? null : Number(r.kit_group), kit_rgb: r.kit_rgb ?? null,
        possible_identity_switch: r.drift_score !== null && r.drift_score !== undefined && Number(r.drift_score) < DRIFT_WARNING,
        has_thumbnail: !!r.thumbnail_asset_id, links_proposed: links.get(r.id as string)?.PROPOSED ?? 0, links_confirmed: links.get(r.id as string)?.CONFIRMED ?? 0,
        evidence: { peak_confidence: r.peak === null || r.peak === undefined ? null : Number(r.peak), mean_height_px: r.mean_h_px === null || r.mean_h_px === undefined ? null : Math.round(Number(r.mean_h_px)),
          low_confidence_share: r.low_share === null || r.low_share === undefined ? null : Number(r.low_share), shirt_number_state: r.shirt_state ?? null },
      });
    });
  }

  async observations(id: string, fromUs: number, toUs: number, p: Principal): Promise<ObservationWindow> {
    const run = await this.run(id, p);
    if (!Number.isFinite(fromUs) || !Number.isFinite(toUs) || toUs <= fromUs || fromUs < 0) throw new ApiError(422, "INVALID_WINDOW", "Give from_us < to_us, both in microseconds.");
    if (toUs - fromUs > MAX_WINDOW_US) throw new ApiError(422, "WINDOW_TOO_LONG", "Ask for at most 20 seconds at a time.");
    const obs = await this.db.rows<RowDataPacket>(
      `SELECT o.track_id, t.internal_track_number, t.class_name, o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, o.detector_confidence, ta.kit_group
         FROM track_observations o JOIN tracks t ON t.id = o.track_id LEFT JOIN track_appearance ta ON ta.track_id = t.id
        WHERE o.video_id = ? AND t.run_id = ? AND o.pts_us >= ? AND o.pts_us < ? ORDER BY o.pts_us, t.internal_track_number LIMIT 20000`,
      [run.video_id, id, fromUs, toUs]);
    const shots = await this.db.rows<RowDataPacket>(
      "SELECT shot_number, start_pts_us, end_pts_us FROM video_shots WHERE run_id = ? AND end_pts_us > ? AND start_pts_us < ? ORDER BY start_pts_us", [id, fromUs, toUs]);
    // pitch positions of people's feet, only where a calibration measured that moment (the best-quality sample whose slice contains the time)
    const cal = await this.db.rows<RowDataPacket>(
      "SELECT start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score FROM pitch_calibrations WHERE video_id = ? AND end_pts_us > ? AND start_pts_us < ? ORDER BY start_pts_us",
      [run.video_id, fromUs, toUs]);
    const slices = cal.map((c) => ({ s: Number(c.start_pts_us), e: Number(c.end_pts_us), H: (typeof c.transform_matrix === "string" ? JSON.parse(c.transform_matrix) : c.transform_matrix) as Mat3, L: Number(c.pitch_length_m ?? 105), W: Number(c.pitch_width_m ?? 68), q: Number(c.quality_score ?? 0) }));
    const place = (o: RowDataPacket): [number, number] | null => {
      if (o.class_name !== "PERSON" || !slices.length) return null;
      const t = Number(o.pts_us);
      let best: (typeof slices)[number] | null = null;
      for (const sl of slices) if (sl.s <= t && t < sl.e && (!best || sl.q > best.q)) best = sl;
      return best ? feetPosition(best.H, { x: Number(o.bbox_x), y: Number(o.bbox_y), w: Number(o.bbox_w), h: Number(o.bbox_h) }, best.L, best.W) : null;
    };
    return ObservationWindow.parse({
      from_us: fromUs, to_us: toUs,
      observations: obs.map((o) => ({ track_id: o.track_id, track_number: Number(o.internal_track_number), class_name: o.class_name, pts_us: Number(o.pts_us),
        x: Number(o.bbox_x), y: Number(o.bbox_y), w: Number(o.bbox_w), h: Number(o.bbox_h), score: o.detector_confidence === null ? null : Number(o.detector_confidence),
        kit_group: o.kit_group === null || o.kit_group === undefined ? null : Number(o.kit_group),
        pitch_x: place(o)?.[0] ?? null, pitch_y: place(o)?.[1] ?? null })),
      shots: shots.map((s) => ({ shot_number: Number(s.shot_number), start_pts_us: Number(s.start_pts_us), end_pts_us: Number(s.end_pts_us) })),
      calibrations: slices.map((sl) => ({ start_us: sl.s, end_us: sl.e, H: sl.H, length_m: sl.L, width_m: sl.W, quality: sl.q })),
    });
  }

  // ------------------------------------------------------------------ playback through the signed media gateway
  /** A short-lived signed gateway URL for a PROXY or REEL asset of the organization (download: served as an attachment). */
  signedUrl(assetId: string, org: string, download = false, ttlS = PLAYBACK_TTL_S): { url: string; expires_at: string } {
    const exp = Math.floor(Date.now() / 1000) + ttlS;
    return { url: `/api/v1/media/${assetId}?org=${org}&exp=${exp}&sig=${this.sign(assetId, org, exp)}${download ? "&download=1" : ""}`, expires_at: new Date(exp * 1000).toISOString() };
  }

  private sign(assetId: string, org: string, exp: number): string {
    return createHmac("sha256", this.key).update(`${assetId}.${org}.${exp}`).digest("base64url");
  }

  async playback(videoId: string, p: Principal): Promise<Playback> {
    const v = await this.db.one<RowDataPacket>(
      `SELECT v.state, v.proxy_asset_id, a.mime_type,
              (SELECT j.state FROM worker_jobs j WHERE j.organization_id = v.organization_id AND j.kind = 'PROXY' AND j.subject_id = v.id ORDER BY j.created_at DESC LIMIT 1) AS proxy_job
         FROM video_sources v LEFT JOIN assets a ON a.id = v.proxy_asset_id AND a.organization_id = v.organization_id
        WHERE v.id = ? AND v.organization_id = ?`, [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    if (!v.proxy_asset_id) {
      const reason = v.state !== "INGESTED" ? "The video has not been verified yet." : v.proxy_job === "FAILED" ? "The playback copy could not be made." : "The playback copy is being made.";
      return Playback.parse({ available: false, url: null, mime: null, expires_at: null, reason });
    }
    const exp = Math.floor(Date.now() / 1000) + PLAYBACK_TTL_S;
    const sig = this.sign(v.proxy_asset_id as string, p.organizationId, exp);
    return Playback.parse({
      available: true, url: `/api/v1/media/${v.proxy_asset_id}?org=${p.organizationId}&exp=${exp}&sig=${sig}`, mime: v.mime_type,
      expires_at: new Date(exp * 1000).toISOString(), reason: null,
    });
  }

  async media(assetId: string, org: string, exp: number, sig: string, range: string | undefined, res: FastifyReply, download = false): Promise<void> {
    const expected = Buffer.from(this.sign(assetId, org, exp));
    const given = Buffer.from(sig ?? "");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new ApiError(403, "INVALID_SIGNATURE", "This media link is not valid.");
    if (exp < Date.now() / 1000) throw new ApiError(403, "LINK_EXPIRED", "This media link has expired; reload the page.");
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    // the files a person may open: playback copies, rendered reels, reports, and the page 10 companions (ADR-058: event list, heatmap, ZIP),
    // which carry their file name; a signature is issued only by routes the user may use
    const a = await this.db.one<RowDataPacket>(
      `SELECT object_key, mime_type, kind, JSON_UNQUOTE(JSON_EXTRACT(metadata, '$.filename')) AS filename, JSON_EXTRACT(metadata, '$.bundle_id') IS NOT NULL AS in_bundle
         FROM assets WHERE id = ? AND organization_id = ? AND (kind IN ('PROXY', 'REEL', 'REPORT', 'BUNDLE') OR (kind IN ('EVENTS', 'HEATMAP') AND JSON_EXTRACT(metadata, '$.bundle_id') IS NOT NULL))`, [assetId, org]);
    if (!a) throw notFound("Media");
    const file = this.store.resolve(a.object_key as string);
    const size = (await stat(file)).size;
    void res.header("accept-ranges", "bytes").header("content-type", a.mime_type ?? "application/octet-stream").header("cache-control", "private, max-age=3600");
    if (download && a.kind === "REEL") void res.header("content-disposition", `attachment; filename="otsi-reel-${assetId.slice(0, 8)}.${a.mime_type === "video/webm" ? "webm" : "mp4"}"`);
    const named = a.filename ? String(a.filename).replace(/[^\w.-]+/g, "-") : null;
    if (a.kind === "REPORT") void res.header("content-disposition", `${download ? "attachment" : "inline"}; filename="${named ? `otsi-${named}` : `otsi-player-report-${assetId.slice(0, 8)}.pdf`}"`);
    if (["EVENTS", "HEATMAP", "BUNDLE"].includes(String(a.kind))) void res.header("content-disposition", `${download || a.kind === "BUNDLE" ? "attachment" : "inline"}; filename="otsi-${named ?? assetId.slice(0, 8)}"`);
    const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(size - 1, end);
      if (start > end) {
        void res.status(416).header("content-range", `bytes */${size}`).send();
        return;
      }
      void res.status(206).header("content-range", `bytes ${start}-${end}/${size}`).header("content-length", end - start + 1).send(createReadStream(file, { start, end }));
      return;
    }
    void res.header("content-length", size).send(createReadStream(file));
  }
}

@Controller("v1")
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post("videos/:videoId/analysis-runs")
  @UseGuards(AuthGuard)
  @Roles("OWNER", "ADMIN", "ANALYST")
  start(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.analysis.start(uuidParam(id, "Video"), CreateAnalysisRequest.parse(body ?? {}), p);
  }

  @Get("videos/:videoId/analysis-runs")
  @UseGuards(AuthGuard)
  list(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.analysis.list(uuidParam(id, "Video"), p);
  }

  @Get("videos/:videoId/playback")
  @UseGuards(AuthGuard)
  playback(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.analysis.playback(uuidParam(id, "Video"), p);
  }

  @Get("analysis-runs/:runId")
  @UseGuards(AuthGuard)
  get(@Param("runId") id: string, @CurrentPrincipal() p: Principal) {
    return this.analysis.get(uuidParam(id, "Analysis run"), p);
  }

  @Post("analysis-runs/:runId/cancel")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @Roles("OWNER", "ADMIN", "ANALYST")
  cancel(@Param("runId") id: string, @CurrentPrincipal() p: Principal) {
    return this.analysis.cancel(uuidParam(id, "Analysis run"), p);
  }

  @Get("analysis-runs/:runId/tracks")
  @UseGuards(AuthGuard)
  tracks(@Param("runId") id: string, @CurrentPrincipal() p: Principal) {
    return this.analysis.tracks(uuidParam(id, "Analysis run"), p);
  }

  @Get("analysis-runs/:runId/observations")
  @UseGuards(AuthGuard)
  observations(@Param("runId") id: string, @Query("from_us") from: string, @Query("to_us") to: string, @CurrentPrincipal() p: Principal) {
    return this.analysis.observations(uuidParam(id, "Analysis run"), Number(from), Number(to), p);
  }

  /** No AuthGuard: the HMAC signature (organization, asset, expiry) is the authorisation; issued only by GET .../playback. */
  @Get("media/:assetId")
  media(@Param("assetId") id: string, @Query("org") org: string, @Query("exp") exp: string, @Query("sig") sig: string, @Query("download") download: string | undefined,
        @Req() req: FastifyRequest, @Res() res: FastifyReply) {
    return this.analysis.media(uuidParam(id, "Media"), uuidParam(org ?? "", "Media"), Number(exp), sig, req.headers.range, res, download === "1");
  }
}
