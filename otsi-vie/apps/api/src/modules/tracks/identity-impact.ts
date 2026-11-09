/**
 * v3 Phase B.7 (ADR-084): the identity impact preview. Before a person saves an identity decision, the page asks what it would make out
 * of date, so nobody breaks a rendered or shared reel, or a made report, without seeing it first.
 *
 *   GET /v1/identity-impact?track_ids=a,b&state=CONFIRMED&player_id=x
 *
 * A track "changes" when its current decision differs from the one proposed (state or player). For the changing tracks:
 * - reels that follow one of them under its current decision (the reel would become stale; ReelsService refuses to render it until its
 *   targets are refreshed), with their finished renders and live share links;
 * - made PDF reports (report_jobs SUCCEEDED) of the player who loses the tracks (current CONFIRMED player) and of the player who gains them.
 * Read only; tenant scope: tracks of another organization are a 404, as everywhere.
 */
import { Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { IdentityImpact, TrackDecisionState } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";

const Query_ = z.object({
  track_ids: z.string().transform((s) => [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))]).pipe(z.array(z.string().uuid()).min(1).max(200)),
  state: TrackDecisionState,
  player_id: z.string().uuid().optional(),
});

@Injectable()
export class IdentityImpactService {
  constructor(private readonly db: Db) {}

  async impact(q: z.infer<typeof Query_>, p: Principal): Promise<IdentityImpact> {
    const cur = await this.db.rows<RowDataPacket>(
      `SELECT t.id, ci.decision_id, ci.state, ci.player_id FROM tracks t JOIN pipeline_runs r ON r.id = t.run_id AND r.organization_id = ?
         LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id WHERE t.id IN (?)`, [p.organizationId, q.track_ids]);
    if (cur.length !== q.track_ids.length) throw notFound("Track");
    const next = q.player_id ?? null;
    const changing = cur.filter((c) => (c.state ?? "UNRESOLVED") !== q.state || (c.player_id ?? null) !== next);
    const out: IdentityImpact = { changing_tracks: changing.length, unchanged_tracks: cur.length - changing.length, reels: [], reports: [] };
    if (!changing.length) return IdentityImpact.parse(out);
    const ids = changing.map((c) => c.id as string);
    const reels = await this.db.rows<RowDataPacket>(
      `SELECT rp.id, rp.name,
              (SELECT COUNT(*) FROM render_jobs rj WHERE rj.reel_id = rp.id AND rj.state = 'SUCCEEDED') AS renders,
              (SELECT COUNT(*) FROM render_jobs rj JOIN share_links sl ON sl.asset_id = rj.output_asset_id AND sl.organization_id = rj.organization_id
                WHERE rj.reel_id = rp.id AND sl.revoked_at IS NULL AND (sl.expires_at IS NULL OR sl.expires_at > CURRENT_TIMESTAMP(6))) AS live_links
         FROM reel_targets rt
         JOIN reel_projects rp ON rp.id = rt.reel_id AND rp.organization_id = ? AND rp.removed_at IS NULL
         JOIN v_track_current_identity ci ON ci.track_id = rt.track_id AND ci.decision_id = rt.identity_decision_id
        WHERE rt.track_id IN (?) GROUP BY rp.id, rp.name ORDER BY rp.name LIMIT 100`, [p.organizationId, ids]);
    out.reels = reels.map((r) => ({ reel_id: r.id, name: r.name ?? "Untitled reel", renders: Number(r.renders), live_links: Number(r.live_links) }));
    const losers = [...new Set(changing.filter((c) => c.state === "CONFIRMED" && c.player_id && c.player_id !== next).map((c) => c.player_id as string))];
    const gainer = q.state === "CONFIRMED" && next ? next : null;
    const players: [string, "LOSES" | "GAINS"][] = [...losers.map((x) => [x, "LOSES"] as [string, "LOSES"]), ...(gainer && !losers.includes(gainer) ? [[gainer, "GAINS"] as [string, "GAINS"]] : [])];
    if (players.length) {
      const rows = await this.db.rows<RowDataPacket>(
        `SELECT pi.player_id, pi.display_name, COUNT(j.id) AS pdfs, MAX(j.created_at) AS latest_at FROM v_player_identity pi
           LEFT JOIN report_jobs j ON j.player_id = pi.player_id AND j.organization_id = ? AND j.state = 'SUCCEEDED'
          WHERE pi.player_id IN (?) GROUP BY pi.player_id, pi.display_name`, [p.organizationId, players.map(([x]) => x)]);
      const by = new Map(rows.map((r) => [r.player_id as string, r]));
      out.reports = players.flatMap(([id, role]) => {
        const r = by.get(id);
        return r ? [{ player_id: id, name: r.display_name as string, pdfs: Number(r.pdfs), latest_at: r.latest_at ? new Date(r.latest_at).toISOString() : null, role }] : [];
      });
    }
    return IdentityImpact.parse(out);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class IdentityImpactController {
  constructor(private readonly impact: IdentityImpactService) {}

  @Get("identity-impact")
  get(@Query() q: unknown, @CurrentPrincipal() p: Principal) {
    const r = Query_.safeParse(q);
    if (!r.success) throw new ApiError(422, "BAD_IMPACT_QUERY", "Name the tracks (track_ids), the decision (state) and, for a confirmation, the player.");
    return this.impact.impact(r.data, p);
  }
}
