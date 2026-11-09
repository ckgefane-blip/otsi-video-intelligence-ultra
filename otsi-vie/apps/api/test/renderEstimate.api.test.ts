/**
 * B.13 (ADR-089): the Generate Reel estimate through the real API and MySQL: none before any render finished; then measured from the
 * organization's finished renders (start → finish ÷ the seconds the worker made), same Auto Track setting first, times this reel's
 * length; queued renders counted; another organization cannot read it.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, b: Member;
async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

/** a confirmed player's reel with one 6 s clip */
async function seedReel(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Estimate Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body;
  await call(m, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED" });
  return reel.id as string;
}
const render = async (m: Member, reel: string) => (await call(m, "POST", `/v1/reels/${reel}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
/** recorded the way the worker records a finished render: `elapsed` seconds of work for `made` seconds of reel */
async function finish(m: Member, id: string, elapsed: number, made: number, autoTrack = true) {
  const out = uuidv7(), man = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 1, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 1, 'application/json')",
    [out, m.orgId, `org/${m.orgId}/r/${id}.mp4`, man, m.orgId, `org/${m.orgId}/r/${id}.json`]);
  await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [id]);
  await root.query(`UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, started_at = CURRENT_TIMESTAMP(6) - INTERVAL ? SECOND, completed_at = CURRENT_TIMESTAMP(6),
    result = JSON_OBJECT('duration_s', ?), config = JSON_SET(config, '$.settings.auto_track', ?) WHERE id = ?`, [out, man, elapsed, made, autoTrack, id]);
}

beforeAll(async () => { app = await startApi(); root = await rootDb(); a = await seedMember(root, "OWNER"); b = await seedMember(root, "OWNER"); });
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Render estimate (B.13)", () => {
  it("is unknown before any render finished, then measured from the organization's own renders", async () => {
    const reel = await seedReel(a);
    expect((await call(a, "GET", `/v1/reels/${reel}/render-estimate`)).body).toEqual({ basis: 0, same_tracking: false, per_second: null, seconds: null, low_seconds: null, high_seconds: null, waiting: 0 });

    await finish(a, await render(a, reel), 60, 6);            // 10 s of work per second, Auto Track on
    await finish(a, await render(a, reel), 120, 6);           // 20 s per second, Auto Track on
    await finish(a, await render(a, reel), 6, 6, false);      // 1 s per second, Auto Track off: not used while on-renders exist
    const e = (await call(a, "GET", `/v1/reels/${reel}/render-estimate`)).body;
    expect(e).toEqual({ basis: 2, same_tracking: true, per_second: 15, seconds: 90, low_seconds: 60, high_seconds: 120, waiting: 0 });

    await render(a, reel);                                  // queued now
    expect((await call(a, "GET", `/v1/reels/${reel}/render-estimate`)).body.waiting).toBe(1);
    expect((await call(b, "GET", `/v1/reels/${reel}/render-estimate`)).status).toBe(404);
  });
});
