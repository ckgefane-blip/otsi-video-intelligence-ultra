/**
 * v3 Phase E.3 (ADR-123): Formations by name from calibrated pitch positions.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, other: Member;

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
  other = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("Formations by name (v3 Phase E.3, ADR-123)", () => {
  it("honestly indicates uncalibrated when calibrations are missing, infers formations when calibrated, and supports person confirmation", async () => {
    // 1. Seed video with 11 tracks (1 GK + 10 outfielders)
    const { videoId, runId, trackIds } = await seedTracks(root, owner, 11);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED' WHERE id = ?", [runId]);
    for (const tid of trackIds) {
      await root.query(
        "INSERT INTO track_appearance (track_id, run_id, kit_group, crop_count) VALUES (?, ?, 0, 10)",
        [tid, runId],
      );
    }

    // Uncalibrated GET
    const uncalRes = (await call(owner, "GET", `/v1/videos/${videoId}/formations`)).body;
    expect(uncalRes.video_id).toBe(videoId);
    expect(uncalRes.teams[0].is_calibrated).toBe(false);
    expect(uncalRes.teams[0].state).toBe("INFERRED");
    expect(uncalRes.teams[0].not_measured_reason).toContain("Needs pitch calibration");

    // 2. Add pitch calibration
    const calId = uuidv7();
    // Pitch maps [-52.5, +52.5] x [-34, +34] to [0, 1] x [0, 1]
    const H = JSON.stringify([
      [1 / 105, 0, 0.5],
      [0, 1 / 68, 0.5],
      [0, 0, 1],
    ]);
    await root.query(
      `INSERT INTO pitch_calibrations (id, video_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score)
       VALUES (?, ?, 0, 300000000, ?, 105, 68, 0.9)`,
      [calId, videoId, H],
    );

    // Add match periods
    await root.query(
      `INSERT INTO match_periods (video_id, organization_id, state, first_start_us, first_end_us, second_start_us, second_end_us)
       VALUES (?, ?, 'PROPOSED', 0, 120000000, 120000000, 240000000)`,
      [videoId, owner.orgId],
    );

    // 3. Seed frame indices & observations for a 4-3-3 structure
    // 1 GK (px = -45), 4 Def (px = -25), 3 Mid (px = 0), 3 Fwd (px = +25)
    // Corresponding image x: x_img = px/105 + 0.5
    const positions = [
      -45, // GK -> 0.071
      -25, -25, -25, -25, // 4 Def -> 0.262
      0, 0, 0, // 3 Mid -> 0.5
      25, 25, 25, // 3 Fwd -> 0.738
    ];

    for (let frame = 100; frame <= 104; frame++) {
      const ptsUs = frame * 1_000_000;
      await root.query(
        "INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)",
        [videoId, frame, ptsUs],
      );

      for (let i = 0; i < 11; i++) {
        const px = positions[i]!;
        const imgX = px / 105 + 0.5;
        await root.query(
          `INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state)
           VALUES (?, ?, ?, ?, ?, 0.5, 0.05, 0.1, 0.9, 'DETECTED')`,
          [videoId, frame, trackIds[i], ptsUs, Math.max(0.01, Math.min(0.99, imgX))],
        );
      }
    }

    // 4. GET /v1/videos/:id/formations
    const res = (await call(owner, "GET", `/v1/videos/${videoId}/formations`)).body;
    expect(res.video_id).toBe(videoId);
    const team0 = res.teams.find((t: { kit_group: number }) => t.kit_group === 0);
    expect(team0).toBeDefined();
    expect(team0.is_calibrated).toBe(true);
    expect(team0.formation).toBe("4-3-3");
    expect(team0.state).toBe("INFERRED");
    expect(team0.stability_pct).toBeGreaterThan(0);
    expect(team0.defensive_line_height_m).toBeGreaterThan(0);
    expect(team0.lines.defenders).toBe(4);
    expect(team0.lines.midfielders).toBe(3);
    expect(team0.lines.forwards).toBe(3);

    // 5. POST /v1/videos/:id/formations/confirm: analyst confirms as 4-2-3-1
    const confirmRes = (
      await call(owner, "POST", `/v1/videos/${videoId}/formations/confirm`, {
        kit_group: 0,
        period: "FULL",
        formation: "4-2-3-1",
        reason: "Analyst visual confirmation of double-pivot setup",
      })
    ).body;

    expect(confirmRes.formation).toBe("4-2-3-1");
    expect(confirmRes.state).toBe("CONFIRMED");
    expect(confirmRes.decided_by).toBe(owner.userId);
    expect(confirmRes.decided_at).toBeTruthy();

    // Subsequent GET reflects confirmed state
    const resAfter = (await call(owner, "GET", `/v1/videos/${videoId}/formations`)).body;
    const team0After = resAfter.teams.find((t: { kit_group: number }) => t.kit_group === 0);
    expect(team0After.formation).toBe("4-2-3-1");
    expect(team0After.state).toBe("CONFIRMED");

    // 6. Tenant isolation
    const otherRes = await call(other, "GET", `/v1/videos/${videoId}/formations`);
    expect(otherRes.status).toBe(404);
  });
});
