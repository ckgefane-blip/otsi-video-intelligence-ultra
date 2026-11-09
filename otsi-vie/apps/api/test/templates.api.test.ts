/**
 * Clip Studio transitions and templates through the real API and MySQL (ADR-055, migration 0041): a transition goes into a clip after the
 * first, at most half that clip, removed with its clip, copied by Duplicate and sent to the renderer; a template keeps a reel's look for the
 * organization, applying it leaves out a logo whose rights lapsed and says so; roles and other organizations are kept out.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

/** a reel of a confirmed player with three clips: 1-7 s, 10-11 s (short) and 18-24 s */
async function seedReel(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Look Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body;
  for (const [i, o] of [[1, 7], [10, 11], [18, 24]]) await call(m, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: i! * 1e6, out_pts_us: o! * 1e6 });
  return { video, player, reel: (await call(m, "GET", `/v1/reels/${reel.id}`)).body };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-looks-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("transitions", () => {
  it("go into a clip after the first, at most half of it; removed with the clip; copied by Duplicate; sent to the renderer", async () => {
    const s = await seedReel(a);
    const [c1, c2, c3] = s.reel.clips.map((c: { id: string }) => c.id);
    const url = `/v1/reels/${s.reel.id}/transitions`;
    expect(s.reel.transitions).toEqual([]);
    expect((await call(a, "PATCH", url, { clip_id: c1, kind: "FADE" })).body.code).toBe("FIRST_CLIP");
    expect((await call(a, "PATCH", url, { clip_id: c2, kind: "FADE", duration_ms: 600 })).body.code).toBe("TRANSITION_TOO_LONG");
    expect((await call(a, "PATCH", url, { clip_id: c3, kind: "WIPE" })).status).toBe(422);
    expect((await call(a, "PATCH", url, { clip_id: c3, kind: "FADE", duration_ms: 1500 })).status).toBe(422);
    expect((await call(viewer, "PATCH", url, { clip_id: c3, kind: "FADE" })).status).toBe(403);
    expect((await call(b, "PATCH", url, { clip_id: c3, kind: "FADE" })).status).toBe(404);
    let r = (await call(a, "PATCH", url, { clip_id: c3, kind: "SPIN" })).body;
    expect(r.transitions).toEqual([{ clip_id: c3, kind: "SPIN", duration_ms: 600 }]);
    r = (await call(a, "PATCH", url, { clip_id: c3, kind: "DISSOLVE", duration_ms: 1000 })).body;
    r = (await call(a, "PATCH", url, { clip_id: c2, kind: "ZOOM", duration_ms: 400 })).body;
    expect(r.transitions).toEqual([{ clip_id: c2, kind: "ZOOM", duration_ms: 400 }, { clip_id: c3, kind: "DISSOLVE", duration_ms: 1000 }]);
    const [[n]] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM timeline_items i JOIN timeline_tracks t ON t.id = i.timeline_track_id WHERE t.track_type = 'TRANSITION' AND i.reel_clip_id IN (?, ?)", [c2, c3]);
    expect(Number(n!.n)).toBe(2);
    // the render takes them, in microseconds
    const job = await call(a, "POST", `/v1/reels/${s.reel.id}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() });
    expect(job.status).toBe(201);
    expect(job.body.config.transitions).toEqual([{ clip_id: c2, kind: "ZOOM", duration_us: 400_000 }, { clip_id: c3, kind: "DISSOLVE", duration_us: 1_000_000 }]);
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [job.body.id]);
    await root.query("UPDATE render_jobs SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [job.body.id]);
    // Duplicate copies them onto the copy's clips
    const copy = (await call(a, "POST", `/v1/reels/${s.reel.id}/duplicate`)).body;
    expect(copy.transitions.map((t: { kind: string }) => t.kind)).toEqual(["ZOOM", "DISSOLVE"]);
    expect(copy.transitions.map((t: { clip_id: string }) => t.clip_id)).toEqual([copy.clips[1].id, copy.clips[2].id]);
    // a clip deleted takes its transition; the clip that becomes first shows none
    r = (await call(a, "DELETE", `/v1/reels/${s.reel.id}/clips/${c2}`)).body;
    expect(r.transitions).toEqual([{ clip_id: c3, kind: "DISSOLVE", duration_ms: 1000 }]);
    r = (await call(a, "DELETE", `/v1/reels/${s.reel.id}/clips/${c1}`)).body;
    expect(r.transitions).toEqual([]);
    // removed
    const s2 = await seedReel(a);
    const k3 = s2.reel.clips[2].id;
    await call(a, "PATCH", `/v1/reels/${s2.reel.id}/transitions`, { clip_id: k3, kind: "FADE" });
    expect((await call(a, "PATCH", `/v1/reels/${s2.reel.id}/transitions`, { clip_id: k3, kind: null })).body.transitions).toEqual([]);
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? AND action LIKE 'reel.transition%' ORDER BY occurred_at", [s2.reel.id]);
    expect(audit.map((x) => x.action)).toEqual(["reel.transition_set", "reel.transition_removed"]);
  });
});

describe("templates", () => {
  it("keep a reel's look for the organization; apply it, leaving out a logo whose rights lapsed; update and delete; others kept out", async () => {
    const s = await seedReel(a), t = await seedReel(a);
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const logo = (await call(a, "POST", "/v1/brand-assets", { kind: "COMPETITION_LOGO", name: "League", rights_holder: "The League", rights_basis: "LICENSED", confirm_rights: true, data_base64: png })).body;
    await call(a, "PATCH", `/v1/reels/${s.reel.id}`, { version: s.reel.version, aspect: "9:16", settings: { dim: 0.7, ring_color: "#F1A824", score_bug: true, competition_logo_id: logo.id } });
    expect((await call(viewer, "POST", "/v1/reel-templates", { name: "Club look", reel_id: s.reel.id })).status).toBe(403);
    expect((await call(b, "POST", "/v1/reel-templates", { name: "Club look", reel_id: s.reel.id })).status).toBe(404);
    const made = await call(a, "POST", "/v1/reel-templates", { name: "Club look", reel_id: s.reel.id });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: "Club look", aspect: "9:16", settings: { dim: 0.7, ring_color: "#F1A824", score_bug: true, competition_logo_id: logo.id } });
    expect((await call(a, "POST", "/v1/reel-templates", { name: "club LOOK", reel_id: s.reel.id })).body.code).toBe("NAME_TAKEN");
    expect((await call(viewer, "GET", "/v1/reel-templates")).body.map((x: { id: string }) => x.id)).toContain(made.body.id);
    expect((await call(b, "GET", "/v1/reel-templates")).body).toEqual([]);
    expect((await call(b, "POST", `/v1/reels/${t.reel.id}/apply-template`, { template_id: made.body.id, version: t.reel.version })).status).toBe(404);
    // applied to another reel: its look, not its clips
    let res = (await call(a, "POST", `/v1/reels/${t.reel.id}/apply-template`, { template_id: made.body.id, version: t.reel.version })).body;
    expect(res.left_out).toEqual([]);
    expect(res.reel).toMatchObject({ aspect: "9:16", settings: { dim: 0.7, score_bug: true, competition_logo_id: logo.id } });
    expect(res.reel.clips).toHaveLength(3);
    expect((await call(a, "POST", `/v1/reels/${t.reel.id}/apply-template`, { template_id: made.body.id, version: t.reel.version })).body.code).toBe("STALE_VERSION");
    // the logo's rights lapse: applying leaves it out and names it
    await root.query("UPDATE rights_grants g JOIN brand_assets b ON b.rights_grant_id = g.id SET g.valid_until = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 HOUR), g.valid_from = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 2 HOUR) WHERE b.id = ?", [logo.id]);
    const u = await seedReel(a);
    res = (await call(a, "POST", `/v1/reels/${u.reel.id}/apply-template`, { template_id: made.body.id, version: u.reel.version })).body;
    expect(res.left_out).toHaveLength(1);
    expect(res.reel.settings).toMatchObject({ dim: 0.7, competition_logo_id: null });
    // updated from another reel's look; deleted
    const p45 = await call(a, "PATCH", `/v1/reels/${u.reel.id}`, { version: res.reel.version, aspect: "4:5" });   // ADR-080: the 4:5 frame is stored
    expect(p45.status).toBe(200);
    expect(p45.body.aspect).toBe("4:5");
    await call(a, "PATCH", `/v1/reels/${u.reel.id}`, { version: p45.body.version, aspect: "1:1" });
    const upd = await call(a, "PUT", `/v1/reel-templates/${made.body.id}`, { reel_id: u.reel.id });
    expect(upd.status).toBe(200);
    expect(upd.body.aspect).toBe("1:1");
    expect((await call(viewer, "DELETE", `/v1/reel-templates/${made.body.id}`)).status).toBe(403);
    expect((await call(b, "DELETE", `/v1/reel-templates/${made.body.id}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/reel-templates/${made.body.id}`)).status).toBe(204);
    expect((await call(a, "GET", "/v1/reel-templates")).body).toEqual([]);
    expect((await call(a, "POST", `/v1/reels/${u.reel.id}/apply-template`, { template_id: made.body.id, version: u.reel.version })).status).toBe(404);
  });
});
