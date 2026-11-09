/**
 * v3 Phase B.12 (ADR-088): the Library table's Rights, Evidence and Profile facts, one call for every video the caller may see.
 *
 *   GET /v1/library/facts   per video: its current rights grant (state, allowed uses, why nothing new may be made or analysed now),
 *                           whether a finished analysis exists, its tracks and person-confirmed tracks (latest finished run), and the
 *                           profile the latest analysis ran with (else the one chosen at upload)
 *
 * Recorded facts only; the caller's organization and project access (hidden projects' videos are left out); removed videos left out.
 */
import { Controller, Get, Injectable, UseGuards } from "@nestjs/common";
import { analysisBlock, ANALYSIS_RIGHTS_REASONS, LibraryFacts } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { notHidden } from "../../core/access";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";

const json = <T>(v: unknown): T | null => (v === null || v === undefined ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

@Injectable()
export class LibraryFactsService {
  constructor(private readonly db: Db) {}

  async facts(p: Principal): Promise<LibraryFacts> {
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT v.id, g.rights_state, g.allowed_uses, g.valid_from, g.valid_until, g.guardian_consent_state, o.analysis_profile, o.auto_profile,
              r.id AS run_id, JSON_UNQUOTE(JSON_EXTRACT(r.config, '$.profile')) AS run_profile,
              (SELECT COUNT(*) FROM tracks t WHERE t.run_id = r.id) AS tracks,
              (SELECT COUNT(*) FROM tracks t JOIN v_track_current_identity ci ON ci.track_id = t.id AND ci.state = 'CONFIRMED' WHERE t.run_id = r.id) AS confirmed
         FROM video_sources v
         LEFT JOIN rights_grants g ON g.id = (SELECT g2.id FROM rights_grants g2 WHERE g2.video_id = v.id AND g2.organization_id = v.organization_id ORDER BY g2.created_at DESC, g2.id DESC LIMIT 1)
         LEFT JOIN video_ingest_options o ON o.video_id = v.id
         LEFT JOIN pipeline_runs r ON r.id = (SELECT r2.id FROM pipeline_runs r2 WHERE r2.video_id = v.id AND r2.organization_id = v.organization_id AND r2.status = 'SUCCEEDED'
                                              ORDER BY r2.finished_at DESC, r2.id DESC LIMIT 1)
        WHERE v.organization_id = ? AND v.removed_at IS NULL${notHidden(p, "v.project_id")}
        ORDER BY v.created_at, v.id`, [p.organizationId]);
    const now = new Date();
    return LibraryFacts.parse({
      videos: rows.map((r) => {
        const g = r.rights_state ? { rights_state: r.rights_state as string, allowed_uses: json<string[]>(r.allowed_uses) ?? [], valid_from: r.valid_from, valid_until: r.valid_until,
          guardian_consent_state: r.guardian_consent_state as string } : null;
        const why = (use: "ANALYZE" | "PRODUCE") => { const c = analysisBlock(g, now, use); return c ? ANALYSIS_RIGHTS_REASONS[c] : null; };
        return {
          video_id: r.id, rights: g ? { state: g.rights_state, uses: g.allowed_uses, produce_block: why("PRODUCE"), analyse_block: why("ANALYZE") } : null,
          analysed: !!r.run_id, tracks: Number(r.tracks ?? 0), confirmed_tracks: Number(r.confirmed ?? 0),
          profile: (r.run_profile && r.run_profile !== "null" ? r.run_profile : null) ?? r.auto_profile ?? r.analysis_profile ?? null,
        };
      }),
    });
  }
}

@Controller("v1/library")
@UseGuards(AuthGuard)
export class LibraryFactsController {
  constructor(private readonly s: LibraryFactsService) {}

  @Get("facts")
  facts(@CurrentPrincipal() p: Principal) { return this.s.facts(p); }
}
