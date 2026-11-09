/**
 * Same-person links and track appearance (ADR-031) through the real API and MySQL: suggestions are evidence, decisions are human and
 * append-only, a correction needs a reason, groups follow only CONFIRMED links, and nothing crosses organizations.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: mysql.Connection;
let a: Member, viewer: Member, b: Member;
let dir: string;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body && r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

/** three tracks of one run: 1 (0-1 s), 2 (3-4 s), 3 (6-7 s); links 1->2 and 2->3, a thumbnail for track 2 */
async function seedRun(m: Member) {
  const s = await seedTracks(db, m, 3);
  for (const [i, t] of s.trackIds.entries()) {
    await db.query("UPDATE tracks SET class_name = 'PERSON', first_pts_us = ?, last_pts_us = ? WHERE id = ?", [i * 3_000_000, i * 3_000_000 + 1_000_000, t]);
  }
  const [proj] = await db.query<mysql.RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [s.videoId]);
  const thumbKey = `org/${m.orgId}/runs/${s.runId}/thumbs/2.jpg`;
  await mkdir(path.join(dir, ...thumbKey.split("/").slice(0, -1)), { recursive: true });
  await writeFile(path.join(dir, ...thumbKey.split("/")), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]));
  const thumb = uuidv7();
  await db.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256, mime_type) VALUES (?, ?, ?, 'THUMBNAIL', ?, 'local', 9, ?, 'image/jpeg')",
    [thumb, m.orgId, proj[0]!.project_id, thumbKey, "0".repeat(64)]);
  for (const [i, t] of s.trackIds.entries()) {
    await db.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count, drift_score, thumbnail_asset_id) VALUES (?, ?, ?, ?, 4, ?, ?)",
      [t, s.runId, i === 2 ? null : 0, "#FFFFFF", i === 0 ? 0.4 : 0.95, i === 1 ? thumb : null]);
  }
  const links = [uuidv7(), uuidv7()];
  await db.query("INSERT INTO track_links (id, run_id, track_a_id, track_b_id, score, method, crosses_cut, gap_us) VALUES (?, ?, ?, ?, 0.81, 'APPEARANCE', true, 2000000), (?, ?, ?, ?, 0.66, 'APPEARANCE', false, 2000000)",
    [links[0], s.runId, s.trackIds[0], s.trackIds[1], links[1], s.runId, s.trackIds[1], s.trackIds[2]]);
  return { ...s, links };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(process.env.TEMP ?? os.tmpdir(), "otsi-links-"));
  app = await startApi({ storageDir: dir });
  db = await rootDb();
  a = await seedMember(db, "ANALYST");
  viewer = await seedMember(db, "VIEWER", a.orgId);
  b = await seedMember(db, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe("same-person links", () => {
  it("list suggestions in both directions with the other track's identity, and carry appearance on the track list", async () => {
    const s = await seedRun(a);
    const mid = await call(a, "GET", `/v1/tracks/${s.trackIds[1]}/links`);
    expect(mid.status).toBe(200);
    expect(mid.body.map((l: { direction: string }) => l.direction).sort()).toEqual(["after", "before"]);
    const before = mid.body.find((l: { direction: string }) => l.direction === "before");
    expect(before).toMatchObject({ score: 0.81, crosses_cut: true, state: "PROPOSED", decision_id: null, other: { track_number: 1, confirmed_player: null, label: "Unidentified person · track 1" } });
    const list = await call(a, "GET", `/v1/analysis-runs/${s.runId}/tracks`);
    const t1 = list.body.find((t: { track_number: number }) => t.track_number === 1);
    expect(t1).toMatchObject({ kit_group: 0, kit_rgb: "#FFFFFF", possible_identity_switch: true, links_proposed: 1, links_confirmed: 0, has_thumbnail: false });
    expect(list.body.find((t: { track_number: number }) => t.track_number === 3).kit_group).toBeNull();
  });

  it("are decided by a person, append-only: a correction supersedes the current decision and needs a reason", async () => {
    const s = await seedRun(a);
    const first = await call(a, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "CONFIRMED" });
    expect(first.status).toBe(201);
    const confirmed = first.body.find((l: { link_id: string }) => l.link_id === s.links[0]);
    expect(confirmed.state).toBe("CONFIRMED");
    expect((await call(a, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "REJECTED" })).body.code).toBe("STALE_DECISION");
    expect((await call(a, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "REJECTED", supersedes_id: confirmed.decision_id })).body.code).toBe("CORRECTION_REASON_REQUIRED");
    const fixed = await call(a, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "REJECTED", supersedes_id: confirmed.decision_id, reason: "different shirt number" });
    expect(fixed.body.find((l: { link_id: string }) => l.link_id === s.links[0]).state).toBe("REJECTED");
    const [hist] = await db.query<mysql.RowDataPacket[]>("SELECT state FROM track_link_decisions WHERE link_id = ? ORDER BY decided_at", [s.links[0]]);
    expect(hist.map((h) => h.state)).toEqual(["CONFIRMED", "REJECTED"]);                    // history kept
    await expect(db.query("UPDATE track_link_decisions SET state = 'CONFIRMED' WHERE link_id = ?", [s.links[0]])).rejects.toThrow(/APPEND_ONLY/);
    const [aud] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND action = 'track.link_decided'", [s.links[0]]);
    expect(aud[0]!.n).toBe(2);
  });

  it("group tracks only through CONFIRMED links, and report every player confirmed in the group", async () => {
    const s = await seedRun(a);
    expect((await call(a, "GET", `/v1/tracks/${s.trackIds[0]}/person-group`)).body.track_ids).toEqual([s.trackIds[0]]);
    await call(a, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "CONFIRMED" });
    await call(a, "POST", `/v1/track-links/${s.links[1]}/decisions`, { state: "CONFIRMED" });
    const g = await call(a, "GET", `/v1/tracks/${s.trackIds[2]}/person-group`);
    expect(g.body.track_ids).toEqual(s.trackIds);                                            // in time order, across the cut
    // two different players confirmed inside one group: the API reports both, so the UI can show the conflict instead of hiding it
    const mk = async (name: string) => JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: name } })).body).player_id as string;
    const p1 = await mk("Linked Player One"), p2 = await mk("Linked Player Two");
    await call(a, "POST", `/v1/tracks/${s.trackIds[0]}/identity-decisions`, { state: "CONFIRMED", player_id: p1 });
    expect((await call(a, "GET", `/v1/tracks/${s.trackIds[1]}/person-group`)).body.confirmed_player_ids).toEqual([p1]);
    await call(a, "POST", `/v1/tracks/${s.trackIds[2]}/identity-decisions`, { state: "CONFIRMED", player_id: p2 });
    expect((await call(a, "GET", `/v1/tracks/${s.trackIds[1]}/person-group`)).body.confirmed_player_ids.sort()).toEqual([p1, p2].sort());
    const suggested = (await call(a, "GET", `/v1/tracks/${s.trackIds[1]}/links`)).body.find((l: { direction: string }) => l.direction === "before");
    expect(suggested.other.confirmed_player).toMatchObject({ player_id: p1, display_name: "Linked Player One", canonical_otsi_id: null });
  });

  it("serve the track thumbnail, and keep links, groups and thumbnails inside the organization; viewers cannot decide", async () => {
    const s = await seedRun(a);
    const img = await app.inject({ method: "GET", url: `/v1/tracks/${s.trackIds[1]}/thumbnail`, headers: a.headers });
    expect(img.statusCode).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect((await call(a, "GET", `/v1/tracks/${s.trackIds[0]}/thumbnail`)).status).toBe(404);
    for (const url of [`/v1/tracks/${s.trackIds[1]}/links`, `/v1/tracks/${s.trackIds[1]}/person-group`, `/v1/tracks/${s.trackIds[1]}/thumbnail`]) {
      expect((await call(b, "GET", url)).status).toBe(404);
    }
    expect((await call(b, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "CONFIRMED" })).status).toBe(404);
    expect((await call(viewer, "POST", `/v1/track-links/${s.links[0]}/decisions`, { state: "CONFIRMED" })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect(key()).toMatch(/^k-/);
  });
});

describe("look-alikes anywhere in the match", () => {
  it("gather from all his confirmed tracks, widen with each confirmation, and leave out the impossible, the rejected and the decided", async () => {
    // six tracks: 0 (0-1 s) him; 1 (0.5-1.5 s) on screen with him; 2, 3, 4, 5 later; look-alike graph 0->1, 0->2, 0->4, 2->3 (one way)
    const s = await seedTracks(db, a, 6);
    const times = [[0, 1], [0.5, 1.5], [10, 11], [20, 21], [30, 31], [40, 41]];
    for (const [i, t] of s.trackIds.entries()) {
      await db.query("UPDATE tracks SET class_name = 'PERSON', first_pts_us = ?, last_pts_us = ? WHERE id = ?", [times[i]![0]! * 1e6, times[i]![1]! * 1e6, t]);
    }
    const T = s.trackIds;
    await db.query("INSERT INTO track_neighbours (track_id, neighbour_id, cosine, kit_similarity, rank_no) VALUES (?, ?, 0.95, 1, 1), (?, ?, 0.9, 1, 2), (?, ?, 0.7, 1, 3), (?, ?, 0.88, 1, 1)",
      [T[0], T[1], T[0], T[2], T[0], T[4], T[2], T[3]]);
    const url = (i: number) => `/v1/tracks/${T[i]}/look-alikes`;
    // nobody named yet: the track's own look-alikes, minus the one on screen at the same time
    let r = (await call(a, "GET", url(0))).body;
    expect(r).toMatchObject({ player: null, seeds: 1 });
    expect(r.items.map((x: { other: { track_number: number } }) => x.other.track_number)).toEqual([3, 5]);
    const p = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: "Look Alike" } })).body).player_id as string;
    await call(a, "POST", `/v1/tracks/${T[0]}/identity-decisions`, { state: "CONFIRMED", player_id: p });
    await call(a, "POST", `/v1/tracks/${T[2]}/identity-decisions`, { state: "CONFIRMED", player_id: p });
    // two confirmed tracks: the search starts from both (track 4 comes from track 3's graph), the confirmed ones are not offered again
    r = (await call(a, "GET", url(0))).body;
    expect(r).toMatchObject({ player: { player_id: p, display_name: "Look Alike" }, seeds: 2 });
    expect(r.items.map((x: { other: { track_number: number }; similarity: number }) => [x.other.track_number, x.similarity])).toEqual([[4, 0.88], [5, 0.7]]);
    // "not him" on track 5: gone from his list
    await call(a, "POST", `/v1/tracks/${T[4]}/identity-decisions`, { state: "REJECTED", player_id: p });
    expect((await call(a, "GET", url(2))).body.items.map((x: { other: { track_number: number } }) => x.other.track_number)).toEqual([4]);
    expect((await call(viewer, "GET", url(0))).status).toBe(200);
    expect((await call(b, "GET", url(0))).status).toBe(404);
  });

  it("rank by look weighted by shirt colour, leave out his kit's other colour groups, and page them (ADR-045)", async () => {
    // 30 tracks, 1 s each, 10 s apart; track 1 is him (kit 0). Look-alikes: 2 (very alike, other shirt shade), 3 (alike, same shade),
    // 4 (the most alike, but kit group 1: the other team), 5..30 (alike)
    const s = await seedTracks(db, a, 30);
    const T = s.trackIds;
    for (const [i, t] of T.entries()) {
      await db.query("UPDATE tracks SET class_name = 'PERSON', first_pts_us = ?, last_pts_us = ? WHERE id = ?", [i * 10e6, i * 10e6 + 1e6, t]);
      await db.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count) VALUES (?, ?, ?, '#202020', 4)", [t, s.runId, i === 3 ? 1 : i === 4 ? null : 0]);
    }
    const rows: unknown[] = [];
    const add = (i: number, cos: number, kit: number) => rows.push(T[0], T[i], cos, kit, Math.min(i, 20));
    add(1, 0.95, 0.5); add(2, 0.9, 1); add(3, 0.99, 1);
    for (let i = 4; i < 30; i++) add(i, i === 4 ? 0.65 : 0.6, 1);
    await db.query(`INSERT INTO track_neighbours (track_id, neighbour_id, cosine, kit_similarity, rank_no) VALUES ${T.slice(1).map(() => "(?, ?, ?, ?, ?)").join(", ")}`, rows);
    const p = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: "Kit Ranked" } })).body).player_id as string;
    await call(a, "POST", `/v1/tracks/${T[0]}/identity-decisions`, { state: "CONFIRMED", player_id: p });
    const r = (await call(a, "GET", `/v1/tracks/${T[0]}/look-alikes`)).body;
    const nums = r.items.map((x: { other: { track_number: number } }) => x.other.track_number);
    expect(nums.slice(0, 2)).toEqual([3, 2]);                                   // the same shade first, although the other looks more alike
    expect(r.items[0]).toMatchObject({ similarity: 0.9, kit_similarity: 1, score: 0.9 });
    expect(r.items[1]).toMatchObject({ similarity: 0.95, kit_similarity: 0.5 });
    expect(r.items[1].score).toBeCloseTo(0.7125, 2);
    expect(nums).not.toContain(4);                                              // the other colour group: not him
    expect(nums).toContain(5);                                                  // no colour group (not read clearly): still offered
    expect(r.items).toHaveLength(24);
    expect(r.more).toBe(4);                                                     // 28 possible, 24 shown
  });
});
