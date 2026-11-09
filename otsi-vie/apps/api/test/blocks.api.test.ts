/**
 * B.21 (ADR-096, migration 0057), through the real API and MySQL:
 * - one transition on every cut, as one change (a short clip gets what it can take, a clip after a gap none, undo restores);
 * - compound clips: save consecutive clips as a block, put them into another reel of the same video before a position as one undoable
 *   change, refuse a non-consecutive run;
 * - a viewer cannot save; another organization cannot see, use or delete the block.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, viewer: Member, b: Member;
async function call(m: Member, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

/** a video with a confirmed player; two reels of it */
async function seed(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 1000000, 50000000, 'ENDED', 1)`, [track, run, video, shot]);
  await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, 25, 1000000)", [video]);
  await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, 25, ?, 1000000, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, track]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Block Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const r1 = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body.id as string;
  const r2 = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body.id as string;
  return { r1, r2 };
}
type Clip = { id: string; in_pts_us: number; out_pts_us: number; sequence_index: number };
const order = (reel: { clips: Clip[] }) => [...reel.clips].sort((x, y) => x.sequence_index - y.sequence_index);

beforeAll(async () => { app = await startApi(); root = await rootDb(); a = await seedMember(root, "OWNER"); viewer = await seedMember(root, "VIEWER", a.orgId); b = await seedMember(root, "OWNER"); });
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Clip Studio transitions on every cut and blocks (B.21)", () => {
  it("one kind on every cut as one change", async () => {
    const { r1 } = await seed(a);
    for (const [i, o] of [[2e6, 6e6], [10e6, 14e6], [20e6, 20.6e6], [30e6, 34e6]] as const) await call(a, "POST", `/v1/reels/${r1}/clips`, { in_pts_us: i, out_pts_us: o });
    let reel = (await call(a, "GET", `/v1/reels/${r1}`)).body;
    const cl = order(reel);
    await call(a, "PATCH", `/v1/reels/${r1}/clips/${cl[3]!.id}/fx`, { zoom: [], drawings: [], gap_ms: 1000 });   // clip 4 starts from black
    reel = (await call(a, "POST", `/v1/reels/${r1}/transitions/all`, { kind: "DISSOLVE", duration_ms: 600 })).body;
    const t = Object.fromEntries(reel.transitions.map((x: { clip_id: string; duration_ms: number; kind: string }) => [x.clip_id, [x.kind, x.duration_ms]]));
    expect(t).toEqual({ [cl[1]!.id]: ["DISSOLVE", 600], [cl[2]!.id]: ["DISSOLVE", 300] });              // 0.6 s clip: half of it; none after the gap
    expect((await call(viewer, "POST", `/v1/reels/${r1}/transitions/all`, { kind: "FADE" })).status).toBe(403);
    expect((await call(a, "POST", `/v1/reels/${r1}/transitions/all`, { kind: null })).body.transitions).toEqual([]);
    expect((await call(a, "POST", `/v1/reels/${r1}/history/undo`, {})).body.transitions).toHaveLength(2);
  });

  it("save consecutive clips as a block and put it into another reel of the same video", async () => {
    const { r1, r2 } = await seed(a);
    for (const [i, o] of [[2e6, 6e6], [10e6, 14e6], [20e6, 24e6]] as const) await call(a, "POST", `/v1/reels/${r1}/clips`, { in_pts_us: i, out_pts_us: o });
    const cl = order((await call(a, "GET", `/v1/reels/${r1}`)).body);
    await call(a, "PATCH", `/v1/reels/${r1}/clips/${cl[1]!.id}/effect`, { kind: "SLOW", at_us: null, speed: 0.5, hold_ms: 0 });
    expect((await call(a, "POST", `/v1/reels/${r1}/blocks`, { name: "Gap", clip_ids: [cl[0]!.id, cl[2]!.id] })).body.code).toBe("CLIPS_NOT_CONSECUTIVE");
    expect((await call(viewer, "POST", `/v1/reels/${r1}/blocks`, { name: "X", clip_ids: [cl[0]!.id] })).status).toBe(403);
    const blk = (await call(a, "POST", `/v1/reels/${r1}/blocks`, { name: "Intro run", clip_ids: [cl[1]!.id, cl[2]!.id] })).body;
    expect(blk).toMatchObject({ name: "Intro run", length_us: 8_000_000, clips: [{ in_pts_us: 10e6 }, { in_pts_us: 20e6 }] });
    expect((await call(a, "GET", `/v1/reels/${r2}/blocks`)).body.map((x: { id: string }) => x.id)).toEqual([blk.id]);
    expect((await call(viewer, "GET", `/v1/reels/${r2}/blocks`)).status).toBe(200);
    expect((await call(b, "GET", `/v1/reels/${r2}/blocks`)).status).toBe(404);

    // into reel 2, which has one clip: before it; copies with their speed effect; one change, undone by Undo
    await call(a, "POST", `/v1/reels/${r2}/clips`, { in_pts_us: 40e6, out_pts_us: 44e6 });
    const put = (await call(a, "POST", `/v1/reels/${r2}/blocks/${blk.id}/insert`, { at: 0 })).body;
    const got = order(put);
    expect(got.map((c: Clip) => c.in_pts_us)).toEqual([10e6, 20e6, 40e6]);
    expect((got[0] as unknown as { effect: { kind: string; speed: number } }).effect).toMatchObject({ kind: "SLOW", speed: 0.5 });
    expect(got.map((c: Clip) => c.id)).not.toContain(cl[1]!.id);
    expect(order((await call(a, "POST", `/v1/reels/${r2}/history/undo`, {})).body).map((c: Clip) => c.in_pts_us)).toEqual([40e6]);
    expect((await call(a, "POST", `/v1/reels/${r2}/blocks/${blk.id}/insert`, {})).body.clips).toHaveLength(3);        // at the end

    // another organization can neither use nor delete it; deleting it leaves the reels' clips
    expect((await call(b, "POST", `/v1/reels/${r2}/blocks/${blk.id}/insert`, {})).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/reels/${r2}/blocks/${blk.id}`)).status).toBe(204);
    expect((await call(a, "GET", `/v1/reels/${r2}/blocks`)).body).toEqual([]);
    expect((await call(a, "GET", `/v1/reels/${r2}`)).body.clips).toHaveLength(3);
  });

  it("a block of another video cannot be put into this reel", async () => {
    const one = await seed(a), two = await seed(a);
    await call(a, "POST", `/v1/reels/${one.r1}/clips`, { in_pts_us: 2e6, out_pts_us: 6e6 });
    const c = order((await call(a, "GET", `/v1/reels/${one.r1}`)).body)[0]!;
    const blk = (await call(a, "POST", `/v1/reels/${one.r1}/blocks`, { name: "Other", clip_ids: [c.id] })).body;
    expect((await call(a, "GET", `/v1/reels/${two.r1}/blocks`)).body).toEqual([]);
    expect((await call(a, "POST", `/v1/reels/${two.r1}/blocks/${blk.id}/insert`, {})).body.code).toBe("BLOCK_OTHER_VIDEO");
  });
});
