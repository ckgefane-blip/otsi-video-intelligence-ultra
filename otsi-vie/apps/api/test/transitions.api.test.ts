/**
 * Transitions Analysis API Tests (v3 Phase E.4, ADR-119).
 * Verifies turnover detection, next-action tracing within match time, INFERRED evidence state,
 * exclusion of REJECTED events (E.1), and tenant scoping.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi } from "./helpers";
import { TransitionsAnalysis } from "@otsi-vie/contracts";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, b: Member;

async function call(m: Member, url: string) {
  const r = await app.inject({ method: "GET", url, headers: m.headers });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi({});
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await root?.end();
});

async function seedMatchWithTurnovers(m: Member) {
  const project = uuidv7(),
    video = uuidv7(),
    run = uuidv7(),
    ball = uuidv7();

  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [
    project,
    m.orgId,
    m.userId,
  ]);
  await root.query(
    "INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, duration_us, created_by) VALUES (?, ?, ?, 'UPLOAD', 3600000000, ?)",
    [video, m.orgId, project, m.userId],
  );
  await root.query(
    "INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (?, ?, ?, 'test', 'SUCCEEDED', '{}')",
    [run, video, m.orgId],
  );
  await root.query(
    `INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us, decided_by, decided_at)
     VALUES (?, ?, ?, 'CONFIRMED', 300000000, 1500000000, 1920000000, 3120000000, ?, NOW(6))`,
    [video, m.orgId, run, m.userId],
  );

  const tr: string[] = [];
  for (const [i, kit] of [0, 0, 1, 1].entries()) {
    const t = uuidv7();
    tr.push(t);
    await root.query(
      "INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (?, ?, ?, ?, 'PERSON', 0, 3600000000)",
      [t, run, video, i + 1],
    );
    await root.query(
      "INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count) VALUES (?, ?, ?, ?, 3)",
      [t, run, kit, ["#FFFFFF", "#FFFFFF", "#0000FF", "#0000FF"][i]],
    );
  }

  await root.query(
    "INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, created_at, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', NOW(6), NOW(6))",
    [ball, m.orgId, video, run],
  );

  const ev = async (kind: string, s: number, e: number, p: string | null, q: string | null, kit: number, f: object = {}) => {
    const id = uuidv7();
    await root.query(
      `INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.85, 'DETECTED', ?)`,
      [id, run, video, ball, kind, s * 1e6, e * 1e6, p, q, kit, JSON.stringify(f)],
    );
    return id;
  };

  // Kit 1 wins ball from Kit 0 at 400s (Tackle by tr[2] on tr[0])
  await ev("TACKLE", 400, 401, tr[2]!, tr[0]!, 1, { from_kit_group: 0 });
  const turnover1 = await ev("POSSESSION_CHANGE", 400, 401, tr[0]!, tr[2]!, 1, { from_kit_group: 0 });

  // Kit 1 shoots 3 seconds later at 403s (Counter-attack shot)
  const shot1 = await ev("SHOT", 403, 404, tr[2]!, null, 1, { speed_ms: 22.5 });

  // Kit 0 wins ball from Kit 1 at 500s (Interception by tr[0] on tr[2])
  await ev("INTERCEPTION", 500, 501, tr[0]!, tr[2]!, 0, { from_kit_group: 1 });
  const turnover2 = await ev("POSSESSION_CHANGE", 500, 501, tr[2]!, tr[0]!, 0, { from_kit_group: 1 });

  // Kit 0 plays a pass at 504s, but Kit 1 presses and regains at 505s (Counter-press within 5s)
  await ev("PRESSURE", 503, 504, tr[3]!, tr[0]!, 1, { from_kit_group: 0, regain: true });
  await ev("POSSESSION_CHANGE", 505, 506, tr[0]!, tr[3]!, 1, { from_kit_group: 0 });

  return { video, run, tr, turnover1, shot1, turnover2 };
}

describe("Transitions Analysis (v3 Phase E.4, ADR-119)", () => {
  it("identifies attacking transitions to shot, pass, and counter-press regains labelled INFERRED", async () => {
    const s = await seedMatchWithTurnovers(a);
    const res = await call(a, `/v1/videos/${s.video}/transitions`);

    expect(res.status).toBe(200);
    const data = TransitionsAnalysis.parse(res.body);

    expect(data.state).toBe("READY");
    expect(data.evidence).toBe("INFERRED");
    expect(data.summary.teams).toHaveLength(2);

    const kit1Stats = data.summary.teams.find((t) => t.kit_group === 1);
    expect(kit1Stats).toBeDefined();
    expect(kit1Stats!.attacking_transitions).toBe(2);
    expect(kit1Stats!.shots_from_transitions).toBe(1); // turnover1 led directly to shot1
    expect(kit1Stats!.counter_press_regains).toBe(1); // kit 1 regained within 5s after turnover2

    // Check individual transition item
    const item1 = data.items.find((it) => it.trigger_event_id === s.turnover1);
    expect(item1).toBeDefined();
    expect(item1).toMatchObject({
      transition_type: "ATTACKING",
      trigger_kind: "TACKLE",
      kit_group: 1,
      evidence: "INFERRED",
      next_action: {
        event_type: "SHOT",
        outcome: "SHOT",
        duration_s: 3,
      },
    });
  });

  it("excludes rejected events (E.1) from transitions analysis", async () => {
    const s = await seedMatchWithTurnovers(a);

    // Reject shot1: analyst decides it was a deflected cross, not a shot
    const rejectRes = await app.inject({
      method: "POST",
      url: `/v1/videos/${s.video}/events/${s.shot1}/decision`,
      headers: a.headers,
      payload: { decision: "REJECT", reason: "Deflected clearance, not a shot" },
    });
    expect(rejectRes.statusCode).toBe(201);

    // Fetch transitions again: shot1 must not be counted as next action
    const res = await call(a, `/v1/videos/${s.video}/transitions`);
    const data = TransitionsAnalysis.parse(res.body);

    const kit1Stats = data.summary.teams.find((t) => t.kit_group === 1);
    expect(kit1Stats!.shots_from_transitions).toBe(0);

    const item1 = data.items.find((it) => it.trigger_event_id === s.turnover1);
    expect(item1!.next_action.outcome).not.toBe("SHOT");
  });

  it("enforces tenant isolation", async () => {
    const s = await seedMatchWithTurnovers(a);
    const res = await call(b, `/v1/videos/${s.video}/transitions`);
    expect(res.status).toBe(404);
  });
});
