/**
 * Library folders, delete and Trash through the real API and MySQL (ADR-052, migration 0039; apps/api/src/modules/library): a folder
 * only groups items; a delete removes only the chosen item (ADR-074: a reel with its rendered files, a match without its videos, a video
 * or project still in use is refused) and goes to the Trash as one entry; Restore brings it back and waits for what it needs; other organizations and roles are kept out; the old per-type delete routes are gone.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

/** a finished render of a confirmed player's reel, recorded the way the worker records it */
async function seedRender(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Shared Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body;
  await call(m, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED" });
  const render = (await call(m, "POST", `/v1/reels/${reel.id}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
  const out = uuidv7(), man = uuidv7(), keyOut = `org/${m.orgId}/reels/${reel.id}/render.mp4`;
  await mkdir(path.join(dir, "org", m.orgId, "reels", reel.id), { recursive: true });
  await writeFile(path.join(dir, ...keyOut.split("/")), Buffer.alloc(4000, 7));
  await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 4000, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
    [out, m.orgId, keyOut, man, m.orgId, `${keyOut}.json`]);
  await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [render]);
  await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, render]);
  return { video, render, reel: reel.id as string, player };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-library-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("Library folders only group items (ADR-052)", () => {
  it("make, rename, file, move and take out; deleting a folder keeps its items; roles and organizations kept apart", async () => {
    const s = await seedRender(a);
    expect((await call(viewer, "POST", "/v1/library/folders", { name: "No" })).status).toBe(403);
    const f1 = (await call(a, "POST", "/v1/library/folders", { name: "Scouting" })).body;
    const f2 = (await call(a, "POST", "/v1/library/folders", { name: "Clients" })).body;
    expect(f1.item_count).toBe(0);
    expect((await call(a, "PATCH", `/v1/library/folders/${f1.id}`, { version: 99, name: "x" })).body.code).toBe("STALE_VERSION");
    expect((await call(a, "PATCH", `/v1/library/folders/${f1.id}`, { version: f1.version, name: "Scouting 2026" })).body.name).toBe("Scouting 2026");
    expect((await call(b, "GET", "/v1/library/folders")).body.map((x: { id: string }) => x.id)).not.toContain(f1.id);
    // file the video and the reel; another organization cannot see or use them
    expect((await call(a, "PUT", `/v1/library/folder-items/video/${s.video}`, { folder_id: f1.id })).status).toBe(200);
    expect((await call(a, "PUT", `/v1/library/folder-items/reel/${s.reel}`, { folder_id: f1.id })).status).toBe(200);
    expect((await call(b, "PUT", `/v1/library/folder-items/video/${s.video}`, { folder_id: f1.id })).status).toBe(404);
    const theirs = (await call(b, "POST", "/v1/library/folders", { name: "Theirs" })).body.id as string;
    expect((await call(a, "PUT", `/v1/library/folder-items/video/${s.video}`, { folder_id: theirs })).status).toBe(404);
    expect((await call(a, "PUT", `/v1/library/folder-items/thing/${s.video}`, { folder_id: f1.id })).body.code).toBe("BAD_KIND");
    let filed = (await call(a, "GET", "/v1/library/folder-items")).body as { item_kind: string; item_id: string; folder_id: string }[];
    expect(filed.filter((x) => x.folder_id === f1.id).map((x) => x.item_kind).sort()).toEqual(["reel", "video"]);
    expect((await call(a, "GET", "/v1/library/folders")).body.find((x: { id: string }) => x.id === f1.id).item_count).toBe(2);
    // an item is in one folder at a time: moving it is one row
    await call(a, "PUT", `/v1/library/folder-items/reel/${s.reel}`, { folder_id: f2.id });
    filed = (await call(a, "GET", "/v1/library/folder-items")).body;
    expect(filed.find((x) => x.item_id === s.reel)!.folder_id).toBe(f2.id);
    await call(a, "PUT", `/v1/library/folder-items/reel/${s.reel}`, { folder_id: null });
    expect(((await call(a, "GET", "/v1/library/folder-items")).body as { item_id: string }[]).map((x) => x.item_id)).not.toContain(s.reel);
    // deleting the folder deletes nothing in it
    const pre = (await call(a, "GET", `/v1/library/folder/${f1.id}/removal`)).body;
    expect(pre.kept_items).toBe(1);
    expect(pre.videos).toEqual([]);
    expect((await call(a, "DELETE", `/v1/library/folder/${f1.id}`)).status).toBe(200);
    expect((await call(a, "GET", `/v1/videos/${s.video}`)).status).toBe(200);
    expect((await call(a, "GET", "/v1/library/folders")).body.map((x: { id: string }) => x.id)).not.toContain(f1.id);
    expect(((await call(a, "GET", "/v1/library/folder-items")).body as { item_id: string }[]).map((x) => x.item_id)).not.toContain(s.video);
    // the folder is in the Trash, and restoring it brings its filing back
    const t = ((await call(a, "GET", "/v1/library/trash")).body as { id: string; item_id: string; kind: string }[]).find((x) => x.item_id === f1.id)!;
    expect(t.kind).toBe("folder");
    expect((await call(a, "POST", `/v1/library/trash/${t.id}/restore`)).status).toBe(200);
    expect(((await call(a, "GET", "/v1/library/folder-items")).body as { item_id: string; folder_id: string }[]).find((x) => x.item_id === s.video)!.folder_id).toBe(f1.id);
  });
});

describe("Library delete removes only what was chosen and goes to the Trash; Restore brings it back (ADR-052, ADR-074)", () => {
  it("a match goes alone: its video, reel and rendered file stay, the video only leaves the match; Restore links it again", async () => {
    const s = await seedRender(a);
    const club = async (name: string) => (await call(a, "POST", "/v1/clubs", { name })).body.id as string;
    const match = (await call(a, "POST", "/v1/matches", { home_club_id: await club(`Home ${uuidv7()}`), away_club_id: await club(`Away ${uuidv7()}`) })).body.id as string;
    await root.query("UPDATE video_sources SET match_id = ? WHERE id = ?", [match, s.video]);
    expect((await call(a, "GET", `/v1/library/thing/${match}/removal`)).body.code).toBe("BAD_KIND");
    expect((await call(viewer, "GET", `/v1/library/match/${match}/removal`)).status).toBe(403);
    expect((await call(b, "GET", `/v1/library/match/${match}/removal`)).status).toBe(404);
    const pre = (await call(a, "GET", `/v1/library/match/${match}/removal`)).body;
    expect(pre.videos).toEqual([]);
    expect(pre.reels).toEqual([]);
    expect(pre.renders).toBe(0);
    expect(pre.share_links).toBe(0);
    expect(pre.unlinked.map((v: { id: string }) => v.id)).toEqual([s.video]);
    expect(pre.in_use).toEqual([]);
    expect(pre.blocked).toBeNull();
    // a render of a reel on its video does not block the match: nothing of the reel goes
    const running = (await call(a, "POST", `/v1/reels/${s.reel}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
    expect((await call(a, "GET", `/v1/library/match/${match}/removal`)).body.blocked).toBeNull();
    await call(a, "POST", `/v1/renders/${running}/cancel`);
    expect((await call(viewer, "DELETE", `/v1/library/match/${match}`)).status).toBe(403);
    expect((await call(b, "DELETE", `/v1/library/match/${match}`)).status).toBe(404);
    const del = await call(a, "DELETE", `/v1/library/match/${match}`);
    expect(del.status).toBe(200);
    expect((await call(a, "GET", `/v1/matches/${match}`)).status).toBe(404);
    expect((await call(a, "GET", `/v1/videos/${s.video}`)).status).toBe(200);
    expect((await root.query<RowDataPacket[]>("SELECT match_id FROM video_sources WHERE id = ?", [s.video]))[0][0]!.match_id).toBeNull();
    expect((await call(a, "GET", `/v1/reels/${s.reel}`)).body.last_good_render.id).toBe(s.render);
    expect((await call(a, "GET", `/v1/renders/${s.render}/playback`)).status).toBe(200);
    const entry = ((await call(a, "GET", "/v1/library/trash")).body as { id: string; with: { videos: number; reels: number; renders: number }; blocked: string | null }[])
      .find((x) => x.id === del.body.trash_id)!;
    expect(entry.with).toEqual({ videos: 0, reels: 0, renders: 0 });
    expect(entry.blocked).toBeNull();
    expect(((await call(b, "GET", "/v1/library/trash")).body as { id: string }[]).map((x) => x.id)).not.toContain(entry.id);
    expect((await call(b, "POST", `/v1/library/trash/${entry.id}/restore`)).status).toBe(404);
    expect((await call(viewer, "POST", `/v1/library/trash/${entry.id}/restore`)).status).toBe(403);
    expect((await call(a, "POST", `/v1/library/trash/${entry.id}/restore`)).body).toEqual({ restored: 1, not_restorable: 0 });
    expect((await call(a, "GET", `/v1/matches/${match}`)).status).toBe(200);
    expect((await root.query<RowDataPacket[]>("SELECT match_id FROM video_sources WHERE id = ?", [s.video]))[0][0]!.match_id).toBe(match);
    expect((await call(a, "POST", `/v1/library/trash/${entry.id}/restore`)).status).toBe(404);
    const audit = (await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id", [match]))[0].map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["match.deleted", "match.restored"]));
  });

  it("a video or project still in use is refused with what to delete first; a reel takes its rendered files; restore in order; the old routes are gone", async () => {
    const s = await seedRender(a);
    const out = (await root.query<RowDataPacket[]>("SELECT output_asset_id FROM render_jobs WHERE id = ?", [s.render]))[0][0]!.output_asset_id as string;
    const link = uuidv7();
    await root.query("INSERT INTO share_links (id, organization_id, asset_id, created_by, token_hash, expires_at, can_download) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), 0)", [link, a.orgId, out, a.userId, uuidv7().replace(/-/g, "").padEnd(64, "0")]);
    const project = (await call(a, "GET", `/v1/videos/${s.video}`)).body.project_id as string;
    // the video is used by a reel: refused, and the reel is named
    const vPre = (await call(a, "GET", `/v1/library/video/${s.video}/removal`)).body;
    expect(vPre.in_use.map((x: { id: string; kind: string }) => [x.kind, x.id])).toEqual([["reel", s.reel]]);
    expect(vPre.reels).toEqual([]);
    expect(vPre.blocked).toMatch(/1 reel is made from this video\. Delete it first:/);
    const vDel = await call(a, "DELETE", `/v1/library/video/${s.video}`);
    expect([vDel.status, vDel.body.code]).toEqual([409, "IN_USE"]);
    expect((await call(a, "GET", `/v1/reels/${s.reel}`)).status).toBe(200);
    // the project holds the video and the reel: refused
    const pPre = (await call(a, "GET", `/v1/library/project/${project}/removal`)).body;
    expect(pPre.in_use.map((x: { kind: string }) => x.kind).sort()).toEqual(["reel", "video"]);
    expect(pPre.blocked).toMatch(/This project still holds 1 video and 1 reel\. Delete them first:/);
    expect((await call(a, "DELETE", `/v1/library/project/${project}`)).body.code).toBe("IN_USE");
    expect((await call(a, "GET", `/v1/projects/${project}`)).status).toBe(200);
    // the reel takes its own rendered file; blocked while a render of it runs; its share link stops
    const rPre = (await call(a, "GET", `/v1/library/reel/${s.reel}/removal`)).body;
    expect([rPre.renders, rPre.share_links, rPre.blocked]).toEqual([1, 1, null]);
    const running = (await call(a, "POST", `/v1/reels/${s.reel}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
    expect((await call(a, "GET", `/v1/library/reel/${s.reel}/removal`)).body.blocked).toMatch(/still running/);
    expect((await call(a, "DELETE", `/v1/library/reel/${s.reel}`)).body.code).toBe("REEL_RENDERING");
    await call(a, "POST", `/v1/renders/${running}/cancel`);
    const reelDel = (await call(a, "DELETE", `/v1/library/reel/${s.reel}`)).body.trash_id as string;
    expect((await call(a, "GET", `/v1/reels/${s.reel}`)).status).toBe(404);
    expect((await call(a, "GET", `/v1/renders/${s.render}/playback`)).status).toBe(404);
    expect((await call(a, "GET", `/v1/videos/${s.video}`)).status).toBe(200);
    expect((await root.query<RowDataPacket[]>("SELECT revoked_at FROM share_links WHERE id = ?", [link]))[0][0]!.revoked_at).not.toBeNull();
    // now the video goes, alone; then the empty project
    expect((await call(a, "GET", `/v1/library/video/${s.video}/removal`)).body.blocked).toBeNull();
    expect((await call(a, "DELETE", `/v1/library/video/${s.video}`)).status).toBe(200);
    const pDel = (await call(a, "DELETE", `/v1/library/project/${project}`)).body.trash_id as string;
    expect((await call(a, "GET", `/v1/projects/${project}`)).status).toBe(404);
    // restore waits for what it needs: the video waits for its project, the reel for its video
    const trash = (await call(a, "GET", "/v1/library/trash")).body as { id: string; blocked: string | null }[];
    expect(trash.find((x) => x.id === reelDel)!.blocked).toMatch(/Its video/);
    expect((await call(a, "POST", `/v1/library/trash/${reelDel}/restore`)).body.code).toBe("RESTORE_BLOCKED");
    expect((await call(a, "POST", `/v1/library/video/${s.video}/restore`)).body.code).toBe("RESTORE_BLOCKED");
    expect((await call(a, "POST", `/v1/library/trash/${pDel}/restore`)).body).toEqual({ restored: 1, not_restorable: 0 });
    expect((await call(a, "POST", `/v1/library/video/${s.video}/restore`)).status).toBe(200);          // Upload › Undo
    expect((await call(a, "POST", `/v1/library/trash/${reelDel}/restore`)).body).toEqual({ restored: 2, not_restorable: 0 });
    expect((await call(a, "GET", `/v1/reels/${s.reel}`)).body.last_good_render.id).toBe(s.render);
    expect((await root.query<RowDataPacket[]>("SELECT revoked_at FROM share_links WHERE id = ?", [link]))[0][0]!.revoked_at).not.toBeNull();   // links stay off
    expect((await call(a, "POST", `/v1/library/video/${s.video}/restore`)).status).toBe(404);          // nothing left to undo
    // a rendered file alone; the reel stays
    expect((await call(a, "DELETE", `/v1/library/render/${s.render}`)).status).toBe(200);
    expect((await call(a, "GET", `/v1/reels/${s.reel}`)).body.last_good_render).toBeNull();
    // one implementation: the old per-type delete and restore routes are gone
    for (const u of [`/v1/reels/${s.reel}`, `/v1/renders/${s.render}`, `/v1/projects/${project}`, `/v1/videos/${s.video}`]) {
      expect((await call(a, "DELETE", u)).status).toBe(404);
    }
    expect((await call(a, "POST", `/v1/videos/${s.video}/restore`)).status).toBe(404);
  });
});
