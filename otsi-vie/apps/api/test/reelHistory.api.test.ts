/**
 * B.1 (ADR-081, migration 0052): a reel's edit history through the real API and MySQL. Every content change is one EDIT with the state before
 * and after; Undo and Redo are compensating changes that put a recorded state back (the same clip ids, order, effects, drawings, transitions,
 * frame and look); a new edit after an undo drops Redo; "back to before this edit" undoes several; an unrecorded change blocks undo (409);
 * viewers and other organizations are kept out.
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
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-history-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

type Clip = { id: string; in_pts_us: number; out_pts_us: number; effect: { kind: string } };
const shape = (r: { name: string; aspect: string; clips: Clip[]; transitions: unknown[]; settings: unknown }) =>
  ({ name: r.name, aspect: r.aspect, settings: r.settings, transitions: r.transitions, clips: r.clips.map((c) => [c.id, c.in_pts_us, c.out_pts_us, c.effect.kind]) });

describe("reel edit history (B.1)", () => {
  it("records each change; undo and redo put the recorded state back with the same clips; a new edit drops redo", async () => {
    const s = await seedReel(a);
    const id = s.reel.id as string, url = `/v1/reels/${id}`;
    let h = (await call(a, "GET", `${url}/history`)).body;
    expect(h.entries.map((e: { label: string }) => e.label)).toEqual(["Added a clip", "Added a clip", "Added a clip"]);
    expect(h).toMatchObject({ can_undo: true, can_redo: false, undo_label: "Added a clip" });
    const start = (await call(a, "GET", url)).body;
    const [c1, c2, c3] = start.clips.map((c: Clip) => c.id);
    // five different changes
    await call(a, "PATCH", `${url}/clips/${c1}`, { in_pts_us: 2_000_000, out_pts_us: 7_000_000 });
    await call(a, "PATCH", `${url}/clips/${c3}/effect`, { kind: "SLOW", speed: 0.5 });
    await call(a, "PATCH", `${url}/transitions`, { clip_id: c3, kind: "FADE", duration_ms: 500 });
    await call(a, "POST", `${url}/clips/order`, { clip_ids: [c3, c1, c2] });
    let r = (await call(a, "PATCH", url, { version: (await call(a, "GET", url)).body.version, aspect: "4:5" })).body;
    const end = shape(r);
    h = (await call(a, "GET", `${url}/history`)).body;
    expect(h.entries.slice(0, 5).map((e: { label: string }) => e.label)).toEqual(["Frame 4:5", "Reordered the clips", "Transition into clip 3: fade", "Speed effect: slow motion", "Trimmed a clip"]);
    expect(h.entries[0].actor.user_id).toBe(a.userId);
    // nothing changed: nothing recorded
    await call(a, "POST", `${url}/clips/order`, { clip_ids: [c3, c1, c2] });
    expect((await call(a, "GET", `${url}/history`)).body.entries).toHaveLength(8);
    // back to before the trim: five undos at once, the same three clips as at the start
    r = (await call(a, "POST", `${url}/history/undo`, { to_edit_id: h.entries[4].id })).body;
    expect(shape(r)).toEqual(shape(start));
    h = (await call(a, "GET", `${url}/history`)).body;
    expect(h.entries.slice(0, 5).map((e: { kind: string }) => e.kind)).toEqual(["UNDO", "UNDO", "UNDO", "UNDO", "UNDO"]);
    expect(h).toMatchObject({ can_undo: true, can_redo: true, redo_label: "Trimmed a clip" });
    // redo all five: the end state again
    for (let i = 0; i < 5; i++) r = (await call(a, "POST", `${url}/history/redo`)).body;
    expect(shape(r)).toEqual(end);
    expect((await call(a, "POST", `${url}/history/redo`)).body.code).toBe("NOTHING_TO_REDO");
    // undo one, then a new edit: redo is gone
    r = (await call(a, "POST", `${url}/history/undo`, {})).body;
    expect(r.aspect).toBe("16:9");
    await call(a, "DELETE", `${url}/clips/${c2}`);
    h = (await call(a, "GET", `${url}/history`)).body;
    expect(h).toMatchObject({ can_redo: false, undo_label: "Removed a clip" });
    expect(h.entries.find((e: { label: string }) => e.label === "Frame 4:5").state).toBe("DROPPED");
    // undo of a removal brings the same clip back, in its place
    r = (await call(a, "POST", `${url}/history/undo`, {})).body;
    expect(r.clips.map((c: Clip) => c.id)).toEqual([c3, c1, c2]);
    // nothing is deleted from the log
    const [[n]] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM reel_edits WHERE reel_id = ?", [id]);
    expect(Number(n!.n)).toBe(h.entries.length + 1);
  });

  it("refuses an undo when the reel was changed outside the history; keeps viewers and other organizations out", async () => {
    const s = await seedReel(a);
    const id = s.reel.id as string, url = `/v1/reels/${id}`;
    expect((await call(viewer, "POST", `${url}/history/undo`, {})).status).toBe(403);
    expect((await call(viewer, "GET", `${url}/history`)).status).toBe(200);
    expect((await call(b, "GET", `${url}/history`)).status).toBe(404);
    expect((await call(b, "POST", `${url}/history/undo`, {})).status).toBe(404);
    await root.query("UPDATE reel_clips SET out_pts_us = out_pts_us - 100000 WHERE reel_id = ? AND sequence_index = 2", [id]);
    const res = await call(a, "POST", `${url}/history/undo`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REEL_CHANGED");
    const empty = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect((await call(a, "POST", `/v1/reels/${empty.id}/history/undo`, {})).body.code).toBe("NOTHING_TO_UNDO");
    expect((await call(a, "GET", `/v1/reels/${empty.id}/history`)).body).toMatchObject({ entries: [], can_undo: false, can_redo: false });
  });
});
