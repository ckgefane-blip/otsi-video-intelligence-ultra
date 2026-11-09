/**
 * B.15 (ADR-091, migration 0056): reviewing suggested moments through the real API and MySQL: measured coverage per moment; "Not this
 * one" lists it last, keeps it out of Add all, and Restore brings it back; Swap gives a selected clip a moment's window in place and is
 * one undoable change; a viewer cannot reject; another organization cannot see the reel.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, viewer: Member, b: Member;
async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

/** a confirmed player seen continuously 2–6 s and 30–34 s (a position every 0.2 s) */
async function seedReel(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 34000000, 'ENDED', 42)`, [track, run, video, shot]);
  const times = [...Array.from({ length: 21 }, (_, i) => 2_000_000 + i * 200_000), ...Array.from({ length: 21 }, (_, i) => 30_000_000 + i * 200_000)];
  for (const t of times) {
    await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, t / 40_000, t]);
    await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, t / 40_000, track, t]);
  }
  const player = (await call(m, "POST", "/v1/players", { display_name: "Review Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  return (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body.id as string;
}
type M = { in_pts_us: number; out_pts_us: number; rejected: boolean; in_reel: boolean; coverage: number | null; label: string };

beforeAll(async () => { app = await startApi(); root = await rootDb(); a = await seedMember(root, "OWNER"); viewer = await seedMember(root, "VIEWER", a.orgId); b = await seedMember(root, "OWNER"); });
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Moment review (B.15)", () => {
  it("coverage, Not this one / Restore, Swap in place with undo; roles and organizations", async () => {
    const reel = await seedReel(a);
    const ms = (await call(a, "GET", `/v1/reels/${reel}/moments`)).body as M[];
    expect(ms.length).toBe(2);
    const [m1, m2] = [...ms].sort((x, y) => x.in_pts_us - y.in_pts_us) as [M, M];
    expect(m1.in_pts_us).toBe(1_000_000);
    expect(m1.coverage).toBeCloseTo(4.04 / 6, 2);                       // seen 1.98–6.02 s of 1–7 s
    expect(m1.rejected).toBe(false);

    // Not this one: listed last, not added by Add all; a viewer cannot; another organization cannot see it
    expect((await call(viewer, "POST", `/v1/reels/${reel}/moments/reject`, { in_pts_us: m1.in_pts_us, out_pts_us: m1.out_pts_us })).status).toBe(403);
    expect((await call(b, "POST", `/v1/reels/${reel}/moments/reject`, { in_pts_us: m1.in_pts_us, out_pts_us: m1.out_pts_us })).status).toBe(404);
    const after = (await call(a, "POST", `/v1/reels/${reel}/moments/reject`, { in_pts_us: m1.in_pts_us, out_pts_us: m1.out_pts_us })).body as M[];
    expect(after.map((x) => [x.in_pts_us, x.rejected])).toEqual([[m2.in_pts_us, false], [m1.in_pts_us, true]]);
    const filled = (await call(a, "POST", `/v1/reels/${reel}/clips/add-moments`)).body;
    expect(filled.clips.map((c: { in_pts_us: number }) => c.in_pts_us)).toEqual([m2.in_pts_us]);
    const back = (await call(a, "POST", `/v1/reels/${reel}/moments/restore`, { in_pts_us: m1.in_pts_us, out_pts_us: m1.out_pts_us })).body as M[];
    expect(back.every((x) => !x.rejected)).toBe(true);

    // Swap: the clip keeps its id and place, takes the moment's window and label; one change, undone by Undo
    const clip = filled.clips[0] as { id: string; sequence_index: number };
    const swapped = (await call(a, "POST", `/v1/reels/${reel}/clips/${clip.id}/swap`, { in_pts_us: m1.in_pts_us, out_pts_us: m1.out_pts_us, label: m1.label })).body;
    expect(swapped.clips).toHaveLength(1);
    expect(swapped.clips[0]).toMatchObject({ id: clip.id, in_pts_us: m1.in_pts_us, out_pts_us: m1.out_pts_us, sequence_index: clip.sequence_index });
    const undone = (await call(a, "POST", `/v1/reels/${reel}/history/undo`, {})).body;
    expect(undone.clips[0]).toMatchObject({ id: clip.id, in_pts_us: m2.in_pts_us, out_pts_us: m2.out_pts_us });
    expect((await call(viewer, "POST", `/v1/reels/${reel}/clips/${clip.id}/swap`, { in_pts_us: 0, out_pts_us: 1_000_000 })).status).toBe(403);
  });
});
