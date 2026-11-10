/**
 * Player Profile Intro through the real HTTP API (Fastify inject) and the real MySQL schema (ADR-130): the user-entered profile
 * details, the photo upload with its rights declaration, the intro assembly (measured stats only, verified badge rule), and the
 * render snapshot's profile_intro — first in the reel, or absent when the setting is off. Runs on the owner's host (needs MySQL).
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { appDb, key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let dir: string;
let a: Member, b: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
const create = (m: Member, name = "Intro Player", k = key()) => call(m, "POST", "/v1/players", { display_name: name }, { "idempotency-key": k });
const register = (m: Member, id: string, country = "NGA", k = key()) => call(m, "POST", `/v1/players/${id}/registration`, { country_code: country }, { "idempotency-key": k });
const meta = (m: object) => Buffer.from(JSON.stringify(m)).toString("base64url");
const photoMeta = { rights_holder: "OTSI Ltd", rights_basis: "OWN_BRAND", confirm_rights: true };
/** a 1x1 PNG (real bytes, so the magic-byte check passes) */
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const upPhoto = (m: Member, playerId: string, body: Buffer, info: object | null, type = "image/png") =>
  app.inject({ method: "POST", url: `/v1/players/${playerId}/photo`, headers: { ...m.headers, "content-type": type, ...(info ? { "x-asset-meta": meta(info) } : {}) }, payload: body });

/** an analysed video: track 1 seen at 2-6 s and 20-22 s, track 2 someone else (as in reels.api.test.ts) */
async function seedAnalysed(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)",
    [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  const times = [2, 3, 4, 5, 6, 20, 21, 22];
  for (const s of [...times, 30]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  const tracks = [uuidv7(), uuidv7()];
  for (const [i, t] of tracks.entries()) {
    const ts = i === 0 ? times : [30];
    await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count)
                      VALUES (?, ?, ?, ?, ?, 'PERSON', ?, ?, 'ENDED', ?)`, [t, run, video, shot, i + 1, ts[0]! * 1e6, ts[ts.length - 1]! * 1e6, ts.length]);
    for (const s of ts) {
      await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')",
        [video, s * 25, t, s * 1_000_000]);
    }
  }
  const player = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...m.headers, "idempotency-key": key() }, payload: { display_name: "Reel Player" } })).body).player_id as string;
  return { video, run, tracks, player };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-intro-"));
  app = await startApi({ storageDir: dir });
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("player profile details (ADR-130)", () => {
  it("records the user-entered fields, all optional; a field left out is unchanged, null clears it", async () => {
    const player = (await create(a)).body.player_id as string;
    const full = await call(a, "PATCH", `/v1/players/${player}/profile-details`,
      { height_cm: 182, weight_kg: 73, strengths: ["Excellent Ball Control", "Strong Passing Ability"], summary: "Dynamic midfielder.",
        club_name: "FC Ercakhu", league: "Abkhazia Premier League", international_country_code: "FRA", international_caps: 32, international_goals: 7 });
    expect(full.status).toBe(200);
    expect(full.body.details).toMatchObject({ height_cm: 182, weight_kg: 73, strengths: ["Excellent Ball Control", "Strong Passing Ability"],
      summary: "Dynamic midfielder.", club_name: "FC Ercakhu", league: "Abkhazia Premier League",
      international_country_code: "FRA", international_country_name: "France", international_caps: 32, international_goals: 7 });
    const cleared = await call(a, "PATCH", `/v1/players/${player}/profile-details`, { summary: null, international_goals: null });
    expect(cleared.body.details).toMatchObject({ summary: null, international_goals: null, height_cm: 182 });
    const [row] = await root.query<RowDataPacket[]>("SELECT height_cm, strengths FROM player_profile_details WHERE player_id = ?", [player]);
    expect(row[0]).toMatchObject({ height_cm: 182 });
    expect(JSON.parse(String(row[0]!.strengths))).toEqual(["Excellent Ball Control", "Strong Passing Ability"]);
  });

  it("refuses invented ranges, too many strengths and unknown countries; another organization cannot edit", async () => {
    const player = (await create(a)).body.player_id as string;
    expect((await call(a, "PATCH", `/v1/players/${player}/profile-details`, { height_cm: 99 })).body.code).toBe("INVALID_REQUEST");
    expect((await call(a, "PATCH", `/v1/players/${player}/profile-details`, { weight_kg: 201 })).body.code).toBe("INVALID_REQUEST");
    expect((await call(a, "PATCH", `/v1/players/${player}/profile-details`, { strengths: ["a", "b", "c", "d", "e", "f", "g"] })).body.code).toBe("INVALID_REQUEST");
    expect((await call(a, "PATCH", `/v1/players/${player}/profile-details`, { international_country_code: "XXX" })).body.code).toBe("UNKNOWN_COUNTRY");
    expect((await call(b, "PATCH", `/v1/players/${player}/profile-details`, { height_cm: 180 })).status).toBe(404);
    expect((await call(a, "PATCH", `/v1/players/${player}/profile-details`, { height_cm: 180 })).body.details.height_cm).toBe(180);
  });

  it("photo: real PNG/JPEG only, at most 512 KB, with the rights declaration; the grant is EXPORT_ALLOWED for REEL_OVERLAY", async () => {
    const player = (await create(a)).body.player_id as string;
    expect(JSON.parse((await upPhoto(a, player, png, null)).body).code).toBe("PHOTO_DETAILS_MISSING");
    expect(JSON.parse((await upPhoto(a, player, Buffer.from("<html>not an image</html>"), photoMeta)).body).code).toBe("PHOTO_NOT_AN_IMAGE");
    expect(JSON.parse((await upPhoto(a, player, Buffer.alloc(600 * 1024, 1), photoMeta)).body).code).toBe("PHOTO_TOO_LARGE");
    const r = await upPhoto(a, player, png, photoMeta);
    expect(r.statusCode).toBe(200);
    const profile = JSON.parse(r.body) as { details: { photo_asset_id: string | null } };
    expect(profile.details.photo_asset_id).toMatch(/^[0-9a-f-]{36}$/);
    const [grant] = await root.query<RowDataPacket[]>(
      "SELECT g.rights_state, g.allowed_uses FROM assets a JOIN rights_grants g ON g.asset_id = a.id WHERE a.id = ?", [profile.details.photo_asset_id]);
    expect(grant[0]).toMatchObject({ rights_state: "EXPORT_ALLOWED" });
    expect(grant[0]!.allowed_uses).toEqual(["REEL_OVERLAY"]);
  });
});

describe("profile intro assembly (ADR-130)", () => {
  it("a provisional player with no confirmed track is unverified and unmeasured — nothing invented", async () => {
    const player = (await create(a)).body.player_id as string;
    const intro = (await call(a, "GET", `/v1/players/${player}/profile-intro`)).body;
    expect(intro.verified).toBe(false);
    expect(intro.player.canonical_otsi_id).toBeNull();
    expect(intro.stats).toMatchObject({ games_analysed: null, minutes_seen: null, goals: null, assists: null });
    expect(intro.stats.assists_reason).toMatch(/not link a pass to a goal/);
    expect(intro.heat).toBeNull();
    expect(intro.recent_form).toMatchObject({ ratings: null });
  });

  it("registered but with no confirmed track is still unverified; confirmed, it verifies and measures", async () => {
    const s = await seedAnalysed(a);
    const reg = await register(a, s.player);
    expect(reg.body.canonical_otsi_id).toMatch(/^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$/);
    expect((await call(a, "GET", `/v1/players/${s.player}/profile-intro`)).body.verified).toBe(false);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const intro = (await call(a, "GET", `/v1/players/${s.player}/profile-intro`)).body;
    expect(intro.verified).toBe(true);
    expect(intro.player.canonical_otsi_id).toBe(reg.body.canonical_otsi_id);
    expect(intro.stats.games_analysed).toBe(1);
    expect(intro.stats.minutes_seen).toBe(1);   // 8 s seen on camera, rounded up like the report's mins()
    expect(intro.stats.goals).toBeNull();        // the ball was followed in none of his videos: goals not measured, not 0
    expect(intro.stats.assists).toBeNull();
  });

  it("the render snapshot carries the intro first in line (profile_intro), or nothing when the setting is off", async () => {
    const s = await seedAnalysed(a);
    await register(a, s.player);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.settings.profile_intro).toBe(true);
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    const r1 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    expect(r1.body.config.profile_intro).toMatchObject({ name: "Reel Player", verified: true, assists: null, photo_key: null });
    expect(r1.body.config.profile_intro.otsi_id).toMatch(/^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$/);
    expect(r1.body.config.profile).toBe("REEL");   // the export profile key is untouched by the intro key
    const off = await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { profile_intro: false } });
    const r2 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    expect(off.body.settings.profile_intro).toBe(false);
    expect(r2.body.config.profile_intro).toBeNull();
  });

  it("a photo whose rights lapsed blocks the render and shows in the preflight", async () => {
    const s = await seedAnalysed(a);
    await register(a, s.player);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const up = await upPhoto(a, s.player, png, photoMeta);
    expect(up.statusCode).toBe(200);
    const assetId = (JSON.parse(up.body) as { details: { photo_asset_id: string } }).details.photo_asset_id;
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    await root.query("UPDATE rights_grants SET valid_until = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 HOUR), valid_from = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 2 HOUR) WHERE asset_id = ?", [assetId]);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("PHOTO_RIGHTS_MISSING");
    const pre = await call(a, "GET", `/v1/reels/${reel.id}/preflight`);
    expect(pre.body.checks.find((c: { key: string }) => c.key === "photo_rights").level).toBe("BLOCK");
  });
});
