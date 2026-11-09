/**
 * Brand assets for reels (ADR-044): the competition logo and custom logo of Page 06's Overlays and Branding switches, and the music under a
 * reel (ADR-047), and the intro / outro videos played before and after it (ADR-050).
 *
 *   GET    /v1/brand-assets[?kind=]          the organization's logos (not retired) with the state of their rights grant
 *   POST   /v1/brand-assets                  upload a PNG or JPEG (base64 JSON, <= 512 KB) with the uploader's rights declaration
 *   POST   /v1/brand-assets/music            upload a music file (raw audio bytes, <= 25 MB; header x-asset-meta: base64url JSON of the name
 *                                            and the rights declaration)
 *   POST   /v1/brand-assets/video            upload an intro / outro video (raw MP4, MOV or WebM bytes, <= 80 MB; the same header)
 *   GET    /v1/brand-assets/:id/image        the file (the image to show, or the music to listen to; also /file)
 *   DELETE /v1/brand-assets/:id              retire it (kept for traceability; reels using it must choose another)
 *
 * Page 06: "branding asset provenance and licensed usage enforced; render disabled when required image rights lacking". The declaration is
 * stored as a `rights_grants` row (EXPORT_ALLOWED, allowed use REEL_OVERLAY) for the file; `rightsOk` is checked again when a reel is
 * rendered. The declaration is the uploading person's statement, recorded with who made it; it is not legal clearance.
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { BRAND_MAX_BYTES, BrandAsset, BrandAssetKind, CreateBrandAssetRequest, MUSIC_MAX_BYTES, MusicMeta, VIDEO_MAX_BYTES } from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyReply } from "fastify";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, userActor } from "../../core/audit";
import { AuthGuard, CurrentPrincipal, Principal, Roles } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db, Executor } from "../../core/db";
import { ApiError, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";
import { uuidParam } from "../players/players.controller";
import { PROJECT_WRITERS } from "../projects/projects";

const REEL_OVERLAY = "REEL_OVERLAY";
const REEL_AUDIO = "REEL_AUDIO";

/** the real format of the bytes (the declared type proves nothing) */
function logoType(b: Buffer): "image/png" | "image/jpeg" | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** the real format of an audio file, from its first bytes; null: not one we mix */
export function musicType(b: Buffer): { mime: string; ext: string } | null {
  if (b.length < 16) return null;
  const at = (i: number, s: string) => b.subarray(i, i + s.length).toString("latin1") === s;
  if (at(0, "ID3") || (b[0] === 0xff && (b[1]! & 0xe0) === 0xe0)) return { mime: "audio/mpeg", ext: "mp3" };
  if (at(0, "RIFF") && at(8, "WAVE")) return { mime: "audio/wav", ext: "wav" };
  if (at(4, "ftyp")) return { mime: "audio/mp4", ext: "m4a" };
  if (at(0, "OggS")) return { mime: "audio/ogg", ext: "ogg" };
  if (at(0, "fLaC")) return { mime: "audio/flac", ext: "flac" };
  return null;
}

/** the real format of an intro / outro video, from its first bytes; null: not one the renderer reads */
export function videoType(b: Buffer): { mime: string; ext: string } | null {
  if (b.length < 16) return null;
  if (b.subarray(4, 8).toString("latin1") === "ftyp") {
    return b.subarray(8, 10).toString("latin1") === "qt" ? { mime: "video/quicktime", ext: "mov" } : { mime: "video/mp4", ext: "mp4" };
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { mime: "video/webm", ext: "webm" };
  return null;
}

const SELECT = `SELECT b.*, a.object_key, a.mime_type, a.byte_size, g.rights_state, g.allowed_uses, g.valid_until
                  FROM brand_assets b JOIN assets a ON a.id = b.asset_id AND a.organization_id = b.organization_id
                  JOIN rights_grants g ON g.id = b.rights_grant_id`;

/** the grant still allows using the asset in a reel (a logo shown, music played) */
export function rightsOk(r: RowDataPacket): boolean {
  const use = r.kind === "MUSIC" ? REEL_AUDIO : REEL_OVERLAY;
  const uses = typeof r.allowed_uses === "string" ? (JSON.parse(r.allowed_uses) as string[]) : ((r.allowed_uses as string[] | null) ?? []);
  const until = r.valid_until ? new Date(r.valid_until as string) : null;
  return r.rights_state === "EXPORT_ALLOWED" && uses.includes(use) && (!until || until.getTime() > Date.now()) && !r.retired_at;
}

@Injectable()
export class BrandService {
  private readonly store: LocalStore | null;
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private view(r: RowDataPacket): BrandAsset {
    return BrandAsset.parse({
      id: r.id, kind: r.kind, name: r.name, mime: r.mime_type, byte_size: Number(r.byte_size), rights_holder: r.rights_holder, rights_basis: r.rights_basis,
      rights_ok: rightsOk(r), uploaded_by: r.uploaded_by ?? null, created_at: r.created_at,
    });
  }

  /** a logo of this organization (retired ones too when `any`), with its file and grant */
  async row(id: string, org: string, ex?: Executor, any = false): Promise<RowDataPacket> {
    const r = await this.db.one<RowDataPacket>(`${SELECT} WHERE b.id = ? AND b.organization_id = ?${any ? "" : " AND b.retired_at IS NULL"}`, [id, org], ex);
    if (!r) throw notFound("Brand asset");
    return r;
  }

  async list(kind: BrandAssetKind | undefined, p: Principal): Promise<BrandAsset[]> {
    const rows = await this.db.rows<RowDataPacket>(`${SELECT} WHERE b.organization_id = ? AND b.retired_at IS NULL${kind ? " AND b.kind = ?" : ""} ORDER BY b.created_at DESC LIMIT 200`,
      kind ? [p.organizationId, kind] : [p.organizationId]);
    return rows.map((r) => this.view(r));
  }

  async create(body: CreateBrandAssetRequest, p: Principal): Promise<BrandAsset> {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    const bytes = Buffer.from(body.data_base64.replace(/^data:[^,]*,/, ""), "base64");
    if (bytes.length === 0) throw new ApiError(400, "LOGO_MISSING", "Choose a PNG or JPEG picture.");
    if (bytes.length > BRAND_MAX_BYTES) throw new ApiError(413, "LOGO_TOO_LARGE", "The picture is larger than 512 KB.");
    const mime = logoType(bytes);
    if (!mime) throw new ApiError(400, "LOGO_NOT_AN_IMAGE", "That file is not a PNG or JPEG picture.");
    return this.save(body.kind, body, bytes, mime, mime === "image/png" ? "png" : "jpg", REEL_OVERLAY, p);
  }

  /** ADR-047: a music file for reels, with the uploading person's rights declaration */
  /** ADR-050: an intro / outro video for reels, with the uploading person's rights declaration (it is shown and heard) */
  async createVideo(bytes: Buffer | undefined, metaHeader: string | undefined, p: Principal): Promise<BrandAsset> {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    let meta: MusicMeta;
    try { meta = MusicMeta.parse(JSON.parse(Buffer.from(metaHeader ?? "", "base64url").toString("utf8"))); }
    catch { throw new ApiError(422, "VIDEO_DETAILS_MISSING", "Give the video a name, say who owns it and why you may use it, and confirm the rights."); }
    if (!bytes || bytes.length === 0) throw new ApiError(400, "VIDEO_MISSING", "Choose a video file.");
    if (bytes.length > VIDEO_MAX_BYTES) throw new ApiError(413, "VIDEO_TOO_LARGE", "The video is larger than 80 MB.");
    const t = videoType(bytes);
    if (!t) throw new ApiError(400, "VIDEO_NOT_VIDEO", "That file is not an MP4, MOV or WebM video.");
    return this.save("REEL_VIDEO", meta, bytes, t.mime, t.ext, [REEL_OVERLAY, REEL_AUDIO], p);
  }

  async createMusic(bytes: Buffer | undefined, metaHeader: string | undefined, p: Principal): Promise<BrandAsset> {
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    let meta: MusicMeta;
    try { meta = MusicMeta.parse(JSON.parse(Buffer.from(metaHeader ?? "", "base64url").toString("utf8"))); }
    catch { throw new ApiError(422, "MUSIC_DETAILS_MISSING", "Give the music a name, say who owns it and why you may use it, and confirm the rights."); }
    if (!bytes || bytes.length === 0) throw new ApiError(400, "MUSIC_MISSING", "Choose a music file.");
    if (bytes.length > MUSIC_MAX_BYTES) throw new ApiError(413, "MUSIC_TOO_LARGE", "The music file is larger than 25 MB.");
    const t = musicType(bytes);
    if (!t) throw new ApiError(400, "MUSIC_NOT_AUDIO", "That file is not MP3, WAV, M4A, OGG or FLAC music.");
    return this.save("MUSIC", meta, bytes, t.mime, t.ext, REEL_AUDIO, p);
  }

  private async save(kind: BrandAssetKind, body: { name: string; rights_holder: string; rights_basis: string }, bytes: Buffer, mime: string, ext: string, use: string | string[], p: Principal): Promise<BrandAsset> {
    const id = uuidv7(), assetId = uuidv7(), grantId = uuidv7();
    const key = `org/${p.organizationId}/brand/${id}.${ext}`;
    const file = this.store!.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
                     VALUES (?, ?, 'BRAND', ?, 'local', ?, ?, ?, ?, ?)`,
        [assetId, p.organizationId, key, bytes.length, createHash("sha256").update(bytes).digest("hex"), mime, p.userId, JSON.stringify({ brand_asset_id: id })]);
      await c.query(`INSERT INTO rights_grants (id, organization_id, asset_id, rights_state, allowed_uses, valid_from) VALUES (?, ?, ?, 'EXPORT_ALLOWED', ?, CURRENT_TIMESTAMP(6))`,
        [grantId, p.organizationId, assetId, JSON.stringify(Array.isArray(use) ? use : [use])]);
      await c.query(`INSERT INTO brand_assets (id, organization_id, kind, name, asset_id, rights_grant_id, rights_holder, rights_basis, uploaded_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, p.organizationId, kind, body.name, assetId, grantId, body.rights_holder, body.rights_basis, p.userId]);
      await recordChange(c, userActor(p), {
        action: "brand_asset.uploaded", entityType: "brand_asset", entityId: id,
        after: { kind, name: body.name, rights_holder: body.rights_holder, rights_basis: body.rights_basis, rights_declared: true, bytes: bytes.length, mime },
      });
    });
    return this.view(await this.row(id, p.organizationId));
  }

  async image(id: string, p: Principal): Promise<{ path: string; mime: string; bytes: number }> {
    const r = await this.row(id, p.organizationId, undefined, true);
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    return { path: this.store.resolve(r.object_key as string), mime: r.mime_type as string, bytes: Number(r.byte_size) };
  }

  async retire(id: string, p: Principal): Promise<void> {
    await this.db.tx(async (c) => {
      await this.row(id, p.organizationId, c);
      await c.query("UPDATE brand_assets SET retired_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [id]);
      await recordChange(c, userActor(p), { action: "brand_asset.retired", entityType: "brand_asset", entityId: id, after: { retired: true } });
    });
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class BrandController {
  constructor(private readonly brand: BrandService) {}

  @Get("brand-assets")
  list(@Query("kind") kind: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.brand.list(kind === undefined ? undefined : BrandAssetKind.parse(kind), p);
  }

  @Post("brand-assets")
  @Roles(...PROJECT_WRITERS)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.brand.create(CreateBrandAssetRequest.parse(body), p);
  }

  @Post("brand-assets/music")
  @Roles(...PROJECT_WRITERS)
  createMusic(@Body() body: unknown, @Headers("x-asset-meta") meta: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.brand.createMusic(Buffer.isBuffer(body) ? body : undefined, meta, p);
  }

  @Post("brand-assets/video")
  @Roles(...PROJECT_WRITERS)
  createVideo(@Body() body: unknown, @Headers("x-asset-meta") meta: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.brand.createVideo(Buffer.isBuffer(body) ? body : undefined, meta, p);
  }

  @Get(["brand-assets/:id/image", "brand-assets/:id/file"])
  async image(@Param("id") id: string, @CurrentPrincipal() p: Principal, @Res() res: FastifyReply) {
    const f = await this.brand.image(uuidParam(id, "Logo"), p);
    void res.header("content-type", f.mime).header("content-length", f.bytes).header("cache-control", "private, max-age=300").send(createReadStream(f.path));
  }

  @Delete("brand-assets/:id")
  @HttpCode(204)
  @Roles(...PROJECT_WRITERS)
  async retire(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    await this.brand.retire(uuidParam(id, "Logo"), p);
  }
}
