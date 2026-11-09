/**
 * Pitch calibration through the real HTTP stack and MySQL (apps/api/src/modules/analysis/pitch.ts): the person's clicks are checked before any work is
 * queued, an accepted request becomes one CALIBRATE_PITCH job, measured samples turn into pitch positions in the observations window and moments without
 * a sample stay "not measured", other organizations see nothing. The fitting itself (lines, camera following) is tested in services/worker/tests/test_geometry.py;
 * the TypeScript and Python maths are checked against the same numbers (fixtures/pitch_parity.json).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dlt, fitFromPoints, pitchLandmarks, pitchLines, project, type Mat3, type Pt, unproject } from "@otsi-vie/contracts";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { pitchJobStarter } from "../src/core/outbox/subscribers";
import { appDb, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member, b: Member, viewer: Member;

async function call(m: Member, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedVideo(m: Member, state = "INGESTED"): Promise<string> {
  const project = uuidv7(), video = uuidv7(), source = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, width, height, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', ?, 600000000, 1280, 720, ?, ?)", [video, m.orgId, project, state, m.userId, source]);
  return video;
}

/** a wide-angle camera on the stand side, high up: the whole pitch is in the picture, so every landmark has a place a person could click */
const TRUE_H: Mat3 = dlt([[-52.5, -34], [52.5, -34], [52.5, 34], [-52.5, 34]], [[0.22, 0.18], [0.78, 0.18], [0.98, 0.92], [0.02, 0.92]])!;
const NAMES = ["centre spot", "left penalty area, top front corner", "left penalty area, bottom front corner", "right penalty area, top front corner", "right penalty area, bottom front corner", "halfway line, bottom touchline"];
const clicks = (names: string[], H: Mat3 = TRUE_H) => names.map((n) => { const p = project(H, pitchLandmarks()[n]!)!; return { landmark: n, x: p[0], y: p[1] }; });

beforeAll(async () => {
  app = await startApi({});
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  b = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
});
afterAll(async () => { await app?.close(); await db?.onModuleDestroy(); await root?.end(); });

describe("the TypeScript pitch maths", () => {
  it("has the same landmarks, line sampling and fit as the worker's Python (fixtures/pitch_parity.json)", () => {
    const fx = JSON.parse(readFileSync(resolve(__dirname, "../../../fixtures/pitch_parity.json"), "utf8"));
    for (const [dims, expected] of Object.entries(fx.landmarks as Record<string, Record<string, Pt>>)) {
      const [L, W] = dims.split("x").map(Number) as [number, number];
      const got = pitchLandmarks(L, W);
      expect(Object.keys(got).sort()).toEqual(Object.keys(expected).sort());
      for (const [k, v] of Object.entries(expected)) { expect(got[k]![0]).toBeCloseTo(v[0], 5); expect(got[k]![1]).toBeCloseTo(v[1], 5); }
      const lines = pitchLines(L, W, 1.0), want = fx.lines[dims] as Record<string, { n: number; first: Pt; last: Pt }>;
      expect(Object.keys(lines).sort()).toEqual(Object.keys(want).sort());
      for (const [k, w] of Object.entries(want)) {
        expect(lines[k]!.length, k).toBe(w.n);
        expect(lines[k]![0]![0]).toBeCloseTo(w.first[0], 4); expect(lines[k]![0]![1]).toBeCloseTo(w.first[1], 4);
        expect(lines[k]!.at(-1)![0]).toBeCloseTo(w.last[0], 4); expect(lines[k]!.at(-1)![1]).toBeCloseTo(w.last[1], 4);
      }
    }
    const f = fx.fit, lm = pitchLandmarks();
    const fit = fitFromPoints(f.names.map((n: string) => lm[n]), f.image, 1280, 720);
    expect(fit.mirrored).toBe(f.mirrored); expect(fit.collinear).toBe(f.collinear);
    expect(fit.rmsPx).toBeCloseTo(f.rms_px, 2); expect(fit.rmsM).toBeCloseTo(f.rms_m, 2);
    f.H.forEach((row: number[], i: number) => row.forEach((v, j) => expect(fit.H![i]![j]!).toBeCloseTo(v, 5)));
    f.probe.forEach((p: Pt, i: number) => { const q = project(fit.H!, p)!; expect(q[0]).toBeCloseTo(f.probe_image[i][0], 5); expect(q[1]).toBeCloseTo(f.probe_image[i][1], 5); const back = unproject(fit.H!, q)!; expect(back[0]).toBeCloseTo(p[0], 3); });
  });
});

describe("asking for a pitch calibration", () => {
  it("refuses clicks that cannot fix a pitch, with a plain reason, before any work is queued", async () => {
    const v = await seedVideo(a);
    const url = `/v1/videos/${v}/pitch-calibrations`;
    const ok = clicks(NAMES);
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: ok.slice(0, 1) })).status).toBe(422);                                 // one place fixes nothing
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: [ok[0], { ...ok[1]!, x: ok[0]!.x + 0.002, y: ok[0]!.y }] })).body.code).toBe("POINTS_TOO_CLOSE");
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: [...ok.slice(0, 3), { landmark: "the moon", x: 0.5, y: 0.5 }] })).body.code).toBe("UNKNOWN_LANDMARK");
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: [...ok.slice(0, 3), ok[0]] })).body.code).toBe("DUPLICATE_LANDMARK");
    const goalLine = clicks(["left goal line, top corner", "left penalty area, top corner on the goal line", "left six-yard box, top corner on the goal line",
      "left six-yard box, bottom corner on the goal line", "left penalty area, bottom corner on the goal line", "left goal line, bottom corner"]);
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: goalLine })).body.code).toBe("POINTS_ON_ONE_LINE");                 // six on one line cannot stand alone
    const flipped = NAMES.map((n) => { const [x, y] = pitchLandmarks()[n]!; const p = project(TRUE_H, [x, -y])!; return { landmark: n, x: p[0], y: p[1] }; });
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: flipped })).body.code).toBe("POINTS_MIRRORED");
    const swapped = ok.map((p, i) => ({ ...p, landmark: NAMES[(i + 1) % NAMES.length]! }));                                                      // right places, wrong names
    expect((await call(a, "POST", url, { anchor_pts_us: 1_000_000, points: swapped })).body.code).toMatch(/POINTS_INCONSISTENT|POINTS_MIRRORED/);
    expect((await call(a, "POST", url, { anchor_pts_us: 999_999_999_999, points: ok })).body.code).toBe("ANCHOR_OUTSIDE_VIDEO");
    expect((await call(a, "POST", `/v1/videos/${await seedVideo(a, "PENDING")}/pitch-calibrations`, { anchor_pts_us: 1, points: ok })).body.code).toBe("VIDEO_NOT_READY");
    const [n] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM pitch_calibration_requests WHERE video_id = ?", [v]);
    expect(n[0]!.n).toBe(0);
  });

  it("queues one CALIBRATE_PITCH job for good clicks, allows one at a time, lists it, and keeps other organizations and viewers out", async () => {
    const v = await seedVideo(a);
    const url = `/v1/videos/${v}/pitch-calibrations`;
    const q = await call(a, "POST", url, { anchor_pts_us: 5_000_000, points: clicks(NAMES) });
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ status: "QUEUED", anchor_pts_us: 5_000_000, point_count: 6, pitch_length_m: 105, pitch_width_m: 68, coverage: { samples: 0, first_pts_us: null, last_pts_us: null } });
    expect((await call(a, "POST", url, { anchor_pts_us: 6_000_000, points: clicks(NAMES) })).body.code).toBe("CALIBRATION_ALREADY_RUNNING");
    const d = new OutboxDispatcher(db, [pitchJobStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, state, subject_type FROM worker_jobs WHERE subject_id = ?", [q.body.id]);
    expect(jobs).toEqual([{ kind: "CALIBRATE_PITCH", state: "QUEUED", subject_type: "pitch_calibration" }]);
    expect((await call(a, "GET", url)).body.map((r: { id: string }) => r.id)).toEqual([q.body.id]);
    expect((await call(b, "GET", url)).status).toBe(404);                                                                                        // another organization: the video does not exist
    expect((await call(b, "POST", url, { anchor_pts_us: 1, points: clicks(NAMES) })).status).toBe(404);
    expect((await call(viewer, "POST", url, { anchor_pts_us: 1, points: clicks(NAMES) })).status).toBe(403);                                      // a viewer may look, not start
    expect((await call(viewer, "GET", url)).status).toBe(200);
    // while it runs it cannot be removed; once finished it can, with its samples
    await root.query("UPDATE pitch_calibration_requests SET status = 'RUNNING' WHERE id = ?", [q.body.id]);
    expect((await call(a, "DELETE", `/v1/pitch-calibrations/${q.body.id}`)).body.code).toBe("CALIBRATION_RUNNING");
    await root.query("UPDATE pitch_calibration_requests SET status = 'FAILED', failure_code = 'LINES_DO_NOT_MATCH', failure_detail = 'x' WHERE id = ?", [q.body.id]);
    expect((await call(a, "GET", url)).body[0]).toMatchObject({ status: "FAILED", failure_code: "LINES_DO_NOT_MATCH" });
    expect((await call(b, "DELETE", `/v1/pitch-calibrations/${q.body.id}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/pitch-calibrations/${q.body.id}`)).status).toBe(204);
    expect((await call(a, "GET", url)).body).toEqual([]);
  });

  it("takes a moment of only 2-3 places for the match camera, keeps one pitch size per video, and shows the camera until a moment it used is removed", async () => {
    const v = await seedVideo(a);
    const url = `/v1/videos/${v}/pitch-calibrations`;
    expect((await call(a, "GET", `/v1/videos/${v}/pitch-camera`)).body).toEqual({ camera: null });
    const q = await call(a, "POST", url, { anchor_pts_us: 7_000_000, points: clicks(NAMES.slice(0, 2)) });                                         // two places: queued, the worker joins it
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ status: "QUEUED", point_count: 2, landmarks: NAMES.slice(0, 2) });
    await root.query("UPDATE pitch_calibration_requests SET status = 'WAITING', metrics = ? WHERE id = ?", [JSON.stringify({ waiting: "Mark about 2 more places" }), q.body.id]);
    expect((await call(a, "GET", url)).body[0]).toMatchObject({ status: "WAITING", metrics: { waiting: "Mark about 2 more places" } });
    // a waiting moment does not block the next one, but the next one must use the same pitch
    expect((await call(a, "POST", url, { anchor_pts_us: 8_000_000, points: clicks(NAMES.slice(2, 5)), pitch_length_m: 100, pitch_width_m: 64 })).body.code).toBe("PITCH_SIZE_DIFFERS");
    const halfway = clicks(["halfway line, top touchline", "centre circle, top", "centre spot", "centre circle, bottom", "halfway line, bottom touchline"]);
    const q2 = await call(a, "POST", url, { anchor_pts_us: 8_000_000, points: halfway });                                                         // a centre view: all on the halfway line, joined
    expect(q2.status).toBe(202);
    const d = new OutboxDispatcher(db, [pitchJobStarter()]);                                                                                      // one job per moment, as for any calibration
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT subject_id FROM worker_jobs WHERE kind = 'CALIBRATE_PITCH' AND subject_id IN (?, ?)", [q.body.id, q2.body.id]);
    expect(jobs).toHaveLength(2);
    // the worker's camera (written by vie_worker.pitch_job.join_moments) is shown, scoped to the organization, until a moment it rests on is removed
    const camId = uuidv7();
    await root.query(`INSERT INTO pitch_cameras (id, organization_id, video_id, centre_x_m, centre_y_m, height_m, roll_deg, pitch_length_m, pitch_width_m, moments, points, click_rms_px)
                      VALUES (?, ?, ?, 2, 51.8, 10.8, -0.5, 105, 68, ?, 5, 1.9)`, [camId, a.orgId, v, JSON.stringify([q.body.id, q2.body.id])]);
    expect((await call(a, "GET", `/v1/videos/${v}/pitch-camera`)).body.camera).toMatchObject({ id: camId, position_m: [2, 51.8], height_m: 10.8, moments: 2, points: 5 });
    expect((await call(b, "GET", `/v1/videos/${v}/pitch-camera`)).status).toBe(404);
    await root.query("UPDATE pitch_calibration_requests SET status = 'WAITING' WHERE id = ?", [q2.body.id]);
    expect((await call(a, "DELETE", `/v1/pitch-calibrations/${q.body.id}`)).status).toBe(204);
    expect((await call(a, "GET", `/v1/videos/${v}/pitch-camera`)).body).toEqual({ camera: null });
  });
});

describe("the whole video calibrated automatically (ADR-036)", () => {
  it("queues one AUTO request with no clicks, keeps the video's pitch size, one at a time, and keeps viewers and other organizations out", async () => {
    const v = await seedVideo(a);
    const url = `/v1/videos/${v}/pitch-calibrations/auto`;
    expect((await call(viewer, "POST", url, {})).status).toBe(403);
    expect((await call(b, "POST", url, {})).status).toBe(404);
    const q = await call(a, "POST", url, {});
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ status: "QUEUED", mode: "AUTO", point_count: 0, landmarks: [], lines: [], pitch_length_m: 105, pitch_width_m: 68 });
    expect((await call(a, "POST", url, {})).body.code).toBe("CALIBRATION_ALREADY_RUNNING");
    expect((await call(a, "POST", `/v1/videos/${v}/pitch-calibrations`, { anchor_pts_us: 1_000_000, points: clicks(NAMES) })).body.code).toBe("CALIBRATION_ALREADY_RUNNING");
    const d = new OutboxDispatcher(db, [pitchJobStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind FROM worker_jobs WHERE subject_id = ?", [q.body.id]);
    expect(jobs).toEqual([{ kind: "CALIBRATE_PITCH" }]);
    await root.query("UPDATE pitch_calibration_requests SET status = 'SUCCEEDED' WHERE id = ?", [q.body.id]);
    expect((await call(a, "POST", url, { pitch_length_m: 100, pitch_width_m: 64 })).body.code).toBe("PITCH_SIZE_DIFFERS");          // one match, one pitch
    const v2 = await seedVideo(a);
    expect((await call(a, "POST", `/v1/videos/${v2}/pitch-calibrations/auto`, { pitch_length_m: 100, pitch_width_m: 64 })).body).toMatchObject({ pitch_length_m: 100, pitch_width_m: 64 });
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    expect((await call(a, "POST", `/v1/videos/${await seedVideo(a, "PENDING")}/pitch-calibrations/auto`, {})).body.code).toBe("VIDEO_NOT_READY");
  });
});

describe("clicks anywhere on a line (match camera only)", () => {
  it("takes one place and two line clicks, stores and lists them, and refuses unknown lines or too few clicks", async () => {
    const v = await seedVideo(a);
    const url = `/v1/videos/${v}/pitch-calibrations`;
    const centre = clicks(["centre spot"]);
    const touch = (x: number) => { const p = project(TRUE_H, [x, -34])!; return { line: "touchline top", x: p[0], y: p[1] }; };
    expect((await call(a, "POST", url, { anchor_pts_us: 9_000_000, points: centre, lines: [touch(-20)] })).body.code).toBe("TOO_FEW_CLICKS");       // 3 equations: not enough
    expect((await call(a, "POST", url, { anchor_pts_us: 9_000_000, points: centre, lines: [touch(-20), { ...touch(20), line: "the moon" }] })).body.code).toBe("UNKNOWN_LINE");
    const q = await call(a, "POST", url, { anchor_pts_us: 9_000_000, points: centre, lines: [touch(-20), touch(20)] });
    expect(q.status).toBe(202);
    expect(q.body).toMatchObject({ point_count: 3, landmarks: ["centre spot"], lines: ["touchline top", "touchline top"] });
    const [rows] = await root.query<RowDataPacket[]>("SELECT points FROM pitch_calibration_requests WHERE id = ?", [q.body.id]);
    const stored = typeof rows[0]!.points === "string" ? JSON.parse(rows[0]!.points) : rows[0]!.points;
    expect(stored.map((x: { landmark?: string; line?: string }) => x.landmark ?? x.line)).toEqual(["centre spot", "touchline top", "touchline top"]);   // as the worker reads them
    const d = new OutboxDispatcher(db, [pitchJobStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
  });
});

describe("pitch positions in the observations window", () => {
  it("gives metres only where a measured sample covers the moment, never for the ball, never outside the pitch, and removes them with the calibration", async () => {
    const v = await seedVideo(a);
    const run = uuidv7(), shot = uuidv7(), person = uuidv7(), ball = uuidv7(), req = uuidv7();
    await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'SUCCEEDED')", [run, v, a.orgId]);
    await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, v, run]);
    for (let f = 0; f < 6; f++) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [v, f * 25, f * 1_000_000]);
    // a person standing at pitch (10, 5) m, and one 11 m beyond the far touchline (a spectator, a photographer): the picture position of their feet from the true camera
    const feet = project(TRUE_H, [10, 5])!, far = project(TRUE_H, [10, -45])!;
    const box = (foot: Pt, w = 0.02, h = 0.1) => ({ x: foot[0] - w / 2, y: foot[1] - h, w, h });
    const other = uuidv7();
    for (const [id, num, cls] of [[person, 1, "PERSON"], [ball, 2, "BALL"], [other, 3, "PERSON"]] as const) {
      await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count, mean_confidence)
                        VALUES (?, ?, ?, ?, ?, ?, 0, 5000000, 'ENDED', 6, 0.8)`, [id, run, v, shot, num, cls]);
      const bx = id === other ? box(far) : box(feet);
      for (let f = 0; f < 6; f++) await root.query(`INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.8, 'DETECTED')`,
        [v, f * 25, id, f * 1_000_000, bx.x, bx.y, bx.w, bx.h]);
    }
    const win = async () => (await call(a, "GET", `/v1/analysis-runs/${run}/observations?from_us=0&to_us=6000000`)).body.observations as { track_number: number; pts_us: number; pitch_x: number | null; pitch_y: number | null }[];
    expect((await win()).every((o) => o.pitch_x === null && o.pitch_y === null)).toBe(true);                                                     // no calibration: nothing is placed
    await root.query(`INSERT INTO pitch_calibration_requests (id, organization_id, video_id, anchor_pts_us, points, pitch_length_m, pitch_width_m, status, requested_by) VALUES (?, ?, ?, 2000000, '[]', 105, 68, 'SUCCEEDED', ?)`, [req, a.orgId, v, a.userId]);
    // measured samples at 1 s, 2 s and 3 s (slices of 1 s centred on them: 0.5-1.5, 1.5-2.5, 2.5-3.5); nothing at 4 s and 5 s
    for (const t of [1, 2, 3]) await root.query(`INSERT INTO pitch_calibrations (id, video_id, request_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, reprojection_error_px, evidence_state, quality_score)
                                                 VALUES (?, ?, ?, ?, ?, ?, 105, 68, 1.2, 'INFERRED', 0.7)`, [uuidv7(), v, req, t * 1e6 - 500_000, t * 1e6 + 500_000, JSON.stringify(TRUE_H)]);
    const after = await win();
    const mine = after.filter((o) => o.track_number === 1);
    for (const o of mine) {
      const measured = o.pts_us >= 500_000 && o.pts_us < 3_500_000;
      if (measured) { expect(o.pitch_x).toBeCloseTo(10, 1); expect(o.pitch_y).toBeCloseTo(5, 1); }
      else { expect(o.pitch_x).toBeNull(); expect(o.pitch_y).toBeNull(); }                                                                          // 0 s (before the first slice), 4 s, 5 s: not measured
    }
    expect(mine.filter((o) => o.pitch_x !== null).length).toBe(3);
    // the window carries the calibration samples, so the video page can place pitch overlays (trails, shapes, heat, passes) in each frame
    const cw = (await call(a, "GET", `/v1/analysis-runs/${run}/observations?from_us=0&to_us=6000000`)).body.calibrations as { start_us: number; end_us: number; H: number[][]; length_m: number; quality: number }[];
    expect(cw.map((c) => [c.start_us, c.end_us])).toEqual([[500_000, 1_500_000], [1_500_000, 2_500_000], [2_500_000, 3_500_000]]);
    expect(cw[0]).toMatchObject({ length_m: 105, quality: 0.7 });
    expect(project(cw[1]!.H, [10, 5])![0]).toBeCloseTo(feet[0], 4);
    expect(after.filter((o) => o.track_number === 2).every((o) => o.pitch_x === null)).toBe(true);                                                // the ball is in the air as often as on the ground: no ground position
    expect(after.filter((o) => o.track_number === 3).every((o) => o.pitch_x === null)).toBe(true);                                                // 11 m past the touchline (more than the 6 m allowed for staff and substitutes): not placed on the pitch
    expect((await call(b, "GET", `/v1/analysis-runs/${run}/observations?from_us=0&to_us=6000000`)).status).toBe(404);
    await root.query("UPDATE pitch_calibration_requests SET status = 'FAILED' WHERE id = ?", [req]);                                               // (settled: removable)
    expect((await call(a, "DELETE", `/v1/pitch-calibrations/${req}`)).status).toBe(204);
    expect((await win()).every((o) => o.pitch_x === null)).toBe(true);                                                                             // removing the calibration removes the positions
  });
});
