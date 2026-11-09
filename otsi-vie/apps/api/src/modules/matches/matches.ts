/**
 * Clubs, matches and match rosters (Block 07, ADR-033).
 *
 *   GET  /v1/clubs?q=                       clubs this organization can use (its own and shared ones)
 *   POST /v1/clubs                          create a club (visible to this organization)
 *   POST /v1/matches                        create a match (home and away club; optionally link a video)
 *   GET  /v1/matches                        the organization's matches;   GET /v1/matches/:id   one match with its roster
 *   PATCH /v1/matches/:id                   details and score (optimistic concurrency)
 *   POST /v1/videos/:id/match               link a video to a match
 *   POST /v1/matches/:id/roster             add or change a roster entry (shirt number, starter/substitute, position, captain)
 *   DELETE /v1/matches/:id/roster/:playerId remove an entry (reason required once the roster is verified)
 *   POST /v1/matches/:id/roster/verify      mark the roster verified / unverified; verifying records each player's club and number for
 *                                           the match date in the player's own history (clubs and numbers change; the OTSI Player ID never)
 *   GET  /v1/matches/:id/roster/history     every roster change, append-only
 *
 * A roster entry links a player record to a match; a shirt number is the player's clothing in that match, never an identity.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { Club, CreateClubRequest, CreateMatchRequest, Match, RosterChange, RosterUpsertRequest, UpdateMatchRequest } from "@otsi-vie/contracts";
import { PoolConnection, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { matchNotHidden, notHidden } from "../../core/access";
import { Db, Executor } from "../../core/db";
import { ApiError, fromDatabase, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const toClub = (r: RowDataPacket | undefined | null, org: string): Club | null =>
  r && r.id ? Club.parse({ id: r.id, name: r.canonical_name, short_name: r.short_name ?? null, shared: r.created_by_organization_id !== org }) : null;

@Injectable()
export class MatchesService {
  constructor(private readonly db: Db) {}

  /** a club this organization may use: its own, or a shared (not organization-owned) record */
  async club(id: string, p: Principal, ex: Executor = this.db.pool): Promise<RowDataPacket> {
    const c = await this.db.one<RowDataPacket>("SELECT * FROM clubs WHERE id = ? AND (created_by_organization_id IS NULL OR created_by_organization_id = ?)", [id, p.organizationId], ex);
    if (!c) throw notFound("Club");
    return c;
  }

  async clubs(q: string | undefined, p: Principal): Promise<Club[]> {
    const term = (q ?? "").trim();
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT * FROM clubs WHERE (created_by_organization_id IS NULL OR created_by_organization_id = ?)${term ? " AND canonical_name LIKE ?" : ""}
        ORDER BY canonical_name LIMIT 50`, term ? [p.organizationId, `${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`] : [p.organizationId]);
    return rows.map((r) => toClub(r, p.organizationId)!);
  }

  async createClub(body: CreateClubRequest, p: Principal): Promise<Club> {
    const dup = await this.db.one<RowDataPacket>("SELECT id FROM clubs WHERE created_by_organization_id = ? AND canonical_name = ?", [p.organizationId, body.name]);
    if (dup) throw new ApiError(409, "CLUB_EXISTS", "Your organization already has a club with that name.");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO clubs (id, canonical_name, short_name, created_by_organization_id) VALUES (?, ?, ?, ?)", [id, body.name, body.short_name ?? null, p.organizationId]);
      await recordChange(c, userActor(p), { action: "club.created", entityType: "club", entityId: id, after: { name: body.name } });
    });
    return toClub(await this.club(id, p), p.organizationId)!;
  }

  private async matchRow(id: string, p: Principal, ex: Executor = this.db.pool, lock = false): Promise<RowDataPacket> {
    const m = await this.db.one<RowDataPacket>(`SELECT * FROM matches WHERE id = ? AND organization_id = ? AND removed_at IS NULL${lock ? " FOR UPDATE" : ""}`, [id, p.organizationId], ex);
    if (!m) throw notFound("Match");
    return m;
  }

  async create(body: CreateMatchRequest, p: Principal): Promise<Match> {
    await this.club(body.home_club_id, p);
    await this.club(body.away_club_id, p);
    if (body.video_id) await this.videoOf(body.video_id, p);
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO matches (id, organization_id, competition, season, kickoff_at, venue, home_club_id, away_club_id, metadata_state, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)`,
        [id, p.organizationId, body.competition ?? null, body.season ?? null, body.kickoff_at ? new Date(body.kickoff_at) : null, body.venue ?? null,
         body.home_club_id, body.away_club_id, p.userId]);
      if (body.video_id) await c.query("UPDATE video_sources SET match_id = ? WHERE id = ? AND organization_id = ?", [id, body.video_id, p.organizationId]);
      await recordChange(c, userActor(p), { action: "match.created", entityType: "match", entityId: id, after: { ...body },
        event: { eventType: "match.created", payload: { match_id: id } } });
    });
    return this.get(id, p);
  }

  async list(p: Principal): Promise<Match[]> {
    const rows = await this.db.rows<RowDataPacket>(`SELECT id FROM matches WHERE organization_id = ? AND removed_at IS NULL${matchNotHidden(p, "matches.id")} ORDER BY COALESCE(kickoff_at, created_at) DESC LIMIT 200`, [p.organizationId]);
    return Promise.all(rows.map((r) => this.get(r.id as string, p)));
  }

  /** Library › Delete (owner 2026-11-05, migration 0038): a match with no video leaves every list (its team sheets stay with it, kept for
   *  the audit); one that a video is linked to is refused, so no analysis, identity or reel loses its match. */

  async get(id: string, p: Principal): Promise<Match> {
    const m = await this.matchRow(id, p);
    const clubs = await this.db.rows<RowDataPacket>("SELECT * FROM clubs WHERE id IN (?, ?)", [m.home_club_id ?? "", m.away_club_id ?? ""]);
    const byId = new Map(clubs.map((c) => [c.id as string, c]));
    const videos = await this.db.rows<RowDataPacket>(`SELECT id FROM video_sources v WHERE match_id = ? AND organization_id = ?${notHidden(p, "v.project_id")}`, [id, p.organizationId]);
    const roster = await this.db.rows<RowDataPacket>(
      `SELECT r.*, pi.display_name, pi.canonical_otsi_id FROM match_rosters r JOIN v_player_identity pi ON pi.player_id = r.player_id
        WHERE r.match_id = ? ORDER BY r.club_id = ? DESC, r.role, r.jersey_number IS NULL, r.jersey_number, pi.display_name`, [id, m.home_club_id ?? ""]);
    return Match.parse({
      id: m.id, competition: m.competition, season: m.season, kickoff_at: m.kickoff_at ? new Date(m.kickoff_at).toISOString() : null, venue: m.venue,
      home: toClub(byId.get(m.home_club_id), p.organizationId), away: toClub(byId.get(m.away_club_id), p.organizationId),
      home_score: m.home_score, away_score: m.away_score, version: Number(m.version), video_ids: videos.map((v) => v.id),
      roster: roster.map((r) => ({ player_id: r.player_id, display_name: r.display_name, canonical_otsi_id: r.canonical_otsi_id, club_id: r.club_id,
        jersey_number: r.jersey_number === null ? null : Number(r.jersey_number), role: r.role, position: r.position, captain: !!r.captain,
        verified: !!r.roster_verified, verified_at: r.verified_at ? new Date(r.verified_at).toISOString() : null })),
    });
  }

  async update(id: string, body: UpdateMatchRequest, p: Principal): Promise<Match> {
    await this.db.tx(async (c) => {
      const m = await this.matchRow(id, p, c, true);
      if (Number(m.version) !== body.version) throw new ApiError(409, "STALE_VERSION", "Someone changed this match meanwhile; reload and try again.");
      const pick = <K extends keyof UpdateMatchRequest>(k: K, cur: unknown) => (body[k] === undefined ? cur : body[k]);
      await c.query("UPDATE matches SET competition = ?, season = ?, kickoff_at = ?, venue = ?, home_score = ?, away_score = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
        [pick("competition", m.competition), pick("season", m.season), body.kickoff_at === undefined ? m.kickoff_at : body.kickoff_at ? new Date(body.kickoff_at) : null,
         pick("venue", m.venue), pick("home_score", m.home_score), pick("away_score", m.away_score), id]);
      await recordChange(c, userActor(p), { action: "match.updated", entityType: "match", entityId: id, after: { ...body } });
    });
    return this.get(id, p);
  }

  private async videoOf(videoId: string, p: Principal): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id, match_id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  async linkVideo(videoId: string, matchId: string, p: Principal): Promise<Match> {
    await this.videoOf(videoId, p);
    await this.matchRow(matchId, p);
    await this.db.tx(async (c) => {
      await c.query("UPDATE video_sources SET match_id = ? WHERE id = ? AND organization_id = ?", [matchId, videoId, p.organizationId]);
      await recordChange(c, userActor(p), { action: "video.match_linked", entityType: "video", entityId: videoId, after: { match_id: matchId } });
    });
    return this.get(matchId, p);
  }

  private async change(c: PoolConnection, matchId: string, playerId: string, action: string, before: unknown, after: unknown, p: Principal, reason: string | null) {
    await c.query("INSERT INTO match_roster_changes (id, match_id, player_id, action, before_state, after_state, changed_by, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [uuidv7(), matchId, playerId, action, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after), p.userId, reason]);
  }

  async upsertRoster(matchId: string, body: RosterUpsertRequest, p: Principal): Promise<Match> {
    const m = await this.matchRow(matchId, p);
    if (![m.home_club_id, m.away_club_id].includes(body.club_id)) throw new ApiError(422, "CLUB_NOT_IN_MATCH", "A roster entry belongs to the home or the away team of this match.");
    const player = await this.db.one<RowDataPacket>("SELECT own_state, created_by_organization_id FROM v_player_identity WHERE player_id = ?", [body.player_id]);
    if (!player || (player.own_state === "PROVISIONAL" && player.created_by_organization_id !== p.organizationId)) throw notFound("Player");
    if (player.own_state === "MERGED" || player.own_state === "RETIRED") throw new ApiError(409, "PLAYER_NOT_LIVE", "That player record is merged or retired; use the current player.");
    try {
      await this.db.tx(async (c) => {
        const [cur] = await c.query<RowDataPacket[]>("SELECT * FROM match_rosters WHERE match_id = ? AND player_id = ? FOR UPDATE", [matchId, body.player_id]);
        const after = { club_id: body.club_id, jersey_number: body.jersey_number, role: body.role, position: body.position, captain: body.captain };
        if (cur[0]) {
          const before = { club_id: cur[0].club_id, jersey_number: cur[0].jersey_number, role: cur[0].role, position: cur[0].position, captain: !!cur[0].captain };
          if (cur[0].roster_verified && (!body.reason || body.reason.length < 3)) throw new ApiError(422, "CORRECTION_REASON_REQUIRED", "This roster is verified: say why the entry changes.");
          await c.query(`UPDATE match_rosters SET club_id = ?, jersey_number = ?, role = ?, position = ?, captain = ?, roster_verified = false, verified_by = NULL, verified_at = NULL,
                         updated_at = CURRENT_TIMESTAMP(6) WHERE match_id = ? AND player_id = ?`,
            [body.club_id, body.jersey_number, body.role, body.position, body.captain, matchId, body.player_id]);
          await this.change(c, matchId, body.player_id, "UPDATED", before, after, p, body.reason);
        } else {
          await c.query("INSERT INTO match_rosters (match_id, player_id, club_id, jersey_number, role, position, captain) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [matchId, body.player_id, body.club_id, body.jersey_number, body.role, body.position, body.captain]);
          await this.change(c, matchId, body.player_id, "ADDED", null, after, p, body.reason);
        }
        await recordChange(c, userActor(p), { action: "match.roster_changed", entityType: "match", entityId: matchId, after: { player_id: body.player_id, ...after } });
      });
    } catch (e) {
      if ((e as { errno?: number }).errno === 1062) throw new ApiError(409, "SHIRT_NUMBER_TAKEN", "Another player of that team already wears this number in this match.");
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return this.get(matchId, p);
  }

  async removeRoster(matchId: string, playerId: string, reason: string | null, p: Principal): Promise<Match> {
    await this.matchRow(matchId, p);
    await this.db.tx(async (c) => {
      const [cur] = await c.query<RowDataPacket[]>("SELECT * FROM match_rosters WHERE match_id = ? AND player_id = ? FOR UPDATE", [matchId, playerId]);
      if (!cur[0]) throw notFound("Roster entry");
      if (cur[0].roster_verified && (!reason || reason.trim().length < 3)) throw new ApiError(422, "CORRECTION_REASON_REQUIRED", "This roster is verified: say why the player is removed.");
      await c.query("DELETE FROM match_rosters WHERE match_id = ? AND player_id = ?", [matchId, playerId]);
      await this.change(c, matchId, playerId, "REMOVED", { club_id: cur[0].club_id, jersey_number: cur[0].jersey_number, role: cur[0].role }, null, p, reason);
      await recordChange(c, userActor(p), { action: "match.roster_removed", entityType: "match", entityId: matchId, after: { player_id: playerId, reason } });
    });
    return this.get(matchId, p);
  }

  async verify(matchId: string, verified: boolean, p: Principal): Promise<Match> {
    const m = await this.matchRow(matchId, p);
    const date = (m.kickoff_at ? new Date(m.kickoff_at) : new Date()).toISOString().slice(0, 10);
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>("SELECT * FROM match_rosters WHERE match_id = ? FOR UPDATE", [matchId]);
      if (rows.length === 0) throw new ApiError(409, "ROSTER_EMPTY", "Add players before verifying the roster.");
      for (const r of rows) {
        if (!!r.roster_verified === verified) continue;
        await c.query("UPDATE match_rosters SET roster_verified = ?, verified_by = ?, verified_at = ? WHERE match_id = ? AND player_id = ?",
          [verified, verified ? p.userId : null, verified ? new Date() : null, matchId, r.player_id]);
        await this.change(c, matchId, r.player_id, verified ? "VERIFIED" : "UNVERIFIED", null, { club_id: r.club_id, jersey_number: r.jersey_number }, p, null);
        if (verified) {
          // the player's own history: club and shirt number from the match date. The open entry is closed and a new one opened only when
          // they differ and the match is not older than the open entry (verifying an old match never rewrites later history).
          const [mem] = await c.query<RowDataPacket[]>("SELECT id, club_id, valid_from FROM player_club_memberships WHERE player_id = ? AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1", [r.player_id]);
          const fromOf = (x: RowDataPacket) => new Date(x.valid_from).toISOString().slice(0, 10);
          if (!mem[0] || (mem[0].club_id !== r.club_id && fromOf(mem[0]) <= date)) {
            if (mem[0]) await c.query("UPDATE player_club_memberships SET valid_to = ? WHERE id = ?", [date, mem[0].id]);
            await c.query("INSERT INTO player_club_memberships (id, player_id, club_id, valid_from, source, recorded_by) VALUES (?, ?, ?, ?, ?, ?)", [uuidv7(), r.player_id, r.club_id, date, `roster:${matchId}`.slice(0, 64), p.userId]);
          }
          if (r.jersey_number !== null) {
            const [num] = await c.query<RowDataPacket[]>("SELECT id, jersey_number, club_id, valid_from FROM player_jersey_numbers WHERE player_id = ? AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1", [r.player_id]);
            if (!num[0] || ((Number(num[0].jersey_number) !== Number(r.jersey_number) || num[0].club_id !== r.club_id) && fromOf(num[0]) <= date)) {
              if (num[0]) await c.query("UPDATE player_jersey_numbers SET valid_to = ? WHERE id = ?", [date, num[0].id]);
              await c.query("INSERT INTO player_jersey_numbers (id, player_id, club_id, jersey_number, valid_from, source) VALUES (?, ?, ?, ?, ?, ?)", [uuidv7(), r.player_id, r.club_id, r.jersey_number, date, `roster:${matchId}`.slice(0, 64)]);
            }
          }
        }
      }
      await recordChange(c, userActor(p), { action: verified ? "match.roster_verified" : "match.roster_unverified", entityType: "match", entityId: matchId });
    });
    return this.get(matchId, p);
  }

  async history(matchId: string, p: Principal): Promise<RosterChange[]> {
    await this.matchRow(matchId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT c.*, pi.display_name, u.display_name AS by_name FROM match_roster_changes c JOIN v_player_identity pi ON pi.player_id = c.player_id
         JOIN users u ON u.id = c.changed_by WHERE c.match_id = ? ORDER BY c.changed_at DESC, c.id DESC LIMIT 500`, [matchId]);
    const j = (v: unknown) => (v === null || v === undefined ? null : typeof v === "string" ? JSON.parse(v) : v);
    return rows.map((r) => RosterChange.parse({ id: r.id, player_id: r.player_id, display_name: r.display_name, action: r.action, before: j(r.before_state), after: j(r.after_state),
      changed_by: r.by_name, reason: r.reason, changed_at: new Date(r.changed_at).toISOString() }));
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class MatchesController {
  constructor(private readonly matches: MatchesService) {}

  @Get("clubs")
  clubs(@Query("q") q: string | undefined, @CurrentPrincipal() p: Principal) { return this.matches.clubs(q, p); }

  @Post("clubs")
  @Roles(...PROJECT_WRITERS)
  createClub(@Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.matches.createClub(CreateClubRequest.parse(body), p); }

  @Post("matches")
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.matches.create(CreateMatchRequest.parse(body), p); }

  @Get("matches")
  list(@CurrentPrincipal() p: Principal) { return this.matches.list(p); }

  @Get("matches/:matchId")
  get(@Param("matchId") id: string, @CurrentPrincipal() p: Principal) { return this.matches.get(uuidParam(id, "Match"), p); }


  @Patch("matches/:matchId")
  @Roles(...PROJECT_WRITERS)
  update(@Param("matchId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.matches.update(uuidParam(id, "Match"), UpdateMatchRequest.parse(body), p); }

  @Post("videos/:videoId/match")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  link(@Param("videoId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.matches.linkVideo(uuidParam(id, "Video"), z.object({ match_id: z.string().uuid() }).parse(body).match_id, p);
  }

  @Post("matches/:matchId/roster")
  @Roles(...PROJECT_WRITERS)
  upsert(@Param("matchId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.matches.upsertRoster(uuidParam(id, "Match"), RosterUpsertRequest.parse(body), p); }

  @Delete("matches/:matchId/roster/:playerId")
  @Roles(...PROJECT_WRITERS)
  remove(@Param("matchId") id: string, @Param("playerId") player: string, @Query("reason") reason: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.matches.removeRoster(uuidParam(id, "Match"), uuidParam(player, "Player"), reason ?? null, p);
  }

  @Post("matches/:matchId/roster/verify")
  @HttpCode(200)
  @Roles("OWNER", "ADMIN", "ANALYST")
  verify(@Param("matchId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.matches.verify(uuidParam(id, "Match"), z.object({ verified: z.boolean() }).parse(body ?? {}).verified, p);
  }

  @Get("matches/:matchId/roster/history")
  history(@Param("matchId") id: string, @CurrentPrincipal() p: Principal) { return this.matches.history(uuidParam(id, "Match"), p); }
}
