/** GET /v1/overview/stats (Page 01 KPI cards): counts only recorded rows of the caller's organization; nothing estimated. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

const EMPTY_WEEKS = { matches_analyzed: [0, 0, 0, 0, 0], players_tracked: [0, 0, 0, 0, 0], reels_generated: [0, 0, 0, 0, 0], reports_created: [0, 0, 0, 0, 0] };

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member;
let b: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("overview stats", () => {
  it("are zero for a new organization", async () => {
    const r = await call(a, "GET", "/v1/overview/stats");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ matches_analyzed: 0, players_tracked: 0, reels_generated: 0, reports_created: 0, weekly: EMPTY_WEEKS });
  });

  it("count a match only once its analysis finished, and a player only once CONFIRMED; other organizations see none of it", async () => {
    const { runId, trackIds: [track] } = await seedTracks(root, a);
    expect((await call(a, "GET", "/v1/overview/stats")).body.matches_analyzed).toBe(0);           // run still queued
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = UTC_TIMESTAMP(6) - INTERVAL 8 DAY WHERE id = ?", [runId]);
    expect((await call(a, "GET", "/v1/overview/stats")).body.matches_analyzed).toBe(1);
    expect((await call(a, "GET", "/v1/overview/stats")).body.weekly.matches_analyzed).toEqual([0, 0, 0, 1, 0]);   // first analysed 8 days ago

    const player = await call(a, "POST", "/v1/players", { display_name: "Overview Player" }, { "idempotency-key": key() });
    const cand = await call(a, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CANDIDATE", player_id: player.body.player_id });
    expect((await call(a, "GET", "/v1/overview/stats")).body.players_tracked).toBe(0);            // a candidate is not confirmed
    const conf = await call(a, "POST", `/v1/tracks/${track}/identity-decisions`,
      { state: "CONFIRMED", player_id: player.body.player_id, supersedes_id: cand.body.decision_id, reason: "jersey" });
    expect(conf.status).toBe(201);
    expect((await call(a, "GET", "/v1/overview/stats")).body.players_tracked).toBe(1);
    expect((await call(a, "GET", "/v1/overview/stats")).body.weekly.players_tracked).toEqual([0, 0, 0, 0, 1]);    // confirmed just now

    expect((await call(b, "GET", "/v1/overview/stats")).body).toEqual({ matches_analyzed: 0, players_tracked: 0, reels_generated: 0, reports_created: 0, weekly: EMPTY_WEEKS });
  });

  it("leave out a video in Trash: its match, players and the hero picture stop counting (v3 Phase 0)", async () => {
    const m = await seedMember(root, "OWNER");
    const { runId, videoId, trackIds: [track] } = await seedTracks(root, m);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = UTC_TIMESTAMP(6) WHERE id = ?", [runId]);
    const player = await call(m, "POST", "/v1/players", { display_name: "Trash Player" }, { "idempotency-key": key() });
    expect((await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player.body.player_id, reason: "jersey" })).status).toBe(201);
    expect((await call(m, "GET", "/v1/overview/stats")).body).toMatchObject({ matches_analyzed: 1, players_tracked: 1 });
    expect((await call(m, "GET", "/v1/overview/recent-matches")).body).toHaveLength(1);
    await root.query("UPDATE video_sources SET removed_at = UTC_TIMESTAMP(6), removed_by = ? WHERE id = ?", [m.userId, videoId]);
    expect((await call(m, "GET", "/v1/overview/stats")).body).toEqual({ matches_analyzed: 0, players_tracked: 0, reels_generated: 0, reports_created: 0, weekly: EMPTY_WEEKS });
    expect((await call(m, "GET", "/v1/overview/recent-matches")).body).toEqual([]);
  });

  it("refuse an unauthenticated caller", async () => {
    for (const url of ["/v1/overview/stats", "/v1/overview/recent-matches"]) expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
  });
});

describe("recent matches", () => {
  it("list only analysed videos of the caller's organization, newest analysis first, at most four, with the linked match", async () => {
    const m = await seedMember(root, "OWNER");
    expect((await call(m, "GET", "/v1/overview/recent-matches")).body).toEqual([]);
    const vids: string[] = [];
    for (let i = 0; i < 6; i++) {
      const { runId, videoId } = await seedTracks(root, m);
      vids.push(videoId);
      if (i === 5) continue;                                            // the last one is never analysed
      await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = ? WHERE id = ?", [new Date(Date.UTC(2026, 0, 1 + i)), runId]);
    }
    await root.query("UPDATE video_sources SET title = 'Final' WHERE id = ?", [vids[4]]);
    const list = (await call(m, "GET", "/v1/overview/recent-matches")).body as { video_id: string; video_title: string | null; match: unknown; analysed_at: string }[];
    expect(list.map((r) => r.video_id)).toEqual([vids[4], vids[3], vids[2], vids[1]]);
    expect(list[0]).toMatchObject({ video_title: "Final", match: null, analysed_at: "2026-01-05T00:00:00.000Z" });
    expect((await call(b, "GET", "/v1/overview/recent-matches")).body.some((r: { video_id: string }) => vids.includes(r.video_id))).toBe(false);
  });
});

describe("system resources", () => {
  it("show the latest worker reading, and 'not connected' once no worker reported for 20 seconds", async () => {
    await root.query("DELETE FROM worker_status");
    expect((await call(a, "GET", "/v1/system/resources")).body).toMatchObject({ connected: false, workers: 0, cpu_percent: null });
    await root.query(`INSERT INTO worker_status (worker_id, host, kinds, cpu_percent, cpu_count, memory_used_bytes, memory_total_bytes, gpu_name, busy, started_at, reported_at)
      VALUES ('w-test-1', 'host-a', '["ANALYZE"]', 37.5, 16, 8000000000, 32000000000, 'Intel(R) Arc(TM) Graphics', TRUE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6)),
             ('w-test-old', 'host-a', '["ANALYZE"]', 99, 16, 1, 2, NULL, FALSE, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) - INTERVAL 1 MINUTE)`);
    const r = await call(b, "GET", "/v1/system/resources");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ connected: true, workers: 1, busy_workers: 1, cpu_percent: 37.5, cpu_count: 16, memory_used_bytes: 8000000000,
      memory_total_bytes: 32000000000, gpu_name: "Intel(R) Arc(TM) Graphics", gpu_percent: null });
    await root.query("DELETE FROM worker_status WHERE worker_id LIKE 'w-test-%'");
    expect((await app.inject({ method: "GET", url: "/v1/system/resources" })).statusCode).toBe(401);
  });
});

describe("latest confirmed player", () => {
  it("is null until a person confirms one, then the newest confirmation of the caller's organization only", async () => {
    const m = await seedMember(root, "OWNER");
    expect((await call(m, "GET", "/v1/overview/latest-player")).body).toBeNull();
    const { trackIds: [t1, t2], videoId } = await seedTracks(root, m, 2);
    const p1 = await call(m, "POST", "/v1/players", { display_name: "First Confirmed" }, { "idempotency-key": key() });
    const p2 = await call(m, "POST", "/v1/players", { display_name: "Second Confirmed" }, { "idempotency-key": key() });
    const cand = await call(m, "POST", `/v1/tracks/${t1}/identity-decisions`, { state: "CANDIDATE", player_id: p1.body.player_id });
    expect((await call(m, "GET", "/v1/overview/latest-player")).body).toBeNull();                      // a candidate is not confirmed
    await call(m, "POST", `/v1/tracks/${t1}/identity-decisions`, { state: "CONFIRMED", player_id: p1.body.player_id, supersedes_id: cand.body.decision_id, reason: "jersey" });
    const c2 = await call(m, "POST", `/v1/tracks/${t2}/identity-decisions`, { state: "CANDIDATE", player_id: p2.body.player_id });
    await call(m, "POST", `/v1/tracks/${t2}/identity-decisions`, { state: "CONFIRMED", player_id: p2.body.player_id, supersedes_id: c2.body.decision_id, reason: "face" });
    expect((await call(m, "GET", "/v1/overview/latest-player")).body).toMatchObject({ player_id: p2.body.player_id, display_name: "Second Confirmed", video_id: videoId });
    expect((await call(b, "GET", "/v1/overview/latest-player")).body).toBeNull();
    // the hero picture: a confirmed person at one of his biggest detections, with the other people in that frame; never another org's
    expect((await call(m, "GET", "/v1/overview/hero-moment")).body).toBeNull();                       // no detections yet
    await root.query("UPDATE tracks SET class_name = 'PERSON' WHERE id IN (?, ?)", [t1, t2]);
    for (const f of [0, 1]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [videoId, f, f * 500_000]);
    const obs = (t: string | undefined, f: number, h: number) => root.query(`INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state)
      VALUES (?, ?, ?, ?, 0.4, 0.3, 0.05, ?, 0.8, 'DETECTED')`, [videoId, f, t, f * 500_000, h]);
    await obs(t1, 0, 0.2); await obs(t1, 1, 0.4); await obs(t2, 0, 0.1); await obs(t2, 1, 0.3);
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const h = (await call(m, "GET", "/v1/overview/hero-moment")).body;
      expect(h.video_id).toBe(videoId);
      expect([p1.body.player_id, p2.body.player_id]).toContain(h.player_id);
      expect(h.boxes).toHaveLength(2);                                                    // him and the other person in that frame
      expect(h.boxes.filter((x: { me: boolean }) => x.me)).toHaveLength(1);
      expect(h.boxes.every((x: { number: number | null }) => x.number === null)).toBe(true);   // no match sheet: no shirt numbers
      seen.add(h.player_id);
    }
    expect(seen.size).toBe(2);                                                            // random: both confirmed players come up
    expect((await call(b, "GET", "/v1/overview/hero-moment")).body).toBeNull();
  });
});
