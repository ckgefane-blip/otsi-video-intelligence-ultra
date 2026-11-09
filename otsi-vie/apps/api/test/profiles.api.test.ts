/**
 * Analysis profiles and footage-quality assessments (ADR-034) through the real HTTP stack and MySQL: a profile is written out in full
 * into the run's config (the worker obeys it and the run records how it was analysed), single settings can be overridden, an assessment
 * becomes one ASSESS job, and its estimates come from the detector cost measured on the footage. The assessment worker is tested in
 * services/worker.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { assessJobStarter } from "../src/core/outbox/subscribers";
import { appDb, Member, rootDb, seedMember, seedRights, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedVideo(m: Member, state = "INGESTED"): Promise<string> {
  const project = uuidv7(), v = uuidv7(), source = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${v}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', ?, 60000000, ?, ?)",
    [v, m.orgId, project, state, m.userId, state === "INGESTED" ? source : null]);
  await seedRights(root, m.orgId, v);
  return v;
}

beforeAll(async () => {
  app = await startApi({});
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("analysis profiles", () => {
  it("write the chosen profile out in full; single settings can be overridden; the default stays Standard", async () => {
    const v1 = await seedVideo(a), v2 = await seedVideo(a), v3 = await seedVideo(a);
    const std = await call(a, "POST", `/v1/videos/${v1}/analysis-runs`, {});
    expect(std.body.config).toMatchObject({ profile: "STANDARD", sample_fps: 2, tiles: 2, grids: [2] });
    const ultra = await call(a, "POST", `/v1/videos/${v2}/analysis-runs`, { profile: "ULTRA_SENSITIVE" });
    expect(ultra.body.config).toMatchObject({ profile: "ULTRA_SENSITIVE", sample_fps: 6, grids: [2, 3], tiles: 3 });
    const [row] = await root.query<RowDataPacket[]>("SELECT config FROM pipeline_runs WHERE id = ?", [ultra.body.id]);
    const cfg = typeof row[0]!.config === "string" ? JSON.parse(row[0]!.config) : row[0]!.config;
    // low-confidence boxes are kept only as candidates; a track needs temporal confirmation with a confident detection
    expect(cfg).toMatchObject({ score_floor: 0.1, confirm: { min_hits: 4, min_peak: 0.4 }, tracker: { min_hits: 3 }, pitch: "TOUCHLINE" });
    const over = await call(a, "POST", `/v1/videos/${v3}/analysis-runs`, { profile: "HIGH_ACCURACY", sample_fps: 3, tiles: 1 });
    expect(over.body.config).toMatchObject({ profile: "HIGH_ACCURACY", sample_fps: 3, grids: [], tiles: 1 });
    expect((await call(a, "POST", `/v1/videos/${v3}/analysis-runs`, { profile: "MAXIMUM" })).status).toBe(422);
  });
});

describe("footage-quality assessments", () => {
  it("become one ASSESS job, return the latest with issues, recommendation and per-profile estimates, and stay in the organization", async () => {
    const v = await seedVideo(a);
    expect((await call(a, "GET", `/v1/videos/${v}/assessments/latest`)).body.code).toBe("NOT_ASSESSED");
    const q = await call(a, "POST", `/v1/videos/${v}/assessments`);
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ status: "QUEUED", recommended_profile: null, issues: [] });
    expect((await call(a, "POST", `/v1/videos/${v}/assessments`)).body.id).toBe(q.body.id);           // one at a time
    const d = new OutboxDispatcher(db, [assessJobStarter()]);
    for (let i = 0; i < 200; i++) if ((await d.runOnce()).claimed === 0) break;                 // drain: other files leave older events ahead of this one
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, state, subject_type FROM worker_jobs WHERE subject_id = ?", [q.body.id]);
    expect(jobs).toEqual([{ kind: "ASSESS", state: "QUEUED", subject_type: "quality_assessment" }]);

    // what the worker writes back (fixture): measured cost 0.05 s per detector pass on 1920x1080
    const metrics = { resolution: { width: 1920, height: 1080 }, cost: { seconds_per_pass: 0.05 }, issues: [{ code: "SMALL_PLAYERS", text: "players 31 px tall on median" }] };
    await root.query("UPDATE video_quality_assessments SET status = 'SUCCEEDED', metrics = ?, recommended_profile = 'ULTRA_SENSITIVE', finished_at = NOW(6) WHERE id = ?",
      [JSON.stringify(metrics), q.body.id]);
    const r = (await call(a, "GET", `/v1/videos/${v}/assessments/latest`)).body;
    expect(r).toMatchObject({ status: "SUCCEEDED", recommended_profile: "ULTRA_SENSITIVE", issues: [{ code: "SMALL_PLAYERS" }] });
    const est = Object.fromEntries(r.estimates.map((e: { profile: string }) => [e.profile, e]));
    expect(est.STANDARD).toMatchObject({ frames: 120, passes_per_frame: 5, seconds: Math.round(120 * 5 * 0.05 * 1.25) });
    expect(est.ULTRA_SENSITIVE).toMatchObject({ frames: 360, passes_per_frame: 14, seconds: Math.round(360 * 14 * 0.05 * 1.25) });
    expect(est.ULTRA_SENSITIVE.peak_memory_mb).toBeGreaterThan(est.STANDARD.peak_memory_mb);

    await expect(root.query("UPDATE video_quality_assessments SET status = 'SUCCEEDED', metrics = NULL WHERE id = ?", [q.body.id])).rejects.toThrow();
    expect((await call(viewer, "POST", `/v1/videos/${v}/assessments`)).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(b, "GET", `/v1/videos/${v}/assessments/latest`)).status).toBe(404);
    const pending = await seedVideo(a, "PENDING");
    expect((await call(a, "POST", `/v1/videos/${pending}/assessments`)).body.code).toBe("VIDEO_NOT_READY");
  });
});
