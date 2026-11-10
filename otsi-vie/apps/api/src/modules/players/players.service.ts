/**
 * The one player registry (ADR-016). Every module asks THIS service (or the same `v_player_identity` view) for a player's identity,
 * so the canonical OTSI Player ID is the same everywhere. Visibility: a REGISTERED / RETIRED / MERGED player is part of the shared
 * registry and visible to every organization; a PROVISIONAL record is visible only to the organization that created it.
 */
import { Inject, Injectable } from "@nestjs/common";
import {
  CanonicalOtsiId, Country, CreatePlayerRequest, identityLabel, MergePlayersRequest, PlayerIdentity, PlayerListEntry, PlayerPhotoMeta, PlayerProfile, PlayerProfileDetails, PlayerState, RegisterPlayerRequest,
  UpdatePlayerProfileDetailsRequest, UpdatePlayerProfileRequest,
} from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PoolConnection, RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { Principal } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db, Executor } from "../../core/db";
import { recordChange, userActor } from "../../core/audit";
import { ApiError, forbidden, fromDatabase, notFound } from "../../core/problem";
import { LocalStore } from "../../core/storage";

interface IdentityRow extends RowDataPacket {
  player_id: string;
  own_canonical_otsi_id: string | null;
  own_state: PlayerState;
  resolved_player_id: string;
  canonical_otsi_id: string | null;
  resolved_state: PlayerState;
  display_name: string;
  created_by_organization_id: string | null;
}

/** whole years from a birth date (YYYY-MM-DD) to today (UTC) */
export const ageOn = (birth: string, today = new Date()): number => {
  const [y, m, d] = birth.split("-").map(Number) as [number, number, number];
  const a = today.getUTCFullYear() - y;
  return today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d) ? a - 1 : a;
};

/** The extra profile a person entered for the Player Profile Intro (ADR-130, migration 0067): height and weight, photo, strengths,
 *  summary, club and league, international career. All user-entered; null = nothing entered yet. `photo_url` stays null here: a signed
 *  read URL needs the media signer, and only the intro endpoint serves one (ProfileIntroService fills it in). */
export async function playerProfileDetails(db: Db, playerId: string, ex?: Executor): Promise<PlayerProfileDetails | null> {
  const d = await db.one<RowDataPacket>(
    `SELECT d.*, u.display_name AS updated_by_name, c.name AS international_country_name
       FROM player_profile_details d LEFT JOIN users u ON u.id = d.updated_by LEFT JOIN countries c ON c.code = d.international_country_code
      WHERE d.player_id = ?`, [playerId], ex);
  if (!d) return null;
  const strengths = typeof d.strengths === "string" ? (JSON.parse(d.strengths) as unknown) : (d.strengths as unknown);
  return PlayerProfileDetails.parse({
    height_cm: d.height_cm === null ? null : Number(d.height_cm),
    weight_kg: d.weight_kg === null ? null : Number(d.weight_kg),
    photo_asset_id: (d.photo_asset_id as string | null) ?? null,
    photo_url: null,
    strengths: Array.isArray(strengths) ? strengths : [],
    summary: (d.summary as string | null) ?? null,
    club_name: (d.club_name as string | null) ?? null,
    league: (d.league as string | null) ?? null,
    international_country_code: (d.international_country_code as string | null) ?? null,
    international_country_name: (d.international_country_name as string | null) ?? null,
    international_caps: d.international_caps === null ? null : Number(d.international_caps),
    international_goals: d.international_goals === null ? null : Number(d.international_goals),
    updated_by_name: (d.updated_by_name as string | null) ?? null,
    updated_at: d.updated_at ? new Date(d.updated_at).toISOString() : null,
  });
}

/** The profile a person recorded for a player (birth date, foot, current nationality: the sporting one first), as `orgId` sees it */
export async function playerProfile(db: Db, playerId: string, orgId: string, ex?: Executor): Promise<PlayerProfile | null> {
  const r = await db.one<RowDataPacket>(
    `SELECT DATE_FORMAT(p.birth_date, '%Y-%m-%d') AS birth, p.preferred_foot, p.primary_position,
            p.role_confirmed_by, p.role_confirmed_at, p.role_confirmation_state, p.created_by_organization_id,
            u.display_name AS confirmed_by_name
       FROM players p
       LEFT JOIN users u ON u.id = p.role_confirmed_by
      WHERE p.id = ?`, [playerId], ex);
  if (!r) return null;
  const n = await db.one<RowDataPacket>(
    `SELECT n.country_code, c.name FROM player_nationalities n JOIN countries c ON c.code = n.country_code
      WHERE n.player_id = ? AND n.valid_to IS NULL ORDER BY n.kind = 'SPORTING' DESC, n.recorded_at DESC LIMIT 1`, [playerId], ex);
  const t = await db.one<RowDataPacket>(
    `SELECT c.canonical_name, r.jersey_number, r.position, r.roster_verified FROM match_rosters r JOIN matches m ON m.id = r.match_id AND m.organization_id = ?
       JOIN clubs c ON c.id = r.club_id WHERE r.player_id = ? ORDER BY m.kickoff_at IS NULL, m.kickoff_at DESC, r.updated_at DESC LIMIT 1`, [orgId, playerId], ex);
  const birth = (r.birth as string | null) ?? null;
  const isConfirmed = r.role_confirmation_state === "ROLE_CONFIRMED" && !!r.primary_position;
  return PlayerProfile.parse({
    birth_date: birth,
    age: birth ? ageOn(birth) : null,
    preferred_foot: r.preferred_foot ?? null,
    nationality: n ? { code: n.country_code, name: n.name } : null,
    position: r.primary_position ?? null,
    role_confirmed: isConfirmed,
    role_confirmation_state: (r.role_confirmation_state as "ROLE_CONFIRMED" | "ROLE_PROVISIONAL") ?? "ROLE_PROVISIONAL",
    role_confirmed_by: (r.role_confirmed_by as string | null) ?? null,
    role_confirmed_at: r.role_confirmed_at ? new Date(r.role_confirmed_at).toISOString() : null,
    role_confirmed_by_name: (r.confirmed_by_name as string | null) ?? null,
    latest_team: t ? {
      team: t.canonical_name,
      jersey_number: t.jersey_number === null ? null : Number(t.jersey_number),
      position: t.position ?? null,
      role_confirmed: !!t.roster_verified,
    } : null,
    details: await playerProfileDetails(db, playerId, ex),
    editable: r.created_by_organization_id === orgId,
  });
}

/** a player photo: a PNG or JPEG, at most 512 KB (the brand logo limit, ADR-044) */
const PHOTO_MAX_BYTES = 512 * 1024;
/** the real format of the bytes (the declared content type alone proves nothing) */
function photoType(b: Buffer): "image/png" | "image/jpeg" | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

@Injectable()
export class PlayersService {
  private readonly store: LocalStore | null;
  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    this.store = cfg.storage ? new LocalStore(cfg.storage.dir) : null;
  }

  private visible(row: IdentityRow, p: Principal): boolean {
    return row.own_state !== "PROVISIONAL" || row.created_by_organization_id === p.organizationId;
  }

  private toContract(row: IdentityRow): PlayerIdentity {
    return PlayerIdentity.parse({
      player_id: row.player_id,
      canonical_otsi_id: row.canonical_otsi_id,
      own_canonical_otsi_id: row.own_canonical_otsi_id,
      canonical_state: row.own_state,
      resolved_player_id: row.resolved_player_id,
      display_name: row.display_name,
      identity_label: identityLabel(row.own_state),
    });
  }

  private async row(playerId: string, ex: Executor = this.db.pool): Promise<IdentityRow | undefined> {
    return this.db.one<IdentityRow>("SELECT * FROM v_player_identity WHERE player_id = ?", [playerId], ex);
  }

  /** The identity of a player as `p` may see it, or 404 (also for another organization's provisional record: no probing). */
  async identity(playerId: string, p: Principal, ex?: Executor): Promise<PlayerIdentity> {
    const r = await this.row(playerId, ex);
    if (!r || !this.visible(r, p)) throw notFound("Player");
    return this.toContract(r);
  }

  /** Players `p` may see whose name starts with `q` (or whose OTSI Player ID is `q`), or filtered by confirmed role. At most 20, names A-Z. */
  async search(q: string, p: Principal, options?: { role?: string | undefined; confirmedOnly?: boolean | undefined }): Promise<PlayerIdentity[]> {
    const term = q.trim();
    if (term.length < 2 && !options?.role && !options?.confirmedOnly) {
      throw new ApiError(422, "QUERY_TOO_SHORT", "Type at least 2 characters of the player's name or OTSI Player ID.");
    }
    const where: string[] = ["(own_state <> 'PROVISIONAL' OR created_by_organization_id = ?)"];
    const params: unknown[] = [p.organizationId];

    if (term.length >= 2) {
      const like = `${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
      where.push("(display_name LIKE ? OR own_canonical_otsi_id = ?)");
      params.push(like, term.toUpperCase());
    }

    if (options?.role) {
      where.push("EXISTS (SELECT 1 FROM players pl WHERE pl.id = v_player_identity.player_id AND pl.primary_position = ? AND pl.role_confirmation_state = 'ROLE_CONFIRMED')");
      params.push(options.role.toUpperCase());
    } else if (options?.confirmedOnly) {
      where.push("EXISTS (SELECT 1 FROM players pl WHERE pl.id = v_player_identity.player_id AND pl.role_confirmation_state = 'ROLE_CONFIRMED')");
    }

    const rows = await this.db.rows<IdentityRow>(
      `SELECT * FROM v_player_identity
        WHERE ${where.join(" AND ")}
        ORDER BY display_name, player_id LIMIT 20`, params);
    return rows.map((r) => this.toContract(r));
  }

  async byCanonicalId(canonicalId: string, p: Principal): Promise<PlayerIdentity> {
    const parsed = CanonicalOtsiId.safeParse(canonicalId);
    if (!parsed.success) throw new ApiError(422, "INVALID_OTSI_PLAYER_ID", "That is not an OTSI Player ID (OTSI-CCC-YYYY-NNNNNN).");
    const hit = await this.db.one<RowDataPacket>("SELECT id FROM players WHERE canonical_otsi_id = ?", [parsed.data]);
    if (!hit) throw notFound("Player");
    return this.identity(hit.id as string, p);
  }

  /** Create a PROVISIONAL player (no canonical ID). Retrying with the same Idempotency-Key returns the same player. */
  async create(body: CreatePlayerRequest, idempotencyKey: string, p: Principal): Promise<{ player: PlayerIdentity; created: boolean }> {
    const id = uuidv7();
    try {
      await this.db.tx(async (c) => {
        await c.query(
          "INSERT INTO players (id, display_name, birth_date, preferred_foot, created_by_organization_id, creation_key) VALUES (?, ?, ?, ?, ?, ?)",
          [id, body.display_name, body.birth_date ?? null, body.preferred_foot ?? null, p.organizationId, idempotencyKey]);
        await recordChange(c, userActor(p), {
          action: "player.created", entityType: "player", entityId: id,
          after: { display_name: body.display_name, canonical_state: "PROVISIONAL" },
          event: { eventType: "player.created", payload: { player_id: id } },
        });
      });
      return { player: await this.identity(id, p), created: true };
    } catch (e) {
      if ((e as { errno?: number }).errno === 1062) {
        const existing = await this.db.one<RowDataPacket>(
          "SELECT id FROM players WHERE created_by_organization_id = ? AND creation_key = ?", [p.organizationId, idempotencyKey]);
        if (existing) return { player: await this.identity(existing.id as string, p), created: false };
      }
      throw fromDatabase(e) ?? e;
    }
  }

  async profile(playerId: string, p: Principal): Promise<PlayerProfile> {
    const r = await this.row(playerId);
    if (!r || !this.visible(r, p)) throw notFound("Player");
    return (await playerProfile(this.db, playerId, p.organizationId))!;
  }

  /** owner 2026-11-02: a person records the player's birth date, foot, nationality and usual position; each change is audited with before and after.
   *  The nationality history is kept: the current one is closed today and the new one starts today. */
  async updateProfile(playerId: string, body: UpdatePlayerProfileRequest, p: Principal): Promise<PlayerProfile> {
    const r = await this.row(playerId);
    if (!r || !this.visible(r, p)) throw notFound("Player");
    if (r.created_by_organization_id !== p.organizationId) throw forbidden("PROFILE_NOT_YOURS", "Only the organization that created this player can change the profile.");
    if (body.birth_date) {
      const today = new Date().toISOString().slice(0, 10);
      if (body.birth_date > today || body.birth_date < "1900-01-01") throw new ApiError(422, "INVALID_BIRTH_DATE", "Enter a real birth date (not in the future).");
    }
    const before = await playerProfile(this.db, playerId, p.organizationId);
    try {
      await this.db.tx(async (c) => {
        if (body.birth_date !== undefined) await c.query("UPDATE players SET birth_date = ? WHERE id = ?", [body.birth_date, playerId]);
        if (body.preferred_foot !== undefined) await c.query("UPDATE players SET preferred_foot = ? WHERE id = ?", [body.preferred_foot, playerId]);
        if (body.position !== undefined || body.confirm_role !== undefined) {
          if (body.position === null) {
            await c.query(
              "UPDATE players SET primary_position = NULL, role_confirmed_by = NULL, role_confirmed_at = NULL, role_confirmation_state = 'ROLE_PROVISIONAL' WHERE id = ?",
              [playerId]
            );
          } else {
            const nextPos = body.position !== undefined ? body.position : before?.position ?? null;
            if (nextPos) {
              const shouldConfirm = body.confirm_role ?? true;
              if (shouldConfirm) {
                await c.query(
                  "UPDATE players SET primary_position = ?, role_confirmed_by = ?, role_confirmed_at = NOW(6), role_confirmation_state = 'ROLE_CONFIRMED' WHERE id = ?",
                  [nextPos, p.userId, playerId]
                );
              } else {
                await c.query(
                  "UPDATE players SET primary_position = ?, role_confirmed_by = NULL, role_confirmed_at = NULL, role_confirmation_state = 'ROLE_PROVISIONAL' WHERE id = ?",
                  [nextPos, playerId]
                );
              }
            }
          }
        }
        if (body.nationality !== undefined && body.nationality !== (before?.nationality?.code ?? null)) {
          await c.query("UPDATE player_nationalities SET valid_to = GREATEST(CURDATE(), COALESCE(valid_from, CURDATE())) WHERE player_id = ? AND valid_to IS NULL", [playerId]);
          if (body.nationality) {
            const [k] = await c.query<RowDataPacket[]>("SELECT code FROM countries WHERE code = ? AND active", [body.nationality]);
            if (!k.length) throw new ApiError(422, "UNKNOWN_COUNTRY", "Choose a country from the list.");
            await c.query("INSERT INTO player_nationalities (id, player_id, country_code, kind, valid_from) VALUES (?, ?, ?, 'SPORTING', CURDATE())", [uuidv7(), playerId, body.nationality]);
          }
        }
        await recordChange(c, userActor(p), { action: "player.profile_updated", entityType: "player", entityId: playerId, before: before ?? undefined, after: body });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return (await playerProfile(this.db, playerId, p.organizationId))!;
  }

  /** ADR-130: the extra profile for the Player Profile Intro — height and weight, strengths, summary, club and league, international
   *  career. All user-entered, all optional; a field left out is unchanged, null clears it. Same ownership rule as updateProfile, and
   *  each change is audited with before and after. Nothing here is ever filled from a guess. */
  async updateDetails(playerId: string, body: UpdatePlayerProfileDetailsRequest, p: Principal): Promise<PlayerProfile> {
    const r = await this.row(playerId);
    if (!r || !this.visible(r, p)) throw notFound("Player");
    if (r.created_by_organization_id !== p.organizationId) throw forbidden("PROFILE_NOT_YOURS", "Only the organization that created this player can change the profile.");
    if (body.international_country_code) {
      const k = await this.db.rows<RowDataPacket>("SELECT code FROM countries WHERE code = ? AND active", [body.international_country_code]);
      if (!k.length) throw new ApiError(422, "UNKNOWN_COUNTRY", "Choose a country from the list.");
    }
    const before = await playerProfileDetails(this.db, playerId);
    const next = {
      height_cm: body.height_cm !== undefined ? body.height_cm : (before?.height_cm ?? null),
      weight_kg: body.weight_kg !== undefined ? body.weight_kg : (before?.weight_kg ?? null),
      strengths: body.strengths !== undefined ? (body.strengths === null ? null : JSON.stringify(body.strengths)) : (before ? JSON.stringify(before.strengths) : null),
      summary: body.summary !== undefined ? body.summary : (before?.summary ?? null),
      club_name: body.club_name !== undefined ? body.club_name : (before?.club_name ?? null),
      league: body.league !== undefined ? body.league : (before?.league ?? null),
      international_country_code: body.international_country_code !== undefined ? body.international_country_code : (before?.international_country_code ?? null),
      international_caps: body.international_caps !== undefined ? body.international_caps : (before?.international_caps ?? null),
      international_goals: body.international_goals !== undefined ? body.international_goals : (before?.international_goals ?? null),
    };
    try {
      await this.db.tx(async (c) => {
        await c.query(
          `INSERT INTO player_profile_details (player_id, height_cm, weight_kg, strengths, summary, club_name, league, international_country_code,
                                              international_caps, international_goals, updated_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE height_cm = VALUES(height_cm), weight_kg = VALUES(weight_kg), strengths = VALUES(strengths),
               summary = VALUES(summary), club_name = VALUES(club_name), league = VALUES(league),
               international_country_code = VALUES(international_country_code), international_caps = VALUES(international_caps),
               international_goals = VALUES(international_goals), updated_by = VALUES(updated_by)`,
          [playerId, next.height_cm, next.weight_kg, next.strengths, next.summary, next.club_name, next.league, next.international_country_code,
           next.international_caps, next.international_goals, p.userId]);
        await recordChange(c, userActor(p), { action: "player.profile_details_updated", entityType: "player", entityId: playerId,
          before: before ?? undefined, after: body });
      });
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw fromDatabase(e) ?? e;
    }
    return (await playerProfile(this.db, playerId, p.organizationId))!;
  }

  /** ADR-130: the player's photo for the intro — raw PNG/JPEG bytes (at most 512 KB) + the rights declaration in x-asset-meta
   *  (base64url JSON: rights_holder, rights_basis, confirm_rights), following the brand uploads (ADR-044/047). Stored as an asset
   *  (kind PLAYER_PHOTO) with an EXPORT_ALLOWED grant for REEL_OVERLAY; the render refuses the photo while the grant is not in
   *  force. An earlier photo's file is left in place (files are never deleted); the details row points at the newest one. */
  async uploadPhoto(playerId: string, bytes: Buffer | undefined, metaHeader: string | undefined, declared: string | undefined, p: Principal): Promise<PlayerProfile> {
    const r = await this.row(playerId);
    if (!r || !this.visible(r, p)) throw notFound("Player");
    if (r.created_by_organization_id !== p.organizationId) throw forbidden("PROFILE_NOT_YOURS", "Only the organization that created this player can change the profile.");
    if (!this.store) throw new ApiError(503, "STORAGE_NOT_CONFIGURED", "Media storage is not configured on this server.");
    let meta: { rights_holder: string; rights_basis: string };
    try { meta = PlayerPhotoMeta.parse(JSON.parse(Buffer.from(metaHeader ?? "", "base64url").toString("utf8"))); }
    catch { throw new ApiError(422, "PHOTO_DETAILS_MISSING", "Say who owns this photo and why you may use it in reels, and confirm the rights."); }
    if (!bytes || bytes.length === 0) throw new ApiError(400, "PHOTO_MISSING", "Choose a PNG or JPEG picture.");
    if (bytes.length > PHOTO_MAX_BYTES) throw new ApiError(413, "PHOTO_TOO_LARGE", "The picture is larger than 512 KB.");
    const real = photoType(bytes);
    if (!real || (declared && declared.split(";")[0]!.trim() !== real)) throw new ApiError(400, "PHOTO_NOT_AN_IMAGE", "That file is not a PNG or JPEG picture.");
    const assetId = uuidv7(), grantId = uuidv7(), ext = real === "image/png" ? "png" : "jpg";
    const key = `org/${p.organizationId}/players/${playerId}/photo-${assetId}.${ext}`;
    const file = this.store.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await this.db.tx(async (c) => {
      await c.query(`INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by, metadata)
                     VALUES (?, ?, 'PLAYER_PHOTO', ?, 'local', ?, ?, ?, ?, ?)`,
        [assetId, p.organizationId, key, bytes.length, createHash("sha256").update(bytes).digest("hex"), real, p.userId,
         JSON.stringify({ player_id: playerId, rights_holder: meta.rights_holder, rights_basis: meta.rights_basis })]);
      await c.query(`INSERT INTO rights_grants (id, organization_id, asset_id, rights_state, allowed_uses, valid_from)
                     VALUES (?, ?, ?, 'EXPORT_ALLOWED', ?, CURRENT_TIMESTAMP(6))`,
        [grantId, p.organizationId, assetId, JSON.stringify(["REEL_OVERLAY"])]);
      await c.query(`INSERT INTO player_profile_details (player_id, photo_asset_id, updated_by) VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE photo_asset_id = VALUES(photo_asset_id), updated_by = VALUES(updated_by)`,
        [playerId, assetId, p.userId]);
      await recordChange(c, userActor(p), { action: "player.photo_uploaded", entityType: "player", entityId: playerId,
        after: { photo_asset_id: assetId, bytes: bytes.length, mime: real, rights_holder: meta.rights_holder, rights_basis: meta.rights_basis } });
    });
    return (await playerProfile(this.db, playerId, p.organizationId))!;
  }

  /** the photo file's storage key for the render snapshot (the worker resolves it); null = no photo entered */
  async photoKey(playerId: string, orgId: string): Promise<string | null> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT a.object_key FROM player_profile_details d JOIN assets a ON a.id = d.photo_asset_id AND a.organization_id = ?
        WHERE d.player_id = ?`, [orgId, playerId]);
    return (r?.object_key as string | null) ?? null;
  }

  /** the photo's rights grant is still in force (EXPORT_ALLOWED, REEL_OVERLAY); null when there is no photo to check */
  async photoRightsProblem(playerId: string, orgId: string): Promise<string | null> {
    const r = await this.db.one<RowDataPacket>(
      `SELECT g.rights_state, g.allowed_uses, g.valid_until FROM player_profile_details d JOIN assets a ON a.id = d.photo_asset_id AND a.organization_id = ?
         LEFT JOIN rights_grants g ON g.asset_id = a.id WHERE d.player_id = ? ORDER BY g.created_at DESC LIMIT 1`, [orgId, playerId]);
    if (!r) return null;
    const uses = typeof r.allowed_uses === "string" ? (JSON.parse(r.allowed_uses) as string[]) : ((r.allowed_uses as string[] | null) ?? []);
    const until = r.valid_until ? new Date(r.valid_until as string) : null;
    return r.rights_state === "EXPORT_ALLOWED" && uses.includes("REEL_OVERLAY") && (!until || until.getTime() > Date.now())
      ? null : "The player's photo cannot be used in the intro: its rights are not in force. Upload it again with a rights declaration.";
  }

  /** The Players list (owner 2026-11-02): the players this organization created or put on one of its match team sheets, A-Z */
  async list(p: Principal, options?: { role?: string | undefined; confirmedOnly?: boolean | undefined }): Promise<PlayerListEntry[]> {
    const where: string[] = [
      "own_state <> 'MERGED'",
      "(created_by_organization_id = ? OR player_id IN (SELECT r.player_id FROM match_rosters r JOIN matches m ON m.id = r.match_id WHERE m.organization_id = ?))",
    ];
    const params: unknown[] = [p.organizationId, p.organizationId];

    if (options?.role) {
      where.push("EXISTS (SELECT 1 FROM players pl WHERE pl.id = v_player_identity.player_id AND pl.primary_position = ? AND pl.role_confirmation_state = 'ROLE_CONFIRMED')");
      params.push(options.role.toUpperCase());
    } else if (options?.confirmedOnly) {
      where.push("EXISTS (SELECT 1 FROM players pl WHERE pl.id = v_player_identity.player_id AND pl.role_confirmation_state = 'ROLE_CONFIRMED')");
    }

    const rows = await this.db.rows<IdentityRow>(
      `SELECT * FROM v_player_identity
        WHERE ${where.join(" AND ")}
        ORDER BY display_name, player_id LIMIT 1000`, params);
    const out: PlayerListEntry[] = [];
    for (const r of rows.filter((x) => this.visible(x, p))) {
      const c = this.toContract(r);
      out.push({ player_id: c.player_id, display_name: c.display_name, canonical_otsi_id: c.canonical_otsi_id, profile: (await playerProfile(this.db, c.player_id, p.organizationId))! });
    }
    return out;
  }

  async countries(): Promise<Country[]> {
    const rows = await this.db.rows<RowDataPacket>("SELECT code, name FROM countries WHERE active ORDER BY name");
    return rows.map((r) => ({ code: r.code as string, name: r.name as string }));
  }

  /**
   * Register: issue the permanent OTSI Player ID through the database allocator (the only issuer). Only the organization that created
   * the provisional record may register it. Idempotent per (organization, Idempotency-Key) and per player.
   */
  async register(playerId: string, body: RegisterPlayerRequest, idempotencyKey: string, p: Principal): Promise<PlayerIdentity> {
    const r = await this.row(playerId);
    if (!r || !this.visible(r, p)) throw notFound("Player");
    if (r.own_state !== "PROVISIONAL") return this.toContract(r);           // already registered: the same ID, never a second one
    if (r.created_by_organization_id !== p.organizationId) throw notFound("Player");
    const requestKey = `${p.organizationId}:${idempotencyKey}`.slice(0, 191);
    await this.db.retryTransient(async () => {
      const c: PoolConnection = await this.db.pool.getConnection();
      try {
        await c.query("CALL sp_issue_canonical_player_id(?, ?, ?, ?, ?, @cid)", [playerId, body.country_code, p.organizationId, p.userId, requestKey]);
      } catch (e) {
        if ((e as { errno?: number }).errno === 1213 || (e as { errno?: number }).errno === 1205) throw e;
        throw fromDatabase(e) ?? e;
      } finally {
        c.release();
      }
    }, 8);                                                                     // issuance under heavy concurrency: more restarts
    return this.identity(playerId, p);
  }

  /**
   * Merge a duplicate PROVISIONAL record of this organization into a REGISTERED player. Merging two REGISTERED players changes the
   * shared registry for every organization, so it is reserved for platform administrators (ADR-017).
   */
  async merge(fromId: string, body: MergePlayersRequest, p: Principal): Promise<PlayerIdentity> {
    const from = await this.row(fromId);
    const into = await this.row(body.into_player_id);
    if (!from || !this.visible(from, p)) throw notFound("Player");
    if (!into || !this.visible(into, p)) throw notFound("Target player");
    if (from.own_state !== "PROVISIONAL") {
      throw forbidden("PLATFORM_ADMIN_REQUIRED", "Merging registered players changes the shared registry; a platform administrator must do it.");
    }
    if (from.created_by_organization_id !== p.organizationId) throw notFound("Player");
    try {
      await this.db.pool.query("CALL sp_merge_players(?, ?, ?, ?, ?, ?, ?)",
        [uuidv7(), fromId, body.into_player_id, p.organizationId, p.userId, body.reason, body.evidence_id ?? null]);
    } catch (e) {
      throw fromDatabase(e) ?? e;
    }
    return this.identity(fromId, p);
  }
}
