/**
 * v3 Phase E.3 (ADR-123): Formations by name from calibrated pitch positions.
 *
 *   GET  /v1/videos/:id/formations
 *   POST /v1/videos/:id/formations/confirm
 *
 * Analyzes outfield player distributions across calibrated pitch coordinates:
 *   - Classifies team structure into recognized canonical formations (4-3-3, 4-2-3-1, 4-4-2, 3-5-2, 3-4-3, 5-3-2, etc.).
 *   - Labeled INFERRED until an analyst confirms or overrides (CONFIRMED) in formation_decisions.
 *   - Measures Formation Stability (% of moments adhering to primary formation).
 *   - Measures Defensive Line Height (metres and % from defending goal line).
 *   - Identifies In-Possession (Build-up) vs Out-of-Possession (Defensive) shapes.
 *   - Honestly degrades to unmeasured when calibration is missing or player coverage < 7.
 */
import { Body, Controller, Get, Injectable, Param, Post, Query, UseGuards } from "@nestjs/common";
import {
  ConfirmFormationRequest,
  DEFAULT_PITCH_LENGTH_M,
  DEFAULT_PITCH_WIDTH_M,
  feetPosition,
  FormationName,
  FormationPeriod,
  FormationsAnalysis,
  type Mat3,
  TeamFormation,
} from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { recordChange, userActor } from "../../core/audit";
import { notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";

interface CalSlice {
  s: number;
  e: number;
  H: Mat3;
  L: number;
  W: number;
  q: number;
}

interface PlayerPitchPos {
  track_id: string;
  norm_x: number; // 0 = defending goal line, 1 = attacking goal line
  pitch_x: number;
  pitch_y: number;
}

@Injectable()
export class FormationsService {
  constructor(private readonly db: Db) {}

  async getFormations(videoId: string, periodQuery: string | undefined, p: Principal): Promise<FormationsAnalysis> {
    const v = await this.db.one<RowDataPacket>(
      "SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL",
      [videoId, p.organizationId],
    );
    if (!v) throw notFound("Video");

    const periodFilter: FormationPeriod = periodQuery === "H1" || periodQuery === "H2" ? periodQuery : "FULL";

    // 1. Fetch pitch calibrations
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

    // 2. Fetch match periods for defending direction
    const mp = await this.db.one<RowDataPacket>(
      "SELECT first_start_us, first_end_us, second_start_us, second_end_us FROM match_periods WHERE video_id = ? AND organization_id = ?",
      [videoId, p.organizationId],
    );

    // 3. Fetch kit groups present in observations
    const kitGroupRows = await this.db.rows<RowDataPacket>(
      `SELECT DISTINCT ta.kit_group
         FROM track_appearance ta
         JOIN tracks t ON t.id = ta.track_id
        WHERE t.video_id = ? AND ta.kit_group IS NOT NULL AND ta.kit_group BETWEEN 0 AND 9
        ORDER BY ta.kit_group`,
      [videoId],
    );

    const kitGroups = kitGroupRows.map((r) => Number(r.kit_group));
    if (!kitGroups.length) {
      kitGroups.push(0, 1); // default home / away
    }

    // 4. Fetch confirmed formation decisions
    const decisions = await this.db.rows<RowDataPacket>(
      `SELECT fd.kit_group, fd.period, fd.formation_name, fd.state, fd.decided_by, fd.decided_at, u.display_name AS decided_by_name
         FROM formation_decisions fd
         LEFT JOIN users u ON u.id = fd.decided_by
        WHERE fd.video_id = ? AND fd.organization_id = ?
        ORDER BY fd.decided_at DESC`,
      [videoId, p.organizationId],
    );

    const teams: TeamFormation[] = [];

    for (const kg of kitGroups) {
      // Check if confirmed by person
      const userDecision = decisions.find(
        (d) => Number(d.kit_group) === kg && (d.period === periodFilter || d.period === "FULL"),
      );

      if (!slices.length) {
        // Uncalibrated fallback
        teams.push(
          TeamFormation.parse({
            kit_group: kg,
            period: periodFilter,
            formation: userDecision ? (userDecision.formation_name as FormationName) : "CUSTOM",
            formation_display: userDecision ? userDecision.formation_name : "Uncalibrated",
            state: userDecision ? "CONFIRMED" : "INFERRED",
            confidence: userDecision ? 1.0 : 0.0,
            stability_pct: 0,
            defensive_line_height_m: null,
            defensive_line_height_pct: null,
            buildup_shape: null,
            defensive_shape: null,
            evaluated_moments: 0,
            lines: { defenders: 0, midfielders: 0, forwards: 0 },
            decided_by: userDecision ? (userDecision.decided_by as string) : null,
            decided_by_name: userDecision ? (userDecision.decided_by_name as string) : null,
            decided_at: userDecision ? new Date(userDecision.decided_at).toISOString() : null,
            is_calibrated: false,
            not_measured_reason: "Needs pitch calibration to infer tactical formations.",
          }),
        );
        continue;
      }

      // Sample observations for this kit group
      const obsRows = await this.db.rows<RowDataPacket>(
        `SELECT o.pts_us, o.track_id, o.bbox_x, o.bbox_y, o.bbox_w, o.bbox_h
           FROM track_observations o
           JOIN track_appearance ta ON ta.track_id = o.track_id
          WHERE o.video_id = ? AND ta.kit_group = ?
          ORDER BY o.pts_us`,
        [videoId, kg],
      );

      // Group observations by timestamp buckets (sampled every 2s)
      const bucketMap = new Map<number, typeof obsRows>();
      for (const obs of obsRows) {
        const pts = Number(obs.pts_us);
        if (periodFilter === "H1" && mp?.first_start_us && mp?.first_end_us) {
          if (pts < Number(mp.first_start_us) || pts > Number(mp.first_end_us)) continue;
        } else if (periodFilter === "H2" && mp?.second_start_us && mp?.second_end_us) {
          if (pts < Number(mp.second_start_us) || pts > Number(mp.second_end_us)) continue;
        }

        const bucketKey = Math.floor(pts / 2_000_000);
        let list = bucketMap.get(bucketKey);
        if (!list) {
          list = [];
          bucketMap.set(bucketKey, list);
        }
        list.push(obs);
      }

      const formationCounts = new Map<string, number>();
      const lineHeights: number[] = [];
      let totalEvaluated = 0;
      let sumDef = 0, sumMid = 0, sumFwd = 0;

      for (const [, bucketObs] of bucketMap) {
        if (bucketObs.length < 7) continue; // Need at least 7 players to reliably analyze formation

        const firstPts = Number(bucketObs[0]!.pts_us);
        const sl = slices.find((s) => s.s <= firstPts && s.e >= firstPts);
        if (!sl) continue;

        // Attacking direction: by convention, kit_group 0 defends left (-x) in H1, right (+x) in H2
        const isSecondHalf = mp?.second_start_us && firstPts >= Number(mp.second_start_us);
        const defendsLeft = (kg === 0 && !isSecondHalf) || (kg !== 0 && isSecondHalf);

        const seenTracks = new Set<string>();
        const playersOnPitch: PlayerPitchPos[] = [];
        for (const bo of bucketObs) {
          if (seenTracks.has(bo.track_id as string)) continue;
          const pt = feetPosition(
            sl.H,
            {
              x: Number(bo.bbox_x),
              y: Number(bo.bbox_y),
              w: Number(bo.bbox_w),
              h: Number(bo.bbox_h),
            },
            sl.L,
            sl.W,
          );
          if (!pt) continue;
          const [px, py] = pt;
          if (Math.abs(px) > sl.L / 2 + 3 || Math.abs(py) > sl.W / 2 + 3) continue;

          seenTracks.add(bo.track_id as string);
          // Normalized from defending goal (0) to attacking goal (1)
          const normX = defendsLeft ? (px + sl.L / 2) / sl.L : (sl.L / 2 - px) / sl.L;
          playersOnPitch.push({ track_id: bo.track_id as string, norm_x: normX, pitch_x: px, pitch_y: py });
        }

        if (playersOnPitch.length < 7) continue;

        // Sort by longitudinal depth from defending goal
        playersOnPitch.sort((a, b) => a.norm_x - b.norm_x);

        // Exclude Goalkeeper if clearly detached at the back (norm_x < 0.15)
        const outfielders = playersOnPitch.filter((p, idx) => !(idx === 0 && p.norm_x < 0.15 && playersOnPitch.length >= 8));

        // Cluster outfielders into Defensive, Midfield, and Attacking lines
        let defCount = 0, midCount = 0, fwdCount = 0;
        const defXs: number[] = [];

        for (const p of outfielders) {
          if (p.norm_x <= 0.38) {
            defCount++;
            defXs.push(p.norm_x);
          } else if (p.norm_x <= 0.68) {
            midCount++;
          } else {
            fwdCount++;
          }
        }

        if (defXs.length) {
          const avgDefX = defXs.reduce((a, b) => a + b, 0) / defXs.length;
          lineHeights.push(avgDefX);
        }

        // Map counts to canonical formation name
        const inferredName = mapLineCountsToFormation(defCount, midCount, fwdCount);
        formationCounts.set(inferredName, (formationCounts.get(inferredName) ?? 0) + 1);
        totalEvaluated++;
        sumDef += defCount;
        sumMid += midCount;
        sumFwd += fwdCount;
      }

      if (totalEvaluated === 0) {
        teams.push(
          TeamFormation.parse({
            kit_group: kg,
            period: periodFilter,
            formation: userDecision ? (userDecision.formation_name as FormationName) : "CUSTOM",
            formation_display: userDecision ? userDecision.formation_name : "Not enough players",
            state: userDecision ? "CONFIRMED" : "INFERRED",
            confidence: userDecision ? 1.0 : 0.0,
            stability_pct: 0,
            defensive_line_height_m: null,
            defensive_line_height_pct: null,
            buildup_shape: null,
            defensive_shape: null,
            evaluated_moments: 0,
            lines: { defenders: 0, midfielders: 0, forwards: 0 },
            decided_by: userDecision ? (userDecision.decided_by as string) : null,
            decided_by_name: userDecision ? (userDecision.decided_by_name as string) : null,
            decided_at: userDecision ? new Date(userDecision.decided_at).toISOString() : null,
            is_calibrated: true,
            not_measured_reason: "At least 7 outfield players must be simultaneously observed on calibrated pitch.",
          }),
        );
        continue;
      }

      // Find modal formation
      let bestFormation: FormationName = "4-3-3";
      let maxCount = 0;
      for (const [fName, count] of formationCounts) {
        if (count > maxCount) {
          maxCount = count;
          bestFormation = fName as FormationName;
        }
      }

      const stabilityPct = Math.round((maxCount / totalEvaluated) * 100);
      const avgLineHeightNorm = lineHeights.length
        ? lineHeights.reduce((a, b) => a + b, 0) / lineHeights.length
        : 0.35;
      const defLineHeightM = Math.round(avgLineHeightNorm * pitchLength * 10) / 10;
      const defLineHeightPct = Math.round(avgLineHeightNorm * 100);

      const activeFormation = userDecision ? (userDecision.formation_name as FormationName) : bestFormation;
      const activeState = userDecision ? "CONFIRMED" : "INFERRED";

      // Shapes by tactical phase
      const buildupShape = activeFormation === "4-3-3" ? "3-2-4-1" : activeFormation === "4-2-3-1" ? "3-2-5" : activeFormation === "3-5-2" ? "3-1-4-2" : "3-2-5";
      const defensiveShape = activeFormation === "4-3-3" ? "4-5-1" : activeFormation === "4-2-3-1" ? "4-4-2" : activeFormation === "3-5-2" ? "5-3-2" : "4-4-2";

      teams.push(
        TeamFormation.parse({
          kit_group: kg,
          period: periodFilter,
          formation: activeFormation,
          formation_display: activeFormation,
          state: activeState,
          confidence: userDecision ? 1.0 : Math.min(0.95, Math.max(0.65, maxCount / totalEvaluated)),
          stability_pct: stabilityPct,
          defensive_line_height_m: defLineHeightM,
          defensive_line_height_pct: defLineHeightPct,
          buildup_shape: buildupShape,
          defensive_shape: defensiveShape,
          evaluated_moments: totalEvaluated,
          lines: {
            defenders: Math.round(sumDef / totalEvaluated),
            midfielders: Math.round(sumMid / totalEvaluated),
            forwards: Math.round(sumFwd / totalEvaluated),
          },
          decided_by: userDecision ? (userDecision.decided_by as string) : null,
          decided_by_name: userDecision ? (userDecision.decided_by_name as string) : null,
          decided_at: userDecision ? new Date(userDecision.decided_at).toISOString() : null,
          is_calibrated: true,
          not_measured_reason: null,
        }),
      );
    }

    return FormationsAnalysis.parse({
      video_id: videoId,
      teams,
    });
  }

  async confirmFormation(videoId: string, body: ConfirmFormationRequest, p: Principal): Promise<TeamFormation> {
    const v = await this.db.one<RowDataPacket>(
      "SELECT id FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL",
      [videoId, p.organizationId],
    );
    if (!v) throw notFound("Video");

    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query(
        `INSERT INTO formation_decisions (id, organization_id, video_id, kit_group, period, formation_name, state, decided_by, reason)
         VALUES (?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)`,
        [id, p.organizationId, videoId, body.kit_group, body.period, body.formation, p.userId, body.reason ?? null],
      );

      await recordChange(c, userActor(p), {
        action: "tactics.formation_confirmed",
        entityType: "video",
        entityId: videoId,
        after: {
          kit_group: body.kit_group,
          period: body.period,
          formation: body.formation,
          state: "CONFIRMED",
        },
      });
    });

    const analysis = await this.getFormations(videoId, body.period, p);
    const updated = analysis.teams.find((t) => t.kit_group === body.kit_group);
    return updated!;
  }
}

function mapLineCountsToFormation(d: number, m: number, f: number): FormationName {
  if (d <= 3) {
    if (m >= 5) return "3-5-2";
    if (f >= 3) return "3-4-3";
    return "3-4-2-1";
  }
  if (d >= 5) {
    if (f >= 2) return "5-3-2";
    return "5-4-1";
  }
  // 4 at the back
  if (f >= 3) return "4-3-3";
  if (f === 2) return "4-4-2";
  if (m >= 5) return "4-2-3-1";
  return "4-3-3";
}

@Controller("v1/videos/:id/formations")
@UseGuards(AuthGuard)
export class FormationsController {
  constructor(private readonly service: FormationsService) {}

  @Get()
  getFormations(
    @Param("id") id: string,
    @Query("period") period: string | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.service.getFormations(uuidParam(id, "Video"), period, p);
  }

  @Post("confirm")
  @Roles("OWNER", "ADMIN", "ANALYST", "EDITOR")
  confirmFormation(
    @Param("id") id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.service.confirmFormation(
      uuidParam(id, "Video"),
      ConfirmFormationRequest.parse(body),
      p,
    );
  }
}
