/**
 * Heat zones through the real HTTP stack and MySQL (apps/api/src/modules/analysis/heat.ts): time per pitch zone from measured positions only,
 * per track and per kit group; moments without a calibration count as seen, never as a zone; the ball and other organizations are refused.
 */
import { dlt, HEAT_COLS, heatCell, hullArea, type Mat3, movementOf, project, type Pt } from "@otsi-vie/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { accumulate, shapeOf } from "../src/modules/analysis/heat";
import { Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, b: Member;
const H: Mat3 = dlt([[-52.5, -34], [52.5, -34], [52.5, 34], [-52.5, 34]], [[0.22, 0.18], [0.78, 0.18], [0.98, 0.92], [0.02, 0.92]])!;
const toPicture = (p: Pt) => project(H, p)!;
const box = (p: Pt) => { const f = project(H, p)!; return { x: f[0] - 0.01, y: f[1] - 0.1, w: 0.02, h: 0.1 }; };

async function call(m: Member, url: string, method: "GET" | "POST" = "GET", body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi({});
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("movement", () => {
  it("distance and top speed over measured stretches: jitter smoothed, impossible steps dropped, gaps break a stretch (pure)", () => {
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= 60; i++) pts.push([i * 166_667, 5 * (i / 6) + (i % 2 ? 0.25 : -0.25), 0]);   // 5 m/s for 10 s, feet jitter +-25 cm
    const m = movementOf(pts, 12);
    expect(m.distance_m).toBeGreaterThan(46); expect(m.distance_m).toBeLessThan(54);
    expect(m.top_speed_kmh).toBeGreaterThan(16); expect(m.top_speed_kmh).toBeLessThan(20);                // 18 km/h
    expect(m.measured_s).toBe(10); expect(m.seen_s).toBe(12);
    const jump = movementOf([[0, 0, 0], [500_000, 0, 0], [1_000_000, 0, 0], [1_500_000, 30, 0], [2_000_000, 30, 0], [2_500_000, 30, 0], [3_000_000, 30, 0]], 3);
    expect(jump.dropped_steps).toBeGreaterThan(0);                                                        // 30 m in under a second: a measurement error
    expect(jump.top_speed_kmh ?? 0).toBeLessThanOrEqual(36);
    const gap = movementOf([[0, 0, 0], [500_000, 1, 0], [1_000_000, 2, 0], [5_000_000, 40, 0], [5_500_000, 41, 0], [6_000_000, 42, 0]], 6);
    expect(gap.distance_m).toBeLessThan(5);                                                               // the 38 m across the 4 s gap is never counted
    expect(movementOf([], 4)).toMatchObject({ measured_s: 0, distance_m: null, top_speed_kmh: null });
    // one fast second among slow ones (a position glitch) does not set the top speed: it must be held for two seconds
    const spike: [number, number, number][] = [];
    for (let i = 0; i <= 48; i++) spike.push([i * 166_667, i < 24 ? i * 0.4 : (i < 30 ? 9.6 + (i - 24) * 1.2 : 16.8 + (i - 30) * 0.4), 0]);
    const sp = movementOf(spike, 8);
    expect(sp.top_speed_kmh!).toBeLessThan(15);
  });
});

describe("team shape", () => {
  it("measures width, length and outline area only at moments with 8+ of the team on a measured pitch (pure)", () => {
    expect(hullArea([[0, 0], [10, 0], [10, 5], [0, 5], [5, 2]])).toBe(50);
    // nine players on a 40 m x 30 m block, and a moment with only seven of them
    const block: Pt[] = [[-20, -15], [0, -15], [20, -15], [-20, 0], [0, 0], [20, 0], [-20, 15], [0, 15], [20, 15]];
    const slices = [{ s: 0, e: 10_000_000, H, L: 105, W: 68, q: 0.5 }];
    const moments = [{ pts: 1_000_000, feet: block.map(box).map((b) => ({ pts: 1_000_000, ...b })) },
      { pts: 2_000_000, feet: block.slice(0, 7).map(box).map((b) => ({ pts: 2_000_000, ...b })) },
      { pts: 20_000_000, feet: block.map(box).map((b) => ({ pts: 20_000_000, ...b })) }];          // no calibration at 20 s
    const sh = shapeOf(moments, slices, [0]);
    expect(sh.moments).toBe(1);
    expect(sh.seen_moments).toBe(3);
    expect(sh.width_m!.mean).toBeCloseTo(30, 0);
    expect(sh.length_m!.mean).toBeCloseTo(40, 0);
    expect(sh.compactness_m2!.mean).toBeCloseTo(1200, -1);
    expect(sh.players_per_moment).toBe(9);
    expect(sh.density.reduce((t, v) => t + v, 0)).toBe(9);
    expect(Object.keys(sh.not_measured).sort()).toEqual(["defensive_line_height", "formation", "phases"]);
  });
});

describe("heat zones", () => {
  it("add time only where a calibration measured the position (pure)", () => {
    const obs = [0, 1, 2, 3].map((s) => ({ pts: s * 1e6, ...box([10, 5]) }));
    const slices = [{ s: 500_000, e: 2_500_000, H, L: 105, W: 68, q: 0.5 }];
    const r = accumulate(obs, slices, 1_000_000, 105, 68);
    const cell = heatCell([10, 5])!;
    expect(r.seen).toBe(4);
    expect(r.measured).toBe(2);                                                    // 1 s and 2 s are covered; 0 s and 3 s are not
    expect(r.seconds[cell[1] * HEAT_COLS + cell[0]]).toBe(2);
    expect(r.seconds.reduce((t, v) => t + v, 0)).toBe(2);
  });

  it("per track and per kit group, from the database; the ball and other organizations are refused", async () => {
    const project = uuidv7(), video = uuidv7(), run = uuidv7(), shot = uuidv7(), req = uuidv7();
    await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, a.orgId, a.userId]);
    const source = uuidv7();
    await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, a.orgId, project, `org/${a.orgId}/videos/${video}/source.mp4`]);
    await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, width, height, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, 1280, 720, ?, ?)", [video, a.orgId, project, a.userId, source]);
    await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'SUCCEEDED')", [run, video, a.orgId]);
    await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
    const tracks: [string, number, string, Pt, number | null][] = [[uuidv7(), 1, "PERSON", [-30, 10], 0], [uuidv7(), 2, "PERSON", [20, -15], 0], [uuidv7(), 3, "PERSON", [40, 0], 1], [uuidv7(), 4, "BALL", [0, 0], null]];
    for (let f = 0; f < 12; f++) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, f * 15, f * 500_000]);
    for (const [id, num, cls, at, group] of tracks) {
      await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count, mean_confidence)
                        VALUES (?, ?, ?, ?, ?, ?, 0, 5500000, 'ENDED', 12, 0.8)`, [id, run, video, shot, num, cls]);
      if (group !== null) await root.query("INSERT INTO track_appearance (track_id, run_id, kit_group, crop_count) VALUES (?, ?, ?, 4)", [id, run, group]);
      const bx = box(at);
      for (let f = 0; f < 12; f++) await root.query(`INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.8, 'DETECTED')`,
        [video, f * 15, id, f * 500_000, bx.x, bx.y, bx.w, bx.h]);
    }
    const t1 = tracks[0]![0];
    const before = (await call(a, `/v1/analysis-runs/${run}/tracks/${t1}/heat-zones`)).body;
    expect(before).toMatchObject({ subject: { kind: "TRACK", id: t1 }, seen_s: 6, measured_s: 0, ends_as_filmed: true });            // seen, never placed
    await root.query(`INSERT INTO pitch_calibration_requests (id, organization_id, video_id, mode, anchor_pts_us, points, pitch_length_m, pitch_width_m, status, requested_by) VALUES (?, ?, ?, 'AUTO', 0, '[]', 105, 68, 'SUCCEEDED', ?)`, [req, a.orgId, video, a.userId]);
    await root.query(`INSERT INTO pitch_calibrations (id, video_id, request_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, reprojection_error_px, evidence_state, quality_score)
                      VALUES (?, ?, ?, 0, 3000000, ?, 105, 68, 2, 'INFERRED', 0.7)`, [uuidv7(), video, req, JSON.stringify(H)]);
    const z = (await call(a, `/v1/analysis-runs/${run}/tracks/${t1}/heat-zones`)).body;
    const c = heatCell([-30, 10])!;
    expect(z.measured_s).toBe(3);                                                // 0-3 s of the 6 s seen (one observation per half second)
    expect(z.seconds[c[1] * HEAT_COLS + c[0]]).toBe(3);
    const team = (await call(a, `/v1/analysis-runs/${run}/heat-zones?kit_group=0`)).body;
    expect(team).toMatchObject({ subject: { kind: "KIT_GROUP", id: "0" }, seen_s: 12, measured_s: 6 });      // two people, one sample a second each
    const c2 = heatCell([20, -15])!;
    expect(team.seconds[c[1] * HEAT_COLS + c[0]]).toBe(3);
    expect(team.seconds[c2[1] * HEAT_COLS + c2[0]]).toBe(3);
    expect((await call(a, `/v1/analysis-runs/${run}/heat-zones?kit_group=1`)).body.measured_s).toBe(3);
    expect((await call(a, `/v1/analysis-runs/${run}/tracks/${tracks[3]![0]}/heat-zones`)).body.code).toBe("NOT_A_PERSON");
    expect((await call(a, `/v1/analysis-runs/${run}/heat-zones?kit_group=x`)).body.code).toBe("INVALID_KIT_GROUP");
    expect((await call(b, `/v1/analysis-runs/${run}/tracks/${t1}/heat-zones`)).status).toBe(404);
    expect((await call(b, `/v1/analysis-runs/${run}/heat-zones?kit_group=0`)).status).toBe(404);
    const shape = (await call(a, `/v1/analysis-runs/${run}/team-shape?kit_groups=0,1`)).body;
    expect(shape).toMatchObject({ kit_groups: [0, 1], min_players: 8, moments: 0 });                   // three people: never 8 in a moment
    expect(shape.seen_moments).toBeGreaterThan(0);
    expect((await call(a, `/v1/analysis-runs/${run}/team-shape?kit_groups=`)).body.code).toBe("INVALID_KIT_GROUP");
    expect((await call(b, `/v1/analysis-runs/${run}/team-shape?kit_groups=0`)).status).toBe(404);
    // movement of a standing person: measured 0-3 s, no distance to speak of
    const mv = (await call(a, `/v1/analysis-runs/${run}/tracks/${t1}/movement`)).body;
    expect(mv.measured_s).toBeGreaterThan(2); expect(mv.distance_m).toBeLessThan(1); expect(mv.top_speed_kmh).toBeLessThan(2);
    expect((await call(a, `/v1/analysis-runs/${run}/tracks/${tracks[3]![0]}/movement`)).body.code).toBe("NOT_A_PERSON");
    // a registered player: measures come only from tracks a person CONFIRMED as them
    const pl = (await call(a, "/v1/players", "POST", { display_name: "Measured Player" }, { "idempotency-key": uuidv7() })).body.player_id as string;
    expect((await call(a, `/v1/players/${pl}/measures`)).body).toMatchObject({ tracks: 0, videos: 0, seen_s: 0, distance_m: null, heat: null });
    expect((await call(a, `/v1/tracks/${t1}/identity-decisions`, "POST", { state: "CONFIRMED", player_id: pl })).status).toBeLessThan(300);
    const pm = (await call(a, `/v1/players/${pl}/measures`)).body;
    expect(pm).toMatchObject({ player_id: pl, tracks: 1, videos: 1, seen_s: 6 });
    expect(pm.measured_s).toBeGreaterThan(2); expect(pm.mean_confidence).toBeCloseTo(0.8, 2);
    expect(pm.heat.seconds[c[1] * HEAT_COLS + c[0]]).toBeGreaterThan(2);
    expect(pm.events).toBeNull();                                                // the ball was never followed: events not measured
    // his events on the followed ball: passer, receiver, winner (second track), presser, shooter; another player's events do not count
    const ball = uuidv7(), [t2, t3] = [tracks[1]![0], tracks[2]![0]];
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [ball, a.orgId, video, run]);
    const ev = (kind: string, at: number, p: string | null, q: string | null, f: object = {}) =>
      root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.8, 'DETECTED', ?)`, [uuidv7(), run, video, ball, kind, at * 1e6, (at + 0.5) * 1e6, p, q, JSON.stringify(f)]);
    await ev("PASS", 1, t1, t2, { key: true }); await ev("PASS", 2, t1, t2); await ev("PASS", 3, t2, t1); await ev("PASS", 3.5, t2, t3);
    await ev("POSSESSION_CHANGE", 4, t3, t1); await ev("POSSESSION_CHANGE", 4.5, t1, t3); await ev("PRESSURE", 5, t1, t3); await ev("SHOT", 5.2, t1, null);
    expect((await call(a, `/v1/players/${pl}/measures`)).body.events).toEqual({ passes: 2, key_passes: 1, passes_received: 1, balls_won: 1, pressures: 1, shots: 1, videos: 1 });
    expect((await call(b, `/v1/players/${pl}/measures`)).status).toBe(404);
    // Page 08 Event Timeline / Action Map: the same events, listed, in time order
    const list = (await call(a, `/v1/players/${pl}/events`)).body;
    expect(list).toMatchObject({ player_id: pl, half: null, videos: 1, length_m: 105, width_m: 68 });
    expect(list.items.map((e: { kind: string }) => e.kind)).toEqual(["PASS", "PASS", "PASS_RECEIVED", "BALL_WON", "PRESSURE", "SHOT"]);
    expect(list.items[0]).toMatchObject({ key: true, from_m: null, to_m: null, partner_player_id: null, evidence: "DETECTED", video_id: video });
    expect((await call(b, `/v1/players/${pl}/events`)).status).toBe(404);
    expect((await call(a, `/v1/players/${pl}/events?half=x`)).body.code).toBe("BAD_HALF");
    // a pass whose ends (normalised picture points of the ball) fall inside the calibration (0-3 s) is placed on the pitch, in metres
    const placed = uuidv7();
    await root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                      VALUES (?, ?, ?, ?, 'PASS', 1500000, 2000000, ?, ?, 0, 0.8, 'INFERRED', ?)`, [placed, run, video, ball, t1, t2, JSON.stringify({ from: toPicture([-30, 10]), to: toPicture([-10, 5]), length_m: 20.6 })]);
    const withEnds = (await call(a, `/v1/players/${pl}/events`)).body.items.find((e: { id: string }) => e.id === placed);
    expect(withEnds).toMatchObject({ kind: "PASS", evidence: "INFERRED", length_m: 20.6, from_m: [-30, 10], to_m: [-10, 5] });
    await root.query("DELETE FROM event_candidates WHERE id = ?", [placed]);
    // Page 08 "1st Half" / "2nd Half": with no halves known, a half counts nothing; then the engine proposes 0-2.5 s and 3-6 s
    expect((await call(a, `/v1/players/${pl}/measures?half=1`)).body).toMatchObject({ half: 1, seen_s: 0, heat: null, halves: { confirmed: 0, proposed: 0, unknown: 1 } });
    await root.query("INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us) VALUES (?, ?, ?, 'PROPOSED', 0, 2500000, 3000000, 6000000)",
      [video, a.orgId, run]);
    const h1 = (await call(a, `/v1/players/${pl}/measures?half=1`)).body;
    expect(h1).toMatchObject({ half: 1, seen_s: 2.5, halves: { confirmed: 0, proposed: 1, unknown: 0 } });
    expect(h1.heat.measured_s).toBe(2.5);
    expect(h1.events).toEqual({ passes: 2, key_passes: 1, passes_received: 0, balls_won: 0, pressures: 0, shots: 0, videos: 1 });
    const h2 = (await call(a, `/v1/players/${pl}/measures?half=2`)).body;
    expect(h2).toMatchObject({ half: 2, seen_s: 3 });
    expect(h2.events).toEqual({ passes: 0, key_passes: 0, passes_received: 1, balls_won: 1, pressures: 1, shots: 1, videos: 1 });
    expect((await call(a, `/v1/players/${pl}/measures`)).body).toMatchObject({ half: null, seen_s: 5.5 });     // whole match: both halves, not the break
    expect((await call(a, `/v1/players/${pl}/measures?half=3`)).body.code).toBe("BAD_HALF");
  });
});
