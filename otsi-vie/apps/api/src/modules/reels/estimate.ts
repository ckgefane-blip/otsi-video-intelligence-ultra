/**
 * v3 Phase B.13 (ADR-089): how long Generate Reel may take, from this organization's own finished renders.
 *
 *   GET /v1/reels/:id/render-estimate   per finished render: start → finish ÷ the reel seconds the worker measured it made
 *                                       (result.duration_s); the median of the 10 most recent with this reel's Auto Track setting
 *                                       (else any), times this reel's length; and how many renders are queued or running now
 *
 * Measured facts only: no finished render, no estimate. The caller must be able to see the reel (ReelsService.get checks it).
 */
import { Controller, Get, Injectable, Param, UseGuards } from "@nestjs/common";
import { estimateFrom, RenderEstimate, type RenderSample } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { uuidParam } from "../players/players.controller";
import { ReelsService } from "./reels";

@Injectable()
export class RenderEstimateService {
  constructor(private readonly db: Db, private readonly reels: ReelsService) {}

  async estimate(id: string, p: Principal): Promise<RenderEstimate> {
    const reel = await this.reels.get(id, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT TIMESTAMPDIFF(MICROSECOND, started_at, completed_at) / 1e6 AS elapsed_s,
              CAST(JSON_UNQUOTE(JSON_EXTRACT(result, '$.duration_s')) AS DECIMAL(12,3)) AS output_s,
              JSON_EXTRACT(config, '$.settings.auto_track') AS auto_track
         FROM render_jobs
        WHERE organization_id = ? AND state = 'SUCCEEDED' AND started_at IS NOT NULL AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, id DESC LIMIT 100`, [p.organizationId]);
    const samples: RenderSample[] = rows.map((r) => ({ elapsed_s: Number(r.elapsed_s ?? 0), output_s: Number(r.output_s ?? 0),
      auto_track: !(r.auto_track === false || r.auto_track === "false" || r.auto_track === 0) }));
    const open = await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n FROM render_jobs WHERE organization_id = ? AND state IN ('QUEUED', 'RUNNING')", [p.organizationId]);
    return RenderEstimate.parse(estimateFrom(samples, reel.duration_us, reel.settings.auto_track, Number(open?.n ?? 0)));
  }
}

@Controller("v1/reels")
@UseGuards(AuthGuard)
export class RenderEstimateController {
  constructor(private readonly s: RenderEstimateService) {}

  @Get(":reelId/render-estimate")
  estimate(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) { return this.s.estimate(uuidParam(id, "Reel"), p); }
}
