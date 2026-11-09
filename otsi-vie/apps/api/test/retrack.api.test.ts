/**
 * "Track again" (re-track) through the real HTTP stack and MySQL: a new run that replays the saved detections of an earlier FINISHED run
 * of the SAME video. It keeps that run's sampling and settings, uses the current pitch filter, and says which run it came from. Anything
 * else is refused. The worker side (no detector is loaded, same detections and frames) is tested in services/worker/tests/test_analyze.py.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { appDb, Member, rootDb, seedMember, seedRights, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member, b: Member;

async function post(m: Member, url: string, body: unknown) {
  const r = await app.inject({ method: "POST", url, headers: m.headers, payload: body as object });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedFinished(m: Member, opts: { detections?: boolean; status?: string; teamSeedUs?: number } = {}) {
  const project = uuidv7(), video = uuidv7(), source = uuidv7(), run = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)",
    [video, m.orgId, project, m.userId, source]);
  await seedRights(root, m.orgId, video);
  const config = { profile: "HIGH_ACCURACY", sample_fps: 6, grids: [2], tiles: 2, detector: null, score_floor: 0.2, pitch: "STRICT", stabilize: true,
    tracker: { high: 0.5, low: 0.15, min_hits: 2, distance_weight: 0.3 }, confirm: { min_hits: 3, min_peak: 0.5 }, result: { detections: 10 },
    ...(opts.teamSeedUs === undefined ? {} : { team_seed_pts_us: opts.teamSeedUs }) };
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (?, ?, ?, 'test', ?, ?)",
    [run, video, m.orgId, opts.status ?? "SUCCEEDED", JSON.stringify(config)]);
  if (opts.detections !== false) {
    const model = uuidv7(), asset = uuidv7();
    await root.query("INSERT INTO model_versions (id, task, model_name, semantic_version) VALUES (?, 'DETECT', 'test_detector', ?)", [model, `v-${model}`]);
    await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'DETECTIONS', ?, 'local', 1)",
      [asset, m.orgId, project, `org/${m.orgId}/runs/${run}/detections.parquet`]);
    await root.query("INSERT INTO detection_batches (id, run_id, model_version_id, start_frame, end_frame, payload_asset_id, checksum, detection_count) VALUES (?, ?, ?, 0, 1, ?, ?, 10)",
      [uuidv7(), run, model, asset, "0".repeat(64)]);
  }
  return { video, run };
}

beforeAll(async () => {
  app = await startApi({});
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("track again from saved detections", () => {
  it("makes a new run that keeps the earlier sampling and settings, uses the current pitch filter and names its source", async () => {
    const { video, run } = await seedFinished(a);
    const r = await post(a, `/v1/videos/${video}/analysis-runs`, { profile: "HIGH_ACCURACY", retrack_from: run });
    expect(r.status).toBe(201);
    expect(r.body.id).not.toBe(run);
    const [rows] = await root.query<RowDataPacket[]>("SELECT config, status FROM pipeline_runs WHERE id = ?", [r.body.id]);
    const cfg = typeof rows[0]!.config === "string" ? JSON.parse(rows[0]!.config) : rows[0]!.config;
    expect(rows[0]!.status).toBe("QUEUED");
    expect(cfg).toMatchObject({ reuse_detections_from: run, sample_fps: 6, grids: [2], score_floor: 0.2, pitch: "TOUCHLINE", tracker: { min_hits: 2, kit_gate: 0.7 }, confirm: { min_hits: 3, min_peak: 0.5 } });
    expect(cfg.result).toBeUndefined();                                     // the new run does not inherit the old run's measured result
    const [old] = await root.query<RowDataPacket[]>("SELECT status FROM pipeline_runs WHERE id = ?", [run]);
    expect(old[0]!.status).toBe("SUCCEEDED");                               // the earlier run is untouched
  });

  it("carries the kickoff moment that taught the teams: a new one is stored, a re-track without one keeps the earlier run's", async () => {
    const taught = await seedFinished(a, { teamSeedUs: 5_000_000 });
    const keep = await post(a, `/v1/videos/${taught.video}/analysis-runs`, { profile: "HIGH_ACCURACY", retrack_from: taught.run });
    expect(keep.status).toBe(201);
    const [r1] = await root.query<RowDataPacket[]>("SELECT config FROM pipeline_runs WHERE id = ?", [keep.body.id]);
    expect((typeof r1[0]!.config === "string" ? JSON.parse(r1[0]!.config) : r1[0]!.config).team_seed_pts_us).toBe(5_000_000);
    const plain = await seedFinished(a);
    const fresh = await post(a, `/v1/videos/${plain.video}/analysis-runs`, { profile: "HIGH_ACCURACY", retrack_from: plain.run, team_seed_pts_us: 1_485_000_000 });
    expect(fresh.status).toBe(201);
    const [r2] = await root.query<RowDataPacket[]>("SELECT config FROM pipeline_runs WHERE id = ?", [fresh.body.id]);
    expect((typeof r2[0]!.config === "string" ? JSON.parse(r2[0]!.config) : r2[0]!.config).team_seed_pts_us).toBe(1_485_000_000);
    expect((await post(a, `/v1/videos/${plain.video}/analysis-runs`, { profile: "HIGH_ACCURACY", team_seed_pts_us: -5 })).status).toBe(422);
  });

  it("refuses a source that is not a finished run of this video with saved detections", async () => {
    const x = await seedFinished(a), y = await seedFinished(a), running = await seedFinished(a, { status: "RUNNING" }), none = await seedFinished(a, { detections: false });
    const other = await seedFinished(b);
    for (const [video, src] of [[x.video, y.run], [running.video, running.run], [none.video, none.run], [x.video, other.run], [x.video, uuidv7()]] as const) {
      const r = await post(a, `/v1/videos/${video}/analysis-runs`, { retrack_from: src });
      expect(r.status).toBe(409);
      expect(r.body.code ?? r.body.type).toMatch(/RETRACK_SOURCE_INVALID|ANALYSIS_ALREADY_RUNNING/);
    }
    expect((await post(a, `/v1/videos/${x.video}/analysis-runs`, { retrack_from: "not-an-id" })).status).toBe(422);
  });
});
