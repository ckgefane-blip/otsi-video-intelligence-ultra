/**
 * Sharing (Page 10 "Deliver & Share", promise 10; contract `sharing.ts`).
 *
 *   GET    /v1/videos/:id/rights               the video's current rights grant (or none)
 *   POST   /v1/videos/:id/rights               record a new grant (Owner / Admin; audited with the reason; history kept)
 *   POST   /v1/videos/:id/rights/declaration   A.11 (ADR-077): the first rights of a video that has none, in Upload's four answers (writers)
 *   POST   /v1/renders/:id/share-links         a private link to a finished render (writers), only when the rights check allows it
 *   GET    /v1/renders/:id/share-links         the render's links (never the link itself: only its hash is stored)
 *   DELETE /v1/share-links/:id                 revoke (writers; audited)
 *   GET    /v1/public/share/:token             what a person opening the link sees (no sign-in): the check runs again, every opening logged
 *   POST   /v1/public/share/:token/open        the same, for a link with a password (in the body, never the address); 10 wrong passwords
 *                                              on one link within 15 minutes lock it for that time
 *   POST   /v1/public/share/:token/comments    leave a comment with a name, when the link allows comments (the same checks first)
 *   GET    /v1/share-links/:id/comments        the team reads what people left through a link
 *   POST   /v1/reports/:id/share-links         a private link to a finished player report PDF (ADR-056): every video his numbers came from must
 *                                              allow sharing (the same rule per video); GET lists the report's links
 *
 * The check (`decide`) and every outcome are stored in policy_decisions (rule `share-v1`). A link stands for one render; nothing else of the
 * organization is reachable through it. The video URL it hands out lives 15 minutes, so a revoked link stops playing soon after.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, Post, Req, UseGuards } from "@nestjs/common";
import { CreatedReportShareLink, CreatedShareLink, CreateReportShareLinkRequest, CreateShareLinkRequest, OpenShareRequest, PostSharedCommentRequest, RecordRightsRequest,
  ReportShareLink, SharedComment, SharedView, SHARE_REASONS, ShareLink, UploadRights, VideoRights } from "@otsi-vie/contracts";
import type { FastifyRequest } from "fastify";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { hashPassword, verifyPassword } from "../../core/passwords";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { AnalysisService } from "../analysis/analysis";
import { requireIdentity } from "../playerreport/gate";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { analysisRightsBlock, declareRights } from "./rights";

const RULE = "share-v1";
const SHARE_VIDEO_TTL_S = 15 * 60;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;                             // 32 random bytes, base64url
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const json = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const WRONG_LIMIT = 10, WRONG_WINDOW_MIN = 15;                   // wrong passwords per link before it locks for the window
const COMMENT_LIMIT = 30;                                        // comments per link per hour

interface Subject { render: RowDataPacket | undefined; staleTargets: number; grant: RowDataPacket | undefined }

/** The sharing rule: which reasons forbid it (empty = allowed). */
export function decide(s: Subject, wantDownload: boolean, now = new Date()): string[] {
  const reasons: string[] = [];
  if (!s.render || s.render.state !== "SUCCEEDED" || !s.render.output_asset_id) reasons.push("RENDER_NOT_READY");
  if (s.staleTargets > 0) reasons.push("REEL_STALE");
  const g = s.grant;
  if (!g) { reasons.push("NO_RIGHTS_RECORDED"); return reasons; }
  const uses = json<string[]>(g.allowed_uses) ?? [];
  if ((g.valid_from && new Date(g.valid_from) > now) || (g.valid_until && new Date(g.valid_until) <= now) || g.rights_state === "EXPIRED") reasons.push("RIGHTS_NOT_VALID_NOW");
  if (!["EXPORT_ALLOWED", "PUBLIC"].includes(g.rights_state) || !uses.includes("SHARE")) reasons.push("RIGHTS_NOT_SHAREABLE");
  if (wantDownload && !uses.includes("DOWNLOAD")) reasons.push("DOWNLOAD_NOT_ALLOWED");
  if (["PENDING", "REVOKED"].includes(g.guardian_consent_state)) reasons.push("GUARDIAN_CONSENT");
  return reasons;
}

/** The sharing rule for a player report: a finished PDF, and every video his numbers came from allows sharing (the reel rule per video).
 *  A report built from no video is not shared: nothing says its subject may be shown outside the organization. */
export function decideReport(job: RowDataPacket | undefined, grants: (RowDataPacket | undefined)[], wantDownload: boolean, now = new Date()): string[] {
  const reasons = new Set<string>();
  if (!job || job.state !== "SUCCEEDED" || !job.output_asset_id) reasons.add("REPORT_NOT_READY");
  if (!grants.length) reasons.add("NO_RIGHTS_RECORDED");
  for (const g of grants) for (const r of decide({ render: { state: "SUCCEEDED", output_asset_id: "-" } as never, staleTargets: 0, grant: g }, wantDownload, now)) reasons.add(r);
  return [...reasons];
}

const explain = (reasons: string[]) => reasons.map((r) => SHARE_REASONS[r] ?? r).join(" ");

@Injectable()
export class SharingService {
  private readonly ipKey: Buffer;
  constructor(private readonly db: Db, private readonly analysis: AnalysisService, @Inject(CONFIG) cfg: Config) {
    this.ipKey = Buffer.from(cfg.mediaSigningKey ?? randomBytes(32).toString("hex"), "utf8");
  }

  private async video(id: string, org: string): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, org]);
    if (!v) throw notFound("Video");
    return v;
  }

  private grantOf(videoId: string, org: string, ex?: Executor) {
    return this.db.one<RowDataPacket>("SELECT * FROM rights_grants WHERE video_id = ? AND organization_id = ? ORDER BY created_at DESC, id DESC LIMIT 1", [videoId, org], ex);
  }

  async rights(videoId: string, p: Principal): Promise<VideoRights> {
    await this.video(videoId, p.organizationId);
    const g = await this.grantOf(videoId, p.organizationId);
    return VideoRights.parse({ video_id: videoId, grant: g ? {
      id: g.id, rights_state: g.rights_state, allowed_uses: json<string[]>(g.allowed_uses) ?? [], valid_from: iso(g.valid_from), valid_until: iso(g.valid_until),
      guardian_consent_state: g.guardian_consent_state, created_at: iso(g.created_at) } : null,
      analysis_blocked: (await analysisRightsBlock(this.db.pool, p.organizationId, videoId))?.text ?? null });
  }

  /** A.11: the first rights of a video, declared in Upload's four answers; a recorded grant is changed by an Owner or Admin (Export) */
  async declare(videoId: string, body: UploadRights, p: Principal): Promise<VideoRights> {
    await this.video(videoId, p.organizationId);
    await this.db.tx(async (c) => {
      const [had] = await c.query<RowDataPacket[]>("SELECT id FROM rights_grants WHERE video_id = ? AND organization_id = ? LIMIT 1 FOR UPDATE", [videoId, p.organizationId]);
      if (had[0]) throw new ApiError(409, "RIGHTS_ALREADY_RECORDED", "This video's rights are already recorded. An Owner or Admin changes them in Export › Sharing & rights.");
      await declareRights(c, userActor(p), p.organizationId, videoId, body);
    });
    return this.rights(videoId, p);
  }

  async recordRights(videoId: string, body: RecordRightsRequest, p: Principal): Promise<VideoRights> {
    await this.video(videoId, p.organizationId);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO rights_grants (id, organization_id, video_id, rights_state, allowed_uses, valid_from, valid_until, guardian_consent_state)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6), ?, ?)`,
        [id, p.organizationId, videoId, body.rights_state, JSON.stringify([...new Set(body.allowed_uses)]), body.valid_until ? new Date(body.valid_until) : null, body.guardian_consent_state]);
      await recordChange(c, userActor(p), { action: "video.rights_recorded", entityType: "video", entityId: videoId,
        after: { grant_id: id, rights_state: body.rights_state, allowed_uses: body.allowed_uses, valid_until: body.valid_until, guardian_consent_state: body.guardian_consent_state, reason: body.reason } });
    });
    return this.rights(videoId, p);
  }

  /** The render, how many of its reel's identity targets are no longer the confirmed ones, and the source video's current grant. */
  private async subject(renderId: string, org: string): Promise<Subject & { reel: RowDataPacket | undefined }> {
    const render = await this.db.one<RowDataPacket>("SELECT id, reel_id, state, output_asset_id FROM render_jobs WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [renderId, org]);
    const reel = render ? await this.db.one<RowDataPacket>("SELECT id, name, video_id, player_id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [render.reel_id, org]) : undefined;
    const stale = reel ? await this.db.one<RowDataPacket>(
      `SELECT COUNT(*) AS n FROM reel_targets rt LEFT JOIN v_track_current_identity ci ON ci.track_id = rt.track_id
        WHERE rt.reel_id = ? AND NOT ((ci.decision_id = rt.identity_decision_id OR (ci.decision_id IS NULL AND rt.identity_decision_id IS NULL)) AND ci.state = 'CONFIRMED' AND (ci.player_id = rt.player_id OR (ci.player_id IS NULL AND rt.player_id IS NULL)))`, [reel.id]) : undefined;
    const grant = reel ? await this.grantOf(String(reel.video_id), org) : undefined;
    return { render, reel, staleTargets: Number(stale?.n ?? 0), grant };
  }

  private async recordDecision(ex: Executor | undefined, org: string, action: string, resourceType: string, resourceId: string, actor: string | null, reasons: string[], grantId: string | null) {
    await this.db.rows(`INSERT INTO policy_decisions (id, organization_id, action, resource_type, resource_id, actor_id, decision, rule_version, grant_ids, reason_codes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv7(), org, action, resourceType, resourceId, actor, reasons.length ? "DENY" : "ALLOW", RULE, JSON.stringify(grantId ? [grantId] : []), JSON.stringify(reasons)], ex);
  }

  private toLink(r: RowDataPacket, renderId: string): ShareLink {
    const expired = r.expires_at && new Date(r.expires_at) <= new Date();
    return ShareLink.parse({ id: r.id, render_id: renderId, expires_at: iso(r.expires_at), can_download: !!Number(r.can_download), revoked_at: iso(r.revoked_at),
      created_at: iso(r.created_at), opened: Number(r.opened ?? 0), has_password: !!r.password_hash, can_comment: !!Number(r.can_comment), comments: Number(r.comments ?? 0),
      state: r.revoked_at ? "REVOKED" : expired ? "EXPIRED" : "ACTIVE" });
  }

  /** a player report, and the current grant of each video his numbers came from */
  private async reportSubject(reportId: string, org: string): Promise<{ job: RowDataPacket | undefined; grants: (RowDataPacket | undefined)[] }> {
    const job = await this.db.one<RowDataPacket>("SELECT id, player_id, state, output_asset_id, config FROM report_jobs WHERE id = ? AND organization_id = ? AND report_type = 'PLAYER_REPORT'", [reportId, org]);
    const ids = job ? json<{ video_ids?: string[] }>(job.config)?.video_ids ?? [] : [];
    const grants: (RowDataPacket | undefined)[] = [];
    for (const v of ids) grants.push(await this.grantOf(v, org));
    return { job, grants };
  }

  private toReportLink(r: RowDataPacket, reportId: string): ReportShareLink {
    const { render_id: _, ...rest } = this.toLink(r, reportId);
    return ReportShareLink.parse({ ...rest, report_id: reportId });
  }

  async createForReport(reportId: string, body: CreateReportShareLinkRequest, p: Principal): Promise<CreatedReportShareLink> {
    const s = await this.reportSubject(reportId, p.organizationId);
    if (!s.job) throw notFound("Report");
    await requireIdentity(this.db, String(s.job.player_id), p.organizationId);                     // B.24 (ADR-099): not while the identity is unconfirmed
    const reasons = decideReport(s.job, s.grants, body.can_download);
    await this.recordDecision(undefined, p.organizationId, "SHARE", "report", reportId, p.userId, reasons, null);
    if (reasons.length) throw new ApiError(409, "SHARING_NOT_ALLOWED", explain(reasons));
    const token = randomBytes(32).toString("base64url"), id = uuidv7();
    const pw = body.password ? await hashPassword(body.password) : null;
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO share_links (id, organization_id, asset_id, created_by, token_hash, expires_at, can_download, can_comment, password_hash)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6) + INTERVAL ? DAY, ?, false, ?)`,
        [id, p.organizationId, s.job!.output_asset_id, p.userId, sha256(token), body.expires_in_days, body.can_download, pw]);
      await recordChange(c, userActor(p), { action: "share_link.created", entityType: "report", entityId: reportId,
        after: { share_link_id: id, expires_in_days: body.expires_in_days, can_download: body.can_download, password: !!pw, player_id: s.job!.player_id } });
    });
    const row = await this.db.one<RowDataPacket>("SELECT *, 0 AS opened FROM share_links WHERE id = ?", [id]);
    return CreatedReportShareLink.parse({ ...this.toReportLink(row!, reportId), url: `/s/${token}` });
  }

  async listForReport(reportId: string, p: Principal): Promise<ReportShareLink[]> {
    const r = await this.db.one<RowDataPacket>("SELECT output_asset_id FROM report_jobs WHERE id = ? AND organization_id = ? AND report_type = 'PLAYER_REPORT'", [reportId, p.organizationId]);
    if (!r) throw notFound("Report");
    if (!r.output_asset_id) return [];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT l.*, (SELECT COUNT(*) FROM share_link_access a WHERE a.share_link_id = l.id AND a.decision = 'ALLOW' AND a.action = 'VIEW') AS opened, 0 AS comments
         FROM share_links l WHERE l.asset_id = ? AND l.organization_id = ? ORDER BY l.created_at DESC`, [r.output_asset_id, p.organizationId]);
    return rows.map((x) => this.toReportLink(x, reportId));
  }

  async create(renderId: string, body: CreateShareLinkRequest, p: Principal): Promise<CreatedShareLink> {
    const s = await this.subject(renderId, p.organizationId);
    if (!s.render) throw notFound("Render");
    const reasons = decide(s, body.can_download);
    await this.recordDecision(undefined, p.organizationId, "SHARE", "render", renderId, p.userId, reasons, s.grant ? String(s.grant.id) : null);
    if (reasons.length) throw new ApiError(409, "SHARING_NOT_ALLOWED", explain(reasons));
    const token = randomBytes(32).toString("base64url"), id = uuidv7();
    const pw = body.password ? await hashPassword(body.password) : null;
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO share_links (id, organization_id, asset_id, created_by, token_hash, expires_at, can_download, can_comment, password_hash)
                     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6) + INTERVAL ? DAY, ?, ?, ?)`,
        [id, p.organizationId, s.render!.output_asset_id, p.userId, sha256(token), body.expires_in_days, body.can_download, body.can_comment, pw]);
      await recordChange(c, userActor(p), { action: "share_link.created", entityType: "render", entityId: renderId,
        after: { share_link_id: id, expires_in_days: body.expires_in_days, can_download: body.can_download, can_comment: body.can_comment, password: !!pw } });
    });
    const row = await this.db.one<RowDataPacket>("SELECT *, 0 AS opened FROM share_links WHERE id = ?", [id]);
    return CreatedShareLink.parse({ ...this.toLink(row!, renderId), url: `/s/${token}` });
  }

  async list(renderId: string, p: Principal): Promise<ShareLink[]> {
    const r = await this.db.one<RowDataPacket>("SELECT output_asset_id FROM render_jobs WHERE id = ? AND organization_id = ?", [renderId, p.organizationId]);
    if (!r) throw notFound("Render");
    if (!r.output_asset_id) return [];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT l.*, (SELECT COUNT(*) FROM share_link_access a WHERE a.share_link_id = l.id AND a.decision = 'ALLOW' AND a.action = 'VIEW') AS opened,
              (SELECT COUNT(*) FROM comments m WHERE m.share_link_id = l.id) AS comments
         FROM share_links l WHERE l.asset_id = ? AND l.organization_id = ? ORDER BY l.created_at DESC`, [r.output_asset_id, p.organizationId]);
    return rows.map((x) => this.toLink(x, renderId));
  }

  async revoke(linkId: string, p: Principal): Promise<void> {
    const l = await this.db.one<RowDataPacket>("SELECT id, asset_id, revoked_at FROM share_links WHERE id = ? AND organization_id = ?", [linkId, p.organizationId]);
    if (!l) throw notFound("Share link");
    if (l.revoked_at) return;
    await this.db.tx(async (c) => {
      await c.query("UPDATE share_links SET revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND revoked_at IS NULL", [linkId]);
      await recordChange(c, userActor(p), { action: "share_link.revoked", entityType: "share_link", entityId: linkId, before: { revoked_at: null } });
    });
  }

  /** The link and its password (when it has one): wrong passwords are logged and, past the limit, lock the link for a while. */
  private async unlock(token: string, ip: string | undefined, password: string | null): Promise<{ l: RowDataPacket; ipHash: string | null }> {
    if (!TOKEN.test(token)) throw notFound("Shared video");
    const l = await this.db.one<RowDataPacket>("SELECT * FROM share_links WHERE token_hash = ?", [sha256(token)]);
    if (!l) throw notFound("Shared video");
    const ipHash = ip ? createHmac("sha256", this.ipKey).update(ip).digest("hex") : null;
    if (l.password_hash) {
      const wrong = await this.db.one<RowDataPacket>(
        "SELECT COUNT(*) AS n FROM share_link_access WHERE share_link_id = ? AND action = 'PASSWORD' AND decision = 'DENY' AND accessed_at > CURRENT_TIMESTAMP(6) - INTERVAL ? MINUTE",
        [l.id, WRONG_WINDOW_MIN]);
      if (Number(wrong?.n ?? 0) >= WRONG_LIMIT) throw new ApiError(429, "SHARE_LOCKED", `Too many wrong passwords. Try again in ${WRONG_WINDOW_MIN} minutes.`);
      if (!password) throw new ApiError(401, "PASSWORD_REQUIRED", "This video is protected by a password.");
      if (!(await verifyPassword(password, String(l.password_hash)))) {
        await this.db.rows("INSERT INTO share_link_access (share_link_id, actor_id, action, decision, ip_hash) VALUES (?, NULL, 'PASSWORD', 'DENY', ?)", [l.id, ipHash]);
        throw new ApiError(401, "PASSWORD_WRONG", "That password is not right.");
      }
    }
    return { l, ipHash };
  }

  private async linkComments(linkId: string): Promise<SharedComment[]> {
    const rows = await this.db.rows<RowDataPacket>("SELECT id, guest_name, body, at_pts_us, created_at FROM comments WHERE share_link_id = ? ORDER BY created_at, id", [linkId]);
    return rows.map((r) => SharedComment.parse({ id: r.id, name: r.guest_name, body: r.body, at_s: r.at_pts_us === null ? null : Number(r.at_pts_us) / 1e6, created_at: iso(r.created_at) }));
  }

  /** Opening a link: the link (and its password), then the sharing rule again; the outcome is logged either way. 404 for anything that is not a link. */
  async open(token: string, ip: string | undefined, password: string | null = null): Promise<SharedView> {
    const { l, ipHash } = await this.unlock(token, ip, password);
    const linkReasons = [...(l.revoked_at ? ["LINK_REVOKED"] : []), ...(l.expires_at && new Date(l.expires_at) <= new Date() ? ["LINK_EXPIRED"] : [])];
    const report = await this.db.one<RowDataPacket>("SELECT id FROM report_jobs WHERE output_asset_id = ? AND organization_id = ?", [l.asset_id, l.organization_id]);
    if (report) {                                                // a player report (ADR-056): the report rule, then the PDF
      const s = await this.reportSubject(String(report.id), String(l.organization_id));
      const reasons = [...linkReasons, ...decideReport(s.job, s.grants, !!Number(l.can_download))];
      await this.db.rows("INSERT INTO share_link_access (share_link_id, actor_id, action, decision, ip_hash) VALUES (?, NULL, 'VIEW', ?, ?)", [l.id, reasons.length ? "DENY" : "ALLOW", ipHash]);
      await this.recordDecision(undefined, String(l.organization_id), "VIEW", "share_link", String(l.id), null, reasons, null);
      if (reasons.length) throw new ApiError(410, "SHARE_UNAVAILABLE", linkReasons.length ? explain(linkReasons) : "This report can no longer be shared.");
      const player = await this.db.one<RowDataPacket>("SELECT display_name FROM v_player_identity WHERE player_id = ?", [s.job!.player_id]);
      return SharedView.parse({ kind: "REPORT", title: "Player report", player_name: player?.display_name ?? null,
        url: this.analysis.signedUrl(String(l.asset_id), String(l.organization_id), false, SHARE_VIDEO_TTL_S).url,
        download_url: Number(l.can_download) ? this.analysis.signedUrl(String(l.asset_id), String(l.organization_id), true, SHARE_VIDEO_TTL_S).url : null,
        mime: "application/pdf", link_expires_at: iso(l.expires_at), notice: "Shared from OTSI VIE. Engine readings, not a verified stat sheet. Development output: commercial distribution is not activated.",
        can_comment: false, comments: [] });
    }
    const r = await this.db.one<RowDataPacket>("SELECT id FROM render_jobs WHERE output_asset_id = ? AND organization_id = ?", [l.asset_id, l.organization_id]);
    const s = r ? await this.subject(String(r.id), String(l.organization_id)) : { render: undefined, reel: undefined, staleTargets: 0, grant: undefined };
    const reasons = [...linkReasons, ...decide(s, !!Number(l.can_download))];
    await this.db.rows("INSERT INTO share_link_access (share_link_id, actor_id, action, decision, ip_hash) VALUES (?, NULL, 'VIEW', ?, ?)", [l.id, reasons.length ? "DENY" : "ALLOW", ipHash]);
    await this.recordDecision(undefined, String(l.organization_id), "VIEW", "share_link", String(l.id), null, reasons, s.grant ? String(s.grant.id) : null);
    if (reasons.length) throw new ApiError(410, "SHARE_UNAVAILABLE", reasons.includes("LINK_REVOKED") || reasons.includes("LINK_EXPIRED") ? explain(reasons.filter((x) => x.startsWith("LINK_")))
      : "This video can no longer be shared.");
    const player = s.reel?.player_id ? await this.db.one<RowDataPacket>("SELECT display_name FROM v_player_identity WHERE player_id = ?", [s.reel.player_id]) : undefined;
    const asset = await this.db.one<RowDataPacket>("SELECT mime_type FROM assets WHERE id = ?", [l.asset_id]);
    const watch = this.analysis.signedUrl(String(l.asset_id), String(l.organization_id), false, SHARE_VIDEO_TTL_S);
    return SharedView.parse({ title: String(s.reel?.name ?? "Highlight reel"), player_name: player?.display_name ?? null, url: watch.url,
      download_url: Number(l.can_download) ? this.analysis.signedUrl(String(l.asset_id), String(l.organization_id), true, SHARE_VIDEO_TTL_S).url : null,
      mime: asset?.mime_type ?? null, link_expires_at: iso(l.expires_at),
      notice: "Shared from OTSI VIE. Development output: commercial distribution is not activated.",
      can_comment: !!Number(l.can_comment), comments: Number(l.can_comment) ? await this.linkComments(String(l.id)) : [] });
  }

  /** A comment through a link: everything opening checks, then the link must allow comments; at most COMMENT_LIMIT an hour per link. */
  async comment(token: string, ip: string | undefined, body: PostSharedCommentRequest): Promise<SharedComment[]> {
    await this.open(token, ip, body.password);
    const l = (await this.db.one<RowDataPacket>("SELECT id, organization_id, asset_id, can_comment FROM share_links WHERE token_hash = ?", [sha256(token)]))!;
    if (!Number(l.can_comment)) throw new ApiError(403, "COMMENTS_OFF", "This link does not take comments.");
    const recent = await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n FROM comments WHERE share_link_id = ? AND created_at > CURRENT_TIMESTAMP(6) - INTERVAL 1 HOUR", [l.id]);
    if (Number(recent?.n ?? 0) >= COMMENT_LIMIT) throw new ApiError(429, "TOO_MANY_COMMENTS", "Too many comments on this link in the last hour. Try again later.");
    const reel = await this.db.one<RowDataPacket>(
      "SELECT r.id, r.project_id FROM render_jobs j JOIN reel_projects r ON r.id = j.reel_id WHERE j.output_asset_id = ? AND j.organization_id = ?", [l.asset_id, l.organization_id]);
    await this.db.rows("INSERT INTO comments (id, organization_id, project_id, reel_id, author_id, share_link_id, guest_name, body, at_pts_us) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)",
      [uuidv7(), l.organization_id, reel?.project_id ?? null, reel?.id ?? null, l.id, body.name, body.body, body.at_s === null ? null : Math.round(body.at_s * 1e6)]);
    return this.linkComments(String(l.id));
  }

  /** the team reads a link's comments */
  async teamComments(linkId: string, p: Principal): Promise<SharedComment[]> {
    const l = await this.db.one<RowDataPacket>("SELECT id FROM share_links WHERE id = ? AND organization_id = ?", [linkId, p.organizationId]);
    if (!l) throw notFound("Share link");
    return this.linkComments(linkId);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class SharingController {
  constructor(private readonly sharing: SharingService) {}

  @Get("videos/:id/rights")
  rights(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.sharing.rights(uuidParam(id, "Video"), p); }

  @Post("videos/:id/rights")
  @Roles("OWNER", "ADMIN")
  recordRights(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.sharing.recordRights(uuidParam(id, "Video"), RecordRightsRequest.parse(body ?? {}), p);
  }

  @Post("videos/:id/rights/declaration")
  @Roles(...PROJECT_WRITERS)
  declare(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.sharing.declare(uuidParam(id, "Video"), UploadRights.parse(body ?? {}), p);
  }

  @Post("renders/:id/share-links")
  @Roles(...PROJECT_WRITERS)
  create(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.sharing.create(uuidParam(id, "Render"), CreateShareLinkRequest.parse(body ?? {}), p);
  }

  @Get("renders/:id/share-links")
  list(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.sharing.list(uuidParam(id, "Render"), p); }

  @Post("reports/:id/share-links")
  @Roles(...PROJECT_WRITERS)
  createForReport(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.sharing.createForReport(uuidParam(id, "Report"), CreateReportShareLinkRequest.parse(body ?? {}), p);
  }

  @Get("reports/:id/share-links")
  listForReport(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.sharing.listForReport(uuidParam(id, "Report"), p); }

  @Get("share-links/:id/comments")
  comments(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.sharing.teamComments(uuidParam(id, "Share link"), p); }

  @Delete("share-links/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async revoke(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.sharing.revoke(uuidParam(id, "Share link"), p); }
}

/** No AuthGuard: the 256-bit link token is the authorisation (only its hash is stored); the sharing rule runs again on every opening. */
@Controller("v1/public")
export class PublicShareController {
  constructor(private readonly sharing: SharingService) {}

  @Get("share/:token")
  open(@Param("token") token: string, @Req() req: FastifyRequest) { return this.sharing.open(token, req.ip); }

  @Post("share/:token/open")
  @HttpCode(200)
  openWithPassword(@Param("token") token: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    return this.sharing.open(token, req.ip, OpenShareRequest.parse(body ?? {}).password);
  }

  @Post("share/:token/comments")
  @HttpCode(201)
  comment(@Param("token") token: string, @Body() body: unknown, @Req() req: FastifyRequest) {
    return this.sharing.comment(token, req.ip, PostSharedCommentRequest.parse(body ?? {}));
  }
}
