import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { v7 as uuidv7 } from "uuid";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import {
  validateTackleEvidence,
  validateInterceptionEvidence,
  validateProgressivePassEvidence,
  validatePPDAEvidence,
  validateOffBallRunEvidence,
  validateOffsideLineEvidence,
  validateChanceCreatedEvidence,
  validateXgEvidence,
  validateCarriesEvidence,
  type VideoEvidenceAudit,
} from "@otsi-vie/contracts";
import { Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member;

async function call(
  m: Member,
  method: "GET" | "POST" | "PATCH",
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
) {
  const r = await app.inject({
    method,
    url,
    headers: { ...m.headers, ...extra },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("v3 Phase E.6 (ADR-124): Event evidence rules & evidence audit", () => {
  it("validates tackle evidence strictly per ADR-124", () => {
    // 1. Measured tackle with duel proximity, ball contact, deceleration, and possession flip
    const measured = validateTackleEvidence({
      dist_m: 1.2,
      ball_dist_m: 0.5,
      carrier_decel_ms2: 2.1,
      possession_flipped: true,
      pitch_calibrated: true,
    });
    expect(measured.status).toBe("MEASURED");
    expect(measured.value).toBe("Verified Tackle");

    // 2. Uncalibrated pitch yields PROVISIONAL
    const uncal = validateTackleEvidence({
      dist_m: null,
      ball_dist_m: null,
      carrier_decel_ms2: null,
      possession_flipped: true,
      pitch_calibrated: false,
    });
    expect(uncal.status).toBe("PROVISIONAL");
    expect(uncal.value).toBe("Possible Tackle");

    // 3. No possession flip yields NOT_MEASURED
    const noFlip = validateTackleEvidence({
      dist_m: 1.0,
      ball_dist_m: 0.5,
      carrier_decel_ms2: 2.0,
      possession_flipped: false,
      pitch_calibrated: true,
    });
    expect(noFlip.status).toBe("NOT_MEASURED");
    expect(noFlip.value).toBeNull();
  });

  it("validates interception evidence strictly per ADR-124", () => {
    // 1. Measured interception: opposing teams, ball in flight away from passer
    const measured = validateInterceptionEvidence({
      passer_to_interceptor_m: 15.0,
      ball_speed_ms: 8.5,
      interceptor_ball_dist_m: 0.4,
      opposing_teams: true,
      pitch_calibrated: true,
    });
    expect(measured.status).toBe("MEASURED");
    expect(measured.value).toBe("Verified Interception");

    // 2. Close contact (< 2.5m) is not an interception (classified as duel/tackle)
    const duelNotInterception = validateInterceptionEvidence({
      passer_to_interceptor_m: 1.5,
      ball_speed_ms: 3.0,
      interceptor_ball_dist_m: 0.3,
      opposing_teams: true,
      pitch_calibrated: true,
    });
    expect(duelNotInterception.status).toBe("NOT_MEASURED");

    // 3. Uncalibrated pitch yields PROVISIONAL
    const uncal = validateInterceptionEvidence({
      passer_to_interceptor_m: null,
      ball_speed_ms: null,
      interceptor_ball_dist_m: null,
      opposing_teams: true,
      pitch_calibrated: false,
    });
    expect(uncal.status).toBe("PROVISIONAL");
  });

  it("validates progressive pass evidence strictly per distance and pitch third", () => {
    // 1. Defensive third requires >= 30m progress
    const defProgress35 = validateProgressivePassEvidence({
      start_x_m: -40, // 12.5m from own goal
      end_x_m: -5,    // 47.5m from own goal -> 35m progress
      pitch_length_m: 105,
      attacking_towards_positive: true,
      completed: true,
      pitch_calibrated: true,
    });
    expect(defProgress35.status).toBe("MEASURED");
    expect(defProgress35.value).toBe(35);

    // 2. Defensive third with only 20m progress fails threshold (< 30m)
    const defProgress20 = validateProgressivePassEvidence({
      start_x_m: -40,
      end_x_m: -20,   // 20m progress
      pitch_length_m: 105,
      attacking_towards_positive: true,
      completed: true,
      pitch_calibrated: true,
    });
    expect(defProgress20.status).toBe("NOT_MEASURED");

    // 3. Middle third requires >= 15m progress
    const midProgress18 = validateProgressivePassEvidence({
      start_x_m: -5,  // 47.5m from own goal (middle third)
      end_x_m: 15,    // 67.5m from own goal -> 20m progress
      pitch_length_m: 105,
      attacking_towards_positive: true,
      completed: true,
      pitch_calibrated: true,
    });
    expect(midProgress18.status).toBe("MEASURED");

    // 4. Uncalibrated pass is NOT_MEASURED
    const uncal = validateProgressivePassEvidence({
      start_x_m: null,
      end_x_m: null,
      pitch_length_m: 105,
      attacking_towards_positive: true,
      completed: true,
      pitch_calibrated: false,
    });
    expect(uncal.status).toBe("NOT_MEASURED");
  });

  it("validates PPDA evidence strictly enforcing sample size and calibration", () => {
    // 1. Measured PPDA with >= 10 passes and >= 3 actions
    const validPPDA = validatePPDAEvidence({
      opponent_passes_def60: 45,
      defensive_actions_def60: 5,
      pitch_calibrated: true,
    });
    expect(validPPDA.status).toBe("MEASURED");
    expect(validPPDA.value).toBe(9); // 45 / 5 = 9.0

    // 2. Insufficient sample size yields NOT_MEASURED
    const smallSample = validatePPDAEvidence({
      opponent_passes_def60: 6,
      defensive_actions_def60: 2,
      pitch_calibrated: true,
    });
    expect(smallSample.status).toBe("NOT_MEASURED");
    expect(smallSample.value).toBeNull();
    expect(smallSample.reason).toContain("insufficient sample");

    // 3. Uncalibrated pitch yields NOT_MEASURED
    const uncal = validatePPDAEvidence({
      opponent_passes_def60: 50,
      defensive_actions_def60: 10,
      pitch_calibrated: false,
    });
    expect(uncal.status).toBe("NOT_MEASURED");
  });

  it("validates off-ball run evidence, xG/xA non-fabrication, and carries", () => {
    // Off-ball run requires >= 18 km/h and >= 1.5s
    const fastRun = validateOffBallRunEvidence({
      max_speed_kmh: 22.4,
      duration_s: 2.2,
      distance_m: 13.5,
      has_ball: false,
      pitch_calibrated: true,
    });
    expect(fastRun.status).toBe("MEASURED");

    const slowRun = validateOffBallRunEvidence({
      max_speed_kmh: 12.0,
      duration_s: 2.0,
      distance_m: 6.0,
      has_ball: false,
      pitch_calibrated: true,
    });
    expect(slowRun.status).toBe("NOT_MEASURED");

    // xG/xA must NEVER be fabricated
    const xg = validateXgEvidence();
    expect(xg.status).toBe("NOT_MEASURED");
    expect(xg.value).toBeNull();
    expect(xg.reason).toContain("does not fabricate expected goals");

    // Carries require continuous possession >= 5m
    const carry = validateCarriesEvidence({
      distance_m: 8.5,
      duration_s: 2.5,
      pitch_calibrated: true,
      possession_maintained: true,
    });
    expect(carry.status).toBe("MEASURED");
    expect(carry.value).toBe("8.5 m");
  });

  it("serves GET /v1/videos/:id/evidence-audit and GET /v1/videos/:id/pressing", async () => {
    const { videoId, runId, trackIds } = await seedTracks(root, owner, 2);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED' WHERE id = ?", [runId]);

    const ballTrackId = uuidv7();
    await root.query(
      "INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status) VALUES (?, ?, ?, ?, 'SUCCEEDED')",
      [ballTrackId, owner.orgId, videoId, runId],
    );

    // Insert events
    await root.query(
      `INSERT INTO event_candidates (id, ball_track_id, video_id, run_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
       VALUES (?, ?, ?, ?, 'TACKLE', 1000000, 2000000, ?, ?, 0, 0.85, 'INFERRED', ?)`,
      [uuidv7(), ballTrackId, videoId, runId, trackIds[0], trackIds[1], JSON.stringify({ from_kit_group: 1 })],
    );

    await root.query(
      `INSERT INTO event_candidates (id, ball_track_id, video_id, run_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
       VALUES (?, ?, ?, ?, 'PASS', 3000000, 4000000, ?, ?, 0, 0.90, 'DETECTED', ?)`,
      [uuidv7(), ballTrackId, videoId, runId, trackIds[0], trackIds[1], JSON.stringify({ length_m: 25, from: [0.3, 0.5], to: [0.6, 0.5], key: true })],
    );

    const auditRes = await call(owner, "GET", `/v1/videos/${videoId}/evidence-audit`);
    expect(auditRes.status).toBe(200);
    const audit: VideoEvidenceAudit = auditRes.body;
    expect(audit.video_id).toBe(videoId);
    expect(audit.metrics).toBeDefined();

    const requiredMetrics = [
      "TACKLE",
      "INTERCEPTION",
      "PROGRESSIVE_PASS",
      "PPDA",
      "OFF_BALL_RUN",
      "OFFSIDE_LINE",
      "CHANCES_CREATED",
      "XG_XA",
      "CARRIES",
    ];
    for (const m of requiredMetrics) {
      expect(audit.metrics[m]).toBeDefined();
      expect(audit.metrics[m]!.metric).toBe(m);
      expect(["MEASURED", "PROVISIONAL", "NOT_MEASURED"]).toContain(audit.metrics[m]!.status);
    }
    expect(audit.metrics["XG_XA"]!.status).toBe("NOT_MEASURED");

    // Pressing endpoint
    const pressRes = await call(owner, "GET", `/v1/videos/${videoId}/pressing`);
    expect(pressRes.status).toBe(200);
    expect(pressRes.body.teams).toBeInstanceOf(Array);
    if (pressRes.body.teams.length > 0) {
      expect(pressRes.body.teams[0]).toHaveProperty("ppda");
      expect(pressRes.body.teams[0]).toHaveProperty("ppda_status");
      expect(pressRes.body.teams[0]).toHaveProperty("ppda_reason");
    }
  });
});
