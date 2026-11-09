/**
 * B.22 (ADR-097, migration 0058), through the real API and MySQL:
 * - the preset library: built-ins, an organization preset (owner / admin only), personal presets (seen and deleted by their owner only),
 *   another organization sees none;
 * - batch fan-out: one request makes a file per frame, each with its own loudness; a file already rendering is skipped and said so; a
 *   profile with its own frame refuses another;
 * - preflight: what blocks (no clips) and what warns, and the files rendering now.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, admin: Member, editor: Member, editor2: Member, viewer: Member, b: Member;
async function call(m: Member, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedReel(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 1000000, 50000000, 'ENDED', 1)`, [track, run, video, shot]);
  await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, 25, 1000000)", [video]);
  await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, 25, ?, 1000000, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, track]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Export Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  return (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body.id as string;
}
const spec = { outputs: [{ profile: "REEL", aspect: "1:1" }, { profile: "SOCIAL" }], codec: "h264", bitrate_mbps: 6, loudness_lufs: -18 };

beforeAll(async () => {
  app = await startApi(); root = await rootDb();
  a = await seedMember(root, "OWNER"); admin = await seedMember(root, "ADMIN", a.orgId); editor = await seedMember(root, "EDITOR", a.orgId);
  editor2 = await seedMember(root, "EDITOR", a.orgId); viewer = await seedMember(root, "VIEWER", a.orgId); b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Export preset library, batch and preflight (B.22)", () => {
  it("built-in, organization and personal presets with their rights", async () => {
    const all = (await call(editor, "GET", "/v1/export-presets")).body as { id: string; scope: string }[];
    expect(all.filter((x) => x.scope === "BUILT_IN").map((x) => x.id)).toEqual(["builtin-reel", "builtin-scout-social", "builtin-archive", "builtin-all-frames"]);
    expect((await call(editor, "POST", "/v1/export-presets", { name: "Club", scope: "ORGANIZATION", spec })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(viewer, "POST", "/v1/export-presets", { name: "Mine", scope: "PERSONAL", spec })).status).toBe(403);
    const org = (await call(admin, "POST", "/v1/export-presets", { name: "Club social", scope: "ORGANIZATION", note: "Square and vertical", spec })).body;
    expect(org).toMatchObject({ scope: "ORGANIZATION", spec: { outputs: [{ profile: "REEL", aspect: "1:1" }, { profile: "SOCIAL", aspect: null }], loudness_lufs: -18 }, can_delete: true });
    const mine = (await call(editor, "POST", "/v1/export-presets", { name: "My scout", scope: "PERSONAL", spec: { outputs: [{ profile: "SCOUT" }] } })).body;
    expect(mine).toMatchObject({ scope: "PERSONAL", can_delete: true, spec: { codec: null, bitrate_mbps: null } });
    const seen = (await call(editor2, "GET", "/v1/export-presets")).body as { id: string; can_delete: boolean }[];
    expect(seen.map((x) => x.id)).toContain(org.id);
    expect(seen.map((x) => x.id)).not.toContain(mine.id);                                  // another member's own preset is not listed
    expect(seen.find((x) => x.id === org.id)!.can_delete).toBe(false);
    expect((await call(editor2, "DELETE", `/v1/export-presets/${mine.id}`)).status).toBe(404);
    expect((await call(editor, "DELETE", `/v1/export-presets/${org.id}`)).status).toBe(403);
    expect((await call(b, "GET", "/v1/export-presets")).body.map((x: { id: string }) => x.id)).not.toContain(org.id);
    expect((await call(b, "DELETE", `/v1/export-presets/${org.id}`)).status).toBe(404);
    expect((await call(editor, "DELETE", `/v1/export-presets/${mine.id}`)).status).toBe(204);
    expect((await call(a, "DELETE", `/v1/export-presets/${org.id}`)).status).toBe(204);
  });

  it("preflight, then one request makes a file per frame; a running file is skipped", async () => {
    const reel = await seedReel(a);
    let pf = (await call(viewer, "GET", `/v1/reels/${reel}/preflight`)).body;
    expect(pf.checks[0]).toMatchObject({ key: "clips", level: "BLOCK" });
    expect((await call(b, "GET", `/v1/reels/${reel}/preflight`)).status).toBe(404);
    await call(a, "POST", `/v1/reels/${reel}/clips`, { in_pts_us: 1_000_000, out_pts_us: 9_000_000 });
    pf = (await call(a, "GET", `/v1/reels/${reel}/preflight`)).body;
    expect(pf.checks.filter((c: { level: string }) => c.level === "BLOCK")).toEqual([]);
    expect(pf.checks.map((c: { key: string }) => c.key)).toEqual(expect.arrayContaining(["clips", "rights", "player"]));
    expect(pf.open).toEqual([]);

    const k = key();
    const res = (await call(a, "POST", `/v1/reels/${reel}/renders/batch`, { outputs: [...spec.outputs, { profile: "REEL", aspect: "1:1" }], codec: "h264", bitrate_mbps: 6, loudness_lufs: -18 },
      { "idempotency-key": k })).body;
    expect(res.skipped).toEqual([]);
    expect(res.started.map((j: { config: { profile: string; aspect: string; audio: { lufs: number } } }) => [j.config.profile, j.config.aspect, j.config.audio.lufs]))
      .toEqual([["REEL", "1:1", -18], ["SOCIAL", "9:16", -18]]);                         // the same file asked twice is made once
    expect((await call(a, "GET", `/v1/reels/${reel}/preflight`)).body.open).toEqual(expect.arrayContaining([{ profile: "REEL", aspect: "1:1" }, { profile: "SOCIAL", aspect: "9:16" }]));
    // the same request again is the same renders (idempotent); a new one skips the files already rendering and makes the new frame
    expect((await call(a, "POST", `/v1/reels/${reel}/renders/batch`, { outputs: spec.outputs }, { "idempotency-key": k })).body.started.map((j: { id: string }) => j.id))
      .toEqual(res.started.map((j: { id: string }) => j.id));
    const again = (await call(a, "POST", `/v1/reels/${reel}/renders/batch`, { outputs: [{ profile: "REEL", aspect: "1:1" }, { profile: "REEL", aspect: "4:5" }] }, { "idempotency-key": key() })).body;
    expect(again.skipped).toMatchObject([{ profile: "REEL", aspect: "1:1", code: "RENDER_ALREADY_RUNNING" }]);
    expect(again.started.map((j: { config: { aspect: string; audio: { lufs: number } } }) => [j.config.aspect, j.config.audio.lufs])).toEqual([["4:5", -16]]);
    expect((await call(a, "POST", `/v1/reels/${reel}/renders`, { profile: "SCOUT", aspect: "9:16" }, { "idempotency-key": key() })).body.code).toBe("PROFILE_HAS_ITS_FRAME");
    expect((await call(viewer, "POST", `/v1/reels/${reel}/renders/batch`, { outputs: spec.outputs }, { "idempotency-key": key() })).status).toBe(403);
  });
});
