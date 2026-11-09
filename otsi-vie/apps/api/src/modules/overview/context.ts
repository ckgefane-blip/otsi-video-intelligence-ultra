/**
 * v3 Phase A.1 (S01, ADR-069): the work context bar Project ▸ Match ▸ Player.
 *
 *   GET /v1/context?reel=&video=&player=&project=
 *
 * Resolves what a page is about into its project, match, video, player and reel, and lists the choices for each chip of the bar. Every
 * row is the caller's organization only and respects project access (a hidden project, its videos and reels are never named). A
 * reel gives its video and player; a video gives its project and match. A player is named only when the organization created the
 * record or a person confirmed him on one of its visible videos (a merged player resolves to the survivor). Anything unknown is null.
 */
import { Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { WorkContext, WorkContextQuery, type ContextPlayer, type ContextVideo } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { notHidden } from "../../core/access";
import { Db } from "../../core/db";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIDEO_COLS = `v.id, COALESCE(v.title, v.original_filename, 'Untitled video') AS title, v.project_id, v.match_id,
  COALESCE(hc.short_name, hc.canonical_name) AS home, COALESCE(ac.short_name, ac.canonical_name) AS away, m.competition, m.kickoff_at,
  EXISTS (SELECT 1 FROM pipeline_runs r WHERE r.video_id = v.id AND r.organization_id = v.organization_id AND r.status = 'SUCCEEDED') AS analysed`;
const VIDEO_JOINS = `LEFT JOIN matches m ON m.id = v.match_id AND m.organization_id = v.organization_id
  LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id`;

/** "Home v Away · Competition · 2026-10-12" from what is recorded; null without a match or both teams */
export function matchLabel(r: { [k: string]: unknown }): string | null {
  if (!r.home && !r.away) return null;
  const day = r.kickoff_at ? new Date(r.kickoff_at as string).toISOString().slice(0, 10) : null;
  return [`${(r.home as string) ?? "?"} v ${(r.away as string) ?? "?"}`, r.competition as string | null, day].filter(Boolean).join(" · ");
}
const toVideo = (r: RowDataPacket): ContextVideo => ({ id: r.id, title: r.title, match_label: matchLabel(r), analysed: !!Number(r.analysed) });
const toPlayer = (r: RowDataPacket): ContextPlayer => ({ id: r.id, display_name: r.display_name, canonical_otsi_id: r.canonical_otsi_id ?? null });

@Injectable()
export class WorkContextService {
  constructor(private readonly db: Db) {}

  async resolve(q: WorkContextQuery, p: Principal): Promise<WorkContext> {
    const org = p.organizationId;
    let videoId = q.video ?? null, playerRef = q.player ?? null, reel: { id: string; name: string } | null = null;
    if (q.reel) {
      const r = (await this.db.rows<RowDataPacket>(
        `SELECT id, name, video_id, player_id FROM reel_projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL${notHidden(p, "project_id")}`, [q.reel, org]))[0];
      if (r) { reel = { id: r.id, name: r.name }; videoId = r.video_id; playerRef = playerRef ?? r.player_id; }
    }
    const vrow = videoId ? (await this.db.rows<RowDataPacket>(
      `SELECT ${VIDEO_COLS} FROM video_sources v ${VIDEO_JOINS} WHERE v.id = ? AND v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")}`, [videoId, org]))[0] : undefined;
    const projectId = vrow?.project_id ?? q.project ?? null;
    const prow = projectId ? (await this.db.rows<RowDataPacket>(
      `SELECT id, name FROM projects WHERE id = ? AND organization_id = ? AND removed_at IS NULL${notHidden(p, "id")}`, [projectId, org]))[0] : undefined;
    const player = playerRef ? await this.player(playerRef, p) : null;

    const projects = await this.db.rows<RowDataPacket>(
      `SELECT p.id, p.name FROM projects p WHERE p.organization_id = ? AND p.removed_at IS NULL AND p.status = 'ACTIVE'${notHidden(p, "p.id")}
        ORDER BY GREATEST(p.updated_at, COALESCE((SELECT MAX(v.created_at) FROM video_sources v WHERE v.project_id = p.id AND v.removed_at IS NULL), p.updated_at)) DESC, p.id LIMIT 50`, [org]);
    const videos = prow ? await this.db.rows<RowDataPacket>(
      `SELECT ${VIDEO_COLS} FROM video_sources v ${VIDEO_JOINS} WHERE v.project_id = ? AND v.organization_id = ? AND v.removed_at IS NULL ORDER BY v.created_at DESC, v.id LIMIT 100`,
      [prow.id, org]) : [];
    const players = vrow ? await this.db.rows<RowDataPacket>(
      `SELECT DISTINCT pl.id, pl.display_name, pl.canonical_otsi_id FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id
         JOIN players pl ON pl.id = ci.player_id WHERE t.video_id = ? AND ci.state = 'CONFIRMED' AND pl.merged_into_player_id IS NULL ORDER BY pl.display_name, pl.id LIMIT 60`, [vrow.id]) : [];
    const reels = vrow ? await this.db.rows<RowDataPacket>(
      `SELECT id, name, player_id FROM reel_projects WHERE video_id = ? AND organization_id = ? AND removed_at IS NULL${notHidden(p, "project_id")}
        ORDER BY player_id = ? DESC, updated_at DESC, id LIMIT 30`, [vrow.id, org, player?.id ?? ""]) : [];
    return WorkContext.parse({
      project: prow ? { id: prow.id, name: prow.name } : null,
      video: vrow ? toVideo(vrow) : null,
      match: vrow?.match_id && matchLabel(vrow) ? { id: vrow.match_id, name: matchLabel(vrow) } : null,
      player, reel,
      choices: { projects: projects.map((r) => ({ id: r.id, name: r.name })), videos: videos.map(toVideo), players: players.map(toPlayer),
        reels: reels.map((r) => ({ id: r.id, name: r.name, player_id: r.player_id })) },
    });
  }

  /** a player by internal id or OTSI Player ID, only when this organization may name him; a merged record resolves to the survivor */
  private async player(ref: string, p: Principal): Promise<ContextPlayer | null> {
    const col = UUID.test(ref) ? "id" : "canonical_otsi_id";
    let r = (await this.db.rows<RowDataPacket>(`SELECT id, display_name, canonical_otsi_id, merged_into_player_id, created_by_organization_id FROM players WHERE ${col} = ?`, [ref]))[0];
    if (r?.merged_into_player_id) r = (await this.db.rows<RowDataPacket>("SELECT id, display_name, canonical_otsi_id, merged_into_player_id, created_by_organization_id FROM players WHERE id = ?", [r.merged_into_player_id]))[0];
    if (!r) return null;
    if (r.created_by_organization_id === p.organizationId) return toPlayer(r);
    const seen = await this.db.rows<RowDataPacket>(
      `SELECT 1 FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
        WHERE ci.player_id = ? AND ci.state = 'CONFIRMED' AND v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} LIMIT 1`, [r.id, p.organizationId]);
    return seen.length ? toPlayer(r) : null;
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class WorkContextController {
  constructor(private readonly ctx: WorkContextService) {}

  @Get("context")
  resolve(@Query() q: Record<string, string>, @CurrentPrincipal() p: Principal) {
    return this.ctx.resolve(WorkContextQuery.parse(q), p);
  }
}
