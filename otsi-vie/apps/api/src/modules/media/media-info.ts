/**
 * v3 Phase A.12 (ADR-078): Media Info (contract `media-info.ts`).
 *
 *   GET /v1/videos/:id/media-info   everything recorded about the video's file: what arrived, what the prober measured, the ingest checks
 *                                   in order with their results, the playback copy, and what the engine has made from it so far
 *
 * Read-only, from recorded rows: video_sources, its SOURCE / PROXY assets (the source asset's metadata holds the signature, the malware scan
 * and, since ADR-078, the decode test), the latest ingest job, pipeline_runs, tracks and their current identity, the latest footage check,
 * the current rights grant, reels and renders. A video in a project hidden from the person is not found (ADR-057).
 */
import { Controller, Get, Injectable, Param, UseGuards } from "@nestjs/common";
import { MediaInfo, mediaChecks, type SourceMeta } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { notHidden } from "../../core/access";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { analysisRightsBlock } from "../sharing/rights";

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : typeof v === "string" ? JSON.parse(v) : v) as T;
const rate = (n: unknown, d: unknown) => (n && d ? { num: Number(n), den: Number(d) } : null);

@Injectable()
export class MediaInfoService {
  constructor(private readonly db: Db) {}

  async info(id: string, p: Principal): Promise<MediaInfo> {
    const org = p.organizationId;
    const v = await this.db.one<RowDataPacket>(
      `SELECT v.*, sa.sha256 AS source_sha256, sa.mime_type AS source_mime, sa.metadata AS source_meta, pa.byte_size AS proxy_bytes, pa.created_at AS proxy_at,
              u.display_name AS added_by_name
         FROM video_sources v
         LEFT JOIN assets sa ON sa.id = v.source_asset_id AND sa.organization_id = v.organization_id
         LEFT JOIN assets pa ON pa.id = v.proxy_asset_id AND pa.organization_id = v.organization_id
         LEFT JOIN users u ON u.id = v.created_by
        WHERE v.id = ? AND v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")}`, [id, org]);
    if (!v) throw notFound("Video");
    const meta = json<SourceMeta>(v.source_meta);
    const [job, verified, runs, latest, check, reels, renders, grant] = await Promise.all([
      this.db.one<RowDataPacket>(`SELECT state, attempts, started_at, finished_at, error_code FROM worker_jobs
                                   WHERE organization_id = ? AND subject_type = 'video' AND subject_id = ? AND kind IN ('INGEST_UPLOAD', 'INGEST_URL') ORDER BY created_at DESC LIMIT 1`, [org, id]),
      this.db.one<RowDataPacket>("SELECT occurred_at FROM audit_events WHERE organization_id = ? AND action = 'video.ingested' AND entity_id = ? ORDER BY occurred_at DESC LIMIT 1", [org, id]),
      this.db.one<RowDataPacket>("SELECT COUNT(*) AS n FROM pipeline_runs WHERE organization_id = ? AND video_id = ?", [org, id]),
      this.db.one<RowDataPacket>(
        `SELECT r.id, r.status, r.finished_at,
                (SELECT COUNT(*) FROM tracks t WHERE t.run_id = r.id) AS tracks,
                (SELECT COUNT(*) FROM tracks t JOIN v_track_current_identity ci ON ci.track_id = t.id WHERE t.run_id = r.id AND ci.state = 'CONFIRMED') AS confirmed
           FROM pipeline_runs r WHERE r.organization_id = ? AND r.video_id = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 1`, [org, id]),
      this.db.one<RowDataPacket>("SELECT status, recommended_profile FROM video_quality_assessments WHERE organization_id = ? AND video_id = ? ORDER BY created_at DESC LIMIT 1", [org, id]),
      this.db.one<RowDataPacket>("SELECT COUNT(*) AS n FROM reel_projects WHERE organization_id = ? AND video_id = ? AND removed_at IS NULL", [org, id]),
      this.db.one<RowDataPacket>(`SELECT COUNT(*) AS n FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id
                                   WHERE j.organization_id = ? AND r.video_id = ? AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL AND r.removed_at IS NULL`, [org, id]),
      this.db.one<RowDataPacket>("SELECT rights_state, allowed_uses, guardian_consent_state FROM rights_grants WHERE organization_id = ? AND video_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [org, id]),
    ]);
    const blocked = grant ? (await analysisRightsBlock(this.db.pool, org, id))?.text ?? null : null;
    return MediaInfo.parse({
      video_id: id, state: v.state,
      file: { name: v.original_filename ?? null, bytes: num(v.byte_size), sha256: v.source_sha256 ?? v.video_sha256 ?? null, mime_type: v.source_mime ?? null, signature: meta?.sniffed ?? null,
        ingest_mode: v.ingest_mode, source_uri: v.source_uri ?? null, added_by: v.added_by_name ?? null, added_at: iso(v.created_at), verified_at: iso(verified?.occurred_at) },
      streams: { container: v.container_format ?? null, video_codec: v.video_codec ?? null, audio_codec: v.audio_codec ?? null, width: num(v.width), height: num(v.height),
        frame_rate: rate(v.avg_frame_rate_num, v.avg_frame_rate_den), variable_frame_rate: v.is_variable_frame_rate === null ? null : Boolean(v.is_variable_frame_rate),
        frame_count: num(v.frame_count), duration_us: num(v.duration_us), time_base: rate(v.timebase_num, v.timebase_den), rotation_degrees: num(v.rotation_degrees) },
      checks: mediaChecks(v.state, v.failure_code ?? null, v.failure_detail ?? null, v.source_sha256 ?? v.video_sha256 ?? null, meta),
      ingest_job: job ? { state: job.state, attempts: Number(job.attempts), started_at: iso(job.started_at), finished_at: iso(job.finished_at), error_code: job.error_code ?? null } : null,
      copies: { playback: v.proxy_asset_id ? { bytes: num(v.proxy_bytes), created_at: iso(v.proxy_at) } : null, thumbnail: v.thumbnail_asset_id !== null },
      evidence: {
        analyses: Number(runs?.n ?? 0),
        latest_analysis: latest ? { id: latest.id, status: latest.status, finished_at: iso(latest.finished_at), tracks: Number(latest.tracks), confirmed_tracks: Number(latest.confirmed) } : null,
        footage_check: check ? { status: check.status, recommended_profile: check.recommended_profile ?? null } : null,
        rights: grant ? { rights_state: grant.rights_state, allowed_uses: json<string[]>(grant.allowed_uses) ?? [], guardian_consent_state: grant.guardian_consent_state, analysis_blocked: blocked } : null,
        reels: Number(reels?.n ?? 0), renders: Number(renders?.n ?? 0),
      },
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class MediaInfoController {
  constructor(private readonly info: MediaInfoService) {}

  @Get("videos/:id/media-info")
  get(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.info.info(uuidParam(id, "Video"), p); }
}
