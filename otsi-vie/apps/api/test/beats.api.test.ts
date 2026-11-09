/**
 * v3 Phase C.5 (ADR-105, migration 0061): Music beat grid API integration test.
 * Tests GET and POST /v1/brand-assets/:id/beat-grid, rights enforcement, deduplication, and view mapping.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BEAT_LIBRARY_NOTE, BEAT_METHOD } from "@otsi-vie/contracts";
import { Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let owner: Member, viewer: Member, otherOrg: Member;

async function call(m: Member | null, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m?.headers ?? {}, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

async function createMusicAsset(orgId: string, userId: string, name: string, rightsState = "EXPORT_ALLOWED"): Promise<string> {
  const brandId = uuidv7(), assetId = uuidv7(), grantId = uuidv7();
  const key = `org/${orgId}/brand/${brandId}.mp3`;
  const file = path.join(dir, key);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, Buffer.from("ID3FakeMp3AudioDataForBeatAnalysisTesting12345"));

  await root.query(
    `INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type, created_by)
     VALUES (?, ?, 'BRAND', ?, 'local', 45, 'fakehash', 'audio/mpeg', ?)`,
    [assetId, orgId, key, userId],
  );
  await root.query(
    `INSERT INTO rights_grants (id, organization_id, asset_id, rights_state, allowed_uses, valid_from)
     VALUES (?, ?, ?, ?, JSON_ARRAY('REEL_AUDIO'), CURRENT_TIMESTAMP(6))`,
    [grantId, orgId, assetId, rightsState],
  );
  await root.query(
    `INSERT INTO brand_assets (id, organization_id, kind, name, asset_id, rights_grant_id, rights_holder, rights_basis, uploaded_by)
     VALUES (?, ?, 'MUSIC', ?, ?, ?, 'OTSI Records', 'OWN_BRAND', ?)`,
    [brandId, orgId, name, assetId, grantId, userId],
  );
  return brandId;
}

beforeAll(async () => {
  root = await rootDb();
  dir = await mkdtemp(path.join(tmpdir(), "vie-beats-api-"));
  app = await startApi({ storageDir: dir });
  owner = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", owner.orgId);
  otherOrg = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app.close();
  await root.end();
  await rm(dir, { recursive: true, force: true });
});

describe("C.5 Beat Grid API", () => {
  it("requires authentication", async () => {
    const res = await call(null, "GET", `/v1/brand-assets/${uuidv7()}/beat-grid`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for unknown asset or another organization's asset", async () => {
    const musicId = await createMusicAsset(otherOrg.orgId, otherOrg.userId, "Other Org Tune");
    const res = await call(owner, "GET", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res.status).toBe(404);
  });

  it("returns 422 if the asset is not music (e.g. logo)", async () => {
    const logoId = uuidv7(), assetId = uuidv7(), grantId = uuidv7();
    await root.query(
      `INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type, created_by)
       VALUES (?, ?, 'BRAND', 'logo.png', 'local', 10, 'image/png', ?)`,
      [assetId, owner.orgId, owner.userId],
    );
    await root.query(
      `INSERT INTO rights_grants (id, organization_id, asset_id, rights_state, allowed_uses, valid_from)
       VALUES (?, ?, ?, 'EXPORT_ALLOWED', JSON_ARRAY('REEL_OVERLAY'), CURRENT_TIMESTAMP(6))`,
      [grantId, owner.orgId, assetId],
    );
    await root.query(
      `INSERT INTO brand_assets (id, organization_id, kind, name, asset_id, rights_grant_id, rights_holder, rights_basis, uploaded_by)
       VALUES (?, ?, 'CUSTOM_LOGO', 'Logo', ?, ?, 'OTSI', 'OWN_BRAND', ?)`,
      [logoId, owner.orgId, assetId, grantId, owner.userId],
    );

    const res = await call(owner, "GET", `/v1/brand-assets/${logoId}/beat-grid`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("NOT_MUSIC");
  });

  it("returns grid=null before analysis has been requested", async () => {
    const musicId = await createMusicAsset(owner.orgId, owner.userId, "Pregame Anthem");
    const res = await call(owner, "GET", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res.status).toBe(200);
    expect(res.body.music_id).toBe(musicId);
    expect(res.body.grid).toBeNull();
    expect(res.body.library_note).toBe(BEAT_LIBRARY_NOTE);
  });

  it("blocks non-writers from requesting beat grid", async () => {
    const musicId = await createMusicAsset(owner.orgId, owner.userId, "Match Tune");
    const res = await call(viewer, "POST", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res.status).toBe(403);
  });

  it("blocks requesting beat analysis when rights are not in force", async () => {
    const musicId = await createMusicAsset(owner.orgId, owner.userId, "Unlicensed Tune", "EXPIRED");
    const res = await call(owner, "POST", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("MUSIC_RIGHTS_NOT_IN_FORCE");
  });

  it("queues beat analysis and returns 202 with QUEUED status and outbox event", async () => {
    const musicId = await createMusicAsset(owner.orgId, owner.userId, "Club Beat");
    const res = await call(owner, "POST", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res.status).toBe(202);
    expect(res.body.music_id).toBe(musicId);
    expect(res.body.grid.status).toBe("QUEUED");
    expect(res.body.grid.method).toBe(BEAT_METHOD);

    // Verify database row
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT * FROM music_beat_grids WHERE brand_asset_id = ? AND status = 'QUEUED'",
      [musicId],
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.organization_id).toBe(owner.orgId);

    // Verify outbox event
    const [events] = await root.query<RowDataPacket[]>(
      "SELECT * FROM outbox_events WHERE aggregate_id = ? AND event_type = 'brand_asset.beat_grid_requested'",
      [musicId],
    );
    expect(events.length).toBe(1);

    // Repeated request is idempotent and returns the existing queued grid
    const res2 = await call(owner, "POST", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res2.status).toBe(202);
    expect(res2.body.grid.id).toBe(res.body.grid.id);
  });

  it("returns completed beat grid with tempo, beats, and periodicity when succeeded", async () => {
    const musicId = await createMusicAsset(owner.orgId, owner.userId, "Finished Track");
    const gridId = uuidv7();
    const beats = [500_000, 1_000_000, 1_500_000, 2_000_000];
    await root.query(
      `INSERT INTO music_beat_grids (id, organization_id, brand_asset_id, status, method, tempo_bpm, beats, beat_count, duration_us, periodicity, requested_by, finished_at)
       VALUES (?, ?, ?, 'SUCCEEDED', ?, 128.50, ?, 4, 2500000, 0.9200, ?, CURRENT_TIMESTAMP(6))`,
      [gridId, owner.orgId, musicId, BEAT_METHOD, JSON.stringify(beats), owner.userId],
    );

    const res = await call(owner, "GET", `/v1/brand-assets/${musicId}/beat-grid`);
    expect(res.status).toBe(200);
    expect(res.body.grid.status).toBe("SUCCEEDED");
    expect(res.body.grid.tempo_bpm).toBe(128.5);
    expect(res.body.grid.beats_us).toEqual(beats);
    expect(res.body.grid.duration_us).toBe(2_500_000);
    expect(res.body.grid.periodicity).toBe(0.92);
  });
});
