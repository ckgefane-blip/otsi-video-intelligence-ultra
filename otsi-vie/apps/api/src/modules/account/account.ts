/** The signed-in user and the organizations they can act for (GET /v1/me) — the same for local sign-in and an external OIDC provider. */
import { Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Param, Patch, Put, Res, UseGuards } from "@nestjs/common";
import { Me, PageModes, SetPageMode, UiPage, UpdateMeRequest } from "@otsi-vie/contracts";
import type { FastifyReply } from "fastify";
import { RowDataPacket } from "mysql2/promise";
import { Account, AccountOnly, AuthGuard, CurrentAccount } from "../../core/auth";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";

@Injectable()
export class AccountService {
  constructor(private readonly db: Db) {}

  async me(userId: string): Promise<Me> {
    const u = await this.db.one<RowDataPacket>(
      "SELECT u.id, u.email, u.display_name, (SELECT a.updated_at FROM user_avatars a WHERE a.user_id = u.id) AS avatar_updated_at, u.onboarded_at FROM users u WHERE u.id = ?", [userId]);
    if (!u) throw new ApiError(401, "UNKNOWN_ACCOUNT", "This sign-in has no account here.");
    const ms = await this.db.rows<RowDataPacket>(
      `SELECT m.organization_id, o.name AS organization_name, m.role FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.status = 'ACTIVE' ORDER BY o.name`, [userId]);
    return Me.parse({ user: { id: u.id, email: u.email, display_name: u.display_name, avatar_updated_at: u.avatar_updated_at ? new Date(u.avatar_updated_at).toISOString() : null,
      onboarded_at: u.onboarded_at ? new Date(u.onboarded_at).toISOString() : null }, memberships: ms.map((m) => ({ ...m })) });
  }

  /** a person's own name and the end of their welcome tour (never anyone else's account) */
  async update(userId: string, body: UpdateMeRequest): Promise<Me> {
    if (body.display_name !== undefined) await this.db.rows("UPDATE users SET display_name = ? WHERE id = ?", [body.display_name, userId]);
    if (body.onboarding_done) await this.db.rows("UPDATE users SET onboarded_at = COALESCE(onboarded_at, CURRENT_TIMESTAMP(6)) WHERE id = ?", [userId]);
    return this.me(userId);
  }
}

/** v3 Phase A.7 (ADR-072): Guided / Pro, the person's own choice per page (no row: Pro) */
@Injectable()
export class PageModeService {
  constructor(private readonly db: Db) {}

  async list(userId: string): Promise<PageModes> {
    const rows = await this.db.rows<RowDataPacket>("SELECT page, mode FROM user_page_modes WHERE user_id = ? ORDER BY page", [userId]);
    return PageModes.parse({ modes: Object.fromEntries(rows.map((r) => [r.page, r.mode])) });
  }

  async set(userId: string, page: string, body: unknown): Promise<PageModes> {
    const p = UiPage.safeParse(page);
    if (!p.success) throw new ApiError(404, "UNKNOWN_PAGE", "There is no such page.");
    const { mode } = SetPageMode.parse(body);
    await this.db.rows("INSERT INTO user_page_modes (user_id, page, mode) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mode = VALUES(mode)", [userId, p.data, mode]);
    return this.list(userId);
  }
}

const MAX_PHOTO = 409_600;
/** the real format of the bytes (the declared content type alone proves nothing) */
function imageType(b: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

@Injectable()
export class AvatarService {
  constructor(private readonly db: Db, private readonly account: AccountService) {}

  async set(userId: string, body: unknown, declared: string | undefined): Promise<Me> {
    if (!Buffer.isBuffer(body) || body.length === 0) throw new ApiError(400, "PHOTO_MISSING", "Choose a JPEG, PNG or WebP picture.");
    if (body.length > MAX_PHOTO) throw new ApiError(413, "PHOTO_TOO_LARGE", "The picture is larger than 400 KB.");
    const real = imageType(body);
    if (!real || (declared && declared.split(";")[0]!.trim() !== real)) throw new ApiError(400, "PHOTO_NOT_AN_IMAGE", "That file is not a JPEG, PNG or WebP picture.");
    await this.db.rows("INSERT INTO user_avatars (user_id, mime, image) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE mime = VALUES(mime), image = VALUES(image), updated_at = CURRENT_TIMESTAMP(6)", [userId, real, body]);
    return this.account.me(userId);
  }

  async get(userId: string): Promise<{ mime: string; image: Buffer }> {
    const r = await this.db.one<RowDataPacket>("SELECT mime, image FROM user_avatars WHERE user_id = ?", [userId]);
    if (!r) throw new ApiError(404, "NO_PHOTO", "No profile photo is set.");
    return { mime: r.mime as string, image: r.image as Buffer };
  }

  async clear(userId: string): Promise<Me> {
    await this.db.rows("DELETE FROM user_avatars WHERE user_id = ?", [userId]);
    return this.account.me(userId);
  }
}

@Controller("v1")
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService, private readonly avatars: AvatarService, private readonly modes: PageModeService) {}

  /** Guided / Pro per page, the signed-in person's own (ADR-072) */
  @Get("me/page-modes")
  @AccountOnly()
  pageModes(@CurrentAccount() a: Account) {
    return this.modes.list(a.userId);
  }

  @Put("me/page-modes/:page")
  @AccountOnly()
  setPageMode(@CurrentAccount() a: Account, @Param("page") page: string, @Body() body: unknown) {
    return this.modes.set(a.userId, page, body);
  }

  @Get("me")
  @AccountOnly()
  me(@CurrentAccount() a: Account) {
    return this.account.me(a.userId);
  }

  @Patch("me")
  @AccountOnly()
  update(@CurrentAccount() a: Account, @Body() body: unknown) {
    return this.account.update(a.userId, UpdateMeRequest.parse(body));
  }

  /** the signed-in person's own profile photo: set (raw JPEG / PNG / WebP, at most 400 KB), read, remove */
  @Put("me/avatar")
  @AccountOnly()
  setAvatar(@CurrentAccount() a: Account, @Body() body: unknown, @Headers("content-type") type: string | undefined) {
    return this.avatars.set(a.userId, body, type);
  }

  @Get("me/avatar")
  @AccountOnly()
  async avatar(@CurrentAccount() a: Account, @Res() res: FastifyReply) {
    const p = await this.avatars.get(a.userId);
    void res.header("content-type", p.mime).header("content-length", p.image.length).header("x-content-type-options", "nosniff").header("cache-control", "private, no-cache").send(p.image);
  }

  @Delete("me/avatar")
  @AccountOnly()
  @HttpCode(200)
  clearAvatar(@CurrentAccount() a: Account) {
    return this.avatars.clear(a.userId);
  }
}
