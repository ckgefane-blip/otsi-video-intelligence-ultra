/**
 * v3 Phase E.7 (ADR-121): Pressing metrics from existing pressing events.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";
import type { PressingAnalysis } from "@otsi-vie/contracts";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, other: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  other = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("Pressing metrics (v3 Phase E.7, ADR-121)", () => {
  it("computes high press success, final third regains, and average press height with pitch calibration and E.1 exclusion", async () => {
    const { videoId, runId, trackIds: [t1, t2] } = await seedTracks(root, owner, 2);
    const ball = uuidv7();
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))",
      [ball, owner.orgId, videoId, runId]);

    // Insert 2 pressure events:
    // Event 1: Kit 0 presses Kit 1, won within 5s (regain: true)
    // Event 2: Kit 0 presses Kit 1, not won (regain: false)
    const p1 = uuidv7(), p2 = uuidv7();
    const insertPressure = (id: string, s: number, regain: boolean) =>
      root.query(
        `INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
         VALUES (?, ?, ?, ?, 'PRESSURE', ?, ?, ?, ?, 0, 0.85, 'DETECTED', ?)`,
        [id, runId, videoId, ball, s * 1e6, (s + 2) * 1e6, t1, t2, JSON.stringify({ regain, from_kit_group: 1 })],
      );

    await insertPressure(p1, 60, true);
    await insertPressure(p2, 70, false);

    // 1. Uncalibrated query
    const resUncal = await call(owner, "GET", `/v1/videos/${videoId}/pressing`);
    expect(resUncal.status).toBe(200);
    const bodyUncal = resUncal.body as PressingAnalysis;
    expect(bodyUncal.is_calibrated).toBe(false);
    expect(bodyUncal.not_measured_reason).toContain("Pitch calibration required");
    expect(bodyUncal.pressures.length).toBe(2);
    const team0Uncal = bodyUncal.teams.find((t) => t.kit_group === 0);
    expect(team0Uncal?.total_pressures).toBe(2);
    expect(team0Uncal?.total_regains).toBe(1);
    expect(team0Uncal?.overall_success_pct).toBe(50.0);
    expect(team0Uncal?.avg_press_height_m).toBeNull();

    // 2. Add pitch calibration and observations
    // Identity homography: (x, y) pixels maps directly to (pitch_x, pitch_y)
    // Say pitch length is 105m, width is 68m
    // For p1 at 60s: observation feet at x=0.7 (x_pitch = 21m along pitch: in opponent's half, so high press and final third)
    // For p2 at 70s: observation feet at x=0.4 (x_pitch = -10.5m: in own half)
    const calId = uuidv7();
    const H = JSON.stringify([[1 / 105, 0, 0.5], [0, 1 / 68, 0.5], [0, 0, 1]]);
    await root.query(
      `INSERT INTO pitch_calibrations (id, video_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score)
       VALUES (?, ?, 0, 120000000, ?, 105, 68, 0.9)`,
      [calId, videoId, H],
    );

    // Frames for video_frame_index
    await root.query(
      "INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, 1800, 60000000), (?, 2100, 70000000)",
      [videoId, videoId],
    );

    // Observations for presser t1
    // p1 at 60s (60_000_000 us): normalized box feet at x = 0.7, y = 0.5 -> unproject gives [21, 0]
    await root.query(
      `INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, observation_state)
       VALUES (?, 1800, ?, 60000000, 0.65, 0.4, 0.1, 0.1, 'DETECTED')`,
      [videoId, t1],
    );
    // p2 at 70s (70_000_000 us): normalized box feet at x = 0.4, y = 0.5 -> unproject gives [-10.5, 0]
    await root.query(
      `INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, observation_state)
       VALUES (?, 2100, ?, 70000000, 0.35, 0.4, 0.1, 0.1, 'DETECTED')`,
      [videoId, t1],
    );

    const resCal = await call(owner, "GET", `/v1/videos/${videoId}/pressing`);
    expect(resCal.status).toBe(200);
    const bodyCal = resCal.body as PressingAnalysis;
    expect(bodyCal.is_calibrated).toBe(true);
    expect(bodyCal.not_measured_reason).toBeNull();
    expect(bodyCal.pressures.length).toBe(2);

    const pt1 = bodyCal.pressures.find((p) => p.id === p1);
    expect(pt1?.pitch_x).toBeCloseTo(21.0, 1);
    expect(pt1?.is_high_press).toBe(true);
    expect(pt1?.is_final_third).toBe(true);
    expect(pt1?.regain).toBe(true);

    const pt2 = bodyCal.pressures.find((p) => p.id === p2);
    expect(pt2?.pitch_x).toBeCloseTo(-10.5, 1);
    expect(pt2?.is_high_press).toBe(false);
    expect(pt2?.is_final_third).toBe(false);

    const team0Cal = bodyCal.teams.find((t) => t.kit_group === 0);
    expect(team0Cal?.high_pressures).toBe(1);
    expect(team0Cal?.high_press_regains).toBe(1);
    expect(team0Cal?.high_press_success_pct).toBe(100.0);
    expect(team0Cal?.final_third_pressures).toBe(1);
    expect(team0Cal?.final_third_regains).toBe(1);
    expect(team0Cal?.avg_press_height_m).toBeGreaterThan(0);
    expect(team0Cal?.measured_pressures).toBe(2);

    // 3. Reject event p1 (E.1)
    await root.query(
      `INSERT INTO event_decisions (id, event_id, decision, reviewer_id, reason, decided_at)
       VALUES (?, ?, 'REJECT', ?, 'invalid pressure', CURRENT_TIMESTAMP(6))`,
      [uuidv7(), p1, owner.userId],
    );

    const resRej = await call(owner, "GET", `/v1/videos/${videoId}/pressing`);
    const bodyRej = resRej.body as PressingAnalysis;
    // p1 should be completely removed
    expect(bodyRej.pressures.map((p) => p.id)).toEqual([p2]);
    const team0Rej = bodyRej.teams.find((t) => t.kit_group === 0);
    expect(team0Rej?.total_pressures).toBe(1);
    expect(team0Rej?.high_pressures).toBe(0);
    expect(team0Rej?.final_third_regains).toBe(0);

    // 4. Tenant isolation
    const resOther = await call(other, "GET", `/v1/videos/${videoId}/pressing`);
    expect(resOther.status).toBe(404);
  });
});
