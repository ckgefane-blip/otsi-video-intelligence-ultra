/**
 * Match time (migration 0030; contract `periods.ts`).
 *
 *   GET  /v1/videos/:id/match-periods          the halves: confirmed by a person, or proposed by the engine from the latest finished analysis
 *                                              (detected on first request and kept; re-detected when a newer analysis finished)
 *   PUT  /v1/videos/:id/match-periods          a person confirms or corrects them (writers)
 *   POST /v1/videos/:id/match-periods/detect   propose again from the latest analysis (writers); a confirmed decision is never overwritten
 *
 * The evidence is how many people the tracker followed on the pitch, second by second; a half does not start before the video's lineup
 * cards (ADR-039) when they are shown in its first third (team sheets come before kick-off).
 */
import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Put, UseGuards } from "@nestjs/common";
import { detectPeriods, MatchPeriods, SetMatchPeriods } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const json = <T>(v: unknown, d: T): T => (v === null || v === undefined ? d : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
const LINEUP_AFTER_S = 20;                     // a half starts at least this long after the last pre-match lineup card

@Injectable()
export class MatchPeriodsService {
  constructor(private readonly db: Db) {}

  private async video(id: string, p: Principal): Promise<RowDataPacket> {
    const v = await this.db.one<RowDataPacket>("SELECT id, duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [id, p.organizationId]);
    if (!v) throw notFound("Video");
    return v;
  }

  private shape(videoId: string, r: RowDataPacket | null | undefined): MatchPeriods {
    if (!r) return MatchPeriods.parse({ video_id: videoId, state: "NONE", first: null, second: null, per_minute: [], note: null, decided_at: null });
    return MatchPeriods.parse({ video_id: videoId, state: r.state, first: { start_us: Number(r.first_start_us), end_us: Number(r.first_end_us) },
      second: r.second_start_us === null ? null : { start_us: Number(r.second_start_us), end_us: Number(r.second_end_us) },
      per_minute: json(r.per_minute, []), note: r.note ?? null, decided_at: r.decided_at ? new Date(r.decided_at).toISOString() : null });
  }

  /** Propose from the latest finished analysis; returns null when there is none or nothing long enough. */
  private async detect(videoId: string, duration: number, p: Principal): Promise<RowDataPacket | null> {
    const run = await this.db.one<RowDataPacket>("SELECT id, config FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1",
      [videoId, p.organizationId]);
    if (!run) return null;
    const fps = Number(json<{ sample_fps?: number }>(run.config, {}).sample_fps) || 2;
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT FLOOR(o.pts_us / 1000000) AS s, COUNT(*) AS n FROM track_observations o JOIN tracks t ON t.id = o.track_id
        WHERE t.run_id = ? AND t.class_name = 'PERSON' GROUP BY s`, [run.id]);
    const seconds = Math.max(1, Math.ceil(duration / 1e6), ...rows.map((r) => Number(r.s) + 1));
    const per = new Array<number>(seconds).fill(0);
    for (const r of rows) per[Number(r.s)] = Number(r.n) / fps;
    const card = await this.db.one<RowDataPacket>(
      "SELECT MAX(pts_us) AS pts FROM lineup_cards WHERE video_id = ? AND organization_id = ? AND state <> 'DISMISSED' AND pts_us < ?", [videoId, p.organizationId, duration / 3]);
    const notBefore = card?.pts !== null && card?.pts !== undefined ? Math.ceil(Number(card.pts) / 1e6) + LINEUP_AFTER_S : 0;
    const d = detectPeriods(per, notBefore);
    const perMinute = Array.from({ length: Math.ceil(seconds / 60) }, (_, m) => Math.round((per.slice(m * 60, m * 60 + 60).reduce((a, b) => a + b, 0) / 60) * 10) / 10);
    if (!d.first) return null;
    await this.db.rows(
      `INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us, note, per_minute)
       VALUES (?, ?, ?, 'PROPOSED', ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE run_id = VALUES(run_id), state = 'PROPOSED', first_start_us = VALUES(first_start_us), first_end_us = VALUES(first_end_us),
         second_start_us = VALUES(second_start_us), second_end_us = VALUES(second_end_us), note = VALUES(note), per_minute = VALUES(per_minute), decided_by = NULL, decided_at = NULL`,
      [videoId, p.organizationId, run.id, d.first.start_us, d.first.end_us, d.second?.start_us ?? null, d.second?.end_us ?? null, d.note, JSON.stringify(perMinute)]);
    return (await this.db.one<RowDataPacket>("SELECT * FROM match_periods WHERE video_id = ?", [videoId])) ?? null;
  }

  async get(videoId: string, p: Principal): Promise<MatchPeriods> {
    const v = await this.video(videoId, p);
    const cur = await this.db.one<RowDataPacket>("SELECT * FROM match_periods WHERE video_id = ? AND organization_id = ?", [videoId, p.organizationId]);
    if (cur?.state === "CONFIRMED") return this.shape(videoId, cur);
    const latest = await this.db.one<RowDataPacket>("SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1",
      [videoId, p.organizationId]);
    if (cur && (!latest || cur.run_id === latest.id)) return this.shape(videoId, cur);
    return this.shape(videoId, await this.detect(videoId, Number(v.duration_us ?? 0), p));
  }

  async redetect(videoId: string, p: Principal): Promise<MatchPeriods> {
    const v = await this.video(videoId, p);
    const cur = await this.db.one<RowDataPacket>("SELECT state FROM match_periods WHERE video_id = ? AND organization_id = ?", [videoId, p.organizationId]);
    if (cur?.state === "CONFIRMED") throw new ApiError(409, "PERIODS_CONFIRMED", "A person confirmed the halves of this video: change them on the timeline instead.");
    const r = await this.detect(videoId, Number(v.duration_us ?? 0), p);
    if (!r) throw new ApiError(422, "NO_PLAY_FOUND", "No stretch of play of 15 minutes or more was found in the latest analysis.");
    return this.shape(videoId, r);
  }

  async set(videoId: string, body: SetMatchPeriods, p: Principal): Promise<MatchPeriods> {
    const v = await this.video(videoId, p);
    const end = Number(v.duration_us ?? 0);
    if (end && (body.first.end_us > end || (body.second && body.second.end_us > end))) throw new ApiError(422, "PERIOD_AFTER_VIDEO", "A half ends after the end of the video.");
    await this.db.tx(async (c) => {
      const [cur] = await c.query<RowDataPacket[]>("SELECT * FROM match_periods WHERE video_id = ? FOR UPDATE", [videoId]);
      await c.query(
        `INSERT INTO match_periods (video_id, organization_id, state, first_start_us, first_end_us, second_start_us, second_end_us, decided_by, decided_at)
         VALUES (?, ?, 'CONFIRMED', ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(6))
         ON DUPLICATE KEY UPDATE state = 'CONFIRMED', first_start_us = VALUES(first_start_us), first_end_us = VALUES(first_end_us), second_start_us = VALUES(second_start_us),
           second_end_us = VALUES(second_end_us), decided_by = VALUES(decided_by), decided_at = CURRENT_TIMESTAMP(6)`,
        [videoId, p.organizationId, body.first.start_us, body.first.end_us, body.second?.start_us ?? null, body.second?.end_us ?? null, p.userId]);
      const before = cur[0] ? { state: cur[0].state, first: [Number(cur[0].first_start_us), Number(cur[0].first_end_us)],
        second: cur[0].second_start_us === null ? null : [Number(cur[0].second_start_us), Number(cur[0].second_end_us)] } : null;
      await recordChange(c, userActor(p), { action: "video.match_periods_confirmed", entityType: "video", entityId: videoId, before,
        after: { first: [body.first.start_us, body.first.end_us], second: body.second ? [body.second.start_us, body.second.end_us] : null } });
    });
    return this.get(videoId, p);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class MatchPeriodsController {
  constructor(private readonly periods: MatchPeriodsService) {}

  @Get("videos/:id/match-periods")
  get(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.periods.get(uuidParam(id, "Video"), p); }

  @Put("videos/:id/match-periods")
  @Roles(...PROJECT_WRITERS)
  set(@Param("id") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) { return this.periods.set(uuidParam(id, "Video"), SetMatchPeriods.parse(body ?? {}), p); }

  @Post("videos/:id/match-periods/detect")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  redetect(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.periods.redetect(uuidParam(id, "Video"), p); }
}
