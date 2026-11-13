/**
 * Videos and resumable uploads (Block 03: F06 upload, F08 probe hand-off).
 *
 *   POST   /v1/uploads                     start: creates the video record (PENDING) and an upload session; idempotent per Idempotency-Key
 *   PUT    /v1/uploads/:id/parts/:n        one part, raw bytes (application/octet-stream), streamed to storage, size-checked and hashed
 *   GET    /v1/uploads/:id                 which parts arrived (resume after an interruption)
 *   POST   /v1/uploads/:id/complete        all parts present -> video VALIDATING; event video.upload_completed -> ingest job (worker)
 *   DELETE /v1/uploads/:id                 abort
 *   GET    /v1/videos[?project_id=]        the organization's videos with their real state, probe facts and job progress
 *   GET    /v1/videos/:id, /:id/thumbnail
 *   GET    /v1/upload-limits               the largest file this server accepts and the accepted extensions
 *   PATCH  /v1/videos/:id                  rename (title only: every other fact is measured); audited
 *
 * Nothing here claims a video is usable: only the ingest worker, after assembling, hashing, signature-checking, probing and test-decoding
 * the file, sets INGESTED — or FAILED / QUARANTINED with the reason.
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from "@nestjs/common";
import { ACCEPTED_EXTENSIONS, CreateImportRequest, CreateUploadRequest, IMPORT_PROVIDERS, IngestOptions as IngestOptionsSchema, ImportProvider, importProviderFor, type IngestOptions, NOT_BUILT_SWITCHES, planEntryOrNull, planUploadLimitBytes, UpdateVideoRequest, UploadSession, Video, type UploadLimits } from "@otsi-vie/contracts";
import { createCipheriv, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { RowDataPacket } from "mysql2/promise";
import type { Readable } from "node:stream";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { insertRun } from "../analysis/run";
import { declareRights } from "../sharing/rights";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { notHidden } from "../../core/access";
import { CONFIG, Config, StorageConfig } from "../../core/config";
import { Db, type Executor } from "../../core/db";
import { currentPlanCode } from "../../core/plan";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore, PartChecksumMismatch, PartSizeMismatch, PartTooLarge } from "../../core/storage";
import { idempotencyKey, uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const UPLOAD_TTL_HOURS = 48;
/** a link's last part that is a video file name (used as the imported video's name) */
const IMPORT_FILE_NAME = /\.(mp4|m4v|mov|mkv|avi|webm|mpe?g|ts|mts|m2ts|wmv|flv|3gp)$/i;

/**
 * Up-front checks so the user hears at once about an obviously unusable link; the policy is the shared providers.json (ADR-027). The
 * worker re-checks everything and is the authority: it resolves the name and refuses any non-public address (ADR-023).
 */
export function precheckImportUrl(raw: string, hasToken: boolean): { url: string; display: string; provider: ImportProvider } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { throw new ApiError(422, "INVALID_URL", "That is not a valid link."); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new ApiError(422, "INVALID_URL", "Only http:// and https:// links to a video can be imported.");
  if (u.username || u.password) throw new ApiError(422, "INVALID_URL", "Links with a user name or password are not accepted.");
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const provider = importProviderFor(host, u.pathname);
  if (provider.status === "unsupported") throw new ApiError(422, "UNSUPPORTED_PROVIDER", `${provider.name}: ${provider.reason} ${provider.alternative}`);
  if (provider.status === "needs_authorization" && !hasToken) {
    throw new ApiError(422, "AUTH_REQUIRED", `${provider.name} imports need your own access token for that service: ${provider.method}.`);
  }
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ApiError(422, "BLOCKED_DESTINATION", "Use a link with a public host name, not an address on a private or local network.");
  }
  return { url: u.toString(), display: `${u.protocol}//${u.host}${u.pathname}`, provider };     // the query (often a signed token) is never displayed
}

/** AES-256-GCM, bound to the video (associated data) so a sealed token copied elsewhere does not open; the worker opens it once. */
export function sealCredential(token: string, videoId: string, keyB64: string): { v: 1; iv: string; ct: string } {
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new ApiError(503, "CREDENTIALS_NOT_CONFIGURED", "This server cannot accept access tokens (no credential key configured).");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  c.setAAD(Buffer.from(videoId));
  const ct = Buffer.concat([c.update(token, "utf8"), c.final(), c.getAuthTag()]);         // ciphertext || tag, as Python's AESGCM expects
  return { v: 1, iv: iv.toString("base64"), ct: ct.toString("base64") };
}

function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1]!.toLowerCase() : "";
}

const VIDEO_SELECT = `
  SELECT v.*, a.sha256 AS source_sha256,
         o.auto_crop_pitch, o.enhance_quality, o.remove_crowd_noise, o.correct_aspect_ratio, o.overlay_pitch_lines, o.overlay_event_markers, o.auto_create_match, o.generate_highlights,
         o.stabilize_video AS opt_stabilize, o.send_to_analysis AS opt_send, o.auto_outcome AS opt_outcome, o.auto_run_id AS opt_run, o.auto_detail AS opt_detail,
         o.analysis_profile AS opt_profile, o.auto_profile AS opt_auto_profile,
         rn.id AS run_id, rn.status AS run_status, aj.progress AS run_progress, aj.stage_message AS run_stage,
         j.kind AS job_kind, j.state AS job_state, j.progress AS job_progress, j.stage_message AS job_stage, j.error_code AS job_error,
         u.id AS upload_id, u.status AS upload_status, u.expected_bytes AS upload_expected, u.transferred_bytes AS upload_received
    FROM video_sources v
    LEFT JOIN video_ingest_options o ON o.video_id = v.id AND o.organization_id = v.organization_id
    LEFT JOIN assets a ON a.id = v.source_asset_id AND a.organization_id = v.organization_id
    LEFT JOIN pipeline_runs rn ON rn.id = (SELECT r2.id FROM pipeline_runs r2 WHERE r2.video_id = v.id AND r2.organization_id = v.organization_id ORDER BY r2.created_at DESC LIMIT 1)
    LEFT JOIN worker_jobs aj ON aj.id = (SELECT a2.id FROM worker_jobs a2 WHERE a2.organization_id = v.organization_id AND a2.subject_type = 'analysis_run' AND a2.subject_id = rn.id ORDER BY a2.created_at DESC LIMIT 1)
    LEFT JOIN worker_jobs j ON j.id = (SELECT j2.id FROM worker_jobs j2 WHERE j2.organization_id = v.organization_id AND j2.subject_type = 'video'
                                        AND j2.subject_id = v.id ORDER BY j2.created_at DESC LIMIT 1)
    LEFT JOIN upload_sessions u ON u.id = (SELECT u2.id FROM upload_sessions u2 WHERE u2.video_id = v.id AND u2.organization_id = v.organization_id
                                        AND u2.status IN ('INITIALIZED', 'UPLOADING') AND u2.expires_at > CURRENT_TIMESTAMP(6) ORDER BY u2.created_at DESC LIMIT 1)`;

/**
 * Saves the chosen switches with the video (same transaction as the video). The two real choices and the eight requests for steps the engine
 * cannot perform yet come from the person; the four steps every analysis performs are always written as done (migration 0020).
 */
async function saveOptions(c: Executor, organizationId: string, videoId: string, userId: string, o: IngestOptions | undefined): Promise<void> {
  if (!o) return;
  const v = IngestOptionsSchema.parse(o);
  await c.query(
    `INSERT INTO video_ingest_options (video_id, organization_id, stabilize_video, send_to_analysis, auto_crop_pitch, enhance_quality, remove_crowd_noise, correct_aspect_ratio,
        overlay_pitch_lines, overlay_event_markers, auto_create_match, generate_highlights, analysis_profile, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    // A.10: a chosen profile decides Stabilize (High accuracy and Ultra-sensitive stabilise, Standard does not), so the row never disagrees with itself
    [videoId, organizationId, v.analysis_profile && v.analysis_profile !== "RECOMMENDED" ? v.analysis_profile !== "STANDARD" : v.stabilize_video, v.send_to_analysis,
      v.auto_crop_pitch, v.enhance_quality, v.remove_crowd_noise, v.correct_aspect_ratio,
      v.overlay_pitch_lines, v.overlay_event_markers, v.auto_create_match, v.generate_highlights, v.analysis_profile ?? null, userId]);
}

function toVideo(r: RowDataPacket): Video {
  const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  return Video.parse({
    id: r.id, project_id: r.project_id, title: r.title, original_filename: r.original_filename, ingest_mode: r.ingest_mode, source_uri: r.source_uri,
    state: r.state, byte_size: n(r.byte_size), duration_us: n(r.duration_us), width: n(r.width), height: n(r.height),
    frame_rate: r.avg_frame_rate_num && r.avg_frame_rate_den ? { num: Number(r.avg_frame_rate_num), den: Number(r.avg_frame_rate_den) } : null,
    is_variable_frame_rate: r.is_variable_frame_rate === null ? null : Boolean(r.is_variable_frame_rate),
    container_format: r.container_format, video_codec: r.video_codec, audio_codec: r.audio_codec, sha256: r.source_sha256 ?? null,
    failure_code: r.failure_code, failure_detail: r.failure_detail, has_thumbnail: r.thumbnail_asset_id !== null, match_id: r.match_id ?? null,
    job: r.job_kind ? { kind: r.job_kind, state: r.job_state, progress: Number(r.job_progress), stage_message: r.job_stage, error_code: r.job_error } : null,
    upload: r.upload_id ? { upload_id: r.upload_id, status: r.upload_status, expected_bytes: Number(r.upload_expected), received_bytes: Number(r.upload_received) } : null,
    analysis: r.run_id ? { run_id: r.run_id, status: r.run_status, progress: r.run_progress === null || r.run_progress === undefined ? null : Number(r.run_progress), stage_message: r.run_stage ?? null } : null,
    ingest_options: r.opt_send === null || r.opt_send === undefined ? null : {
      stabilize_video: Boolean(r.opt_stabilize), send_to_analysis: Boolean(r.opt_send), analysis_profile: r.opt_profile ?? null,
      auto_crop_pitch: Boolean(r.auto_crop_pitch), enhance_quality: Boolean(r.enhance_quality), remove_crowd_noise: Boolean(r.remove_crowd_noise),
      correct_aspect_ratio: Boolean(r.correct_aspect_ratio), overlay_pitch_lines: Boolean(r.overlay_pitch_lines), overlay_event_markers: Boolean(r.overlay_event_markers),
      auto_create_match: Boolean(r.auto_create_match), generate_highlights: Boolean(r.generate_highlights),
      analysis: r.opt_outcome ? { outcome: r.opt_outcome, run_id: r.opt_run ?? null, detail: r.opt_detail ?? null,
        // before A.10 the server used High accuracy with Stabilize on, Standard off (the run records it the same way)
        profile: r.opt_auto_profile ?? (r.opt_outcome === "STARTED" ? (r.opt_stabilize ? "HIGH_ACCURACY" : "STANDARD") : null) } : null,
      not_performed: NOT_BUILT_SWITCHES.filter((k) => Boolean(r[k])) },
    created_by: r.created_by ?? null, created_at: new Date(r.created_at).toISOString(), updated_at: new Date(r.updated_at).toISOString(),
  });
}

@Injectable()
export class MediaService {
  private readonly store: LocalStore | null;
  private readonly storage: StorageConfig | null;
  private readonly credentialKey: string;

  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    this.credentialKey = cfg.credentialKey ?? "";
    this.storage = cfg.storage ?? null;
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  /** The limits for this caller: the smaller of the server's maximum and the plan's limit per video (owner 2026-11-13). */
  async uploadLimits(p: Principal): Promise<UploadLimits> {
    const server = this.maxUploadBytes;
    const plan = await currentPlanCode(this.db, p.organizationId);
    const planMax = planUploadLimitBytes(plan);
    return { max_upload_bytes: planMax === null ? server : Math.min(server, planMax), server_max_upload_bytes: server,
      plan_code: plan, plan_max_upload_bytes: planMax, accepted_extensions: [...ACCEPTED_EXTENSIONS] };
  }

  /** the largest upload this deployment accepts (storage configuration) */
  get maxUploadBytes(): number { return this.need().storage.maxUploadBytes; }

  private need(): { store: LocalStore; storage: StorageConfig } {
    if (!this.store || !this.storage) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return { store: this.store, storage: this.storage };
  }

  // ------------------------------------------------------------------ videos
  async videos(p: Principal, projectId?: string): Promise<Video[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `${VIDEO_SELECT} WHERE v.removed_at IS NULL AND v.organization_id = ?${projectId ? " AND v.project_id = ?" : ""}${notHidden(p, "v.project_id")} ORDER BY v.created_at DESC LIMIT 200`,
      projectId ? [p.organizationId, projectId] : [p.organizationId]);
    return rows.map(toVideo);
  }

  async rename(id: string, body: UpdateVideoRequest, p: Principal): Promise<Video> {
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT title FROM video_sources WHERE id = ? AND organization_id = ? FOR UPDATE", [id, p.organizationId]);
      if (!rows[0]) throw notFound("Video");
      await c.query("UPDATE video_sources SET title = ?, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [body.title, id]);
      await recordChange(c, userActor(p), { action: "video.renamed", entityType: "video", entityId: id, before: { title: rows[0].title }, after: { title: body.title } });
    });
    return this.video(id, p);
  }

  async video(id: string, p: Principal): Promise<Video> {
    const r = await this.db.one<RowDataPacket>(`${VIDEO_SELECT} WHERE v.id = ? AND v.organization_id = ? AND v.removed_at IS NULL`, [id, p.organizationId]);
    if (!r) throw notFound("Video");
    return toVideo(r);
  }

  /**
   * Removes a video: its queued checks are cancelled, its unfinished upload is aborted, analyses still queued or running are cancelled, and it leaves
   * every list. A check that is running is stopped; a video with a finished analysis or a reel is never removed here.
   */
  /** partial upload bytes of sessions a Library delete aborted */
  async dropUploads(sessions: string[]): Promise<void> {
    if (!sessions.length) return;
    const { store } = this.need();
    for (const s of sessions) await store.removeUpload(s).catch(() => undefined);
  }



  /** Stops the playback copy that is being made (or waiting) for a verified video. The worker stops at its next heartbeat. It can be made again. */
  async cancelPlaybackCopy(id: string, p: Principal): Promise<Video> {
    await this.db.tx(async (c) => {
      const [v] = await c.query<RowDataPacket[]>("SELECT state FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL FOR UPDATE", [id, p.organizationId]);
      if (!v[0]) throw notFound("Video");
      const [r] = await c.query(
        "UPDATE worker_jobs SET state = 'CANCELLED', claim_token = NULL, lease_expires_at = NULL, finished_at = CURRENT_TIMESTAMP(6) WHERE organization_id = ? AND subject_type = 'video' AND subject_id = ? AND kind = 'PROXY' AND state IN ('QUEUED', 'RUNNING', 'PAUSED')",
        [p.organizationId, id]);
      if (!(r as unknown as { affectedRows: number }).affectedRows) throw new ApiError(409, "NO_PLAYBACK_COPY_RUNNING", "No playback copy is being made for this video.");
      await recordChange(c, userActor(p), { action: "video.playback_copy_cancelled", entityType: "video", entityId: id });
    });
    return this.video(id, p);
  }

  /** Makes the playback copy of a verified video again (after it was cancelled or failed): the same job is queued from the start. */
  async makePlaybackCopy(id: string, p: Principal): Promise<Video> {
    await this.db.tx(async (c) => {
      const [v] = await c.query<RowDataPacket[]>("SELECT state, proxy_asset_id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL FOR UPDATE", [id, p.organizationId]);
      if (!v[0]) throw notFound("Video");
      if (v[0].state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video has a playback copy.");
      if (v[0].proxy_asset_id) throw new ApiError(409, "PLAYBACK_COPY_EXISTS", "This video already has its playback copy.");
      const [last] = await c.query<RowDataPacket[]>("SELECT id, state FROM worker_jobs WHERE organization_id = ? AND subject_type = 'video' AND subject_id = ? AND kind = 'PROXY' ORDER BY created_at DESC LIMIT 1 FOR UPDATE", [p.organizationId, id]);
      if (last[0] && (last[0].state === "QUEUED" || last[0].state === "RUNNING" || last[0].state === "PAUSED")) throw new ApiError(409, "PLAYBACK_COPY_RUNNING", "The playback copy is already being made.");
      if (last[0]) {
        await c.query(
          "UPDATE worker_jobs SET state = 'QUEUED', attempts = 0, progress = 0, stage_message = NULL, started_at = NULL, finished_at = NULL, claim_token = NULL, lease_expires_at = NULL, error_code = NULL, error_detail = NULL, available_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
          [last[0].id]);
      } else {
        await c.query("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, max_attempts) VALUES (?, ?, 'PROXY', 'video', ?, ?, ?, 3)",
          [uuidv7(), p.organizationId, id, `proxy:${id}`, JSON.stringify({ video_id: id })]);
      }
      await recordChange(c, userActor(p), { action: "video.playback_copy_requested", entityType: "video", entityId: id });
    });
    return this.video(id, p);
  }

  async thumbnail(id: string, p: Principal): Promise<{ path: string; bytes: number }> {
    const { store } = this.need();
    const r = await this.db.one<RowDataPacket>(
      `SELECT a.object_key FROM video_sources v JOIN assets a ON a.id = v.thumbnail_asset_id AND a.organization_id = v.organization_id
        WHERE v.id = ? AND v.organization_id = ?`, [id, p.organizationId]);
    if (!r) throw notFound("Thumbnail");
    const file = store.resolve(r.object_key as string);
    return { path: file, bytes: (await stat(file)).size };
  }

  // ------------------------------------------------------------------ uploads
  private async session(uploadId: string, p: Principal): Promise<RowDataPacket> {
    const s = await this.db.one<RowDataPacket>(
      `SELECT u.*, u.expires_at <= CURRENT_TIMESTAMP(6) AS expired FROM upload_sessions u WHERE u.id = ? AND u.organization_id = ?`, [uploadId, p.organizationId]);
    if (!s) throw notFound("Upload");
    return s;
  }

  private async view(s: RowDataPacket): Promise<UploadSession> {
    const parts = await this.db.rows<RowDataPacket>("SELECT part_number FROM upload_parts WHERE session_id = ? ORDER BY part_number", [s.id]);
    const partBytes = Number(s.part_bytes), expected = Number(s.expected_bytes);
    return UploadSession.parse({
      upload_id: s.id, video_id: s.video_id, status: Number(s.expired) && ["INITIALIZED", "UPLOADING"].includes(s.status as string) ? "EXPIRED" : s.status,
      part_bytes: partBytes, part_count: Math.ceil(expected / partBytes), expected_bytes: expected,
      received_parts: parts.map((x) => Number(x.part_number)), expires_at: s.expires_at,
    });
  }

  async startUpload(body: CreateUploadRequest, key: string, p: Principal): Promise<{ session: UploadSession; created: boolean }> {
    const { storage } = this.need();
    const ext = extensionOf(body.file_name);
    if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
      throw new ApiError(422, "UNSUPPORTED_FILE_TYPE", `Accepted video files: ${ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(", ")}.`);
    }
    if (body.byte_size > storage.maxUploadBytes) {
      throw new ApiError(413, "FILE_TOO_LARGE", `This server accepts files up to ${(storage.maxUploadBytes / 1024 ** 3).toFixed(0)} GB.`);
    }
    // the plan's own limit per video (owner, approved 2026-11-13: Free 2 GB … Season 64 GB, Enterprise no plan limit)
    const plan = await currentPlanCode(this.db, p.organizationId);
    const planMax = planUploadLimitBytes(plan);
    if (planMax !== null && body.byte_size > planMax) {
      const label = planEntryOrNull(plan)?.label ?? "Free";
      throw new ApiError(413, "PLAN_UPLOAD_LIMIT", `The ${label} plan uploads videos up to ${Math.round(planMax / 1024 ** 3)} GB each. Choose a bigger plan in Settings › Plans & billing to upload this file.`);
    }
    const existing = await this.db.one<RowDataPacket>("SELECT * , expires_at <= CURRENT_TIMESTAMP(6) AS expired FROM upload_sessions WHERE organization_id = ? AND idempotency_key = ?", [p.organizationId, key]);
    if (existing) {
      if (Number(existing.expected_bytes) !== body.byte_size || existing.original_filename !== body.file_name) {
        throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used for a different file.");
      }
      return { session: await this.view(existing), created: false };
    }
    const project = await this.db.one<RowDataPacket>("SELECT status FROM projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [body.project_id, p.organizationId]);
    if (!project) throw notFound("Project");
    if (project.status !== "ACTIVE") throw new ApiError(409, "PROJECT_ARCHIVED", "This project is archived; restore it to add videos.");
    const videoId = uuidv7(), uploadId = uuidv7();
    try {
      await this.db.tx(async (c) => {
        await c.query(
          `INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, title, original_filename, byte_size, state, created_by)
           VALUES (?, ?, ?, 'UPLOAD', ?, ?, ?, 'PENDING', ?)`,
          [videoId, p.organizationId, body.project_id, body.title ?? body.file_name.replace(/\.[^.]+$/, ""), body.file_name, body.byte_size, p.userId]);
        await c.query(
          `INSERT INTO upload_sessions (id, organization_id, video_id, created_by, idempotency_key, original_filename, expected_bytes, expected_sha256, part_bytes, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? HOUR))`,
          [uploadId, p.organizationId, videoId, p.userId, key, body.file_name, body.byte_size, body.sha256 ?? null, storage.partBytes, UPLOAD_TTL_HOURS]);
        await saveOptions(c, p.organizationId, videoId, p.userId, body.options);
        if (body.rights) await declareRights(c, userActor(p), p.organizationId, videoId, body.rights);
        await recordChange(c, userActor(p), {
          action: "video.upload_started", entityType: "video", entityId: videoId,
          after: { project_id: body.project_id, file_name: body.file_name, byte_size: body.byte_size },
          event: { eventType: "video.upload_started", payload: { video_id: videoId, upload_id: uploadId } },
        });
      });
    } catch (e) {
      if ((e as { errno?: number }).errno === 1062) return this.startUpload(body, key, p);   // a concurrent retry with the same key won
      throw e;
    }
    return { session: await this.view(await this.session(uploadId, p)), created: true };
  }

  async startImport(body: CreateImportRequest, key: string, p: Principal): Promise<Video> {
    this.need();
    const { url, display, provider } = precheckImportUrl(body.url, !!body.access_token);
    const project = await this.db.one<RowDataPacket>("SELECT status FROM projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [body.project_id, p.organizationId]);
    if (!project) throw notFound("Project");
    if (project.status !== "ACTIVE") throw new ApiError(409, "PROJECT_ARCHIVED", "This project is archived; restore it to add videos.");
    const existing = await this.db.one<RowDataPacket>("SELECT entity_id FROM audit_events WHERE organization_id = ? AND action = 'video.import_requested' AND request_id = ?",
      [p.organizationId, `import:${key}`]);
    if (existing) return this.video(existing.entity_id as string, p);                   // same Idempotency-Key: same import
    const videoId = uuidv7();
    // the link's last part names the video only when it is a file name; a provider's file id (e.g. 0OMlDjg6NUvw0TVkOVYFQQ) is not a title
    // (v3 Phase 0, P10). The worker replaces it with the provider's own title when there is one; the user can rename it at any time.
    const seg = (() => { try { return decodeURIComponent(display.split(/[?#]/)[0]!.split("/").pop() || ""); } catch { return ""; } })();
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } })();
    const name = (IMPORT_FILE_NAME.test(seg) ? seg : `Imported video${host ? ` · ${host}` : ""}`).slice(0, 255);
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, source_uri, title, original_filename, state, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'VALIDATING', ?)`,
        [videoId, p.organizationId, body.project_id, ["direct", "hls"].includes(provider.id) ? "DIRECT_URL" : "AUTHORIZED_PROVIDER", display,
         body.title ?? (IMPORT_FILE_NAME.test(name) ? name.replace(/\.[^.]+$/, "") : name), name, p.userId]);
      await saveOptions(c, p.organizationId, videoId, p.userId, body.options);
      if (body.rights) await declareRights(c, userActor(p), p.organizationId, videoId, body.rights);
      await recordChange(c, { ...userActor(p), requestId: `import:${key}` }, {
        action: "video.import_requested", entityType: "video", entityId: videoId,
        after: { project_id: body.project_id, source: display, provider: provider.id, user_authorization: !!body.access_token },
        event: { eventType: "video.import_requested", dedupeKey: `import-requested:${videoId}`,
          payload: { video_id: videoId, url, ...(body.access_token ? { credential: sealCredential(body.access_token, videoId, this.credentialKey) } : {}) } },
      });
    });
    return this.video(videoId, p);
  }

  async upload(uploadId: string, p: Principal): Promise<UploadSession> {
    return this.view(await this.session(uploadId, p));
  }

  async putPart(uploadId: string, n: number, body: Readable, declaredSha: string | undefined, p: Principal): Promise<{ part_number: number; bytes: number; sha256: string }> {
    const { store } = this.need();
    const s = await this.session(uploadId, p);
    if (!["INITIALIZED", "UPLOADING"].includes(s.status as string)) throw new ApiError(409, "UPLOAD_NOT_OPEN", `This upload is ${String(s.status).toLowerCase()}.`);
    if (Number(s.expired)) throw new ApiError(410, "UPLOAD_EXPIRED", "This upload expired; start it again.");
    const partBytes = Number(s.part_bytes), expected = Number(s.expected_bytes), count = Math.ceil(expected / partBytes);
    if (!Number.isInteger(n) || n < 1 || n > count) throw new ApiError(422, "INVALID_PART", `Parts are numbered 1 to ${count}.`);
    const size = n < count ? partBytes : expected - partBytes * (count - 1);
    let written: { bytes: number; sha256: string };
    try {
      written = await store.writePart(uploadId, n, body, size, declaredSha);
    } catch (e) {
      if (e instanceof PartTooLarge) throw new ApiError(413, "PART_TOO_LARGE", `Part ${n} must be exactly ${size} bytes.`);
      if (e instanceof PartSizeMismatch) throw new ApiError(422, "PART_SIZE_MISMATCH", `Part ${n} must be exactly ${size} bytes; received ${e.got}.`);
      if (e instanceof PartChecksumMismatch) throw new ApiError(422, "PART_CHECKSUM_MISMATCH", `Part ${n} arrived damaged; send it again.`);
      throw e;
    }
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO upload_parts (session_id, part_number, byte_size, remote_etag, checked_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE byte_size = VALUES(byte_size), remote_etag = VALUES(remote_etag), checked_at = VALUES(checked_at)`,
        [uploadId, n, written.bytes, written.sha256]);
      await c.query(
        `UPDATE upload_sessions SET status = 'UPLOADING',
                transferred_bytes = (SELECT COALESCE(SUM(byte_size), 0) FROM upload_parts WHERE session_id = ?) WHERE id = ? AND status IN ('INITIALIZED', 'UPLOADING')`,
        [uploadId, uploadId]);
    });
    return { part_number: n, bytes: written.bytes, sha256: written.sha256 };
  }

  async complete(uploadId: string, p: Principal): Promise<Video> {
    const s0 = await this.session(uploadId, p);
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT *, expires_at <= CURRENT_TIMESTAMP(6) AS expired FROM upload_sessions WHERE id = ? FOR UPDATE", [uploadId]);
      const s = rows[0]!;
      if (s.status === "VERIFYING" || s.status === "COMPLETED") return;                      // completing twice is harmless
      if (!["INITIALIZED", "UPLOADING"].includes(s.status as string)) throw new ApiError(409, "UPLOAD_NOT_OPEN", `This upload is ${String(s.status).toLowerCase()}.`);
      if (Number(s.expired)) throw new ApiError(410, "UPLOAD_EXPIRED", "This upload expired; start it again.");
      const count = Math.ceil(Number(s.expected_bytes) / Number(s.part_bytes));
      const [parts] = await c.query<RowDataPacket[]>("SELECT part_number, byte_size FROM upload_parts WHERE session_id = ?", [uploadId]);
      const have = new Set(parts.map((x) => Number(x.part_number)));
      const missing = Array.from({ length: count }, (_, i) => i + 1).filter((i) => !have.has(i));
      const total = parts.reduce((a, x) => a + Number(x.byte_size), 0);
      if (missing.length > 0 || total !== Number(s.expected_bytes)) {
        throw new ApiError(409, "UPLOAD_INCOMPLETE", `Missing parts: ${missing.slice(0, 20).join(", ")}${missing.length > 20 ? ", ..." : ""}.`);
      }
      await c.query("UPDATE upload_sessions SET status = 'VERIFYING' WHERE id = ?", [uploadId]);
      await c.query("UPDATE video_sources SET state = 'VALIDATING' WHERE id = ? AND organization_id = ?", [s.video_id, p.organizationId]);
      await recordChange(c, userActor(p), {
        action: "video.upload_completed", entityType: "video", entityId: s.video_id as string,
        after: { upload_id: uploadId, parts: count, bytes: total },
        event: { eventType: "video.upload_completed", payload: { video_id: s.video_id, upload_id: uploadId }, dedupeKey: `upload-completed:${uploadId}` },
      });
    });
    return this.video(s0.video_id as string, p);
  }

  async abort(uploadId: string, p: Principal): Promise<void> {
    const { store } = this.need();
    const s = await this.session(uploadId, p);
    if (!["INITIALIZED", "UPLOADING"].includes(s.status as string)) throw new ApiError(409, "UPLOAD_NOT_OPEN", `This upload is ${String(s.status).toLowerCase()}.`);
    await this.db.tx(async (c) => {
      await c.query("UPDATE upload_sessions SET status = 'ABORTED' WHERE id = ?", [uploadId]);
      await c.query("UPDATE video_sources SET state = 'FAILED', failure_code = 'UPLOAD_ABORTED', failure_detail = 'The upload was cancelled.' WHERE id = ? AND organization_id = ?",
        [s.video_id, p.organizationId]);
      await recordChange(c, userActor(p), { action: "video.upload_aborted", entityType: "video", entityId: s.video_id as string, after: { upload_id: uploadId } });
    });
    await store.removeUpload(uploadId);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get("videos")
  videos(@Query("project_id") projectId: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.media.videos(p, projectId === undefined ? undefined : uuidParam(projectId, "Project"));
  }

  @Get("videos/:videoId")
  video(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.media.video(uuidParam(id, "Video"), p);
  }

  @Get("upload-limits")
  limits(@CurrentPrincipal() p: Principal): Promise<UploadLimits> {
    return this.media.uploadLimits(p);
  }

  @Patch("videos/:videoId")
  @Roles(...PROJECT_WRITERS)
  rename(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.media.rename(uuidParam(id, "Video"), UpdateVideoRequest.parse(body), p);
  }


  @Post("videos/:videoId/playback-copy/cancel")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  cancelPlayback(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.media.cancelPlaybackCopy(uuidParam(id, "Video"), p);
  }

  @Post("videos/:videoId/playback-copy")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  makePlayback(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.media.makePlaybackCopy(uuidParam(id, "Video"), p);
  }


  @Get("videos/:videoId/thumbnail")
  async thumbnail(@Param("videoId") id: string, @CurrentPrincipal() p: Principal, @Res() res: FastifyReply) {
    const t = await this.media.thumbnail(uuidParam(id, "Video"), p);
    void res.header("content-type", "image/jpeg").header("content-length", t.bytes).header("cache-control", "private, max-age=300").send(createReadStream(t.path));
  }

  @Post("uploads")
  @Roles(...PROJECT_WRITERS)
  async start(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) res: FastifyReply) {
    const r = await this.media.startUpload(CreateUploadRequest.parse(body), idempotencyKey(key), p);
    void res.status(r.created ? 201 : 200);
    return r.session;
  }

  /** Which links can be imported, which need the user's authorization, and which are refused (with the alternative). */
  @Get("import-providers")
  providers() {
    return IMPORT_PROVIDERS.map(({ hosts: _h, ...rest }) => rest);
  }

  @Post("imports")
  @Roles(...PROJECT_WRITERS)
  importLink(@Body() body: unknown, @Headers("idempotency-key") key: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.media.startImport(CreateImportRequest.parse(body), idempotencyKey(key), p);
  }

  @Get("uploads/:uploadId")
  upload(@Param("uploadId") id: string, @CurrentPrincipal() p: Principal) {
    return this.media.upload(uuidParam(id, "Upload"), p);
  }

  @Put("uploads/:uploadId/parts/:n")
  @Roles(...PROJECT_WRITERS)
  part(@Param("uploadId") id: string, @Param("n") n: string, @Req() req: FastifyRequest, @Headers("x-part-sha256") sha: string | undefined, @CurrentPrincipal() p: Principal) {
    if (req.headers["content-type"] !== "application/octet-stream") throw new ApiError(415, "OCTET_STREAM_REQUIRED", "Send the part as application/octet-stream.");
    return this.media.putPart(uuidParam(id, "Upload"), Number(n), req.body as Readable, sha, p);
  }

  @Post("uploads/:uploadId/complete")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  complete(@Param("uploadId") id: string, @CurrentPrincipal() p: Principal) {
    return this.media.complete(uuidParam(id, "Upload"), p);
  }

  @Delete("uploads/:uploadId")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  abort(@Param("uploadId") id: string, @CurrentPrincipal() p: Principal) {
    return this.media.abort(uuidParam(id, "Upload"), p);
  }
}
