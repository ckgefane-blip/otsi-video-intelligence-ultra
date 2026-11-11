/**
 * Single Match Spotlight + Scouting Pack (ADR-142, ultra-only; Roadmap Phase 4, Option B, Nigeria first).
 *
 *   POST /v1/players/:playerId/scouting-packs            build one Pack for the player's reel (10 tokens)
 *   GET  /v1/players/:playerId/scouting-packs            the player's Packs, newest first, with download links
 *   GET  /v1/players/:playerId/scouting-packs/:packId    one Pack, with its manifest
 *
 * A Pack is the paid offer as ONE named export bundle: the highlight reel (Player Profile Intro first, then the
 * moments per Best Moment Rule v2.1), the player report, and the AI Analyst brief — as one ZIP with a manifest.
 * The reel source is read from the reel and recorded: a MATCH reel is a Single Match Spotlight (one reel + one
 * report for one match); an ALL_MATCHES reel is the same bundle over a cross-match reel (all matches).
 *
 * Cost (ADR-140, Token Wallet scope): a Pack is an export pack — 10 tokens, charged at enqueue in the same
 * transaction as the Pack row, so a Pack that fails to start charges nothing. The pieces inside the Pack are
 * covered by that one charge and are never charged again: the report is made with charge: false (the ADR-140
 * export-pack pattern from modules/exports), the brief is a read of an already-paid assessment, and the reel is
 * an already-rendered file. A Pack whose build fails after the charge is auto-refunded (WalletService
 * refundForJob, EXPORT_PACK) and left FAILED.
 *
 * Honesty (ADR-124, ADR-141 Rule 4): the manifest is built by buildScoutingPackManifest in contracts — it
 * stamps the Best Moment Rule version and says what is inside and what is not, with why. The Analyst brief
 * reaches the ZIP ONLY through the Piece 3 hook publishedScoutBriefForPack: a draft is recorded as EXCLUDED
 * ("AI Analyst brief: not included (draft, not published)") and never written into the ZIP. A report that
 * cannot be made does not stop the Pack: it is recorded FAILED with its reason, like one companion failing in
 * an export bundle (ADR-058). Nothing is invented anywhere in the Pack.
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { buildScoutingPackManifest, CreateScoutingPackRequest, publishedScoutBriefForPack, SCOUTING_PACK_COST_TOKENS, ScoutingPack, ScoutingPackManifest,
  TOKEN_COSTS, type AiAnalystAssessment, type Reel, type ScoutingPackReelSource } from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { AiAnalystService } from "../aianalyst/aianalyst";
import { AnalysisService } from "../analysis/analysis";
import { writeZip } from "../exports/exports";
import { PlayerReportService } from "../playerreport/playerreport";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { ReelsService } from "../reels/reels";
import { WalletService } from "../wallet/wallet";

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
/** A MySQL JSON column arrives as an object or a string depending on the driver: accept both. */
function asJson<T>(v: unknown): T {
  if (typeof v === "string") return JSON.parse(v) as T;
  return v as T;
}

async function sha256File(file: string): Promise<string> {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest("hex");
}

@Injectable()
export class ScoutingPackService {
  private readonly store: LocalStore | null;
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db, @Inject(ReelsService) private readonly reels: ReelsService,
              @Inject(PlayerReportService) private readonly reports: PlayerReportService,
              @Inject(AiAnalystService) private readonly analyst: AiAnalystService,
              @Inject(AnalysisService) private readonly analysis: AnalysisService,
              @Inject(WalletService) private readonly wallet: WalletService) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private needStore(): LocalStore {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return this.store;
  }

  /** the reel's newest finished render with a file (the same rule as the export bundles: the Pack belongs to it) */
  private async finishedRender(reelId: string, p: Principal) {
    const r = await this.db.one<RowDataPacket>(
      `SELECT j.id, j.output_asset_id, a.object_key, a.byte_size, a.mime_type, a.sha256 FROM render_jobs j JOIN assets a ON a.id = j.output_asset_id
        WHERE j.reel_id = ? AND j.organization_id = ? AND j.state = 'SUCCEEDED' AND j.removed_at IS NULL ORDER BY j.completed_at DESC, j.created_at DESC LIMIT 1`, [reelId, p.organizationId]);
    return r ?? null;
  }

  /** match titles for the manifest: one match for a Spotlight, every match the cross-match reel spans */
  private async matchTitles(reel: Reel, p: Principal): Promise<string[]> {
    if (reel.source !== "ALL_MATCHES") {
      const m = reel.match as { home?: string; away?: string; competition?: string } | null;
      if (m?.home && m?.away) return [`${m.home} vs ${m.away}${m.competition ? ` · ${m.competition}` : ""}`];
      if (reel.video_id) {
        const v = await this.db.one<RowDataPacket>("SELECT title FROM video_sources WHERE id = ? AND organization_id = ?", [reel.video_id, p.organizationId]);
        if (v?.title) return [String(v.title)];
      }
      return [reel.name];
    }
    const ids = [...new Set(reel.clips.map((c) => c.source_video_id))];
    if (!ids.length) return [reel.name];
    const rows = await this.db.rows<RowDataPacket>("SELECT title FROM video_sources WHERE id IN (?) AND organization_id = ?", [ids, p.organizationId]);
    const titles = rows.map((r) => String(r.title)).filter(Boolean);
    return titles.length ? titles : [reel.name];
  }

  /** the player's latest Analyst assessment, or null when there is none (a missing assessment is not an error:
   *  the manifest records the brief as excluded with its reason) */
  private async latestAssessment(playerId: string, p: Principal): Promise<AiAnalystAssessment | null> {
    try {
      return await this.analyst.latest(playerId, p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  private async rowToPack(r: RowDataPacket): Promise<ScoutingPack> {
    const manifest = ScoutingPackManifest.parse(asJson(r.manifest));
    const zipBytes = r.zip_asset_id ? Number(r.zip_bytes ?? 0) : null;
    return ScoutingPack.parse({
      id: r.id, player_id: r.player_id, reel_id: r.reel_id, reel_source: r.reel_source, state: r.state,
      manifest, cost_tokens: SCOUTING_PACK_COST_TOKENS, requested_by_name: r.display_name ?? "",
      created_at: iso(r.created_at), completed_at: iso(r.completed_at),
      zip: r.zip_asset_id && zipBytes !== null
        ? { bytes: zipBytes, download_url: this.analysis.signedUrl(String(r.zip_asset_id), String(r.organization_id), true).url }
        : null,
    });
  }

  private async loadRow(packId: string, playerId: string, p: Principal): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT sp.*, u.display_name, z.byte_size AS zip_bytes FROM scouting_packs sp JOIN users u ON u.id = sp.requested_by
        LEFT JOIN assets z ON z.id = sp.zip_asset_id WHERE sp.id = ? AND sp.player_id = ? AND sp.organization_id = ?`,
      [packId, playerId, p.organizationId]);
    if (!r) throw notFound("Scouting Pack");
    return r;
  }

  async create(playerId: string, body: unknown, p: Principal): Promise<ScoutingPack> {
    const req = CreateScoutingPackRequest.parse(body ?? {});
    const store = this.needStore();
    const reel = await this.reels.get(req.reel_id, p);
    if (!reel.player || reel.player.player_id !== playerId) {
      throw new ApiError(409, "PLAYER_MISMATCH", "This reel is not the player's reel: a Scouting Pack is built for one player and his own reel.");
    }
    // No charge before the Pack can exist: an unrendered reel is refused before any token moves.
    const render = await this.finishedRender(req.reel_id, p);
    if (!render) throw new ApiError(409, "NOT_RENDERED", "Render the reel first: the Scouting Pack holds the finished reel file.");
    const reelSource: ScoutingPackReelSource = reel.source === "ALL_MATCHES" ? "CROSS_MATCH" : "SINGLE_MATCH";
    const titles = await this.matchTitles(reel, p);
    const assessment = await this.latestAssessment(playerId, p);
    const base = {
      player_id: playerId, display_name: reel.player.display_name, otsi_pin: reel.player.canonical_otsi_id,
      reel_id: reel.id, reel_name: reel.name, reel_source: reelSource, match_titles: titles, reel_rendered: true,
      include_report: req.include_report, include_analyst_brief: req.include_analyst_brief, analyst_assessment: assessment,
    };
    const id = uuidv7();
    // ADR-140: 10 tokens at enqueue, in the same transaction as the Pack row — a Pack that fails to start
    // charges nothing. The pieces inside are covered by this charge, never charged again.
    const planned = buildScoutingPackManifest({ ...base, report: { state: "INCLUDED", reason: null } });
    await this.db.tx(async (c) => {
      await this.wallet.charge(c, p.organizationId, p.userId, { type: "EXPORT_PACK", id, amount: TOKEN_COSTS.exportPack, reason: `Scouting Pack for ${reel.player!.display_name} (${reelSource === "SINGLE_MATCH" ? "Single Match Spotlight" : "all matches"}; 10 tokens).` });
      await c.query(`INSERT INTO scouting_packs (id, organization_id, player_id, reel_id, reel_source, state, manifest, cost_tokens, requested_by)
                     VALUES (?, ?, ?, ?, ?, 'CREATED', ?, ?, ?)`,
        [id, p.organizationId, playerId, reel.id, reelSource, JSON.stringify(planned), SCOUTING_PACK_COST_TOKENS, p.userId]);
    });
    try {
      // the report: made fresh for the Pack, covered by the Pack's 10 tokens (charge: false — ADR-140).
      // A report that cannot be made does not stop the Pack: it is recorded FAILED with its reason.
      let reportFile: { name: string; path: string } | null = null;
      let reportState: { state: "INCLUDED" | "NOT_MEASURED" | "FAILED"; reason: string | null } = { state: "INCLUDED", reason: null };
      if (req.include_report) {
        try {
          const job = await this.reports.makeReport(playerId, p, undefined, { charge: false });
          const a = await this.db.one<RowDataPacket>("SELECT a.id, a.object_key FROM report_jobs j JOIN assets a ON a.id = j.output_asset_id WHERE j.id = ?", [job.id]);
          if (!a?.object_key) throw new Error("The report has no file.");
          reportFile = { name: "player-report.pdf", path: store.resolve(String(a.object_key)) };
        } catch (e) {
          reportState = { state: "FAILED", reason: (e instanceof ApiError ? e.message : "The player report could not be made.").slice(0, 255) };
        }
      }
      // the brief: ONLY through the Piece 3 hook — a draft (or no assessment) yields null, so nothing is
      // written into the ZIP and the manifest records why.
      const brief = assessment ? publishedScoutBriefForPack(assessment) : null;
      const briefData = brief ? Buffer.from(JSON.stringify({
        player: reel.player.display_name, otsi_pin: reel.player.canonical_otsi_id,
        published_by: assessment!.published_by_name, published_at: assessment!.published_at, brief,
      }, null, 2), "utf8") : null;
      const manifest = buildScoutingPackManifest({ ...base, report: reportState });
      const ext = render.mime_type === "video/webm" ? "webm" : "mp4";
      const renderFile = store.resolve(String(render.object_key));
      const files: { name: string; path?: string; data?: Buffer }[] = [{ name: `reel.${ext}`, path: renderFile }];
      if (reportFile) files.push(reportFile);
      if (briefData) files.push({ name: "ai-analyst-brief.json", data: briefData });
      files.push({ name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") });
      const key = `org/${p.organizationId}/scouting-packs/${id}/scouting-pack.zip`, file = store.resolve(key), assetId = uuidv7();
      await mkdir(path.dirname(file), { recursive: true });
      const { bytes } = await writeZip(file, files);
      const sha = await sha256File(file);
      await this.db.tx(async (c) => {
        await c.query(`INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
                       SELECT ?, ?, project_id, 'BUNDLE', ?, 'local', ?, ?, 'application/zip', ?, ? FROM reel_projects WHERE id = ?`,
          [assetId, p.organizationId, key, bytes, sha, p.userId, JSON.stringify({ scouting_pack_id: id, filename: "scouting-pack.zip" }), reel.id]);
        await c.query("UPDATE scouting_packs SET state = 'READY', manifest = ?, zip_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
          [JSON.stringify(manifest), assetId, id]);
        await recordChange(c, userActor(p), { action: "scouting_pack.created", entityType: "player", entityId: playerId,
          after: { pack_id: id, reel_id: reel.id, reel_source: reelSource, cost_tokens: SCOUTING_PACK_COST_TOKENS, report: reportState.state, brief_included: !!brief } });
      });
    } catch (e) {
      // the build failed after the charge: return the 10 tokens and leave the Pack FAILED, never half-built.
      await this.db.tx(async (c) => {
        await this.wallet.refundForJob(c, p.organizationId, p.userId,
          { type: "EXPORT_PACK", id, reason: `Scouting Pack for ${playerId} could not be built, so its tokens were returned.` });
        await c.query("UPDATE scouting_packs SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [id]);
      });
      throw e;
    }
    return this.get(playerId, id, p);
  }

  async list(playerId: string, p: Principal): Promise<ScoutingPack[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT sp.*, u.display_name, z.byte_size AS zip_bytes FROM scouting_packs sp JOIN users u ON u.id = sp.requested_by
        LEFT JOIN assets z ON z.id = sp.zip_asset_id WHERE sp.player_id = ? AND sp.organization_id = ? ORDER BY sp.created_at DESC LIMIT 20`,
      [playerId, p.organizationId]);
    return Promise.all(rows.map((r) => this.rowToPack(r)));
  }

  async get(playerId: string, packId: string, p: Principal): Promise<ScoutingPack> {
    return this.rowToPack(await this.loadRow(packId, playerId, p));
  }
}

@Controller("v1/players")
@UseGuards(AuthGuard)
export class ScoutingPackController {
  constructor(private readonly svc: ScoutingPackService) {}

  @Post(":playerId/scouting-packs")
  @HttpCode(201)
  @Roles(...PROJECT_WRITERS)
  create(@Param("playerId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.svc.create(uuidParam(id, "Player"), body, p);
  }

  @Get(":playerId/scouting-packs")
  list(@Param("playerId") id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.list(uuidParam(id, "Player"), p);
  }

  @Get(":playerId/scouting-packs/:packId")
  get(@Param("playerId") id: string, @Param("packId") pack: string, @CurrentPrincipal() p: Principal) {
    return this.svc.get(uuidParam(id, "Player"), uuidParam(pack, "Scouting Pack"), p);
  }
}
