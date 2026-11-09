/**
 * Transitions Analysis (v3 Phase E.4, ADR-119):
 * Computes turnover moments (ball won or lost to next action within match time), labelled INFERRED.
 * Excludes events marked REJECT in event_decisions (E.1).
 */
import { Controller, Get, Injectable, Param, UseGuards } from "@nestjs/common";
import {
  TeamTransitionStats,
  TransitionItem,
  TransitionsAnalysis,
  type TransitionTrigger,
} from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { matchWindows, within } from "./match-time";

@Injectable()
export class TransitionsService {
  constructor(private readonly db: Db) {}

  async analyze(videoId: string, p: Principal): Promise<TransitionsAnalysis> {
    const v = await this.db.one<RowDataPacket>(
      "SELECT id, duration_us FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL",
      [videoId, p.organizationId],
    );
    if (!v) throw notFound("Video");
    const mt = await matchWindows(this.db, videoId);
    const counted = mt ? mt.reduce((s, [a, b]) => s + (b - a), 0) / 1e6 : Number(v.duration_us ?? 0) / 1e6;
    const none: TransitionsAnalysis = {
      video_id: videoId,
      state: "NONE",
      evidence: "INFERRED",
      counted_s: counted,
      summary: { teams: [] },
      items: [],
    };

    const bt = await this.db.one<RowDataPacket>(
      "SELECT id, run_id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1",
      [videoId, p.organizationId],
    );
    if (!bt) return TransitionsAnalysis.parse(none);

    // Get team kit groups and names
    const groups = await this.db.rows<RowDataPacket>(
      `SELECT g.kit_group, a.club_id, c.canonical_name
         FROM (SELECT DISTINCT run_id, kit_group FROM track_appearance WHERE run_id = ? AND kit_group IS NOT NULL) g
         LEFT JOIN v_run_team_current a ON a.run_id = g.run_id AND a.kit_group = g.kit_group
         LEFT JOIN clubs c ON c.id = a.club_id ORDER BY g.kit_group`,
      [bt.run_id],
    );

    const teamStats = new Map<number, TeamTransitionStats>();
    for (const g of groups) {
      const kg = Number(g.kit_group);
      teamStats.set(kg, {
        kit_group: kg,
        club_id: (g.club_id as string | null) ?? null,
        name: (g.canonical_name as string | null) ?? null,
        attacking_transitions: 0,
        shots_from_transitions: 0,
        transitions_retained: 0,
        transitions_lost: 0,
        avg_duration_to_action_s: null,
        counter_press_regains: 0,
      });
    }

    // Query all valid events (excluding REJECT decisions)
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT e.id, e.event_type, e.start_pts_us, e.end_pts_us, e.primary_track_id, e.secondary_track_id, e.kit_group,
              JSON_EXTRACT(e.features, '$.key') AS is_key,
              JSON_EXTRACT(e.features, '$.regain') AS regain,
              JSON_EXTRACT(e.features, '$.from_kit_group') AS from_kit_group,
              a.player_id AS a_player, b.player_id AS b_player
         FROM event_candidates e
         LEFT JOIN v_track_current_identity a ON a.track_id = e.primary_track_id AND a.state = 'CONFIRMED'
         LEFT JOIN v_track_current_identity b ON b.track_id = e.secondary_track_id AND b.state = 'CONFIRMED'
        WHERE e.ball_track_id = ? AND e.video_id = ?
          AND e.event_type IN ('POSSESSION_CHANGE', 'TACKLE', 'INTERCEPTION', 'PASS', 'SHOT', 'GOAL', 'SET_PIECE', 'PRESSURE')
          AND NOT EXISTS (
            SELECT 1 FROM event_decisions ed WHERE ed.event_id = e.id AND ed.decision = 'REJECT'
              AND ed.decided_at = (SELECT MAX(ed2.decided_at) FROM event_decisions ed2 WHERE ed2.event_id = e.id)
          )
        ORDER BY e.start_pts_us ASC`,
      [bt.id, videoId],
    );

    // Filter to match time
    const events = rows.filter((r) => within(mt, Number(r.start_pts_us)));

    // Track how map (tackle / interception)
    const howMap = new Map<string, TransitionTrigger>();
    for (const r of events) {
      if (r.event_type === "TACKLE") howMap.set(`${r.start_pts_us}|${r.primary_track_id}`, "TACKLE");
      else if (r.event_type === "INTERCEPTION") howMap.set(`${r.start_pts_us}|${r.primary_track_id}`, "INTERCEPTION");
    }

    const items: TransitionItem[] = [];
    const durationsPerTeam = new Map<number, number[]>();

    const num = (x: unknown) => (x === null || x === undefined || x === "null" ? null : Number(x));
    const yes = (x: unknown) => x === true || x === "true" || x === 1;

    // Process turnovers
    for (let i = 0; i < events.length; i++) {
      const r = events[i]!;
      if (r.event_type !== "POSSESSION_CHANGE") continue;

      const t0 = Number(r.start_pts_us);
      const toKit = num(r.kit_group);
      const fromKit = num(r.from_kit_group);
      if (toKit === null || !teamStats.has(toKit)) continue;

      const triggerKind: TransitionTrigger =
        howMap.get(`${r.start_pts_us}|${r.secondary_track_id}`) ?? "BALL_WON";

      // Attacking transition for toKit
      const toStats = teamStats.get(toKit)!;
      toStats.attacking_transitions++;

      // Scan subsequent events within 10 seconds for toKit's next action
      let nextAction: TransitionItem["next_action"] | null = null;
      const windowEnd = t0 + 10_000_000;

      for (let j = i + 1; j < events.length; j++) {
        const next = events[j]!;
        const nt = Number(next.start_pts_us);
        if (nt > windowEnd) break;

        const nextKit = num(next.kit_group);

        if (next.event_type === "GOAL" && nextKit === toKit) {
          nextAction = {
            event_id: next.id,
            event_type: "GOAL",
            pts_us: nt,
            duration_s: Math.round(((nt - t0) / 1e6) * 10) / 10,
            outcome: "GOAL",
            detail: "Goal scored from turnover",
          };
          toStats.shots_from_transitions++;
          break;
        }

        if (next.event_type === "SHOT" && nextKit === toKit) {
          nextAction = {
            event_id: next.id,
            event_type: "SHOT",
            pts_us: nt,
            duration_s: Math.round(((nt - t0) / 1e6) * 10) / 10,
            outcome: "SHOT",
            detail: "Shot taken within 10s of turnover",
          };
          toStats.shots_from_transitions++;
          break;
        }

        if (next.event_type === "PASS" && nextKit === toKit) {
          if (yes(next.is_key)) {
            nextAction = {
              event_id: next.id,
              event_type: "PASS",
              pts_us: nt,
              duration_s: Math.round(((nt - t0) / 1e6) * 10) / 10,
              outcome: "KEY_PASS",
              detail: "Key pass created after turnover",
            };
            toStats.transitions_retained++;
            break;
          }
          if (!nextAction) {
            nextAction = {
              event_id: next.id,
              event_type: "PASS",
              pts_us: nt,
              duration_s: Math.round(((nt - t0) / 1e6) * 10) / 10,
              outcome: "PASS",
              detail: "Completed pass found after turnover",
            };
          }
        }

        if (next.event_type === "POSSESSION_CHANGE" && nt <= t0 + 5_000_000) {
          // Lost ball again quickly
          nextAction = {
            event_id: next.id,
            event_type: "POSSESSION_CHANGE",
            pts_us: nt,
            duration_s: Math.round(((nt - t0) / 1e6) * 10) / 10,
            outcome: "DISPOSSESSED",
            detail: "Dispossessed within 5s of turnover",
          };
          toStats.transitions_lost++;
          break;
        }

        if (next.event_type === "SET_PIECE" && nextKit === toKit) {
          nextAction = {
            event_id: next.id,
            event_type: "SET_PIECE",
            pts_us: nt,
            duration_s: Math.round(((nt - t0) / 1e6) * 10) / 10,
            outcome: "STOPPAGE",
            detail: "Foul won / stoppage restart",
          };
          break;
        }
      }

      if (!nextAction) {
        nextAction = {
          event_id: null,
          event_type: "RETAINED",
          pts_us: t0 + 8_000_000,
          duration_s: 8.0,
          outcome: "RETAINED",
          detail: "Possession sustained beyond transition window",
        };
        toStats.transitions_retained++;
      } else if (nextAction.outcome === "PASS") {
        toStats.transitions_retained++;
      }

      const teamDurations = durationsPerTeam.get(toKit) ?? [];
      teamDurations.push(nextAction.duration_s);
      durationsPerTeam.set(toKit, teamDurations);

      items.push({
        id: uuidv7(),
        trigger_event_id: r.id,
        trigger_pts_us: t0,
        transition_type: "ATTACKING",
        trigger_kind: triggerKind,
        kit_group: toKit,
        player_id: (r.b_player as string | null) ?? null,
        track_id: (r.secondary_track_id as string | null) ?? null,
        next_action: nextAction,
        evidence: "INFERRED",
      });

      // Defensive transition check for fromKit (counter-press)
      if (fromKit !== null && teamStats.has(fromKit)) {
        // Check if fromKit counter-pressed and regained within 5s
        const wonBack = events.some(
          (ev) =>
            Number(ev.start_pts_us) > t0 &&
            Number(ev.start_pts_us) <= t0 + 5_000_000 &&
            ((ev.event_type === "PRESSURE" && num(ev.kit_group) === fromKit && yes(ev.regain)) ||
              (ev.event_type === "POSSESSION_CHANGE" && num(ev.kit_group) === fromKit)),
        );
        if (wonBack) {
          teamStats.get(fromKit)!.counter_press_regains++;
        }
      }
    }

    // Calculate averages
    for (const [kg, stats] of teamStats.entries()) {
      const durs = durationsPerTeam.get(kg);
      if (durs && durs.length > 0) {
        stats.avg_duration_to_action_s =
          Math.round((durs.reduce((a, b) => a + b, 0) / durs.length) * 10) / 10;
      }
    }

    return TransitionsAnalysis.parse({
      video_id: videoId,
      state: "READY",
      evidence: "INFERRED",
      counted_s: Math.round(counted),
      summary: {
        teams: [...teamStats.values()],
      },
      items,
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class TransitionsController {
  constructor(private readonly service: TransitionsService) {}

  @Get("videos/:id/transitions")
  analyze(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.service.analyze(uuidParam(id, "Video"), p);
  }
}
