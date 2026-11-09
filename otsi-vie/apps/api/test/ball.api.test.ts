/** The ball answer key and the engine's ball through the real API and MySQL (apps/api/src/modules/analysis/ball.ts). */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { publish } from "../src/core/outbox/publish";
import { autoBallStarter, ballJobStarter } from "../src/core/outbox/subscribers";
import { appDb, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "PUT" | "POST" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedVideo(m: Member): Promise<string> {
  const project = uuidv7(), video = uuidv7(), source = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, width, height, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, 1280, 720, ?, ?)", [video, m.orgId, project, m.userId, source]);
  return video;
}

async function deliver(): Promise<void> {
  const d = new OutboxDispatcher(db, [ballJobStarter(), autoBallStarter()]);
  for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
}

beforeAll(async () => {
  app = await startApi({});
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await db?.onModuleDestroy(); await root?.end(); });

describe("ball marks", () => {
  it("mark the ball or 'not visible' per moment; marking again replaces; validated; viewers and other organizations kept out", async () => {
    const video = await seedVideo(a);
    const url = `/v1/videos/${video}/ball-marks`;
    expect((await call(a, "GET", url)).body).toMatchObject({ marks: [], visible: 0, hidden: 0 });
    expect((await call(a, "PUT", url, { pts_us: 1_000_000, visible: true, x: 0.5, y: 0.6 })).body).toMatchObject({ visible: 1, hidden: 0 });
    expect((await call(a, "PUT", url, { pts_us: 1_166_667, visible: false })).body).toMatchObject({ visible: 1, hidden: 1 });
    const again = (await call(a, "PUT", url, { pts_us: 1_000_000, visible: true, x: 0.52, y: 0.61 })).body;          // a correction replaces
    expect(again.marks).toHaveLength(2);
    expect(again.marks[0]).toMatchObject({ pts_us: 1_000_000, visible: true, x: expect.closeTo(0.52, 4), y: expect.closeTo(0.61, 4) });
    expect((await call(a, "PUT", url, { pts_us: 2_000_000, visible: true })).status).toBe(422);                        // a visible ball needs a place
    expect((await call(a, "PUT", url, { pts_us: 2_000_000, visible: false, x: 0.1, y: 0.1 })).status).toBe(422);       // a hidden one has none
    expect((await call(a, "PUT", url, { pts_us: 99_000_000, visible: false })).body.code).toBe("MARK_OUTSIDE_VIDEO");
    expect((await call(viewer, "PUT", url, { pts_us: 3_000_000, visible: false })).status).toBe(403);
    expect((await call(viewer, "GET", url)).status).toBe(200);
    expect((await call(b, "GET", url)).status).toBe(404);
    expect((await call(b, "DELETE", `/v1/ball-marks/${again.marks[1].id}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/ball-marks/${again.marks[1].id}`)).status).toBe(204);
    expect((await call(a, "GET", url)).body).toMatchObject({ visible: 1, hidden: 0 });
  });
});

describe("the engine's ball", () => {
  it("starts by itself once per finished analysis; a person may start it again; positions come back with a check against the marks", async () => {
    const video = await seedVideo(a);
    const url = `/v1/videos/${video}/ball`;
    expect((await call(a, "GET", url)).body).toMatchObject({ track: null, t: [], s: "", check: null });
    expect((await call(a, "POST", url)).body.code).toBe("NO_FINISHED_ANALYSIS");
    const run = uuidv7();
    await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'SUCCEEDED')", [run, video, a.orgId]);
    // the analysis finishing starts it, nobody clicking - and a repeated delivery never starts a second
    for (const k of [1, 2]) await publish(root as never, { organizationId: a.orgId, aggregateType: "analysis_run", aggregateId: run, eventType: "analysis.completed", payload: { run_id: run, video_id: video }, dedupeKey: `test-done:${run}:${k}` });
    await deliver();
    const [tracks] = await root.query<RowDataPacket[]>("SELECT id, requested_by, status FROM ball_tracks WHERE video_id = ?", [video]);
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({ requested_by: null, status: "QUEUED" });
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, state FROM worker_jobs WHERE subject_id = ?", [tracks[0]!.id]);
    expect(jobs).toEqual([{ kind: "TRACK_BALL", state: "QUEUED" }]);
    expect((await call(a, "GET", url)).body.track).toMatchObject({ status: "QUEUED", automatic: true, run_id: run });
    expect((await call(a, "POST", url)).body.code).toBe("BALL_TRACK_RUNNING");
    // the worker's result: three frames known (two detected, one inferred), everything else unknown
    const id = tracks[0]!.id as string;
    await root.query("INSERT INTO ball_positions (ball_track_id, pts_us, state, x, y, confidence) VALUES (?, 1000000, 'DETECTED', 0.5, 0.5, 0.9), (?, 1166667, 'INFERRED', 0.51, 0.5, 0.4), (?, 1333333, 'DETECTED', 0.52, 0.5, 0.9)", [id, id, id]);
    await root.query("UPDATE ball_tracks SET status = 'SUCCEEDED', metrics = ?, finished_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [JSON.stringify({ step_us: 166667, frames: 360, detected: 2, inferred: 1 }), id]);
    let path = (await call(viewer, "GET", url)).body;
    expect(path).toMatchObject({ t: [1_000_000, 1_166_667, 1_333_333], s: "DID", x: [0.5, 0.51, 0.52], check: null });
    // marks: right (3 px off), wrong (64 px off), the engine said unknown, and a 'not visible' where the engine invented nothing
    for (const m of [{ pts_us: 1_000_000, visible: true, x: 0.502, y: 0.5 }, { pts_us: 1_333_333, visible: true, x: 0.57, y: 0.5 }, { pts_us: 2_000_000, visible: true, x: 0.3, y: 0.3 }, { pts_us: 2_166_667, visible: false }])
      expect((await call(a, "PUT", `/v1/videos/${video}/ball-marks`, m)).status).toBe(200);
    path = (await call(a, "GET", url)).body;
    expect(path.check).toEqual({ marked_visible: 3, right: 1, wrong: 1, unknown: 1, marked_hidden: 1, invented: 0, precision: 0.5, recall: 0.333 });
    // a person starts it again: a new track and its job
    const again = await call(a, "POST", url);
    expect(again.status).toBe(202);
    expect(again.body.track).toMatchObject({ status: "QUEUED", automatic: false, run_id: run });
    await deliver();
    const [jobs2] = await root.query<RowDataPacket[]>("SELECT kind FROM worker_jobs WHERE subject_id = ?", [again.body.track.id]);
    expect(jobs2).toEqual([{ kind: "TRACK_BALL" }]);
    expect((await call(viewer, "POST", url)).status).toBe(403);
    expect((await call(b, "GET", url)).status).toBe(404);
    expect((await call(b, "POST", url)).status).toBe(404);
  });
});
