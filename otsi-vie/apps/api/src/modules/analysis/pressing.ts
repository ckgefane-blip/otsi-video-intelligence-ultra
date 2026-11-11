/**
 * v3 Phase E.7 (ADR-121): Pressing metrics from existing pressing events.
 *
 *   GET /v1/videos/:id/pressing
 *
 * Computes:
 *   - High Press Success: percentage and count of pressures initiated in opponent half leading to a regain within 5s.
 *   - Final Third Regains: count of ball regains won from pressure in the attacking third.
 *   - Average Press Height: distance along pitch axis from defending goal line (metres and %).
 *
 * Evidence rules:
 *   - Excludes any event marked REJECT in event_decisions (ADR-118).
 *   - Feet positions placed via best pitch calibration slice covering the moment.
 *   - When uncalibrated, pitch height and final third are marked unmeasured; wide-view counts preserved.
 */
import { Controller, Get, Injectable, Param, UseGuards } from "@nestjs/common";
import {
  DEFAULT_PITCH_LENGTH_M,
  DEFAULT_PITCH_WIDTH_M,
  feetPosition,
  type Mat3,
  PressingAnalysis,
  type PressingPoint,
  type TeamPressingStats,
  validatePPDAEvidence,
} from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";

interface CalSlice {
  s: number;
  e: number;
  H: Mat3;
  L: number;
  W: number;
  q: number;
}

@Injectable()
export class PressingService {
  constructor(private readonly db: Db) {}

  async get(videoId: string, p: Principal): Promise<PressingAnalysis> {
    const v = await this.db.one<RowDataPacket>(
      "SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL",
      [videoId, p.organizationId],
    );
    if (!v) throw notFound("Video");

    // latest succeeded ball track
    const bt = await this.db.one<RowDataPacket>(
      "SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1",
      [videoId, p.organizationId],
    );

    if (!bt) {
      return PressingAnalysis.parse({
        video_id: videoId,
        ball_track_id: null,
        is_calibrated: false,
        pitch_length_m: DEFAULT_PITCH_LENGTH_M,
        pitch_width_m: DEFAULT_PITCH_WIDTH_M,
        teams: [],
        pressures: [],
        not_measured_reason: "No completed ball tracking found for this match video.",
      });
    }

    // pitch calibrations
    const calRows = await this.db.rows<RowDataPacket>(
      `SELECT start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score
         FROM pitch_calibrations
        WHERE video_id = ?
        ORDER BY start_pts_us`,
      [videoId],
    );

    const slices: CalSlice[] = calRows.map((c) => ({
      s: Number(c.start_pts_us),
      e: Number(c.end_pts_us),
      H: (typeof c.transform_matrix === "string" ? JSON.parse(c.transform_matrix) : c.transform_matrix) as Mat3,
      L: Number(c.pitch_length_m ?? DEFAULT_PITCH_LENGTH_M),
      W: Number(c.pitch_width_m ?? DEFAULT_PITCH_WIDTH_M),
      q: Number(c.quality_score ?? 0),
    }));

    const pitchLength = slices.length ? slices[0]!.L : DEFAULT_PITCH_LENGTH_M;
    const pitchWidth = slices.length ? slices[0]!.W : DEFAULT_PITCH_WIDTH_M;

    // match periods (H1, H2)
    const mp = await this.db.one<RowDataPacket>(
      "SELECT first_start_us, first_end_us, second_start_us, second_end_us FROM match_periods WHERE video_id = ? AND organization_id = ?",
      [videoId, p.organizationId],
    );

    // fetch PRESSURE events, excluding REJECT decisions (E.1)
    const pRows = await this.db.rows<RowDataPacket>(
      `SELECT e.id, e.start_pts_us, e.end_pts_us, e.primary_track_id, e.secondary_track_id, e.kit_group,
              JSON_EXTRACT(e.features, '$.regain') AS regain,
              pa.id AS a_player_id, pa.display_name AS a_name,
              pb.id AS b_player_id, pb.display_name AS b_name
         FROM event_candidates e
         LEFT JOIN v_track_current_identity ia ON ia.track_id = e.primary_track_id AND ia.state = 'CONFIRMED'
         LEFT JOIN players pa ON pa.id = ia.player_id
         LEFT JOIN v_track_current_identity ib ON ib.track_id = e.secondary_track_id AND ib.state = 'CONFIRMED'
         LEFT JOIN players pb ON pb.id = ib.player_id
        WHERE e.ball_track_id = ? AND e.video_id = ? AND e.event_type = 'PRESSURE'
          AND NOT EXISTS (
            SELECT 1 FROM event_decisions ed
            WHERE ed.event_id = e.id AND ed.decision = 'REJECT'
              AND ed.decided_at = (SELECT MAX(ed2.decided_at) FROM event_decisions ed2 WHERE ed2.event_id = e.id)
          )
        ORDER BY e.start_pts_us`,
      [bt.id, videoId],
    );

    // fetch observations for primary tracks around start_pts_us
    const trackIds = [...new Set(pRows.map((r) => r.primary_track_id).filter(Boolean))];
    const obsByTrack = new Map<string, { pts: number; x: number; y: number; w: number; h: number }[]>();
    if (trackIds.length > 0 && slices.length > 0) {
      const obsRows = await this.db.rows<RowDataPacket>(
        `SELECT track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h
           FROM track_observations
          WHERE video_id = ? AND track_id IN (${trackIds.map(() => "?").join(", ")})`,
        [videoId, ...trackIds],
      );
      for (const r of obsRows) {
        const tid = String(r.track_id);
        const list = obsByTrack.get(tid) ?? [];
        list.push({
          pts: Number(r.pts_us),
          x: Number(r.bbox_x),
          y: Number(r.bbox_y),
          w: Number(r.bbox_w),
          h: Number(r.bbox_h),
        });
        obsByTrack.set(tid, list);
      }
      for (const list of obsByTrack.values()) {
        list.sort((a, b) => a.pts - b.pts);
      }
    }

    // Helper: find best slice covering pts
    const sliceAt = (t: number): CalSlice | null => {
      let best: CalSlice | null = null;
      for (const sl of slices) {
        if (sl.s <= t && sl.e > t) {
          if (!best || sl.q > best.q) best = sl;
        }
      }
      return best;
    };

    // Determine team defending direction
    // If calibrated: inspect kit group positions to determine who defends -L/2 in H1
    let kit0DefendsLeftInH1 = true;
    if (slices.length > 0) {
      const kit0X: number[] = [];
      const kit1X: number[] = [];
      const sampleObs = await this.db.rows<RowDataPacket>(
        `SELECT o.pts_us, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h, ta.kit_group
           FROM track_observations o
           JOIN track_appearance ta ON ta.track_id = o.track_id
          WHERE o.video_id = ? AND ta.kit_group IN (0, 1)
          LIMIT 2000`,
        [videoId],
      );
      for (const o of sampleObs) {
        const sl = sliceAt(Number(o.pts_us));
        if (sl) {
          const pt = feetPosition(sl.H, { x: Number(o.bbox_x), y: Number(o.bbox_y), w: Number(o.bbox_w), h: Number(o.bbox_h) }, sl.L, sl.W);
          if (pt) {
            if (o.kit_group === 0) kit0X.push(pt[0]);
            else if (o.kit_group === 1) kit1X.push(pt[0]);
          }
        }
      }
      const mean0 = kit0X.length ? kit0X.reduce((a, b) => a + b, 0) / kit0X.length : 0;
      const mean1 = kit1X.length ? kit1X.reduce((a, b) => a + b, 0) / kit1X.length : 0;
      if (mean0 > mean1) {
        kit0DefendsLeftInH1 = false;
      }
    }

    const pressures: PressingPoint[] = [];

    for (const r of pRows) {
      const startUs = Number(r.start_pts_us);
      const endUs = Number(r.end_pts_us);
      const kit = Number(r.kit_group ?? 0);
      const regain = r.regain === true || r.regain === 1 || String(r.regain) === "true";

      // Check match period
      const isH2 = mp && mp.second_start_us !== null && startUs >= Number(mp.second_start_us);

      // Defending left: team defends -L/2 and attacks towards +L/2
      const defendsLeft = (kit === 0 ? kit0DefendsLeftInH1 : !kit0DefendsLeftInH1) ? !isH2 : isH2;

      let pitchX: number | null = null;
      let pitchY: number | null = null;
      let pressHeightM: number | null = null;
      let pressHeightPct: number | null = null;
      let isHighPress: boolean | null = null;
      let isFinalThird: boolean | null = null;

      const primaryTid = r.primary_track_id ? String(r.primary_track_id) : null;
      const obsList = primaryTid ? obsByTrack.get(primaryTid) : undefined;

      if (obsList && obsList.length > 0) {
        // find nearest observation within 500ms
        let bestObs: (typeof obsList)[0] | null = null;
        let minDiff = 500_000;
        for (const o of obsList) {
          const diff = Math.abs(o.pts - startUs);
          if (diff < minDiff) {
            minDiff = diff;
            bestObs = o;
          }
        }

        if (bestObs) {
          const sl = sliceAt(bestObs.pts);
          if (sl) {
            const pt = feetPosition(sl.H, bestObs, sl.L, sl.W);
            if (pt) {
              pitchX = pt[0];
              pitchY = pt[1];
              // press height: distance from own defending goal line
              const distFromOwnGoal = defendsLeft ? pt[0] + pitchLength / 2 : pitchLength / 2 - pt[0];
              pressHeightM = Math.round(distFromOwnGoal * 10) / 10;
              pressHeightPct = Math.round((distFromOwnGoal / pitchLength) * 1000) / 10;
              isHighPress = pressHeightPct >= 50.0;
              isFinalThird = pressHeightPct >= 66.67;
            }
          }
        }
      }

      pressures.push({
        id: String(r.id),
        start_us: startUs,
        end_us: endUs,
        kit_group: kit,
        presser_track_id: primaryTid,
        presser_player_id: r.a_player_id ? String(r.a_player_id) : null,
        presser_name: r.a_name ? String(r.a_name) : null,
        pressed_track_id: r.secondary_track_id ? String(r.secondary_track_id) : null,
        pressed_player_id: r.b_player_id ? String(r.b_player_id) : null,
        pressed_name: r.b_name ? String(r.b_name) : null,
        regain,
        pitch_x: pitchX,
        pitch_y: pitchY,
        press_height_pct: pressHeightPct,
        press_height_m: pressHeightM,
        is_high_press: isHighPress,
        is_final_third: isFinalThird,
      });
    }

    // Query non-rejected passes for PPDA evidence validation
    const passRows = await this.db.rows<RowDataPacket>(
      `SELECT e.id, e.start_pts_us, e.kit_group,
              JSON_EXTRACT(e.features, '$.from') AS p_from
         FROM event_candidates e
         LEFT JOIN (
           SELECT event_id, MAX(decided_at) AS max_decided_at FROM event_decisions GROUP BY event_id
         ) ed_max ON e.id = ed_max.event_id
         LEFT JOIN event_decisions ed ON ed.event_id = ed_max.event_id AND ed.decided_at = ed_max.max_decided_at
        WHERE e.ball_track_id = ? AND e.video_id = ? AND e.event_type = 'PASS'
          AND (ed.decision IS NULL OR ed.decision != 'REJECT')`,
      [bt.id, videoId],
    );

    // Fetch team club names if match linked
    const match = await this.db.one<RowDataPacket>(
      `SELECT hc.short_name AS home_name, ac.short_name AS away_name
         FROM video_sources v
         LEFT JOIN matches m ON m.id = v.match_id AND m.organization_id = v.organization_id
         LEFT JOIN clubs hc ON hc.id = m.home_club_id
         LEFT JOIN clubs ac ON ac.id = m.away_club_id
        WHERE v.id = ? AND v.organization_id = ?`,
      [videoId, p.organizationId],
    );

    const kitGroups = [...new Set(pressures.map((p) => p.kit_group))].sort();
    if (kitGroups.length === 0) {
      kitGroups.push(0, 1);
    }

    const teams: TeamPressingStats[] = kitGroups.map((kg) => {
      const teamPressures = pressures.filter((p) => p.kit_group === kg);
      const measured = teamPressures.filter((p) => p.press_height_m !== null);
      const totalPressures = teamPressures.length;
      const totalRegains = teamPressures.filter((p) => p.regain).length;
      const overallSuccess = totalPressures > 0 ? Math.round((totalRegains / totalPressures) * 1000) / 10 : null;

      const highPressures = measured.filter((p) => p.is_high_press === true);
      const highRegains = highPressures.filter((p) => p.regain);
      const highSuccess = highPressures.length > 0 ? Math.round((highRegains.length / highPressures.length) * 1000) / 10 : null;

      const finalThirdPressures = measured.filter((p) => p.is_final_third === true);
      const finalThirdRegains = finalThirdPressures.filter((p) => p.regain);

      const avgHeightM = measured.length > 0 ? Math.round((measured.reduce((sum, p) => sum + p.press_height_m!, 0) / measured.length) * 10) / 10 : null;
      const avgHeightPct = measured.length > 0 ? Math.round((measured.reduce((sum, p) => sum + p.press_height_pct!, 0) / measured.length) * 10) / 10 : null;

      const teamName = kg === 0 ? (match?.home_name ?? "Team A") : (match?.away_name ?? "Team B");

      // Defensive actions in defensive 60% of opponent (press_height_pct >= 40.0%)
      const defActionsInDef60 = measured.filter((p) => (p.press_height_pct ?? 0) >= 40.0).length;

      // Opponent passes in their defensive 60%
      let opponentPassesInDef60 = 0;
      if (slices.length > 0) {
        for (const pr of passRows) {
          const passKit = pr.kit_group != null ? Number(pr.kit_group) : null;
          if (passKit === null || passKit === kg) continue; // only opponent passes
          const startUs = Number(pr.start_pts_us);
          const slice = sliceAt(startUs);
          if (!slice) continue;
          const half = mp && mp.second_start_us && startUs >= Number(mp.second_start_us) ? 2 : 1;
          const defendsLeft = half === 1 ? passKit === 0 : passKit !== 0;
          let pxy: [number, number] | null = null;
          if (pr.p_from) {
            try {
              const parsed = typeof pr.p_from === "string" ? JSON.parse(pr.p_from) : pr.p_from;
              if (Array.isArray(parsed) && parsed.length === 2) pxy = [parsed[0], parsed[1]];
            } catch {
              pxy = null;
            }
          }
          if (pxy) {
            const pt = feetPosition(slice.H, { x: pxy[0] - 0.02, y: pxy[1] - 0.04, w: 0.04, h: 0.04 }, slice.L, slice.W);
            if (pt) {
              const distFromOwn = defendsLeft ? pt[0] + slice.L / 2 : slice.L / 2 - pt[0];
              const pct = distFromOwn / slice.L;
              if (pct <= 0.60) opponentPassesInDef60++;
            }
          }
        }
      }

      const ppdaVal = validatePPDAEvidence({
        opponent_passes_def60: opponentPassesInDef60,
        defensive_actions_def60: defActionsInDef60,
        pitch_calibrated: slices.length > 0,
      });

      return {
        kit_group: kg,
        team_name: teamName,
        total_pressures: totalPressures,
        total_regains: totalRegains,
        overall_success_pct: overallSuccess,
        high_pressures: highPressures.length,
        high_press_regains: highRegains.length,
        high_press_success_pct: highSuccess,
        final_third_pressures: finalThirdPressures.length,
        final_third_regains: finalThirdRegains.length,
        avg_press_height_m: avgHeightM,
        avg_press_height_pct: avgHeightPct,
        measured_pressures: measured.length,
        ppda: ppdaVal.status === "MEASURED" ? (ppdaVal.value as number) : null,
        ppda_status: ppdaVal.status === "MEASURED" ? "MEASURED" : "NOT_MEASURED",
        ppda_reason: ppdaVal.reason,
      };
    });

    return PressingAnalysis.parse({
      video_id: videoId,
      ball_track_id: bt.id,
      is_calibrated: slices.length > 0,
      pitch_length_m: pitchLength,
      pitch_width_m: pitchWidth,
      teams,
      pressures,
      not_measured_reason: slices.length === 0 ? "Pitch calibration required to measure pitch positions, press height, and final-third regains." : null,
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class PressingController {
  constructor(private readonly service: PressingService) {}

  @Get("videos/:videoId/pressing")
  get(@Param("videoId") id: string, @CurrentPrincipal() p: Principal) {
    return this.service.get(uuidParam(id, "Video"), p);
  }
}
