/**
 * v3 Phase A.8 (S03, ADR-070) and B.10 (ADR-086): global Smart Search for the header palette.
 *
 *   GET /v1/search?q=   (2-80 characters) words and filters (see contracts `search.ts`): matches, players, reels, projects, the
 *                       engine's moments and people's markers; at most 8 of each kind, best first.
 *
 * It reads the search index (modules/search/indexer.ts), first bringing the organization's index up to date with what changed (so a
 * search never misses something just recorded). Every word must start a word of the item; a word in the title ranks higher, an exact
 * word higher still. The index never decides access: each hit is re-checked against the canonical rows here (the caller's
 * organization; removed items, hidden projects and their videos, merged players left out; a player only when the organization created
 * him or confirmed him on one of its visible videos).
 */
import { Controller, Get, Injectable, Query, UseGuards } from "@nestjs/common";
import { hasCriteria, parseSmartQuery, SearchKind, SearchQuery, SearchResponse, type SearchHit } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { notHidden } from "../../core/access";
import { Db } from "../../core/db";
import { catchUp } from "../search/indexer";

const EACH = 8;
const ORDER: SearchKind[] = ["MATCH", "PLAYER", "REEL", "PROJECT", "MOMENT", "MARKER"];

@Injectable()
export class SearchService {
  constructor(private readonly db: Db) {}

  /** bring the organization's index up to date (done before every search unless the caller already did) */
  catchUp(org: string) { return this.db.retryTransient(() => this.db.tx((c) => catchUp(c, org))); }

  /** `each`: at most so many hits of each kind; `fresh`: the index was just brought up to date; `videoId`: only that video's matches, moments and markers */
  async search(raw: string, p: Principal, o: { each?: number; fresh?: boolean; videoId?: string | null } = {}): Promise<SearchResponse> {
    const q = SearchQuery.parse({ q: raw }).q, org = p.organizationId, each = o.each ?? EACH;
    const s = parseSmartQuery(q);
    if (!hasCriteria(s)) return SearchResponse.parse({ q, hits: [] });
    if (!o.fresh) await this.catchUp(org);
    let kinds = s.kinds;
    if (!kinds.length && s.analysed !== null) kinds = ["MATCH"];
    if (!kinds.length && s.confirmed !== null) kinds = ["PLAYER", "MOMENT"];
    if (!kinds.length && s.period !== null) kinds = ["MOMENT", "MARKER"];
    if (!kinds.length && (s.role !== null || s.role_confirmed_only !== null)) kinds = ["PLAYER"];
    const where: string[] = ["d.organization_id = ?"], params: unknown[] = [org];
    if (kinds.length) { where.push(`d.kind IN (${kinds.map(() => "?").join(", ")})`); params.push(...kinds); }
    if (o.videoId) { where.push("d.video_id = ?"); params.push(o.videoId); }
    if (s.events.length) { where.push(`(d.kind <> 'MOMENT' OR d.event_type IN (${s.events.map(() => "?").join(", ")}))`); params.push(...s.events); }
    if (s.period !== null) { where.push("(d.kind NOT IN ('MOMENT', 'MARKER') OR d.period = ?)"); params.push(s.period); }
    if (s.analysed !== null) { where.push("(d.kind <> 'MATCH' OR d.analysed = ?)"); params.push(s.analysed ? 1 : 0); }
    if (s.confirmed !== null) { where.push("(d.kind NOT IN ('PLAYER', 'MOMENT') OR d.confirmed = ?)"); params.push(s.confirmed ? 1 : 0); }
    if (s.role !== null) {
      where.push("(d.kind <> 'PLAYER' OR EXISTS (SELECT 1 FROM players pl WHERE pl.id = d.entity_id AND pl.primary_position = ? AND pl.role_confirmation_state = 'ROLE_CONFIRMED'))");
      params.push(s.role);
    }
    if (s.role_confirmed_only === true) {
      where.push("(d.kind <> 'PLAYER' OR EXISTS (SELECT 1 FROM players pl WHERE pl.id = d.entity_id AND pl.role_confirmation_state = 'ROLE_CONFIRMED'))");
    } else if (s.role_confirmed_only === false) {
      where.push("(d.kind <> 'PLAYER' OR EXISTS (SELECT 1 FROM players pl WHERE pl.id = d.entity_id AND pl.role_confirmation_state = 'ROLE_PROVISIONAL'))");
    }
    // access, from the canonical rows
    where.push(`((d.kind IN ('MATCH', 'MOMENT', 'MARKER') AND EXISTS (SELECT 1 FROM video_sources v WHERE v.id = d.video_id AND v.organization_id = d.organization_id AND v.removed_at IS NULL${notHidden(p, "v.project_id")}))
      OR (d.kind = 'REEL' AND EXISTS (SELECT 1 FROM reel_projects r WHERE r.id = d.entity_id AND r.organization_id = d.organization_id AND r.removed_at IS NULL${notHidden(p, "r.project_id")}))
      OR (d.kind = 'PROJECT' AND EXISTS (SELECT 1 FROM projects pr WHERE pr.id = d.entity_id AND pr.organization_id = d.organization_id AND pr.removed_at IS NULL${notHidden(p, "pr.id")}))
      OR (d.kind = 'PLAYER' AND EXISTS (SELECT 1 FROM players pl WHERE pl.id = d.entity_id AND pl.merged_into_player_id IS NULL AND (pl.created_by_organization_id = d.organization_id
            OR EXISTS (SELECT 1 FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
                       WHERE ci.player_id = pl.id AND ci.state = 'CONFIRMED' AND v.organization_id = d.organization_id AND v.removed_at IS NULL${notHidden(p, "v.project_id")})))))`);
    where.push("(d.kind <> 'MARKER' OR EXISTS (SELECT 1 FROM video_markers mk WHERE mk.id = d.entity_id AND mk.removed_at IS NULL))");
    // each word must start a word of the item: 3 in the title, 1 elsewhere, +1 when it is the whole word; a missing word makes the score NULL
    const score = s.words.length
      ? s.words.map(() => "(SELECT MAX(IF(t.field = 1, 3, 1) + (t.term = ?)) FROM search_terms t WHERE t.doc_id = d.id AND t.term LIKE ?)").join(" + ")
      : "0";
    const scoreParams = s.words.flatMap((w) => [w, `${w}%`]);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT * FROM (
         SELECT x.*, ROW_NUMBER() OVER (PARTITION BY x.kind ORDER BY x.score DESC, x.sort_at DESC, x.at_us, x.id) AS rn
           FROM (SELECT d.id, d.kind, d.entity_id, d.video_id, d.at_us, d.period, d.title, d.detail, d.ref, d.sort_at, ${score} AS score
                   FROM search_documents d WHERE ${where.join(" AND ")}) x
          WHERE x.score IS NOT NULL) y
        WHERE y.rn <= ${Math.max(1, Math.min(500, Math.floor(each)))}`, [...scoreParams, ...params]);
    rows.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || Number(a.rn) - Number(b.rn));
    const hits: SearchHit[] = rows.map((r) => ({
      kind: r.kind, id: r.entity_id, title: r.title, detail: r.detail ?? null, ref: r.ref ?? null,
      video_id: r.kind === "MOMENT" || r.kind === "MARKER" ? r.video_id : null, at_us: r.at_us === null ? null : Number(r.at_us),
      period: (r.kind === "MOMENT" || r.kind === "MARKER") && r.period ? (r.period as "H1" | "H2") : null,
    }));
    return SearchResponse.parse({ q, hits });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class SearchController {
  constructor(private readonly s: SearchService) {}

  @Get("search")
  search(@Query("q") q: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.s.search(q ?? "", p);
  }
}
