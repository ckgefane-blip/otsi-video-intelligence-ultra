/**
 * Broadcast lineup cards (ADR-039, migration 0029).
 *
 *   GET  /v1/videos/:id/lineups            the latest read of the video and the cards it found (team, coach, numbers, names, roles)
 *   POST /v1/videos/:id/lineups            read the video's lineup cards again (writers) -> a READ_LINEUPS job (202); the engine also does it
 *                                          by itself when an analysis finishes (outbox subscriber jobs.auto_lineups)
 *   GET  /v1/lineup-cards/:id/image        the card's frame (JPEG), for the person who approves it
 *   POST /v1/videos/:id/lineups/apply      a person's approval (writers): the cards as corrected become the match roster. Without a linked
 *                                          match, the home and the away card create the clubs (or find them by name) and the match; each
 *                                          row finds its player in the registry by exact name, or creates a provisional player (no OTSI
 *                                          Player ID until registered); the roster gets the shirt number and the role
 *   POST /v1/lineup-cards/:id/dismiss      not a lineup / not this match (writers)
 *
 * Nothing names a track here: shirt numbers read on players then propose roster players (identity evidence), and a person confirms.
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Res, UseGuards } from "@nestjs/common";
import { AppliedLineups, ApplyLineups, LineupCard, Lineups, nameKey } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { MatchesService } from "../matches/matches";
import { uuidParam } from "../players/players.controller";
import { PlayersService } from "../players/players.service";
import { PROJECT_WRITERS } from "../projects/projects";

const json = <T>(v: unknown, d: T): T => (v === null || v === undefined ? d : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

@Injectable()
export class LineupsService {
  private readonly store: LocalStore | null;

  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db, private readonly matches: MatchesService, private readonly players: PlayersService) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private async video(id: string, p: Principal): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id, state, match_id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  async list(videoId: string, p: Principal): Promise<Lineups> {
    const v = await this.video(videoId, p);
    const r = await this.db.one<RowDataPacket>(
      `SELECT l.*, (SELECT j.progress FROM worker_jobs j WHERE j.organization_id = l.organization_id AND j.subject_type = 'lineup_read' AND j.subject_id = l.id ORDER BY j.created_at DESC LIMIT 1) AS progress,
              (SELECT j.stage_message FROM worker_jobs j WHERE j.organization_id = l.organization_id AND j.subject_type = 'lineup_read' AND j.subject_id = l.id ORDER BY j.created_at DESC LIMIT 1) AS stage_message
         FROM lineup_reads l WHERE l.video_id = ? AND l.organization_id = ? ORDER BY l.created_at DESC LIMIT 1`, [videoId, p.organizationId]);
    const cards = r ? await this.db.rows<RowDataPacket>("SELECT * FROM lineup_cards WHERE read_id = ? ORDER BY pts_us", [r.id]) : [];
    return Lineups.parse({
      video_id: videoId, match_id: v.match_id ?? null,
      read: r ? { id: r.id, status: r.status, automatic: r.requested_by === null, progress: r.progress === null ? null : Number(r.progress),
        stage_message: r.stage_message ?? null, metrics: json(r.metrics, null), failure_detail: r.failure_detail ?? null } : null,
      cards: cards.map((c) => LineupCard.parse({ id: c.id, pts_us: Number(c.pts_us), team_name: c.team_name ?? null, coach_name: c.coach_name ?? null,
        entries: json(c.entries, []), has_image: !!c.frame_asset_id, state: c.state, applied_match_id: c.applied_match_id ?? null, applied_club_id: c.applied_club_id ?? null })),
    });
  }

  async start(videoId: string, p: Principal): Promise<Lineups> {
    const v = await this.video(videoId, p);
    if (v.state !== "INGESTED") throw new ApiError(409, "VIDEO_NOT_READY", "Only a verified video can be read.");
    const open = await this.db.one<RowDataPacket>("SELECT id FROM lineup_reads WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING')", [videoId, p.organizationId]);
    if (open) throw new ApiError(409, "LINEUPS_BEING_READ", "The engine is already reading this video's lineups.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO lineup_reads (id, organization_id, video_id, requested_by) VALUES (?, ?, ?, ?)", [id, p.organizationId, videoId, p.userId]);
      await recordChange(c, userActor(p), { action: "video.lineups_requested", entityType: "video", entityId: videoId, after: { lineup_read_id: id },
        event: { eventType: "video.lineups_requested", payload: { lineup_read_id: id, video_id: videoId }, dedupeKey: `lineups:${id}` } });
    });
    return this.list(videoId, p);
  }

  async image(cardId: string, p: Principal): Promise<{ path: string; bytes: number }> {
    const a = await this.db.one<RowDataPacket>(
      `SELECT a.object_key, a.byte_size FROM lineup_cards c JOIN assets a ON a.id = c.frame_asset_id AND a.organization_id = c.organization_id
        WHERE c.id = ? AND c.organization_id = ?`, [cardId, p.organizationId]);
    if (!a) throw notFound("Lineup card image");
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return { path: this.store.resolve(a.object_key as string), bytes: Number(a.byte_size) };
  }

  async dismiss(cardId: string, p: Principal): Promise<void> {
    const c = await this.db.one<RowDataPacket>("SELECT id, video_id, state FROM lineup_cards WHERE id = ? AND organization_id = ?", [cardId, p.organizationId]);
    if (!c) throw notFound("Lineup card");
    if (c.state === "APPLIED") throw new ApiError(409, "LINEUP_ALREADY_APPLIED", "This card is already the match roster; change the roster there.");
    await this.db.tx(async (x) => {
      await x.query("UPDATE lineup_cards SET state = 'DISMISSED', decided_by = ?, decided_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [p.userId, cardId]);
      await recordChange(x, userActor(p), { action: "video.lineup_dismissed", entityType: "video", entityId: c.video_id, after: { card_id: cardId } });
    });
  }

  /** the club of that exact name in the caller's organization, or a new one */
  private async club(name: string, p: Principal): Promise<string> {
    const hit = await this.db.one<RowDataPacket>("SELECT id FROM clubs WHERE created_by_organization_id = ? AND LOWER(canonical_name) = LOWER(?)", [p.organizationId, name]);
    if (hit) return hit.id as string;
    return (await this.matches.createClub({ name }, p)).id;
  }

  async apply(videoId: string, body: ApplyLineups, p: Principal): Promise<AppliedLineups> {
    const v = await this.video(videoId, p);
    const sides = new Set(body.cards.map((c) => c.side));
    if (sides.size !== body.cards.length) throw new ApiError(422, "ONE_CARD_PER_SIDE", "Give one card for the home team and one for the away team.");
    const rows = await this.db.rows<RowDataPacket>(`SELECT id, state FROM lineup_cards WHERE video_id = ? AND organization_id = ? AND id IN (${body.cards.map(() => "?").join(",")})`,
      [videoId, p.organizationId, ...body.cards.map((c) => c.card_id)]);
    if (rows.length !== body.cards.length) throw notFound("Lineup card");
    let match = v.match_id ? await this.matches.get(v.match_id as string, p) : null;
    const clubOf: Record<string, string> = {};
    if (match) {
      if (!match.home || !match.away) throw new ApiError(409, "MATCH_WITHOUT_TEAMS", "The linked match has no home and away team.");
      clubOf.HOME = match.home.id; clubOf.AWAY = match.away.id;
    } else {
      if (sides.size !== 2) throw new ApiError(422, "BOTH_TEAMS_NEEDED", "This video has no match yet: approve the home and the away card together to create it.");
      for (const c of body.cards) clubOf[c.side] = await this.club(c.team_name, p);
      if (clubOf.HOME === clubOf.AWAY) throw new ApiError(422, "SAME_TEAM_TWICE", "Home and away are the same team name.");
      match = await this.matches.create({ home_club_id: clubOf.HOME!, away_club_id: clubOf.AWAY!, video_id: videoId }, p);
    }
    const out: AppliedLineups["rows"] = [];
    for (const card of body.cards) {
      for (const e of card.entries) {
        try {
          const taken = await this.db.one<RowDataPacket>(
            `SELECT pi.display_name FROM match_rosters r JOIN v_player_identity pi ON pi.player_id = r.player_id
              WHERE r.match_id = ? AND r.club_id = ? AND r.jersey_number = ? AND LOWER(pi.display_name) <> LOWER(?)`, [match.id, clubOf[card.side], e.number, e.name]);
          if (taken) {                                       // checked before a player is created, so a clash leaves nothing behind
            out.push({ card_id: card.card_id, number: e.number, name: e.name, player_id: null, outcome: "FAILED",
              message: `No. ${e.number} of this team is already ${taken.display_name} in this match: correct the number or the roster.` });
            continue;
          }
          const found = await this.db.rows<RowDataPacket>(
            `SELECT player_id FROM v_player_identity WHERE LOWER(display_name) = LOWER(?) AND own_state NOT IN ('MERGED', 'RETIRED')
               AND (own_state <> 'PROVISIONAL' OR created_by_organization_id = ?) LIMIT 2`, [e.name, p.organizationId]);
          let playerId: string, outcome: "FOUND" | "CREATED", note: string | null = null;
          if (!found.length) {                               // the same name in another alphabet or spelling (ЧИНАЗОМ ГОДВИН = Chinazom Godwin)
            const k = nameKey(e.name);
            const all = await this.db.rows<RowDataPacket>(
              `SELECT player_id, display_name FROM v_player_identity WHERE own_state NOT IN ('MERGED', 'RETIRED') AND (own_state <> 'PROVISIONAL' OR created_by_organization_id = ?)`,
              [p.organizationId]);
            const same = all.filter((x) => nameKey(String(x.display_name)) === k);
            if (same.length === 1) { found.push(same[0]!); note = `same name as registered player ${same[0]!.display_name}`; }
            else if (same.length > 1) found.push(...same);
          }
          if (found.length === 1) { playerId = found[0]!.player_id as string; outcome = "FOUND"; }
          else if (found.length > 1) { out.push({ card_id: card.card_id, number: e.number, name: e.name, player_id: null, outcome: "FAILED", message: "Two registered players have this name: add the right one from the roster panel." }); continue; }
          else {                                            // retrying the same approval finds the same new player (key: card, number, name)
            const k = `lineup:${card.card_id}:${e.number}:${e.name.toLowerCase().replace(/\s+/g, " ")}`.slice(0, 120);
            playerId = (await this.players.create({ display_name: e.name }, k, p)).player.player_id; outcome = "CREATED";
          }
          match = await this.matches.upsertRoster(match.id, { player_id: playerId, club_id: clubOf[card.side]!, jersey_number: e.number, role: e.role, position: null, captain: false,
            reason: "from the broadcast lineup card (ADR-039)" }, p);
          out.push({ card_id: card.card_id, number: e.number, name: e.name, player_id: playerId, outcome, message: note });
        } catch (x) {
          out.push({ card_id: card.card_id, number: e.number, name: e.name, player_id: null, outcome: "FAILED", message: x instanceof ApiError ? x.message : "Not added." });
        }
      }
      await this.db.tx(async (c) => {
        await c.query("UPDATE lineup_cards SET state = 'APPLIED', applied_match_id = ?, applied_club_id = ?, decided_by = ?, decided_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
          [match!.id, clubOf[card.side], p.userId, card.card_id]);
        await recordChange(c, userActor(p), { action: "video.lineup_applied", entityType: "video", entityId: videoId,
          after: { card_id: card.card_id, match_id: match!.id, club_id: clubOf[card.side], rows: card.entries.length } });
      });
    }
    return AppliedLineups.parse({ match: await this.matches.get(match.id, p), rows: out });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class LineupsController {
  constructor(private readonly lineups: LineupsService) {}

  @Get("videos/:id/lineups")
  list(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.lineups.list(uuidParam(id, "Video"), p); }

  @Post("videos/:id/lineups")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  start(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.lineups.start(uuidParam(id, "Video"), p); }

  @Post("videos/:id/lineups/apply")
  @Roles(...PROJECT_WRITERS)
  apply(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.lineups.apply(uuidParam(id, "Video"), ApplyLineups.parse(body ?? {}), p); }

  @Get("lineup-cards/:id/image")
  async image(@Param("id") id: string, @CurrentPrincipal() p: Principal, @Res() res: FastifyReply) {
    const f = await this.lineups.image(uuidParam(id, "Lineup card"), p);
    void res.header("content-type", "image/jpeg").header("content-length", f.bytes).header("cache-control", "private, max-age=3600").send(createReadStream(f.path));
  }

  @Post("lineup-cards/:id/dismiss")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async dismiss(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.lineups.dismiss(uuidParam(id, "Lineup card"), p); }
}
