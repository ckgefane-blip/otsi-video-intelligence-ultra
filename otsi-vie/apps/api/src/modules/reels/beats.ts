/**
 * v3 Phase C.5 (ADR-105): the beat grid of a reel's music.
 *
 *   GET  /v1/brand-assets/:id/beat-grid   the latest grid of that music (or null), with the note on what analysed it
 *   POST /v1/brand-assets/:id/beat-grid   find its beat (writers; the music's rights must be in force) -> 202; one BEAT_GRID job.
 *                                         A grid already made, waiting or running for this method is returned instead of a new job
 *                                         (the file never changes); after a failure a new one is made.
 *
 * The analysis runs on this computer in the media worker (vie_worker/beat_job.py). The page shows the beats as Detected, accuracy not
 * measured; Clip Studio's Snap uses them so a dragged clip end lands on a beat (contracts/beats.ts).
 */
import { Controller, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { BEAT_LIBRARY_NOTE, BEAT_METHOD, BeatGrid, BeatGridView } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { BrandService, rightsOk } from "./brand";

const json = <T>(v: unknown): T | null => (v == null ? null : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));

@Injectable()
export class BeatGridService {
  constructor(private readonly db: Db, private readonly brand: BrandService) {}

  private view(r: RowDataPacket): BeatGrid {
    return BeatGrid.parse({
      id: r.id, music_id: r.brand_asset_id, status: r.status, method: r.method,
      tempo_bpm: r.tempo_bpm === null ? null : Number(r.tempo_bpm),
      beats_us: r.status === "SUCCEEDED" ? (json<number[]>(r.beats) ?? []).map((x) => Math.round(Number(x))) : [],
      duration_us: r.duration_us === null ? null : Number(r.duration_us),
      periodicity: r.periodicity === null ? null : Number(r.periodicity),
      failure: r.status === "FAILED" ? (r.failure_code === "CANCELLED" ? "Finding the beat was cancelled." : (r.failure_detail ?? r.failure_code ?? "The beat could not be found.")) : null,
      requested_by: r.display_name ?? null,
      created_at: new Date(r.created_at).toISOString(), finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    });
  }

  private async latest(musicId: string, org: string): Promise<RowDataPacket | null> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT g.*, u.display_name FROM music_beat_grids g LEFT JOIN users u ON u.id = g.requested_by
        WHERE g.brand_asset_id = ? AND g.organization_id = ? ORDER BY g.created_at DESC, g.id DESC LIMIT 1`, [musicId, org]);
    return r ?? null;
  }

  /** the music of this organization (retired too when `any`), refused when it is not music */
  private async music(id: string, p: Principal, any: boolean): Promise<RowDataPacket> {
    const r = await this.brand.row(id, p.organizationId, undefined, any);
    if (r.kind !== "MUSIC") throw new ApiError(422, "NOT_MUSIC", "Only music has a beat to find.");
    return r;
  }

  async get(id: string, p: Principal): Promise<BeatGridView> {
    await this.music(id, p, true);
    const g = await this.latest(id, p.organizationId);
    return BeatGridView.parse({ music_id: id, grid: g ? this.view(g) : null, library_note: BEAT_LIBRARY_NOTE });
  }

  async request(id: string, p: Principal): Promise<BeatGridView> {
    const m = await this.music(id, p, false);
    if (!rightsOk(m)) throw new ApiError(409, "MUSIC_RIGHTS_NOT_IN_FORCE", "This music's rights are not in force, so it is not analysed.");
    const had = await this.latest(id, p.organizationId);
    if (had && had.method === BEAT_METHOD && had.status !== "FAILED") return this.get(id, p);
    const gid = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO music_beat_grids (id, organization_id, brand_asset_id, method, requested_by) VALUES (?, ?, ?, ?, ?)",
        [gid, p.organizationId, id, BEAT_METHOD, p.userId]);
      await recordChange(c, userActor(p), {
        action: "brand_asset.beat_grid_requested", entityType: "brand_asset", entityId: id, after: { beat_grid_id: gid, method: BEAT_METHOD },
        event: { eventType: "brand_asset.beat_grid_requested", payload: { beat_grid_id: gid, brand_asset_id: id }, dedupeKey: `beat_grid:${gid}` },
      });
    });
    return this.get(id, p);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class BeatGridController {
  constructor(private readonly beats: BeatGridService) {}

  @Get("brand-assets/:id/beat-grid")
  get(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.beats.get(uuidParam(id, "Music"), p); }

  @Post("brand-assets/:id/beat-grid")
  @HttpCode(202)
  @Roles(...PROJECT_WRITERS)
  request(@Param("id") id: string, @CurrentPrincipal() p: Principal) { return this.beats.request(uuidParam(id, "Music"), p); }
}
