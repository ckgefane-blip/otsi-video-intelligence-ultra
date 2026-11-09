/**
 * v3 Phase B.11 (ADR-087): Smart Bins, a person's saved Smart Searches that fill themselves.
 *
 *   GET    /v1/smart-bins                 the caller's bins in this organization, each with what it holds now
 *   POST   /v1/smart-bins {name, q}       save one (any member: it is a personal view); the same name again replaces its query
 *   GET    /v1/smart-bins/:id/items       what it holds now (up to BIN_CAP of each kind); ?video= only that video's matches, moments, markers
 *   DELETE /v1/smart-bins/:id             delete one of the caller's own
 *
 * A bin is a row of `saved_searches` whose query is `{ "smart": "<query>" }`, so it is never listed among the Library's saved
 * searches (which hold the Library's own tab and filters). A name already used by a Library saved search is refused (409), never
 * overwritten. A query with no words and no filter, or with a filter not understood, is refused (422): a bin must say what it holds.
 * What a bin holds comes from GET /v1/search's rules and access checks; nothing is stored but the query.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, Query, UseGuards } from "@nestjs/common";
import { BIN_CAP, CreateSmartBinRequest, hasCriteria, parseSmartQuery, SmartBin, SmartBinItems, type SearchHit } from "@otsi-vie/contracts";
import { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { AuthGuard, CurrentPrincipal, Principal } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { SearchService } from "../overview/search";
import { uuidParam } from "../players/players.controller";

const iso = (v: unknown) => new Date(v as string).toISOString();
const obj = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : v) as Record<string, unknown>;
const ROW = "SELECT id, name, query, created_at FROM saved_searches WHERE organization_id = ? AND user_id = ? AND JSON_EXTRACT(query, '$.smart') IS NOT NULL";

@Injectable()
export class SmartBinsService {
  constructor(private readonly db: Db, private readonly search: SearchService) {}

  private async fill(r: RowDataPacket, p: Principal, videoId: string | null = null): Promise<{ bin: SmartBin; hits: SearchHit[] }> {
    const q = String(obj(r.query).smart);
    const { hits } = await this.search.search(q, p, { each: BIN_CAP, fresh: true, videoId });
    const per = new Map<string, number>();
    for (const h of hits) per.set(h.kind, (per.get(h.kind) ?? 0) + 1);
    const bin = SmartBin.parse({ id: r.id, name: r.name, q, count: hits.length, more: [...per.values()].some((n) => n >= BIN_CAP), created_at: iso(r.created_at) });
    return { bin, hits };
  }

  async list(p: Principal): Promise<SmartBin[]> {
    const rows = await this.db.rows<RowDataPacket>(`${ROW} ORDER BY name, id`, [p.organizationId, p.userId]);
    if (!rows.length) return [];
    await this.search.catchUp(p.organizationId);
    const out: SmartBin[] = [];
    for (const r of rows) out.push((await this.fill(r, p)).bin);
    return out;
  }

  async items(id: string, p: Principal, videoId: string | null): Promise<SmartBinItems> {
    const r = await this.db.one<RowDataPacket>(`${ROW} AND id = ?`, [p.organizationId, p.userId, id]);
    if (!r) throw notFound("Smart bin");
    await this.search.catchUp(p.organizationId);
    return SmartBinItems.parse(await this.fill(r, p, videoId));
  }

  async save(body: CreateSmartBinRequest, p: Principal): Promise<SmartBin> {
    const s = parseSmartQuery(body.q);
    if (s.unknown.length) throw new ApiError(422, "BAD_BIN_QUERY", `Not understood: ${s.unknown.join(" ")}. Filters are type:, event: and is: (for example event:goal, is:confirmed).`);
    if (!hasCriteria(s)) throw new ApiError(422, "BAD_BIN_QUERY", "Say what the bin holds: at least one word or filter.");
    return this.db.tx(async (c) => {
      const [[clash]] = await c.query<RowDataPacket[]>("SELECT id, JSON_EXTRACT(query, '$.smart') IS NOT NULL AS smart FROM saved_searches WHERE organization_id = ? AND user_id = ? AND name = ? FOR UPDATE",
        [p.organizationId, p.userId, body.name]);
      if (clash && !Number(clash.smart)) throw new ApiError(409, "NAME_TAKEN", `“${body.name}” is already one of your saved Library searches. Choose another name.`);
      if (clash) await c.query("UPDATE saved_searches SET query = ? WHERE id = ?", [JSON.stringify({ smart: body.q }), clash.id]);
      else await c.query("INSERT INTO saved_searches (id, organization_id, user_id, name, query) VALUES (?, ?, ?, ?, ?)", [uuidv7(), p.organizationId, p.userId, body.name, JSON.stringify({ smart: body.q })]);
      const [[r]] = await c.query<RowDataPacket[]>(`${ROW} AND name = ?`, [p.organizationId, p.userId, body.name]);
      return r!;
    }).then(async (r) => { await this.search.catchUp(p.organizationId); return (await this.fill(r, p)).bin; });
  }

  async remove(id: string, p: Principal): Promise<void> {
    const [res] = await this.db.pool.query<ResultSetHeader>("DELETE FROM saved_searches WHERE id = ? AND organization_id = ? AND user_id = ? AND JSON_EXTRACT(query, '$.smart') IS NOT NULL",
      [id, p.organizationId, p.userId]);
    if (res.affectedRows === 0) throw notFound("Smart bin");
  }
}

@Controller("v1/smart-bins")
@UseGuards(AuthGuard)
export class SmartBinsController {
  constructor(private readonly bins: SmartBinsService) {}

  @Get()
  list(@CurrentPrincipal() p: Principal) { return this.bins.list(p); }

  @Post()
  save(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const r = CreateSmartBinRequest.safeParse(body);
    if (!r.success) throw new ApiError(422, "BAD_BIN_QUERY", "A bin needs a name (1-80 characters) and a search (2-80 characters).");
    return this.bins.save(r.data, p);
  }

  @Get(":id/items")
  items(@Param("id") id: string, @Query("video") video: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.bins.items(uuidParam(id, "Smart bin"), p, video ? uuidParam(video, "Video") : null);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@Param("id") id: string, @CurrentPrincipal() p: Principal) { await this.bins.remove(uuidParam(id, "Smart bin"), p); }
}
