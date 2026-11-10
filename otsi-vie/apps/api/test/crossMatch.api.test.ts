/**
 * Cross-match best moments through the real HTTP API (Fastify inject) and the real MySQL schema (ADR-131): the selection
 * across two matches (tiers, labels with match + minute + reason, the sprint from measured positions), the cross-match reel
 * (creation, moments, reject/restore per video, add-moments, add-clip per video, render snapshot, duplicate, path), and the
 * single-match paths left unchanged. Runs on the owner's host (needs MySQL).
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { appDb, key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let dir: string;
let a: Member, b: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
const createPlayer = (m: Member, name = "Cross Player", k = key()) => call(m, "POST", "/v1/players", { display_name: name }, { "idempotency-key": k });
const register = (m: Member, id: string, k = key()) => call(m, "POST", `/v1/players/${id}/registration`, { country_code: "NGA" }, { "idempotency-key": k });
const confirm = (m: Member, track: string, player: string) => call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });

/** one analysed video: the player's track, another person's track, observations at the given seconds (x = picture feet) */
async function seedVideo(m: Member, project: string, matchId: string | null, durationUs: number,
    playerObs: { s: number; x: number }[], otherObs: number[], playerFirstUs: number, playerLastUs: number) {
  const video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, match_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, ?, 'UPLOAD', 'INGESTED', ?, ?, ?)",
    [video, m.orgId, project, matchId, durationUs, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, ?)", [shot, video, run, durationUs]);
  const tracks = [uuidv7(), uuidv7()];
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count)
                    VALUES (?, ?, ?, ?, ?, 'PERSON', ?, ?, 'ENDED', ?)`, [tracks[0], run, video, shot, 1, playerFirstUs, playerLastUs, playerObs.length]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count)
                    VALUES (?, ?, ?, ?, ?, 'PERSON', ?, ?, 'ENDED', ?)`, [tracks[1], run, video, shot, 2, (otherObs[0] ?? 30) * 1e6, (otherObs[0] ?? 30) * 1e6, otherObs.length]);
  for (const o of playerObs) {
    await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, o.s * 25, o.s * 1_000_000]);
    await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, ?, 0.4, 0.05, 0.15, 0.9, 'DETECTED')",
      [video, o.s * 25, tracks[0], o.s * 1_000_000, o.x]);
  }
  for (const s of otherObs) {
    await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
    await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.6, 0.4, 0.05, 0.15, 0.9, 'DETECTED')",
      [video, s * 25, tracks[1], s * 1_000_000]);
  }
  return { video, run, tracks };
}
const seedBall = async (m: Member, s: { video: string; run: string }) => {
  const ball = uuidv7();
  await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [ball, m.orgId, s.video, s.run]);
  return ball;
};
const seedEvent = (m: Member, s: { video: string; run: string }, ball: string, kind: string, from: number, to: number, p: string | null, q: string | null, f: object = {}) =>
  root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.8, 'DETECTED', ?)`,
  [uuidv7(), s.run, s.video, ball, kind, from * 1e6, to * 1e6, p, q, JSON.stringify(f)]);

/** two matches, two videos: v1 (60 s, Dynamo v Ercakhu) with a goal, a plain pass, a free kick and a measured sprint;
 *  v2 (600 s, Dynamo v Sukhum) with a shot at 400 s (47th minute). Both halves CONFIRMED. */
async function seedTwoMatches(m: Member) {
  const project = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  const dynamo = uuidv7(), ercakhu = uuidv7(), sukhum = uuidv7();
  for (const [id, name] of [[dynamo, "FC Dynamo"], [ercakhu, "FC Ercakhu"], [sukhum, "FC Sukhum"]] as const)
    await root.query("INSERT INTO clubs (id, canonical_name) VALUES (?, ?)", [id, name]);
  const match1 = uuidv7(), match2 = uuidv7();
  await root.query("INSERT INTO matches (id, organization_id, competition, kickoff_at, home_club_id, away_club_id) VALUES (?, ?, 'Abkhazia Premier League', '2026-10-03 15:00:00', ?, ?)", [match1, m.orgId, dynamo, ercakhu]);
  await root.query("INSERT INTO matches (id, organization_id, competition, kickoff_at, home_club_id, away_club_id) VALUES (?, ?, 'Abkhazia Premier League', '2026-10-10 15:00:00', ?, ?)", [match2, m.orgId, dynamo, sukhum]);
  const player = (await createPlayer(m)).body.player_id as string;
  await register(m, player);
  for (const match of [match1, match2])
    await root.query("INSERT INTO match_rosters (match_id, player_id, club_id, jersey_number) VALUES (?, ?, ?, 10)", [match, player, dynamo]);
  const still = [2, 3, 4, 5, 6, 20, 21, 22].map((s) => ({ s, x: 0.4 }));
  // 7.8 m/s for 3 s (28 km/h): picture x 0.40 -> 0.622, one second apart
  const sprint = [0.4, 0.474, 0.548, 0.622].map((x, i) => ({ s: 41 + i, x }));
  const v1 = await seedVideo(m, project, match1, 60_000_000, [...still, ...sprint], [30], 2_000_000, 44_000_000);
  const v2 = await seedVideo(m, project, match2, 600_000_000, [], [], 400_000_000, 401_000_000);
  await root.query("INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us) VALUES (?, ?, ?, 'CONFIRMED', 0, 60000000, NULL, NULL)",
    [v1.video, m.orgId, v1.run]);
  await root.query("INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us) VALUES (?, ?, ?, 'CONFIRMED', 0, 300000000, 300000000, 600000000)",
    [v2.video, m.orgId, v2.run]);
  // the pitch calibration (picture -> pitch) that makes the sprint measured: x 0.40 -> 0.622 is 7.8 m/s
  await root.query("INSERT INTO pitch_calibrations (id, video_id, start_pts_us, end_pts_us, transform_matrix, pitch_length_m, pitch_width_m, quality_score) VALUES (?, ?, 0, 60000000, ?, 105, 68, 0.9)",
    [uuidv7(), v1.video, JSON.stringify([[1 / 105, 0, 0.5], [0, 1 / 68, 0.5], [0, 0, 1]])]);
  const ball1 = await seedBall(m, v1), ball2 = await seedBall(m, v2);
  await seedEvent(m, v1, ball1, "GOAL", 9.5, 15.5, v1.tracks[0]!, null);
  await seedEvent(m, v1, ball1, "PASS", 30, 31, v1.tracks[0]!, v1.tracks[1]!);
  await seedEvent(m, v1, ball1, "SET_PIECE", 50, 56, v1.tracks[0]!, null, { kind: "FREE_KICK" });
  await seedEvent(m, v2, ball2, "SHOT", 400, 401, v2.tracks[0]!, null);
  await confirm(m, v1.tracks[0]!, player);
  await confirm(m, v2.tracks[0]!, player);
  return { project, player, v1, v2 };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-cross-"));
  app = await startApi({ storageDir: dir });
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("cross-match selection (ADR-131)", () => {
  it("selects top-down across matches, with match + minute + reason on each moment", async () => {
    const s = await seedTwoMatches(a);
    const sel = (await call(a, "GET", `/v1/players/${s.player}/cross-match-moments`)).body;
    expect(sel).toMatchObject({ rule_version: 1, length_s: 180, total_s: 28, per_match_counts: { [s.v1.video]: 2, [s.v2.video]: 1 } });
    expect(sel.selected.map((m: { tier: string; reason: string }) => [m.tier, m.reason])).toEqual([
      ["S", "Goal"], ["A", "Shot"], ["B", "Sprint — 28 km/h"]]);
    expect(sel.selected[0]).toMatchObject({ video_id: s.v1.video, match_minute: 1, opponent: "FC Ercakhu", events: ["GOAL"] });
    expect(sel.selected[1]).toMatchObject({ video_id: s.v2.video, match_minute: 47, opponent: "FC Sukhum", events: ["SHOT"] });
    expect(sel.selected[2]).toMatchObject({ video_id: s.v1.video, sprint: { top_kmh: 28, match_top_speed_kmh: 28 } });
    expect(sel.not_selected.map((x: { reason: string }) => x.reason)).toEqual(["not a best moment", "not a best moment"]);
    expect((await call(a, "GET", `/v1/players/${s.player}/cross-match-moments?length_s=90`)).body.selected).toHaveLength(3);
    expect((await call(a, "GET", `/v1/players/${s.player}/cross-match-moments?length_s=120`)).body.code).toBe("BAD_LENGTH");
    // the registry is shared, so another organization sees the registered player — but his moments are this organization's
    // confirmed tracks, and there are none there: no moments leak across organizations
    expect((await call(b, "GET", `/v1/players/${s.player}/cross-match-moments`)).body.code).toBe("NO_CONFIRMED_TRACKS");
  });

  it("refuses a provisional player, and a registered player with no confirmed track", async () => {
    const provisional = (await createPlayer(a, "Provisional")).body.player_id as string;
    expect((await call(a, "GET", `/v1/players/${provisional}/cross-match-moments`)).body.code).toBe("PLAYER_NOT_REGISTERED");
    const registered = (await createPlayer(a, "Registered")).body.player_id as string;
    await register(a, registered);
    expect((await call(a, "GET", `/v1/players/${registered}/cross-match-moments`)).body.code).toBe("NO_CONFIRMED_TRACKS");
    expect((await call(a, "POST", "/v1/reels", { source: "ALL_MATCHES", player_id: registered })).body.code).toBe("NO_CONFIRMED_TRACKS");
    expect((await call(a, "POST", "/v1/reels", { source: "ALL_MATCHES", player_id: registered, video_id: uuidv7() })).body.code).toBe("INVALID_REQUEST");
    expect((await call(a, "POST", "/v1/reels", { player_id: registered })).body.code).toBe("INVALID_REQUEST");
  });
});

describe("cross-match reels (ADR-131)", () => {
  it("creates with the selection's clips in tier order, each with its video and label", async () => {
    const s = await seedTwoMatches(a);
    const reel = (await call(a, "POST", "/v1/reels", { source: "ALL_MATCHES", player_id: s.player })).body;
    expect(reel).toMatchObject({ source: "ALL_MATCHES", video_id: null, cross_match_length_s: 180, best_moments_rule_version: 1,
      name: "Cross Player — best moments (all matches)", match: null, player_roster: null, player_club: "FC Dynamo" });
    expect(reel.targets).toHaveLength(2);
    expect(reel.clips.map((c: { source_video_id: string; label: string }) => [c.source_video_id, c.label])).toEqual([
      [s.v1.video, "Goal — 1' vs FC Ercakhu"], [s.v2.video, "Shot — 47' vs FC Sukhum"], [s.v1.video, "Sprint — 28 km/h — 1' vs FC Ercakhu"]]);
    const [row] = await root.query<RowDataPacket[]>("SELECT source, cross_match_length_s, best_moments_rule_version, video_id FROM reel_projects WHERE id = ?", [reel.id]);
    expect(row[0]).toMatchObject({ source: "ALL_MATCHES", cross_match_length_s: 180, best_moments_rule_version: 1, video_id: null });
    const got = (await call(a, "GET", `/v1/reels/${reel.id}`)).body;
    expect(got).toMatchObject({ source: "ALL_MATCHES", video_id: null });
    const moments = (await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body;
    expect(moments.selected.map((m: { in_reel: boolean }) => m.in_reel)).toEqual([true, true, true]);
    expect((await call(a, "GET", `/v1/reels/${reel.id}/path`)).body).toMatchObject({ stale: false, points: [] });
    expect((await call(a, "POST", `/v1/reels/${reel.id}/candidates`, {})).body.code).toBe("CROSS_MATCH_SINGLE_VIDEO_ONLY");
    expect((await call(a, "GET", `/v1/reels/${reel.id}/boundary-suggestions`)).body.code).toBe("CROSS_MATCH_SINGLE_VIDEO_ONLY");
  });

  it("rejects and restores per video, and adds the selected moments back", async () => {
    const s = await seedTwoMatches(a);
    const reel = (await call(a, "POST", "/v1/reels", { source: "ALL_MATCHES", player_id: s.player })).body;
    expect((await call(a, "POST", `/v1/reels/${reel.id}/moments/reject`, { in_pts_us: 9_500_000, out_pts_us: 15_500_000 })).body.code).toBe("VIDEO_REQUIRED");
    const afterReject = (await call(a, "POST", `/v1/reels/${reel.id}/moments/reject`, { video_id: s.v1.video, in_pts_us: 9_500_000, out_pts_us: 15_500_000 })).body;
    expect(afterReject.selected.map((m: { reason: string }) => m.reason)).toEqual(["Shot", "Sprint — 28 km/h"]);
    expect(afterReject.not_selected.at(-1)).toMatchObject({ reason: "rejected for this reel" });
    const afterRestore = (await call(a, "POST", `/v1/reels/${reel.id}/moments/restore`, { video_id: s.v1.video, in_pts_us: 9_500_000, out_pts_us: 15_500_000 })).body;
    expect(afterRestore.selected).toHaveLength(3);
    const shotClip = reel.clips.find((c: { source_video_id: string }) => c.source_video_id === s.v2.video);
    expect((await call(a, "DELETE", `/v1/reels/${reel.id}/clips/${shotClip.id}`)).body.clips).toHaveLength(2);
    const added = (await call(a, "POST", `/v1/reels/${reel.id}/clips/add-moments`, {})).body;
    expect(added.clips).toHaveLength(3);
    expect(added.clips.map((c: { source_video_id: string }) => c.source_video_id)).toEqual([s.v1.video, s.v1.video, s.v2.video]);
  });

  it("adds a clip per video, and refuses a clip with no video or no confirmed track", async () => {
    const s = await seedTwoMatches(a);
    const reel = (await call(a, "POST", "/v1/reels", { source: "ALL_MATCHES", player_id: s.player })).body;
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000 })).body.code).toBe("NO_SOURCE_VIDEO");
    const added = (await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000, source_video_id: s.v2.video })).body;
    expect(added.clips.at(-1)).toMatchObject({ source_video_id: s.v2.video });
    const v3 = await seedVideo(a, s.project, null, 60_000_000, [], [30], 30_000_000, 30_000_000);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000, source_video_id: v3.video })).body.code).toBe("NO_CONFIRMED_TRACKS");
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000, source_video_id: uuidv7() })).status).toBe(404);
  });

  it("renders with the selection rule and per-clip videos in the snapshot; duplicates keep them", async () => {
    const s = await seedTwoMatches(a);
    const reel = (await call(a, "POST", "/v1/reels", { source: "ALL_MATCHES", player_id: s.player })).body;
    const render = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body;
    expect(render.config.selection).toEqual({ rule: "best-moments", version: 1, length_s: 180 });
    expect(render.config.clips.map((c: { source_video_id: string }) => c.source_video_id)).toEqual([s.v1.video, s.v2.video, s.v1.video]);
    expect(render.config.overlay).toMatchObject({ home: null, away: null, competition: null, player_club: "FC Dynamo" });
    expect(render.config.profile_intro).toMatchObject({ name: "Cross Player", verified: true });
    const copy = (await call(a, "POST", `/v1/reels/${reel.id}/duplicate`, {})).body;
    expect(copy).toMatchObject({ source: "ALL_MATCHES", cross_match_length_s: 180, best_moments_rule_version: 1 });
    expect(copy.clips.map((c: { source_video_id: string }) => c.source_video_id)).toEqual([s.v1.video, s.v2.video, s.v1.video]);
  });

  it("a single-match reel is unchanged: its moments, its video, its ranking", async () => {
    const s = await seedTwoMatches(a);
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.v1.video, player_id: s.player })).body;
    expect(reel).toMatchObject({ source: "MATCH", video_id: s.v1.video, cross_match_length_s: null, best_moments_rule_version: null });
    const moments = (await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body;
    expect(moments[0]).toMatchObject({ kind: "EVENT", events: ["GOAL"], label: "Goal" });
    expect(moments.filter((m: { kind: string }) => m.kind === "EVENT").map((m: { events: string[] }) => m.events)).toEqual([["GOAL"], ["FREE_KICK"], ["PASS"]]);
    const afterReject = (await call(a, "POST", `/v1/reels/${reel.id}/moments/reject`, { in_pts_us: 9_500_000, out_pts_us: 15_500_000 })).body;
    expect(afterReject.find((m: { events: string[] }) => m.events.includes("GOAL")).rejected).toBe(true);
  });
});
