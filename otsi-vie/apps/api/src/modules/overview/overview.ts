/**
 * Home / Overview (Page 01, Section 04): the organization's totals for the four KPI cards.
 *
 *   GET /v1/overview/stats            matches analysed, players tracked (confirmed), reels generated, reports created
 *   GET /v1/overview/recent-matches   the 4 most recently analysed match videos (finished run), with the linked match if any
 *   GET /v1/overview/latest-player    the player most recently confirmed by a person on a track (merged players resolve to the survivor)
 *   GET /v1/system/resources          the analysis workers' machine as last measured (CPU, memory, GPU name); not connected after 20 s
 *
 * Every number is a count of recorded rows of the caller's organization only; nothing is estimated. Trends are not served: no history
 * of these totals is kept yet, so the cards show "—" for change.
 */
import { Controller, Get, Injectable, UseGuards } from "@nestjs/common";
import type { HeroMoment, LatestConfirmedPlayer, OverviewStats, RecentMatch, SystemResources } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { notHidden, reelNotHidden, reportNotHidden } from "../../core/access";
import { Db } from "../../core/db";

@Injectable()
export class OverviewService {
  constructor(private readonly db: Db) {}

  async stats(p: Principal): Promise<OverviewStats> {
    const org = p.organizationId;
    const r = await this.db.one<RowDataPacket>(
      `SELECT
         (SELECT COUNT(DISTINCT COALESCE(v.match_id, v.id)) FROM video_sources v
           WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} AND EXISTS (SELECT 1 FROM pipeline_runs r WHERE r.video_id = v.id AND r.organization_id = v.organization_id AND r.status = 'SUCCEEDED')) AS matches_analyzed,
         (SELECT COUNT(DISTINCT ci.player_id) FROM v_track_current_identity ci
            JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
           WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} AND ci.state = 'CONFIRMED') AS players_tracked,
         (SELECT COUNT(DISTINCT j.reel_id) FROM render_jobs j
           WHERE j.organization_id = ?${reelNotHidden(p, "j.reel_id")} AND j.state = 'SUCCEEDED' AND j.output_asset_id IS NOT NULL AND j.removed_at IS NULL) AS reels_generated,
         (SELECT COUNT(*) FROM report_jobs j
           WHERE j.organization_id = ?${reportNotHidden(p, "j")} AND j.state = 'SUCCEEDED' AND j.output_asset_id IS NOT NULL) AS reports_created`,
      [org, org, org, org]);
    // when each counted item was FIRST counted (first finished analysis of a match, first confirmation of a player, first render of a
    // reel, the report's creation), bucketed into five 7-day windows ending now
    const firsts = await this.db.rows<RowDataPacket>(
      `SELECT 'matches_analyzed' AS k, MIN(r.finished_at) AS t FROM video_sources v
          JOIN pipeline_runs r ON r.video_id = v.id AND r.organization_id = v.organization_id AND r.status = 'SUCCEEDED'
         WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} GROUP BY COALESCE(v.match_id, v.id)
       UNION ALL
       SELECT 'players_tracked', MIN(ci.decided_at) FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
         WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} AND ci.state = 'CONFIRMED' GROUP BY ci.player_id
       UNION ALL
       SELECT 'reels_generated', MIN(j.completed_at) FROM render_jobs j WHERE j.organization_id = ?${reelNotHidden(p, "j.reel_id")} AND j.state = 'SUCCEEDED' AND j.output_asset_id IS NOT NULL AND j.removed_at IS NULL GROUP BY j.reel_id
       UNION ALL
       SELECT 'reports_created', j.created_at FROM report_jobs j WHERE j.organization_id = ?${reportNotHidden(p, "j")} AND j.state = 'SUCCEEDED' AND j.output_asset_id IS NOT NULL`,
      [org, org, org, org]);
    const now = Date.now(), WEEK = 7 * 864e5;
    const weekly = { matches_analyzed: [0, 0, 0, 0, 0], players_tracked: [0, 0, 0, 0, 0], reels_generated: [0, 0, 0, 0, 0], reports_created: [0, 0, 0, 0, 0] };
    for (const f of firsts) {
      if (!f.t) continue;
      const ago = Math.floor((now - new Date(f.t as string).getTime()) / WEEK);
      if (ago >= 0 && ago < 5) weekly[f.k as keyof typeof weekly][4 - ago]! += 1;
    }
    return {
      matches_analyzed: Number(r!.matches_analyzed), players_tracked: Number(r!.players_tracked),
      reels_generated: Number(r!.reels_generated), reports_created: Number(r!.reports_created), weekly,
    };
  }

  /** infrastructure status, not organization data: the same machine serves every organization; only load figures are shown */
  async resources(): Promise<SystemResources> {
    const rows = await this.db.rows<RowDataPacket>(
      "SELECT * FROM worker_status WHERE reported_at >= UTC_TIMESTAMP(6) - INTERVAL 20 SECOND ORDER BY reported_at DESC");
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const top = rows[0];
    return {
      connected: rows.length > 0, workers: rows.length, busy_workers: rows.filter((r) => Number(r.busy) === 1).length,
      host: top?.host ?? null, cpu_percent: n(top?.cpu_percent), cpu_count: n(top?.cpu_count), memory_used_bytes: n(top?.memory_used_bytes),
      memory_total_bytes: n(top?.memory_total_bytes), gpu_name: top?.gpu_name ?? null, gpu_percent: n(top?.gpu_percent),
      reported_at: top ? new Date(top.reported_at).toISOString() : null,
    };
  }

  async latestPlayer(p: Principal): Promise<LatestConfirmedPlayer> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT pi.resolved_player_id, pi.display_name, pi.canonical_otsi_id, ci.decided_at, t.video_id
         FROM v_track_current_identity ci
         JOIN tracks t ON t.id = ci.track_id
         JOIN video_sources v ON v.id = t.video_id
         JOIN v_player_identity pi ON pi.player_id = ci.player_id
        WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} AND ci.state = 'CONFIRMED'
        ORDER BY ci.decided_at DESC, ci.decision_id DESC LIMIT 1`, [p.organizationId]);
    return r ? { player_id: r.resolved_player_id, display_name: r.display_name, canonical_otsi_id: r.canonical_otsi_id ?? null,
      confirmed_at: new Date(r.decided_at).toISOString(), video_id: r.video_id } : null;
  }

  /** a random confirmed player at a moment where he is shown large (one of his 12 biggest detections), with the frame's other people */
  async heroMoment(p: Principal): Promise<HeroMoment> {
    const t = await this.db.one<RowDataPacket>(
      `SELECT ci.track_id, t.run_id, t.video_id, v.match_id, v.width, v.height, pi.resolved_player_id, pi.display_name, pi.canonical_otsi_id
         FROM v_track_current_identity ci
         JOIN tracks t ON t.id = ci.track_id AND t.class_name = 'PERSON'
         JOIN video_sources v ON v.id = t.video_id
         JOIN v_player_identity pi ON pi.player_id = ci.player_id
        WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")} AND ci.state = 'CONFIRMED' ORDER BY RAND() LIMIT 1`, [p.organizationId]);
    if (!t) return null;
    const big = await this.db.rows<RowDataPacket>(
      `SELECT frame_index, pts_us FROM track_observations WHERE track_id = ? AND observation_state = 'DETECTED' ORDER BY bbox_h * bbox_w DESC LIMIT 12`, [t.track_id]);
    if (!big.length) return null;
    const at = big[Math.floor(Math.random() * big.length)]!;
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT o.track_id, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, ci.player_id, ci.state
         FROM track_observations o JOIN tracks t ON t.id = o.track_id AND t.run_id = ? AND t.class_name = 'PERSON'
         LEFT JOIN v_track_current_identity ci ON ci.track_id = o.track_id
        WHERE o.video_id = ? AND o.frame_index = ?`, [t.run_id, t.video_id, at.frame_index]);
    const sheet = t.match_id ? await this.db.rows<RowDataPacket>(
      `SELECT r.player_id, r.jersey_number, r.position, COALESCE(c.short_name, c.canonical_name) AS team FROM match_rosters r JOIN clubs c ON c.id = r.club_id
        WHERE r.match_id = ?`, [t.match_id]) : [];
    const bySheet = new Map(sheet.map((s) => [s.player_id as string, s]));
    const me = bySheet.get(t.resolved_player_id as string);
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      player_id: t.resolved_player_id, display_name: t.display_name, canonical_otsi_id: t.canonical_otsi_id ?? null,
      jersey_number: num(me?.jersey_number), position: me?.position ?? null, team: me?.team ?? null,
      video_id: t.video_id, pts_us: Number(at.pts_us), width: num(t.width), height: num(t.height),
      boxes: rows.map((r) => ({ x: Number(r.bbox_x), y: Number(r.bbox_y), w: Number(r.bbox_w), h: Number(r.bbox_h), me: r.track_id === t.track_id,
        number: r.state === "CONFIRMED" && r.player_id ? num(bySheet.get(r.player_id as string)?.jersey_number) : null })),
    };
  }

  async recentMatches(p: Principal): Promise<RecentMatch[]> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT v.id, v.title, v.original_filename, v.duration_us, v.thumbnail_asset_id, r.analysed_at,
              m.id AS match_id, m.competition, m.kickoff_at, m.home_score, m.away_score,
              COALESCE(hc.short_name, hc.canonical_name) AS home, COALESCE(ac.short_name, ac.canonical_name) AS away
         FROM video_sources v
         JOIN (SELECT video_id, MAX(COALESCE(finished_at, created_at)) AS analysed_at FROM pipeline_runs
                WHERE organization_id = ? AND status = 'SUCCEEDED' GROUP BY video_id) r ON r.video_id = v.id
         LEFT JOIN matches m ON m.id = v.match_id AND m.organization_id = v.organization_id
         LEFT JOIN clubs hc ON hc.id = m.home_club_id
         LEFT JOIN clubs ac ON ac.id = m.away_club_id
        WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")}
        ORDER BY r.analysed_at DESC, v.id DESC LIMIT 4`, [p.organizationId, p.organizationId]);
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
    return rows.map((r) => ({
      video_id: r.id, video_title: r.title ?? r.original_filename ?? null, duration_us: n(r.duration_us), has_thumbnail: r.thumbnail_asset_id !== null,
      analysed_at: iso(r.analysed_at),
      match: r.match_id ? { id: r.match_id, home: r.home ?? null, away: r.away ?? null, competition: r.competition ?? null, kickoff_at: iso(r.kickoff_at),
        home_score: n(r.home_score), away_score: n(r.away_score) } : null,
    }));
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class OverviewController {
  constructor(private readonly overview: OverviewService) {}

  @Get("overview/stats")
  stats(@CurrentPrincipal() p: Principal) {
    return this.overview.stats(p);
  }

  @Get("overview/recent-matches")
  recentMatches(@CurrentPrincipal() p: Principal) {
    return this.overview.recentMatches(p);
  }

  @Get("overview/hero-moment")
  heroMoment(@CurrentPrincipal() p: Principal) {
    return this.overview.heroMoment(p);
  }

  @Get("overview/latest-player")
  latestPlayer(@CurrentPrincipal() p: Principal) {
    return this.overview.latestPlayer(p);
  }

  @Get("system/resources")
  resources() {
    return this.overview.resources();
  }
}
