/**
 * v3 Phase C.4 (ADR-104, migration 0060): Archive bundle with manifest (`otsi-archive/v1`) and audit extract (`audit-extract.json`);
 * rights are re-checked at pack time and at every open or download, and every check is recorded in `policy_decisions` (`archive-v1`).
 *
 *   GET  /v1/archives/status?subject_kind=...&subject_id=...   live rights check (`archive-v1`) and packed archives for a reel, video, or match
 *   POST /v1/archives {subject_kind, subject_id}               pack a portable ZIP archive (`manifest.json`, `audit-extract.json`, plus for a
 *                                                              reel its `.otsi-reel` manifest, `.otio` timeline, and finished render if on disk)
 *   GET  /v1/archives/:id                                      open an archive: re-checks live rights (`ARCHIVE_OPEN`) and returns the manifest
 *                                                              and audit extract, or refuses with 409 `ARCHIVE_RIGHTS_BLOCKED`
 *   GET  /v1/archives/:id/download                             download the ZIP: re-checks live rights (`ARCHIVE_DOWNLOAD`) and streams the file
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { ARCHIVE_SCHEMA, ArchiveAuditEntry, ArchiveBundleSummary, ArchiveBundleView, ArchiveFileEntry, ArchiveManifest, ArchiveRightsCheck,
  ArchiveStatusView, ArchiveSubjectKind, ArchiveVideoEvidence, CreateArchiveRequest, RIGHTS_STATES, RIGHTS_USES, checkArchiveRights,
  type ArchiveVideoGrantInput } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { matchNotHidden, notHidden } from "../../core/access";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { ExportsService, writeZip } from "../exports/exports";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const RULE = "archive-v1";
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const json = <T>(v: unknown): T => (typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
const sha256Buf = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

async function fileExists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

const StatusQuery = z.object({
  subject_kind: ArchiveSubjectKind,
  subject_id: z.string().uuid(),
});

interface ResolvedSubject {
  kind: ArchiveSubjectKind;
  id: string;
  title: string;
  projectId: string | null;
  videoIds: string[];
  staleTargets: number;
}

@Injectable()
export class ArchiveService {
  private readonly store: LocalStore | null;
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db, @Inject(ExportsService) private readonly exportsSvc: ExportsService) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private needStore(): LocalStore {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return this.store;
  }

  /** Resolve the subject (reel, video, or match), enforcing tenant and project visibility. */
  private async resolveSubject(kind: ArchiveSubjectKind, id: string, p: Principal): Promise<ResolvedSubject> {
    const org = p.organizationId;
    if (kind === "REEL") {
      const r = await this.db.one<RowDataPacket>(
        `SELECT id, name, project_id, video_id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL${notHidden(p, "project_id")}`,
        [id, org]);
      if (!r) throw notFound("Reel");
      const stale = await this.db.one<RowDataPacket>(
        `SELECT COUNT(*) AS n FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id
          WHERE rt.reel_id = ? AND NOT ((ci.decision_id = rt.identity_decision_id OR (ci.decision_id IS NULL AND rt.identity_decision_id IS NULL)) AND ci.state = 'CONFIRMED' AND (ci.player_id = rt.player_id OR (ci.player_id IS NULL AND rt.player_id IS NULL)))`,
        [id]);
      return {
        kind,
        id,
        title: String(r.name),
        projectId: (r.project_id as string | null) ?? null,
        videoIds: [String(r.video_id)],
        staleTargets: Number(stale?.n ?? 0),
      };
    }
    if (kind === "VIDEO") {
      const v = await this.db.one<RowDataPacket>(
        `SELECT id, COALESCE(title, original_filename, 'Video') AS title, project_id
           FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL${notHidden(p, "project_id")}`,
        [id, org]);
      if (!v) throw notFound("Video");
      return {
        kind,
        id,
        title: String(v.title),
        projectId: (v.project_id as string | null) ?? null,
        videoIds: [String(v.id)],
        staleTargets: 0,
      };
    }
    const m = await this.db.one<RowDataPacket>(
      `SELECT m.id, COALESCE(CONCAT(h.canonical_name, ' vs ', a.canonical_name), m.competition, 'Match') AS title
         FROM matches m LEFT JOIN clubs h ON h.id = m.home_club_id LEFT JOIN clubs a ON a.id = m.away_club_id
        WHERE m.id = ? AND m.organization_id = ? AND m.removed_at IS NULL${matchNotHidden(p, "m.id")}`,
      [id, org]);
    if (!m) throw notFound("Match");
    const vids = await this.db.rows<RowDataPacket>(
      `SELECT id, project_id FROM video_sources WHERE match_id = ? AND organization_id = ? AND removed_at IS NULL${notHidden(p, "project_id")} ORDER BY created_at, id`,
      [id, org]);
    return {
      kind,
      id,
      title: String(m.title),
      projectId: vids.length === 1 ? ((vids[0]!.project_id as string | null) ?? null) : null,
      videoIds: vids.map((x) => String(x.id)),
      staleTargets: 0,
    };
  }

  /** Evaluate the live rights (`archive-v1`) for a set of video IDs and optional reel target staleness. */
  private async evaluateRights(videoIds: string[], reelId: string | null, org: string): Promise<ArchiveRightsCheck> {
    let staleTargets = 0;
    if (reelId) {
      const stale = await this.db.one<RowDataPacket>(
        `SELECT COUNT(*) AS n FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id
          WHERE rt.reel_id = ? AND NOT ((ci.decision_id = rt.identity_decision_id OR (ci.decision_id IS NULL AND rt.identity_decision_id IS NULL)) AND ci.state = 'CONFIRMED' AND (ci.player_id = rt.player_id OR (ci.player_id IS NULL AND rt.player_id IS NULL)))`,
        [reelId]);
      staleTargets = Number(stale?.n ?? 0);
    }
    if (!videoIds.length) {
      return checkArchiveRights({ videos: [], staleTargets });
    }
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT v.id, COALESCE(v.title, v.original_filename, 'Video') AS title, v.removed_at,
              g.id AS grant_id, g.rights_state, g.allowed_uses, g.valid_from, g.valid_until, g.guardian_consent_state
         FROM video_sources v
         LEFT JOIN rights_grants g ON g.id = (SELECT g2.id FROM rights_grants g2 WHERE g2.video_id = v.id AND g2.organization_id = v.organization_id ORDER BY g2.created_at DESC, g2.id DESC LIMIT 1)
        WHERE v.id IN (?) AND v.organization_id = ?
        ORDER BY v.created_at, v.id`,
      [videoIds, org]);
    const byId = new Map(rows.map((r) => [String(r.id), r]));
    const inputs: ArchiveVideoGrantInput[] = videoIds.map((vid) => {
      const r = byId.get(vid);
      if (!r) {
        return { video_id: vid, title: "Removed video", removed: true, grant: null };
      }
      return {
        video_id: vid,
        title: String(r.title),
        removed: r.removed_at !== null,
        grant: r.grant_id ? {
          id: String(r.grant_id),
          rights_state: r.rights_state as (typeof RIGHTS_STATES)[number],
          allowed_uses: (json<string[]>(r.allowed_uses) ?? []) as (typeof RIGHTS_USES)[number][],
          valid_from: iso(r.valid_from),
          valid_until: iso(r.valid_until),
          guardian_consent_state: r.guardian_consent_state as "NOT_APPLICABLE" | "PENDING" | "VERIFIED" | "REVOKED",
        } : null,
      };
    });
    return checkArchiveRights({ videos: inputs, staleTargets });
  }

  private async recordDecision(ex: Executor | undefined, org: string, action: "PRODUCE" | "VIEW" | "DOWNLOAD",
                               resourceType: string, resourceId: string, actor: string | null, check: ArchiveRightsCheck) {
    const grantIds = check.videos.map((v) => v.grant_id).filter((x): x is string => !!x);
    await this.db.rows(
      `INSERT INTO policy_decisions (id, organization_id, action, resource_type, resource_id, actor_id, decision, rule_version, grant_ids, reason_codes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv7(), org, action, resourceType, resourceId, actor, check.allowed ? "ALLOW" : "DENY", RULE, JSON.stringify(grantIds), JSON.stringify(check.reason_codes)],
      ex);
  }

  /** Collect video evidence summaries for the archive manifest. */
  private async collectVideoEvidence(videoIds: string[], org: string): Promise<ArchiveVideoEvidence[]> {
    if (!videoIds.length) return [];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT v.id, COALESCE(v.title, v.original_filename, 'Video') AS title, v.duration_us, a.sha256 AS source_sha256,
              r.id AS run_id,
              (SELECT COUNT(*) FROM tracks t WHERE t.run_id = r.id) AS tracks,
              (SELECT COUNT(*) FROM tracks t JOIN v_track_current_identity ci ON ci.track_id = t.id AND ci.state = 'CONFIRMED' WHERE t.run_id = r.id) AS confirmed_tracks,
              EXISTS(SELECT 1 FROM pitch_calibrations pc WHERE pc.video_id = v.id) AS calibrated
         FROM video_sources v
         LEFT JOIN assets a ON a.id = v.source_asset_id
         LEFT JOIN pipeline_runs r ON r.id = (SELECT r2.id FROM pipeline_runs r2 WHERE r2.video_id = v.id AND r2.organization_id = v.organization_id AND r2.status = 'SUCCEEDED'
                                              ORDER BY r2.finished_at DESC, r2.id DESC LIMIT 1)
        WHERE v.id IN (?) AND v.organization_id = ?
        ORDER BY v.created_at, v.id`,
      [videoIds, org]);
    return rows.map((r) => ArchiveVideoEvidence.parse({
      video_id: String(r.id),
      title: String(r.title),
      duration_us: r.duration_us == null ? null : Number(r.duration_us),
      source_sha256: (r.source_sha256 as string | null) ?? null,
      analysed: !!r.run_id,
      tracks: Number(r.tracks ?? 0),
      confirmed_tracks: Number(r.confirmed_tracks ?? 0),
      calibrated: !!Number(r.calibrated ?? 0),
    }));
  }

  /** Collect the chronological audit extract scoped to the subject and its related entities within the organization. */
  private async collectAuditExtract(sub: ResolvedSubject, org: string): Promise<ArchiveAuditEntry[]> {
    const entityIds = new Set<string>([sub.id, ...sub.videoIds]);
    if (sub.kind === "REEL") {
      const renders = await this.db.rows<RowDataPacket>("SELECT id, output_asset_id FROM render_jobs WHERE reel_id = ? AND organization_id = ?", [sub.id, org]);
      for (const r of renders) {
        entityIds.add(String(r.id));
        if (r.output_asset_id) {
          const links = await this.db.rows<RowDataPacket>("SELECT id FROM share_links WHERE asset_id = ? AND organization_id = ?", [r.output_asset_id, org]);
          for (const l of links) entityIds.add(String(l.id));
        }
      }
    }
    if (sub.videoIds.length) {
      const runs = await this.db.rows<RowDataPacket>("SELECT id FROM pipeline_runs WHERE video_id IN (?) AND organization_id = ?", [sub.videoIds, org]);
      for (const r of runs) entityIds.add(String(r.id));
      const tracks = await this.db.rows<RowDataPacket>(
        "SELECT t.id FROM tracks t JOIN video_sources v ON v.id = t.video_id WHERE t.video_id IN (?) AND v.organization_id = ? LIMIT 500",
        [sub.videoIds, org]);
      for (const t of tracks) entityIds.add(String(t.id));
      const cals = await this.db.rows<RowDataPacket>("SELECT id FROM pitch_calibration_requests WHERE video_id IN (?) AND organization_id = ?", [sub.videoIds, org]);
      for (const c of cals) entityIds.add(String(c.id));
      const matches = await this.db.rows<RowDataPacket>("SELECT DISTINCT match_id FROM video_sources WHERE id IN (?) AND organization_id = ? AND match_id IS NOT NULL", [sub.videoIds, org]);
      for (const m of matches) entityIds.add(String(m.match_id));
      if (sub.kind === "MATCH") {
        const reels = await this.db.rows<RowDataPacket>("SELECT id FROM reel_projects WHERE video_id IN (?) AND organization_id = ?", [sub.videoIds, org]);
        for (const rl of reels) entityIds.add(String(rl.id));
      }
    }
    const ids = [...entityIds];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT e.id, e.occurred_at, e.actor_kind, e.actor_id, u.display_name AS actor_name, e.actor_service,
              e.action, e.entity_type, e.entity_id, e.request_id, e.before_state, e.after_state
         FROM audit_events e LEFT JOIN users u ON u.id = e.actor_id
        WHERE e.organization_id = ? AND e.entity_id IN (?)
        ORDER BY e.id ASC LIMIT 500`,
      [org, ids]);
    const parseState = (v: unknown) => {
      if (v === null || v === undefined) return null;
      if (typeof v !== "string") return v;
      try { return JSON.parse(v); } catch { return v; }
    };
    return rows.map((r) => ArchiveAuditEntry.parse({
      id: Number(r.id),
      occurred_at: new Date(r.occurred_at as string).toISOString(),
      actor_kind: String(r.actor_kind),
      actor_id: (r.actor_id as string | null) ?? null,
      actor_name: (r.actor_name as string | null) ?? null,
      actor_service: (r.actor_service as string | null) ?? null,
      action: String(r.action),
      entity_type: String(r.entity_type),
      entity_id: (r.entity_id as string | null) ?? null,
      request_id: (r.request_id as string | null) ?? null,
      before_state: parseState(r.before_state),
      after_state: parseState(r.after_state),
    }));
  }

  private toSummary(row: RowDataPacket, rightsNow: ArchiveRightsCheck): ArchiveBundleSummary {
    const manifest = json<ArchiveManifest>(row.manifest);
    const id = String(row.id);
    return ArchiveBundleSummary.parse({
      id,
      subject_kind: row.subject_kind,
      subject_id: String(row.subject_id),
      title: String(row.title),
      created_at: iso(row.created_at)!,
      created_by_name: String(row.created_by_name ?? ""),
      bytes: Number(row.byte_size),
      sha256: String(row.sha256),
      audit_count: Number(row.audit_count),
      file_count: manifest.files.length + 1,
      rights_now: rightsNow,
      download_url: rightsNow.allowed ? `/api/v1/archives/${id}/download` : null,
    });
  }

  /** Live rights check and list of already-packed archives for a reel, video, or match (view-only). */
  async status(kind: ArchiveSubjectKind, subjectId: string, p: Principal): Promise<ArchiveStatusView> {
    const sub = await this.resolveSubject(kind, subjectId, p);
    const rightsNow = await this.evaluateRights(sub.videoIds, sub.kind === "REEL" ? sub.id : null, p.organizationId);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT ab.*, u.display_name AS created_by_name
         FROM archive_bundles ab JOIN users u ON u.id = ab.created_by
        WHERE ab.organization_id = ? AND ab.subject_kind = ? AND ab.subject_id = ?
        ORDER BY ab.created_at DESC, ab.id DESC LIMIT 10`,
      [p.organizationId, kind, subjectId]);
    const summaries: ArchiveBundleSummary[] = [];
    for (const r of rows) {
      const vids = json<string[]>(r.video_ids) ?? sub.videoIds;
      const check = await this.evaluateRights(vids, r.subject_kind === "REEL" ? String(r.subject_id) : null, p.organizationId);
      summaries.push(this.toSummary(r, check));
    }
    return ArchiveStatusView.parse({
      subject_kind: kind,
      subject_id: subjectId,
      title: sub.title,
      rights_now: rightsNow,
      archives: summaries,
    });
  }

  /** Pack a new portable archive bundle: checks live rights (`ARCHIVE_PACK`), writes the ZIP, and records `archive.packed`. */
  async pack(body: CreateArchiveRequest, p: Principal): Promise<ArchiveBundleView> {
    const store = this.needStore();
    const sub = await this.resolveSubject(body.subject_kind, body.subject_id, p);
    const rightsAtPack = await this.evaluateRights(sub.videoIds, sub.kind === "REEL" ? sub.id : null, p.organizationId);
    await this.recordDecision(undefined, p.organizationId, "PRODUCE", sub.kind.toLowerCase(), sub.id, p.userId, rightsAtPack);
    if (!rightsAtPack.allowed) {
      await recordChange(this.db.pool, userActor(p), {
        action: "archive.blocked",
        entityType: sub.kind.toLowerCase(),
        entityId: sub.id,
        after: { stage: "PACK", reason_codes: rightsAtPack.reason_codes },
      });
      throw new ApiError(409, "ARCHIVE_RIGHTS_BLOCKED", rightsAtPack.reason_text ?? "This item's rights do not allow packing an archive bundle.");
    }

    const archiveId = uuidv7();
    const packedAt = new Date().toISOString();
    const orgRow = await this.db.one<RowDataPacket>("SELECT name FROM organizations WHERE id = ?", [p.organizationId]);
    const userRow = await this.db.one<RowDataPacket>("SELECT display_name FROM users WHERE id = ?", [p.userId]);
    const orgName = String(orgRow?.name ?? "");
    const userName = String(userRow?.display_name ?? "");

    const videos = await this.collectVideoEvidence(sub.videoIds, p.organizationId);
    const auditExtract = await this.collectAuditExtract(sub, p.organizationId);

    const zipFiles: { name: string; path?: string; data?: Buffer }[] = [];
    const listedFiles: ArchiveFileEntry[] = [];

    const auditBuf = Buffer.from(JSON.stringify(auditExtract, null, 2) + "\n", "utf8");
    zipFiles.push({ name: "audit-extract.json", data: auditBuf });
    listedFiles.push({
      name: "audit-extract.json",
      kind: "AUDIT_EXTRACT",
      mime_type: "application/json",
      bytes: auditBuf.length,
      sha256: sha256Buf(auditBuf),
    });

    let reelInterchange: ArchiveManifest["reel_interchange"] = null;
    if (sub.kind === "REEL") {
      const ix = await this.exportsSvc.interchange(sub.id, undefined, p).catch(() => null);
      if (ix) {
        reelInterchange = { manifest: ix.manifest, otio: ix.otio };
        const reelManifestBuf = Buffer.from(JSON.stringify(ix.manifest, null, 2) + "\n", "utf8");
        zipFiles.push({ name: "reel.otsi-reel", data: reelManifestBuf });
        listedFiles.push({
          name: "reel.otsi-reel",
          kind: "REEL_MANIFEST",
          mime_type: "application/vnd.otsi.reel+json",
          bytes: reelManifestBuf.length,
          sha256: sha256Buf(reelManifestBuf),
        });
        const otioBuf = Buffer.from(JSON.stringify(ix.otio, null, 2) + "\n", "utf8");
        zipFiles.push({ name: "timeline.otio", data: otioBuf });
        listedFiles.push({
          name: "timeline.otio",
          kind: "OTIO_TIMELINE",
          mime_type: "application/vnd.pixar.opentimelineio+json",
          bytes: otioBuf.length,
          sha256: sha256Buf(otioBuf),
        });
      }
      const render = await this.db.one<RowDataPacket>(
        `SELECT a.object_key, a.mime_type FROM render_jobs j JOIN assets a ON a.id = j.output_asset_id
          WHERE j.reel_id = ? AND j.organization_id = ? AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL
          ORDER BY j.completed_at DESC, j.created_at DESC LIMIT 1`,
        [sub.id, p.organizationId]);
      if (render?.object_key) {
        const renderFile = store.resolve(String(render.object_key));
        if (await fileExists(renderFile)) {
          const ext = render.mime_type === "video/webm" ? "webm" : "mp4";
          const name = `reel.${ext}`;
          const st = await stat(renderFile);
          const sha = await sha256File(renderFile);
          zipFiles.push({ name, path: renderFile });
          listedFiles.push({
            name,
            kind: "RENDERED_REEL",
            mime_type: String(render.mime_type ?? "video/mp4"),
            bytes: st.size,
            sha256: sha,
          });
        }
      }
    }

    const actions = [...new Set(auditExtract.map((e) => e.action))];
    const finalManifest = ArchiveManifest.parse({
      schema: ARCHIVE_SCHEMA,
      archive_id: archiveId,
      packed_at: packedAt,
      packed_by_name: userName,
      organization_id: p.organizationId,
      organization_name: orgName,
      subject: {
        kind: sub.kind,
        id: sub.id,
        title: sub.title,
        project_id: sub.projectId,
      },
      rights_at_pack: rightsAtPack,
      videos,
      reel_interchange: reelInterchange,
      audit_summary: {
        count: auditExtract.length,
        earliest_at: auditExtract[0]?.occurred_at ?? null,
        latest_at: auditExtract[auditExtract.length - 1]?.occurred_at ?? null,
        actions,
      },
      files: listedFiles,
    });
    const finalManifestBuf = Buffer.from(JSON.stringify(finalManifest, null, 2) + "\n", "utf8");

    const allZipFiles = [{ name: "manifest.json", data: finalManifestBuf }, ...zipFiles];
    const key = `org/${p.organizationId}/archives/${archiveId}/otsi-archive.zip`;
    const file = store.resolve(key);
    const assetId = uuidv7();
    await mkdir(path.dirname(file), { recursive: true });
    const { bytes } = await writeZip(file, allZipFiles);
    const zipSha = await sha256File(file);
    const slug = sub.title.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "archive";

    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
         VALUES (?, ?, ?, 'BUNDLE', ?, 'local', ?, ?, 'application/zip', ?, ?)`,
        [assetId, p.organizationId, sub.projectId, key, bytes, zipSha, p.userId, JSON.stringify({ archive_id: archiveId, filename: `${slug}.otsi-archive.zip` })]);
      await c.query(
        `INSERT INTO archive_bundles (id, organization_id, project_id, subject_kind, subject_id, title, video_ids, zip_asset_id, manifest, audit_extract, audit_count, byte_size, sha256, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [archiveId, p.organizationId, sub.projectId, sub.kind, sub.id, sub.title, JSON.stringify(sub.videoIds), assetId,
         JSON.stringify(finalManifest), JSON.stringify(auditExtract), auditExtract.length, bytes, zipSha, p.userId]);
      await recordChange(c, userActor(p), {
        action: "archive.packed",
        entityType: sub.kind.toLowerCase(),
        entityId: sub.id,
        after: { archive_id: archiveId, bytes, sha256: zipSha, files: finalManifest.files.length + 1, audit_count: auditExtract.length },
      });
    });

    const row = await this.db.one<RowDataPacket>(
      `SELECT ab.*, u.display_name AS created_by_name FROM archive_bundles ab JOIN users u ON u.id = ab.created_by WHERE ab.id = ?`,
      [archiveId]);
    return ArchiveBundleView.parse({
      ...this.toSummary(row!, rightsAtPack),
      manifest: finalManifest,
      audit_extract: auditExtract,
    });
  }

  /** Open an archive bundle: re-checks live rights (`ARCHIVE_OPEN`) every time and refuses with 409 if blocked. */
  async open(archiveId: string, p: Principal): Promise<ArchiveBundleView> {
    const row = await this.db.one<RowDataPacket>(
      `SELECT ab.*, u.display_name AS created_by_name
         FROM archive_bundles ab JOIN users u ON u.id = ab.created_by
        WHERE ab.id = ? AND ab.organization_id = ?`,
      [archiveId, p.organizationId]);
    if (!row) throw notFound("Archive bundle");
    const videoIds = json<string[]>(row.video_ids) ?? [];
    const reelId = row.subject_kind === "REEL" ? String(row.subject_id) : null;
    const rightsNow = await this.evaluateRights(videoIds, reelId, p.organizationId);
    await this.recordDecision(undefined, p.organizationId, "VIEW", "archive", archiveId, p.userId, rightsNow);
    if (!rightsNow.allowed) {
      await recordChange(this.db.pool, userActor(p), {
        action: "archive.blocked",
        entityType: String(row.subject_kind).toLowerCase(),
        entityId: String(row.subject_id),
        after: { archive_id: archiveId, stage: "OPEN", reason_codes: rightsNow.reason_codes },
      });
      throw new ApiError(409, "ARCHIVE_RIGHTS_BLOCKED", rightsNow.reason_text ?? "This archive cannot be opened because a source video's rights no longer allow it.");
    }
    return ArchiveBundleView.parse({
      ...this.toSummary(row, rightsNow),
      manifest: json<ArchiveManifest>(row.manifest),
      audit_extract: json<ArchiveAuditEntry[]>(row.audit_extract),
    });
  }

  /** Download the ZIP archive: re-checks live rights (`ARCHIVE_DOWNLOAD`) every time and refuses with 409 if blocked. */
  async download(archiveId: string, p: Principal): Promise<{ file: string; filename: string; bytes: number }> {
    const store = this.needStore();
    const row = await this.db.one<RowDataPacket>(
      `SELECT ab.*, a.object_key, a.byte_size AS asset_bytes
         FROM archive_bundles ab JOIN assets a ON a.id = ab.zip_asset_id
        WHERE ab.id = ? AND ab.organization_id = ?`,
      [archiveId, p.organizationId]);
    if (!row) throw notFound("Archive bundle");
    const videoIds = json<string[]>(row.video_ids) ?? [];
    const reelId = row.subject_kind === "REEL" ? String(row.subject_id) : null;
    const rightsNow = await this.evaluateRights(videoIds, reelId, p.organizationId);
    await this.recordDecision(undefined, p.organizationId, "DOWNLOAD", "archive", archiveId, p.userId, rightsNow);
    if (!rightsNow.allowed) {
      await recordChange(this.db.pool, userActor(p), {
        action: "archive.blocked",
        entityType: String(row.subject_kind).toLowerCase(),
        entityId: String(row.subject_id),
        after: { archive_id: archiveId, stage: "DOWNLOAD", reason_codes: rightsNow.reason_codes },
      });
      throw new ApiError(409, "ARCHIVE_RIGHTS_BLOCKED", rightsNow.reason_text ?? "This archive cannot be downloaded because a source video's rights no longer allow it.");
    }
    const slug = String(row.title).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "archive";
    const file = store.resolve(String(row.object_key));
    return { file, filename: `${slug}.otsi-archive.zip`, bytes: Number(row.asset_bytes ?? row.byte_size) };
  }
}

@Controller("v1/archives")
@UseGuards(AuthGuard)
export class ArchiveController {
  constructor(private readonly s: ArchiveService) {}

  @Get("status")
  status(@Query() query: unknown, @CurrentPrincipal() p: Principal) {
    const q = StatusQuery.parse(query);
    return this.s.status(q.subject_kind, q.subject_id, p);
  }

  @Post()
  @HttpCode(201)
  @Roles(...PROJECT_WRITERS)
  pack(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.s.pack(CreateArchiveRequest.parse(body), p);
  }

  @Get(":id")
  open(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.s.open(uuidParam(id, "Archive bundle"), p);
  }

  @Get(":id/download")
  async download(@Param("id") id: string, @CurrentPrincipal() p: Principal, @Res({ passthrough: true }) reply: FastifyReply) {
    const d = await this.s.download(uuidParam(id, "Archive bundle"), p);
    reply
      .header("content-type", "application/zip")
      .header("content-length", String(d.bytes))
      .header("content-disposition", `attachment; filename="${d.filename}"`)
      .header("cache-control", "no-store");
    return createReadStream(d.file);
  }
}
