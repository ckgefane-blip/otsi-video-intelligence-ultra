/**
 * Same-person links between tracks and track thumbnails (Block 07, ADR-031).
 *
 *   GET  /v1/tracks/:id/thumbnail           the track's largest crop (JPEG), as recorded by the analysis worker
 *   GET  /v1/tracks/:id/links               suggestions that another track (before or after it) shows the same person, with that track's
 *                                           confirmed player (the basis of an identity SUGGESTION) and the current decision
 *   POST /v1/track-links/:id/decisions      a person confirms / rejects / resets a link (append-only; a correction needs a reason)
 *   GET  /v1/tracks/:id/person-group        tracks joined by CONFIRMED links: one person across occlusions and camera cuts
 *   GET  /v1/tracks/:id/look-alikes         tracks anywhere in the match that look like this person (from all his confirmed tracks)
 *
 * Links never change an identity by themselves: applying a player to the tracks of a group is an explicit identity decision per track
 * (POST /v1/tracks/:id/identity-decisions), made by a person. Tenant scope: tracks and links are reached only through a run of the caller's
 * organization; anything else is a 404.
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, Post, Res, UseGuards } from "@nestjs/common";
import { LinkDecisionRequest, LookAlikes, PersonGroup, TrackLink } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { createReadStream } from "node:fs";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db, Executor } from "../../core/db";
import { ApiError, fromDatabase, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { matchWindows, overlaps } from "../analysis/match-time";
import { uuidParam } from "../players/players.controller";

/** look-alikes shown at a time: a person checks each picture, and deciding them brings up the next ones */
const LOOK_ALIKE_PAGE = 24;

const label = (state: string, n: number, name: string | null, cid: string | null) =>
  state === "CONFIRMED" && name ? `${name} · ${cid ?? "provisional, no OTSI Player ID yet"}` : `Unidentified person · track ${n}`;

@Injectable()
export class TrackLinksService {
  private readonly store: LocalStore | null;

  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private async track(trackId: string, p: Principal, ex: Executor = this.db.pool): Promise<RowDataPacket> {
    const t = await this.db.one<RowDataPacket>(
      "SELECT t.id, t.run_id, t.internal_track_number FROM tracks t JOIN pipeline_runs r ON r.id = t.run_id WHERE t.id = ? AND r.organization_id = ?",
      [trackId, p.organizationId], ex);
    if (!t) throw notFound("Track");
    return t;
  }

  async thumbnail(trackId: string, p: Principal): Promise<{ path: string; bytes: number }> {
    await this.track(trackId, p);
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    const a = await this.db.one<RowDataPacket>(
      `SELECT a.object_key, a.byte_size FROM track_appearance ta JOIN assets a ON a.id = ta.thumbnail_asset_id AND a.organization_id = ?
        WHERE ta.track_id = ?`, [p.organizationId, trackId]);
    if (!a) throw notFound("Thumbnail");
    return { path: this.store.resolve(a.object_key as string), bytes: Number(a.byte_size) };
  }

  async links(trackId: string, p: Principal): Promise<TrackLink[]> {
    await this.track(trackId, p);
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT c.link_id, c.score, c.crosses_cut, c.gap_us, c.state, c.decision_id,
              IF(c.track_a_id = ?, 'after', 'before') AS direction,
              o.id AS other_id, o.internal_track_number, o.first_pts_us, o.last_pts_us,
              COALESCE(ci.state, 'UNRESOLVED') AS identity_state, pi.player_id, pi.display_name, pi.canonical_otsi_id,
              ta.kit_rgb, ta.thumbnail_asset_id
         FROM v_track_link_current c
         JOIN tracks o ON o.id = IF(c.track_a_id = ?, c.track_b_id, c.track_a_id)
         LEFT JOIN v_track_current_identity ci ON ci.track_id = o.id
         LEFT JOIN v_player_identity pi ON pi.player_id = ci.player_id AND ci.state = 'CONFIRMED'
         LEFT JOIN track_appearance ta ON ta.track_id = o.id
        WHERE (c.track_a_id = ? OR c.track_b_id = ?)
        ORDER BY c.state = 'REJECTED', c.score DESC LIMIT 50`, [trackId, trackId, trackId, trackId]);
    return rows.map((r) => TrackLink.parse({
      link_id: r.link_id, direction: r.direction,
      other: {
        track_id: r.other_id, track_number: Number(r.internal_track_number), first_pts_us: Number(r.first_pts_us), last_pts_us: Number(r.last_pts_us),
        label: label(r.identity_state, Number(r.internal_track_number), r.display_name, r.canonical_otsi_id), identity_state: r.identity_state,
        confirmed_player: r.identity_state === "CONFIRMED" && r.player_id ? { player_id: r.player_id, display_name: r.display_name, canonical_otsi_id: r.canonical_otsi_id } : null,
        kit_rgb: r.kit_rgb, has_thumbnail: !!r.thumbnail_asset_id,
      },
      score: Number(r.score), crosses_cut: !!r.crosses_cut, gap_us: Number(r.gap_us), state: r.state, decision_id: r.decision_id,
    }));
  }

  async lookAlikes(trackId: string, p: Principal): Promise<LookAlikes> {
    const t = await this.track(trackId, p);
    const me = await this.db.one<RowDataPacket>(
      `SELECT ci.player_id, pi.display_name FROM v_track_current_identity ci JOIN v_player_identity pi ON pi.player_id = ci.player_id
        WHERE ci.track_id = ? AND ci.state = 'CONFIRMED'`, [trackId]);
    const seeds = me
      ? await this.db.rows<RowDataPacket>(
        `SELECT o.id, o.first_pts_us, o.last_pts_us, ta.kit_group FROM tracks o JOIN v_track_current_identity ci ON ci.track_id = o.id AND ci.state = 'CONFIRMED'
           LEFT JOIN track_appearance ta ON ta.track_id = o.id WHERE o.run_id = ? AND ci.player_id = ?`, [t.run_id, me.player_id])
      : await this.db.rows<RowDataPacket>("SELECT o.id, o.first_pts_us, o.last_pts_us, ta.kit_group FROM tracks o LEFT JOIN track_appearance ta ON ta.track_id = o.id WHERE o.id = ?", [trackId]);
    const ids = seeds.map((s) => s.id as string);
    const marks = ids.map(() => "?").join(",");
    // his shirt-colour group: the one most of his tracks are in (a track of another colour group is another team or an official)
    const kits = new Map<number, number>();
    for (const s of seeds) if (s.kit_group !== null) kits.set(Number(s.kit_group), (kits.get(Number(s.kit_group)) ?? 0) + 1);
    const kit = [...kits.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    // the look-alike graph is stored one way (track -> its nearest neighbours): read both directions. On wide footage everyone's look is
    // alike (cosine 0.9+ for most pairs, ADR-045), so the ranking weighs the look by the shirt colour's similarity
    const near = await this.db.rows<RowDataPacket>(
      `SELECT other_id, MAX(cosine * (0.5 + 0.5 * kit)) AS score, MAX(cosine) AS similarity, MAX(kit) AS kit, COUNT(*) AS resembles FROM (
         SELECT n.neighbour_id AS other_id, n.cosine, n.kit_similarity AS kit FROM track_neighbours n WHERE n.track_id IN (${marks})
         UNION ALL SELECT n.track_id, n.cosine, n.kit_similarity FROM track_neighbours n WHERE n.neighbour_id IN (${marks})) x
        GROUP BY other_id ORDER BY score DESC, resembles DESC LIMIT 600`, [...ids, ...ids]);
    const cand = near.filter((r) => !ids.includes(r.other_id as string));
    const items: LookAlikes["items"] = [];
    let more = 0;
    const vid = await this.db.one<RowDataPacket>("SELECT video_id FROM pipeline_runs WHERE id = ?", [t.run_id]);
    const mt = vid ? await matchWindows(this.db, String(vid.video_id)) : null;
    if (cand.length) {
      const rows = await this.db.rows<RowDataPacket>(
        `SELECT o.id, o.internal_track_number, o.first_pts_us, o.last_pts_us, o.class_name,
                COALESCE(ci.state, 'UNRESOLVED') AS identity_state, ci.player_id AS decided_player, pi.display_name, pi.canonical_otsi_id,
                ta.kit_rgb, ta.kit_group, ta.thumbnail_asset_id
           FROM tracks o LEFT JOIN v_track_current_identity ci ON ci.track_id = o.id
           LEFT JOIN v_player_identity pi ON pi.player_id = ci.player_id AND ci.state = 'CONFIRMED'
           LEFT JOIN track_appearance ta ON ta.track_id = o.id
          WHERE o.run_id = ? AND o.id IN (${cand.map(() => "?").join(",")})`, [t.run_id, ...cand.map((r) => r.other_id)]);
      const byId = new Map(rows.map((r) => [r.id as string, r]));
      for (const c of cand) {
        const r = byId.get(c.other_id as string);
        if (!r || r.class_name !== "PERSON") continue;
        if (r.identity_state === "CONFIRMED") continue;                                             // already somebody (him or another)
        if (!overlaps(mt, Number(r.first_pts_us), Number(r.last_pts_us))) continue;                 // outside match time (programme, studio)
        if (me && r.identity_state === "REJECTED" && r.decided_player === me.player_id) continue;   // a person said: not him
        const a = Number(r.first_pts_us), b = Number(r.last_pts_us);
        if (seeds.some((s) => a <= Number(s.last_pts_us) && b >= Number(s.first_pts_us))) continue;  // on screen with him: not him
        if (kit !== null && r.kit_group !== null && Number(r.kit_group) !== kit) continue;           // another shirt colour: not him
        if (items.length === LOOK_ALIKE_PAGE) { more++; continue; }
        items.push({
          other: { track_id: r.id, track_number: Number(r.internal_track_number), first_pts_us: a, last_pts_us: b,
            label: label(r.identity_state, Number(r.internal_track_number), null, null), identity_state: r.identity_state, confirmed_player: null,
            kit_rgb: r.kit_rgb, has_thumbnail: !!r.thumbnail_asset_id },
          similarity: Math.round(Number(c.similarity) * 1000) / 1000, resembles: Number(c.resembles),
          kit_similarity: Math.round(Number(c.kit) * 1000) / 1000, score: Math.round(Number(c.score) * 1000) / 1000 });
      }
    }
    return LookAlikes.parse({ track_id: trackId, player: me ? { player_id: me.player_id, display_name: me.display_name } : null, seeds: seeds.length, items, more });
  }

  async decide(linkId: string, body: LinkDecisionRequest, p: Principal): Promise<TrackLink[]> {
    let anchor = "";
    try {
      await this.db.tx(async (c) => {
        const [ls] = await c.query<RowDataPacket[]>(
          `SELECT l.id, l.track_a_id FROM track_links l JOIN pipeline_runs r ON r.id = l.run_id WHERE l.id = ? AND r.organization_id = ? FOR UPDATE`,
          [linkId, p.organizationId]);
        if (!ls[0]) throw notFound("Link");
        anchor = ls[0].track_a_id as string;
        const [cur] = await c.query<RowDataPacket[]>("SELECT decision_id, state FROM v_track_link_current WHERE link_id = ?", [linkId]);
        if ((cur[0]?.decision_id ?? null) !== (body.supersedes_id ?? null)) {
          throw new ApiError(409, "STALE_DECISION", "Someone decided on this link meanwhile; reload and decide again.");
        }
        const id = uuidv7();
        await c.query("INSERT INTO track_link_decisions (id, link_id, state, decided_by, reason, supersedes_id) VALUES (?, ?, ?, ?, ?, ?)",
          [id, linkId, body.state, p.userId, body.reason, body.supersedes_id]);
        const payload = { link_id: linkId, decision_id: id, state: body.state, supersedes_id: body.supersedes_id };
        await recordChange(c, userActor(p), {
          action: "track.link_decided", entityType: "track_link", entityId: linkId, after: payload,
          before: cur[0]?.decision_id ? { decision_id: cur[0].decision_id, state: cur[0].state } : null,
          event: { eventType: "track.link_decided", payload, dedupeKey: `track-link:${id}` },
        });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return this.links(anchor, p);
  }

  /** Breadth-first over CONFIRMED links from the track (bounded): the person's tracks across occlusions and cuts. */
  async group(trackId: string, p: Principal): Promise<PersonGroup> {
    const t = await this.track(trackId, p);
    const edges = await this.db.rows<RowDataPacket>("SELECT track_a_id, track_b_id FROM v_track_link_current WHERE run_id = ? AND state = 'CONFIRMED'", [t.run_id]);
    const adj = new Map<string, string[]>();
    for (const e of edges) {
      adj.set(e.track_a_id, [...(adj.get(e.track_a_id) ?? []), e.track_b_id]);
      adj.set(e.track_b_id, [...(adj.get(e.track_b_id) ?? []), e.track_a_id]);
    }
    const seen = new Set([trackId]);
    const queue = [trackId];
    while (queue.length && seen.size < 500) {
      for (const n of adj.get(queue.shift()!) ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
    const ids = [...seen];
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT t.id, t.internal_track_number, t.first_pts_us, t.last_pts_us, COALESCE(ci.state, 'UNRESOLVED') AS state, ci.player_id
         FROM tracks t LEFT JOIN v_track_current_identity ci ON ci.track_id = t.id
        WHERE t.run_id = ? AND t.id IN (${ids.map(() => "?").join(",")}) ORDER BY t.first_pts_us`, [t.run_id, ...ids]);
    const tracks = rows.map((r) => ({ track_id: r.id as string, track_number: Number(r.internal_track_number), first_pts_us: Number(r.first_pts_us),
      last_pts_us: Number(r.last_pts_us), identity_state: r.state, player_id: r.state === "CONFIRMED" ? (r.player_id as string) : null }));
    return PersonGroup.parse({
      track_ids: tracks.map((x) => x.track_id), tracks,
      confirmed_player_ids: [...new Set(tracks.map((x) => x.player_id).filter((x): x is string => !!x))],
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class TrackLinksController {
  constructor(private readonly links: TrackLinksService) {}

  @Get("tracks/:trackId/thumbnail")
  async thumbnail(@Param("trackId") id: string, @CurrentPrincipal() p: Principal, @Res() res: FastifyReply) {
    const t = await this.links.thumbnail(uuidParam(id, "Track"), p);
    void res.header("content-type", "image/jpeg").header("content-length", t.bytes).header("cache-control", "private, max-age=3600").send(createReadStream(t.path));
  }

  @Get("tracks/:trackId/links")
  list(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) {
    return this.links.links(uuidParam(id, "Track"), p);
  }

  @Get("tracks/:trackId/look-alikes")
  lookAlikes(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) {
    return this.links.lookAlikes(uuidParam(id, "Track"), p);
  }

  @Get("tracks/:trackId/person-group")
  group(@Param("trackId") id: string, @CurrentPrincipal() p: Principal) {
    return this.links.group(uuidParam(id, "Track"), p);
  }

  @Post("track-links/:linkId/decisions")
  @HttpCode(201)
  @Roles("OWNER", "ADMIN", "ANALYST")
  decide(@Param("linkId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.links.decide(uuidParam(id, "Link"), LinkDecisionRequest.parse(body), p);
  }
}
