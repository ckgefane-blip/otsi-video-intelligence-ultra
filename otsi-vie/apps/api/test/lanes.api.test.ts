/**
 * B.3 (ADR-082, migration 0053): the Analysis timeline's engine lanes and video markers through the real API and MySQL: shots of the latest
 * finished run, ball found (detected positions joined under 1 s apart), pitch measured; markers added by writers, removed by their author or an
 * owner/admin, read by viewers; another organization sees nothing.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { joinSpans } from "@otsi-vie/contracts";
import { Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, analyst: Member, viewer: Member, other: Member;

async function call(m: Member, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  analyst = await seedMember(root, "ANALYST", owner.orgId);
  viewer = await seedMember(root, "VIEWER", owner.orgId);
  other = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("joinSpans", () => {
  it("joins neighbours under the gap and widens a lone point", () => {
    expect(joinSpans([0, 500_000, 1_000_000, 5_000_000], 1_000_000, 500_000)).toEqual([{ start_us: 0, end_us: 1_000_000 }, { start_us: 4_750_000, end_us: 5_250_000 }]);
    expect(joinSpans([], 1, 1)).toEqual([]);
  });
});

describe("engine lanes and markers (B.3)", () => {
  it("draws only what was recorded: shots, ball found, pitch measured; markers by role", async () => {
    const s = await seedTracks(root, owner);
    const url = `/v1/videos/${s.videoId}`;
    await root.query("UPDATE video_sources SET duration_us = 60000000 WHERE id = ?", [s.videoId]);
    // nothing finished yet
    let l = (await call(owner, "GET", `${url}/lanes`)).body;
    expect(l).toMatchObject({ run_id: null, shots: [], ball: null, calibrated: [], markers: [], duration_us: 60_000_000 });
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [s.runId]);
    await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 20000000), (?, ?, ?, 2, 20000000, 60000000)",
      [uuidv7(), s.videoId, s.runId, uuidv7(), s.videoId, s.runId]);
    const bt = uuidv7();
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, metrics) VALUES (?, ?, ?, ?, 'SUCCEEDED', ?)", [bt, owner.orgId, s.videoId, s.runId, JSON.stringify({ step_us: 500000 })]);
    for (const [t, st] of [[1_000_000, "DETECTED"], [1_500_000, "DETECTED"], [2_000_000, "INFERRED"], [9_000_000, "DETECTED"]] as const)
      await root.query("INSERT INTO ball_positions (ball_track_id, pts_us, state, x, y, confidence) VALUES (?, ?, ?, 0.5, 0.5, 0.9)", [bt, t, st]);
    await root.query("INSERT INTO pitch_calibrations (id, video_id, start_pts_us, end_pts_us, transform_matrix, quality_score) VALUES (?, ?, 0, 10000000, '[[1,0,0],[0,1,0],[0,0,1]]', 0.8)", [uuidv7(), s.videoId]);
    l = (await call(viewer, "GET", `${url}/lanes`)).body;
    expect(l.run_id).toBe(s.runId);
    expect(l.shots.map((k: { shot_number: number }) => k.shot_number)).toEqual([1, 2]);
    expect(l.ball).toEqual([{ start_us: 1_000_000, end_us: 1_500_000 }, { start_us: 8_750_000, end_us: 9_250_000 }]);   // inferred positions are not "found"
    expect(l.calibrated).toEqual([{ start_us: 0, end_us: 10_000_000, quality: expect.closeTo(0.8, 5) }]);
    // markers
    expect((await call(viewer, "POST", `${url}/markers`, { at_pts_us: 1_000_000, body: "x" })).status).toBe(403);
    expect((await call(analyst, "POST", `${url}/markers`, { at_pts_us: 70_000_000, body: "late" })).body.code).toBe("MARKER_OUTSIDE_VIDEO");
    expect((await call(analyst, "POST", `${url}/markers`, { at_pts_us: 5_000_000, body: "  " })).status).toBe(422);
    let ms = (await call(analyst, "POST", `${url}/markers`, { at_pts_us: 5_000_000, body: "Good press here" })).body;
    ms = (await call(owner, "POST", `${url}/markers`, { at_pts_us: 2_000_000, body: "Kick-off" })).body;
    expect(ms.map((m: { body: string }) => m.body)).toEqual(["Kick-off", "Good press here"]);
    const mine = ms.find((m: { body: string }) => m.body === "Good press here");
    const owners = ms.find((m: { body: string }) => m.body === "Kick-off");
    expect(owners.mine).toBe(true);
    expect((await call(analyst, "DELETE", `${url}/markers/${owners.id}`)).body.code).toBe("NOT_YOUR_MARKER");
    expect((await call(owner, "DELETE", `${url}/markers/${mine.id}`)).status).toBe(200);
    expect((await call(viewer, "GET", `${url}/lanes`)).body.markers.map((m: { body: string }) => m.body)).toEqual(["Kick-off"]);
    // another organization
    expect((await call(other, "GET", `${url}/lanes`)).status).toBe(404);
    expect((await call(other, "POST", `${url}/markers`, { at_pts_us: 1, body: "x" })).status).toBe(404);
  });
});

describe("joinCalibrations", () => {
  it("draws per-frame calibrations as one stretch with a duration-weighted quality", async () => {
    const { joinCalibrations } = await import("../src/modules/analysis/lanes.js");
    expect(joinCalibrations([{ start_us: 0, end_us: 100, quality: 1 }, { start_us: 101, end_us: 400, quality: 0.5 }, { start_us: 2_000_000, end_us: 2_100_000, quality: null }]))
      .toEqual([{ start_us: 0, end_us: 400, quality: expect.closeTo((100 + 0.5 * 299) / 399, 6) }, { start_us: 2_000_000, end_us: 2_100_000, quality: null }]);
  });
  it("keeps span ends whole numbers for an odd step", () => {
    for (const s of joinSpans([1_000_000], 1_000_000, 166_667)) { expect(Number.isInteger(s.start_us)).toBe(true); expect(Number.isInteger(s.end_us)).toBe(true); }
  });
});
