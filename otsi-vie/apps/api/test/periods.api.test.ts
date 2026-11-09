/** Match time (migration 0030) through the real API and MySQL: the halves proposed from players followed on the pitch, a lineup card
 * before kick-off respected, a person's confirmation kept, roles and tenancy. Synthetic play: 1 analysed frame a second. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "PUT" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

/** a 60-minute video: programme 0-5 min, 1st half 5-25, half-time 25-32, 2nd half 32-52, programme after; 10 players a second in play,
 * 2 a second in the programme (a presenter, a coach); a lineup card at 6:00 */
async function seed(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, duration_us, created_by) VALUES (?, ?, ?, 'UPLOAD', 3600000000, ?)", [video, m.orgId, project, m.userId]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (?, ?, ?, 'test', 'SUCCEEDED', '{\"sample_fps\": 1}')", [run, video, m.orgId]);
  const tracks: string[] = [];
  for (let i = 0; i < 10; i++) {
    const t = uuidv7(); tracks.push(t);
    await root.query("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (?, ?, ?, ?, 'PERSON', 0, 3600000000)", [t, run, video, i + 1]);
  }
  const frames = Array.from({ length: 3600 }, (_, s) => [video, s, s * 1_000_000, s % 10 === 0]);
  await root.query("INSERT INTO video_frame_index (video_id, frame_index, pts_us, keyframe) VALUES ?", [frames]);
  const play = (s: number) => (s >= 300 && s < 1500) || (s >= 1920 && s < 3120);
  const rows: unknown[][] = [];
  for (let s = 0; s < 3600; s++) for (let k = 0; k < (play(s) ? 10 : s % 3 === 0 ? 2 : 0); k++) rows.push([video, s, tracks[k], s * 1_000_000, 0.1, 0.1, 0.05, 0.1, 0.8, "DETECTED"]);
  for (let i = 0; i < rows.length; i += 5000) {
    await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES ?", [rows.slice(i, i + 5000)]);
  }
  const read = uuidv7();
  await root.query("INSERT INTO lineup_reads (id, organization_id, video_id, status) VALUES (?, ?, ?, 'SUCCEEDED')", [read, m.orgId, video]);
  await root.query("INSERT INTO lineup_cards (id, organization_id, read_id, video_id, pts_us, team_name, entries) VALUES (?, ?, ?, ?, 360000000, 'A', '[]')", [uuidv7(), m.orgId, read, video]);
  return { video, run };
}

beforeAll(async () => {
  app = await startApi({});
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("match periods", () => {
  it("are proposed from play, after the lineup card, confirmed by a person and kept", async () => {
    const { video } = await seed(a);
    const url = `/v1/videos/${video}/match-periods`;
    const p = (await call(a, "GET", url)).body;
    expect(p.state).toBe("PROPOSED");
    // the 1st half cannot start before the lineup card (6:00 + 20 s); both halves end where play ends (within the trimming margin)
    expect(p.first.start_us).toBeGreaterThanOrEqual(380_000_000);
    expect(p.first.start_us).toBeLessThan(420_000_000);
    expect(Math.abs(p.first.end_us - 1_500_000_000)).toBeLessThanOrEqual(31_000_000);
    expect(Math.abs(p.second.start_us - 1_920_000_000)).toBeLessThanOrEqual(31_000_000);
    expect(Math.abs(p.second.end_us - 3_120_000_000)).toBeLessThanOrEqual(31_000_000);
    expect(p.per_minute).toHaveLength(60);
    expect(p.per_minute[10]).toBe(10);
    expect((await call(a, "GET", url)).body).toEqual(p);                                    // kept, not detected again
    const set = { first: { start_us: 300_000_000, end_us: 1_500_000_000 }, second: { start_us: 1_920_000_000, end_us: 3_120_000_000 } };
    expect((await call(viewer, "PUT", url, set)).status).toBe(403);
    expect((await call(a, "PUT", url, { first: set.second, second: set.first })).status).toBe(422);              // the second half after the first
    expect((await call(a, "PUT", url, { first: { start_us: 0, end_us: 4_000_000_000 }, second: null })).body.code).toBe("PERIOD_AFTER_VIDEO");
    const c = (await call(a, "PUT", url, set)).body;
    expect(c).toMatchObject({ state: "CONFIRMED", first: set.first, second: set.second });
    expect(c.decided_at).not.toBeNull();
    expect((await call(a, "POST", `${url}/detect`)).body.code).toBe("PERIODS_CONFIRMED");
    expect((await call(viewer, "GET", url)).body.state).toBe("CONFIRMED");
    expect((await call(b, "GET", url)).status).toBe(404);
    const [aud] = await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND action = 'video.match_periods_confirmed'", [video]);
    expect(aud[0]!.n).toBe(1);
  });

  it("a video without a finished analysis has none", async () => {
    const project = uuidv7(), video = uuidv7();
    await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, a.orgId, a.userId]);
    await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, created_by) VALUES (?, ?, ?, 'UPLOAD', ?)", [video, a.orgId, project, a.userId]);
    expect((await call(a, "GET", `/v1/videos/${video}/match-periods`)).body).toMatchObject({ state: "NONE", first: null, second: null });
  });
});

describe("measures count match time only", () => {
  it("a track in the pre-match programme gets no heat-map time, no shirt-number proposal and no kit sample; one in a half keeps them", async () => {
    const { video, run } = await seed(a);
    await call(a, "PUT", `/v1/videos/${video}/match-periods`, { first: { start_us: 300_000_000, end_us: 1_500_000_000 }, second: { start_us: 1_920_000_000, end_us: 3_120_000_000 } });
    // two extra tracks with a read No. 4: one at 1:00-2:00 (programme), one at 10:00-11:00 (1st half)
    const [pre, mid] = [uuidv7(), uuidv7()];
    for (const [t, from, n] of [[pre, 60, 991], [mid, 600, 992]] as [string, number, number][]) {
      await root.query("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us, observation_count) VALUES (?, ?, ?, ?, 'PERSON', ?, ?, 60)",
        [t, run, video, n, from * 1e6, (from + 59) * 1e6]);
      await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES ?",
        [Array.from({ length: 60 }, (_, k) => [video, from + k, t, (from + k) * 1e6, 0.4, 0.4, 0.05, 0.1, 0.9, "DETECTED"])]);
      await root.query("INSERT INTO track_jersey_evidence (track_id, run_id, state, number, confidence) VALUES (?, ?, 'RECOGNIZED', '4', 0.95)", [t, run]);
      await root.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count, drift_score, thumbnail_asset_id) VALUES (?, ?, 0, '#FFFFFF', 3, 0.9, NULL)", [t, run]);
    }
    const heat = async (t: string) => (await call(a, "GET", `/v1/analysis-runs/${run}/tracks/${t}/heat-zones`)).body.seen_s as number;
    expect(await heat(pre)).toBe(0);
    expect(await heat(mid)).toBeGreaterThan(0);
    const props = (await call(a, "GET", `/v1/analysis-runs/${run}/number-proposals`)).body.proposals.map((x: { track_number: number }) => x.track_number);
    expect(props).toContain(992);
    expect(props).not.toContain(991);
  });
});
