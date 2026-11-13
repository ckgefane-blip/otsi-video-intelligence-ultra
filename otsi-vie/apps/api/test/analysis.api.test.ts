/**
 * Analysis runs, tracks, the overlay window and the signed playback gateway (Blocks 04-06) through the real HTTP stack and MySQL.
 * Track rows are seeded as the worker writes them (fixtures, root account); the worker itself is tested in services/worker.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { analyzeJobStarter, proxyJobStarter } from "../src/core/outbox/subscribers";
import { appDb, key, Member, rootDb, seedMember, seedRights, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let dir: string;
let a: Member;
let b: Member;
let video: string;
let proxyBytes: Buffer;

async function call(m: Member | null, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m ? m.headers : {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload, headers: r.headers };
}

async function seedVideo(m: Member, state = "INGESTED"): Promise<string> {
  const project = uuidv7(), v = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  const source = uuidv7();                                    // an INGESTED video always has its verified source asset (schema rule)
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${v}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', ?, 60000000, ?, ?)",
    [v, m.orgId, project, state, m.userId, state === "INGESTED" ? source : null]);
  await seedRights(root, m.orgId, v);
  return v;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-analysis-"));
  app = await startApi({ storageDir: dir });
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
  video = await seedVideo(a);
  // a playback copy on disk, as the proxy worker leaves it
  const asset = uuidv7(), key = `org/${a.orgId}/videos/${video}/proxy.webm`;
  proxyBytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 251));
  await mkdir(path.join(dir, "org", a.orgId, "videos", video), { recursive: true });
  await writeFile(path.join(dir, ...key.split("/")), proxyBytes);
  await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'PROXY', ?, 'local', ?, 'video/webm')",
    [asset, a.orgId, key, proxyBytes.length]);
  await root.query("UPDATE video_sources SET proxy_asset_id = ? WHERE id = ?", [asset, video]);
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("analysis runs", () => {
  it("start a run for a verified video, queue exactly one analysis job, refuse a second open run and unverified videos", async () => {
    const r = await call(a, "POST", `/v1/videos/${video}/analysis-runs`, { sample_fps: 2, tiles: 2 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "QUEUED", config: { sample_fps: 2, tiles: 2, detector: null }, result: null,
      steps: [{ name: "SHOTS", status: "QUEUED" }, { name: "DETECT", status: "QUEUED" }, { name: "TRACK", status: "QUEUED" }, { name: "IDENTIFY", status: "QUEUED" }] });
    expect((await call(a, "POST", `/v1/videos/${video}/analysis-runs`, {})).body.code).toBe("ANALYSIS_ALREADY_RUNNING");
    const pending = await seedVideo(a, "VALIDATING");
    expect((await call(a, "POST", `/v1/videos/${pending}/analysis-runs`, {})).body.code).toBe("VIDEO_NOT_READY");
    expect((await call(a, "POST", `/v1/videos/${video}/analysis-runs`, { sample_fps: 50 })).body.code).toBe("INVALID_REQUEST");
    const d = new OutboxDispatcher(db, [analyzeJobStarter(), proxyJobStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, state FROM worker_jobs WHERE subject_id = ?", [r.body.id]);
    expect(jobs).toEqual([{ kind: "ANALYZE", state: "QUEUED" }]);
    expect((await call(a, "GET", `/v1/analysis-runs/${r.body.id}`)).body.job).toEqual({ state: "QUEUED", progress: 0, stage_message: null });
    const cancelled = await call(a, "POST", `/v1/analysis-runs/${r.body.id}/cancel`);
    expect(cancelled.body).toMatchObject({ status: "CANCELLED", steps: [{ status: "CANCELLED" }, { status: "CANCELLED" }, { status: "CANCELLED" }, { status: "CANCELLED" }], job: { state: "CANCELLED" } });
    expect((await call(a, "POST", `/v1/analysis-runs/${r.body.id}/cancel`)).body.code).toBe("RUN_NOT_ACTIVE");
  });

  it("are private to the organization and need an analyst role to start", async () => {
    const r = (await call(a, "GET", `/v1/videos/${video}/analysis-runs`)).body[0];
    expect((await call(b, "GET", `/v1/analysis-runs/${r.id}`)).status).toBe(404);
    expect((await call(b, "POST", `/v1/videos/${video}/analysis-runs`, {})).status).toBe(404);
    const editor = await seedMember(root, "EDITOR", a.orgId);
    expect((await call(editor, "POST", `/v1/videos/${video}/analysis-runs`, {})).body.code).toBe("ROLE_NOT_ALLOWED");
  });
});

describe("tracks and the overlay window", () => {
  let run: string;
  beforeAll(async () => {
    run = uuidv7();
    await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'SUCCEEDED')", [run, video, a.orgId]);
    const shot = uuidv7();
    await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
    for (let f = 0; f < 10; f++) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, f * 25, f * 1_000_000]);
    for (const [n, cls] of [[1, "PERSON"], [2, "BALL"]] as const) {
      const t = uuidv7();
      await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count, mean_confidence)
                        VALUES (?, ?, ?, ?, ?, ?, 0, 9000000, 'ENDED', 10, 0.8)`, [t, run, video, shot, n, cls]);
      for (let f = 0; f < 10; f++) {
        await root.query(`INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state)
                          VALUES (?, ?, ?, ?, 0.1, 0.2, 0.05, 0.1, 0.8, 'DETECTED')`, [video, f * 25, t, f * 1_000_000]);
      }
    }
  });

  it("label every track honestly: no identity without a confirmed decision", async () => {
    const t = await call(a, "GET", `/v1/analysis-runs/${run}/tracks`);
    expect(t.body.map((x: { label: string }) => x.label)).toEqual(["Unidentified person · track 1", "Ball · track 2"]);
    expect(t.body[0]).toMatchObject({ identity_state: "UNRESOLVED", canonical_otsi_id: null, observation_count: 10, shot_number: 1, jersey_number: null, position: null, club: null });
  });

  it("carries the confirmed player's line for the identity row: shirt number, position, club", async () => {
    const person = (await root.query("SELECT id FROM tracks WHERE run_id = ? AND internal_track_number = 1", [run]))[0] as { id: string }[];
    const player = (await call(a, "POST", "/v1/players", { display_name: "Line Player" }, { "idempotency-key": key() })).body.player_id as string;
    expect((await call(a, "POST", `/v1/tracks/${person[0]!.id}/identity-decisions`, { state: "CONFIRMED", player_id: player })).status).toBe(201);
    const home = uuidv7(), away = uuidv7(), match = uuidv7();
    await root.query("INSERT INTO clubs (id, canonical_name) VALUES (?, 'FC Ercakhu'), (?, 'Nart Sukhum')", [home, away]);
    await root.query("INSERT INTO matches (id, organization_id, home_club_id, away_club_id, kickoff_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(6))", [match, a.orgId, home, away]);
    await root.query("INSERT INTO match_rosters (match_id, player_id, club_id, jersey_number, role, position) VALUES (?, ?, ?, 4, 'STARTER', 'DM')", [match, player, home]);
    const t = await call(a, "GET", `/v1/analysis-runs/${run}/tracks`);
    expect(t.body[0]).toMatchObject({ identity_state: "CONFIRMED", jersey_number: 4, position: "DM", club: "FC Ercakhu" });
    expect(t.body[1]).toMatchObject({ jersey_number: null, position: null, club: null });   // the ball track has no player
  });

  it("serve the boxes between two times, with shot boundaries, and only within a bounded window", async () => {
    const w = await call(a, "GET", `/v1/analysis-runs/${run}/observations?from_us=2000000&to_us=5000000`);
    expect(w.body.observations).toHaveLength(6);                                        // 2 tracks x frames at 2, 3, 4 s
    expect(w.body.observations[0]).toEqual({ track_id: expect.any(String), track_number: 1, class_name: "PERSON", pts_us: 2000000, x: 0.1, y: 0.2, w: 0.05, h: 0.1, score: 0.8, kit_group: null, pitch_x: null, pitch_y: null });   // no appearance measured: no colour group, no pitch position: not a guess
    // a measured shirt-colour group travels with each box (independent of the capped track list)
    const person = (await root.query("SELECT id FROM tracks WHERE run_id = ? AND internal_track_number = 1", [run]))[0] as { id: string }[];
    await root.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count) VALUES (?, ?, 1, '#202020', 4)", [person[0]!.id, run]);
    const w2 = await call(a, "GET", `/v1/analysis-runs/${run}/observations?from_us=2000000&to_us=3000000`);
    expect(w2.body.observations.find((o: { track_number: number }) => o.track_number === 1).kit_group).toBe(1);
    expect(w2.body.observations.find((o: { track_number: number }) => o.track_number === 2).kit_group).toBeNull();
    expect(w.body.shots).toEqual([{ shot_number: 1, start_pts_us: 0, end_pts_us: 60000000 }]);
    expect((await call(a, "GET", `/v1/analysis-runs/${run}/observations?from_us=0&to_us=30000000`)).body.code).toBe("WINDOW_TOO_LONG");
    expect((await call(a, "GET", `/v1/analysis-runs/${run}/observations?from_us=5&to_us=1`)).body.code).toBe("INVALID_WINDOW");
    expect((await call(b, "GET", `/v1/analysis-runs/${run}/observations?from_us=0&to_us=1000000`)).status).toBe(404);
  });
});

describe("signed playback", () => {
  it("issues a short-lived signed URL and streams with HTTP Range; tampered, foreign or expired links are refused", async () => {
    const p = await call(a, "GET", `/v1/videos/${video}/playback`);
    expect(p.body).toMatchObject({ available: true, mime: "video/webm", reason: null });
    const url = (p.body.url as string).replace(/^\/api/, "");
    const full = await call(null, "GET", url);
    expect([full.status, Buffer.compare(full.body as Buffer, proxyBytes)]).toEqual([200, 0]);
    const part = await call(null, "GET", url, undefined, { range: "bytes=100-199" });
    expect([part.status, part.headers["content-range"], (part.body as Buffer).length]).toEqual([206, `bytes 100-199/${proxyBytes.length}`, 100]);
    expect((part.body as Buffer).equals(proxyBytes.subarray(100, 200))).toBe(true);
    expect((await call(null, "GET", url, undefined, { range: "bytes=999999-" })).status).toBe(416);
    expect((await call(null, "GET", url.replace(/sig=[^&]+/, "sig=AAAA"))).body.code).toBe("INVALID_SIGNATURE");
    expect((await call(null, "GET", url.replace(`org=${a.orgId}`, `org=${b.orgId}`))).body.code).toBe("INVALID_SIGNATURE");   // the signature binds the organization
    const exp = /exp=(\d+)/.exec(url)![1]!;
    expect((await call(null, "GET", url.replace(`exp=${exp}`, `exp=${Number(exp) + 10}`))).body.code).toBe("INVALID_SIGNATURE"); // and the expiry
    expect((await call(b, "GET", `/v1/videos/${video}/playback`)).status).toBe(404);
  });

  it("says why there is no playback yet", async () => {
    const v = await seedVideo(a, "VALIDATING");
    expect((await call(a, "GET", `/v1/videos/${v}/playback`)).body).toEqual({ available: false, url: null, mime: null, expires_at: null, reason: "The video has not been verified yet." });
  });
});
