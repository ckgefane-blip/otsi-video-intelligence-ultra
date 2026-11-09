/**
 * v3 Phase B.21 (ADR-096, migration 0057): compound clips. A run of consecutive clips saved under a name (an intro block, "best passes"),
 * put into any reel of the same video in one step, as copies (the block does not follow later changes).
 *
 *   GET    /v1/reels/:id/blocks                     the organization's blocks of this reel's video, newest first
 *   POST   /v1/reels/:id/blocks                     save consecutive clips of this reel as a block   { name, clip_ids }   (writers)
 *   POST   /v1/reels/:id/blocks/:blockId/insert     put copies of the block's clips in before position `at` (null = end), one change   (writers)
 *   DELETE /v1/reels/:id/blocks/:blockId            delete the block (writers; reels that used it keep their clips)
 *
 * Tenant isolation: every query is scoped to the caller's organization; a block of another video cannot be put into this reel.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Post, UseGuards } from "@nestjs/common";
import { CreateBlockRequest, InsertBlockRequest, ReelBlock, type Reel } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";
import { type BlockClipRow, ReelsService } from "./reels";

const parse = <T>(v: unknown): T => (typeof v === "string" ? JSON.parse(v) : v) as T;

@Injectable()
export class BlocksService {
  constructor(private readonly db: Db, private readonly reels: ReelsService) {}

  private toBlock(r: RowDataPacket): ReelBlock {
    const clips = parse<BlockClipRow[]>(r.clips);
    return ReelBlock.parse({ id: r.id, name: r.name, video_id: r.video_id, clips: clips.map((c) => ({ in_pts_us: Number(c.in_pts_us), out_pts_us: Number(c.out_pts_us), label: c.label ?? null })),
      length_us: clips.reduce((s, c) => s + Number(c.out_pts_us) - Number(c.in_pts_us), 0), created_by: r.created_by_name ?? null,
      created_at: new Date(r.created_at).toISOString() });
  }

  async list(reelId: string, p: Principal): Promise<ReelBlock[]> {
    const reel = await this.reels.get(reelId, p);                       // the caller can see the reel
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT b.*, u.display_name AS created_by_name FROM reel_blocks b LEFT JOIN users u ON u.id = b.created_by
        WHERE b.organization_id = ? AND b.video_id = ? ORDER BY b.created_at DESC, b.id DESC LIMIT 100`, [p.organizationId, reel.video_id]);
    return rows.map((r) => this.toBlock(r));
  }

  async create(reelId: string, body: CreateBlockRequest, p: Principal): Promise<ReelBlock> {
    const reel = await this.reels.get(reelId, p);
    const order = [...reel.clips].sort((a, b) => a.sequence_index - b.sequence_index).map((c) => c.id);
    const at = body.clip_ids.map((x) => order.indexOf(x));
    if (at.some((i) => i < 0)) throw notFound("Clip");
    if (new Set(body.clip_ids).size !== body.clip_ids.length || at.some((i, k) => k > 0 && i !== at[k - 1]! + 1))
      throw new ApiError(422, "CLIPS_NOT_CONSECUTIVE", "A block is a run of clips next to each other, in their order.");
    const rows = await this.db.rows<RowDataPacket>(
      `SELECT id, in_pts_us, out_pts_us, label, origin, playback_speed, effect_kind, effect_at_us, effect_hold_ms, clip_fx FROM reel_clips WHERE reel_id = ? AND id IN (${body.clip_ids.map(() => "?").join(",")})`,
      [reelId, ...body.clip_ids]);
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    const clips: BlockClipRow[] = body.clip_ids.map((x) => {
      const r = byId.get(x)!;
      return { in_pts_us: Number(r.in_pts_us), out_pts_us: Number(r.out_pts_us), label: r.label ?? null, origin: r.origin, playback_speed: Number(r.playback_speed ?? 1),
        effect_kind: r.effect_kind ?? "NONE", effect_at_us: r.effect_at_us === null ? null : Number(r.effect_at_us), effect_hold_ms: Number(r.effect_hold_ms ?? 0),
        clip_fx: r.clip_fx === null || r.clip_fx === undefined ? null : parse<unknown>(r.clip_fx) };
    });
    const id = uuidv7();
    await this.db.tx(async (c) => {
      await c.query("INSERT INTO reel_blocks (id, organization_id, video_id, name, clips, clip_count, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, p.organizationId, reel.video_id, body.name, JSON.stringify(clips), clips.length, p.userId]);
      await recordChange(c, userActor(p), { action: "reel.block_saved", entityType: "reel_block", entityId: id, after: { reel_id: reelId, name: body.name, clips: clips.length } });
    });
    const r = await this.db.one<RowDataPacket>("SELECT b.*, u.display_name AS created_by_name FROM reel_blocks b LEFT JOIN users u ON u.id = b.created_by WHERE b.id = ?", [id]);
    return this.toBlock(r!);
  }

  private async block(reelId: string, blockId: string, p: Principal): Promise<{ reel: Reel; row: RowDataPacket }> {
    const reel = await this.reels.get(reelId, p);
    const row = await this.db.one<RowDataPacket>("SELECT * FROM reel_blocks WHERE id = ? AND organization_id = ?", [blockId, p.organizationId]);
    if (!row) throw notFound("Block");
    if (row.video_id !== reel.video_id) throw new ApiError(422, "BLOCK_OTHER_VIDEO", "This block was saved from another video: its clips are not in this reel's video.");
    return { reel, row };
  }

  async insert(reelId: string, blockId: string, body: InsertBlockRequest, p: Principal): Promise<Reel> {
    const { row } = await this.block(reelId, blockId, p);
    return this.reels.insertClips(reelId, parse<BlockClipRow[]>(row.clips), body.at, row.name as string, p);
  }

  async remove(reelId: string, blockId: string, p: Principal): Promise<void> {
    await this.block(reelId, blockId, p);
    await this.db.tx(async (c) => {
      await c.query("DELETE FROM reel_blocks WHERE id = ? AND organization_id = ?", [blockId, p.organizationId]);
      await recordChange(c, userActor(p), { action: "reel.block_deleted", entityType: "reel_block", entityId: blockId, after: { reel_id: reelId } });
    });
  }
}

@Controller("v1/reels")
@UseGuards(AuthGuard)
export class BlocksController {
  constructor(private readonly blocks: BlocksService) {}

  @Get(":reelId/blocks")
  list(@Param("reelId") id: string, @CurrentPrincipal() p: Principal) {
    return this.blocks.list(uuidParam(id, "Reel"), p);
  }

  @Post(":reelId/blocks")
  @Roles(...PROJECT_WRITERS)
  create(@Param("reelId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.blocks.create(uuidParam(id, "Reel"), CreateBlockRequest.parse(body), p);
  }

  @Post(":reelId/blocks/:blockId/insert")
  @HttpCode(200)
  @Roles(...PROJECT_WRITERS)
  insert(@Param("reelId") id: string, @Param("blockId") blockId: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.blocks.insert(uuidParam(id, "Reel"), uuidParam(blockId, "Block"), InsertBlockRequest.parse(body ?? {}), p);
  }

  @Delete(":reelId/blocks/:blockId")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async remove(@Param("reelId") id: string, @Param("blockId") blockId: string, @CurrentPrincipal() p: Principal) {
    await this.blocks.remove(uuidParam(id, "Reel"), uuidParam(blockId, "Block"), p);
  }
}
