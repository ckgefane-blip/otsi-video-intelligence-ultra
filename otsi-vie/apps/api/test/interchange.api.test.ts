/**
 * v3 Phase C.3 (ADR-103): OpenTimelineIO (.otio) timeline and .otsi-reel manifest export through the real API and MySQL:
 * - refuses a reel with no clips (409 NO_CLIPS);
 * - exports both .otio (Timeline.1) and .otsi-reel (otsi-reel/v1) with attachment headers before or after any MP4 render;
 * - carries faithful evidence flags (CONFIRMED vs STALE identity, UNRECORDED vs EXPORT_ALLOWED rights, INFERRED events,
 *   NOT_MEASURED score, UNVERIFIED accuracy gate);
 * - integrates B.22 export presets (?preset=) and refuses another member's personal preset or an unknown preset (404);
 * - enforces tenant and restricted-project isolation (404).
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member, editor: Member, editor2: Member, viewer: Member, b: Member;

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null, headers: r.headers };
}

async function seedFixture(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7(), ballTrack = uuidv7(), evId = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'Interchange Project', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1024, ?)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`, "1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff"]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, title, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'Lagos Match Source', 'UPLOAD', 'INGESTED', 60000000, ?, ?)",
    [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6, 12, 14]) {
    await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  }
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count)
                    VALUES (?, ?, ?, ?, 9, 'PERSON', 2000000, 14000000, 'ENDED', 7)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6, 12, 14]) {
    await root.query(`INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state)
                      VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')`, [video, s * 25, track, s * 1_000_000]);
  }
  await root.query(`INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, created_at, finished_at)
                    VALUES (?, ?, ?, ?, 'SUCCEEDED', NOW(6), NOW(6))`, [ballTrack, m.orgId, video, run]);
  await root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                    VALUES (?, ?, ?, ?, 'PASS', 3000000, 3600000, ?, NULL, 0, 0.85, 'DETECTED', '{"key": true}')`, [evId, run, video, ballTrack, track]);

  const player = (await call(m, "POST", "/v1/players", { display_name: "Interchange Striker" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player, basis: "JERSEY_NUMBER" });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player, name: "Striker — Match Reel" })).body.id as string;
  return { project, video, track, player, reel };
}

let f: Awaited<ReturnType<typeof seedFixture>>;

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  editor = await seedMember(root, "EDITOR", a.orgId);
  editor2 = await seedMember(root, "EDITOR", a.orgId);
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
  f = await seedFixture(a);
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("OpenTimelineIO (.otio) and .otsi-reel manifest export (C.3)", () => {
  it("refuses a reel with no clips, then exports both .otio and .otsi-reel with faithful evidence flags", async () => {
    expect((await call(a, "GET", `/v1/reels/${f.reel}/interchange`)).body.code).toBe("NO_CLIPS");
    expect((await call(a, "GET", `/v1/reels/${f.reel}/interchange/otio`)).status).toBe(409);
    expect((await call(a, "GET", `/v1/reels/${f.reel}/interchange/otsi-reel`)).status).toBe(409);

    const c1 = (await call(editor, "POST", `/v1/reels/${f.reel}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED", label: "Key pass" })).body.clips[0].id as string;
    const c2 = (await call(editor, "POST", `/v1/reels/${f.reel}/clips`, { in_pts_us: 10_000_000, out_pts_us: 15_000_000, origin: "MANUAL", label: "Second run" })).body.clips[1].id as string;
    await call(editor, "PATCH", `/v1/reels/${f.reel}/clips/${c2}/effect`, { kind: "SLOW", speed: 0.5 });
    await call(editor, "PATCH", `/v1/reels/${f.reel}/transitions`, { clip_id: c2, kind: "DISSOLVE", duration_ms: 400 });

    const res = await call(viewer, "GET", `/v1/reels/${f.reel}/interchange`);
    expect(res.status).toBe(200);
    expect(res.body.filename_base).toBe("Striker-Match-Reel");
    expect(res.body.manifest.schema).toBe("otsi-reel/v1");
    expect(res.body.manifest.evidence).toEqual({
      player_identity: "CONFIRMED",
      target_tracks_current: true,
      match_clock: "NONE",
      match_score: "NOT_MEASURED",
      events_evidence: "INFERRED",
      accuracy_gate: "UNVERIFIED",
      rights_state: "UNRECORDED",
      sharing_allowed: false,
    });
    expect(res.body.manifest.targets[0]).toMatchObject({
      track_id: f.track,
      track_number: 9,
      decision_current: true,
      state: "CONFIRMED",
      basis: "HUMAN",
    });
    expect(res.body.manifest.clips).toHaveLength(2);
    expect(res.body.manifest.clips[0]).toMatchObject({
      id: c1,
      origin: "SUGGESTED",
      origin_evidence: "INFERRED",
      action_detected: true,
      output_duration_us: 6_000_000,
    });
    expect(res.body.manifest.clips[0].events[0]).toMatchObject({
      kind: "PASS",
      key: true,
      evidence_class: "INFERRED",
      evidence_basis: "DETECTED",
      accuracy_gate: "UNVERIFIED",
    });
    expect(res.body.manifest.clips[1]).toMatchObject({
      id: c2,
      origin: "MANUAL",
      origin_evidence: "CONFIRMED",
      action_detected: false,
      output_duration_us: 10_000_000,
      transition_in: { kind: "DISSOLVE", duration_ms: 400 },
    });

    // Direct .otio and .otsi-reel download endpoints set Content-Disposition
    const otioRes = await call(editor, "GET", `/v1/reels/${f.reel}/interchange/otio`);
    expect(otioRes.status).toBe(200);
    expect(otioRes.headers["content-disposition"]).toBe('attachment; filename="Striker-Match-Reel.otio"');
    expect(otioRes.body.OTIO_SCHEMA).toBe("Timeline.1");
    expect(otioRes.body.tracks.children[0].children.map((x: { OTIO_SCHEMA: string }) => x.OTIO_SCHEMA)).toEqual([
      "Clip.1",
      "Transition.1",
      "Clip.1",
    ]);

    const manRes = await call(editor, "GET", `/v1/reels/${f.reel}/interchange/otsi-reel`);
    expect(manRes.status).toBe(200);
    expect(manRes.headers["content-disposition"]).toBe('attachment; filename="Striker-Match-Reel.otsi-reel"');
    expect(manRes.body.schema).toBe("otsi-reel/v1");
  });

  it("integrates B.22 export presets, updates rights and stale-identity evidence, and enforces isolation", async () => {
    const mine = (await call(editor, "POST", "/v1/export-presets", {
      name: "Social + Archive",
      scope: "PERSONAL",
      spec: { outputs: [{ profile: "SOCIAL" }, { profile: "ARCHIVE" }], loudness_lufs: -18 },
    })).body;

    // Owner of personal preset can use it; another editor in the same org cannot
    const withPreset = await call(editor, "GET", `/v1/reels/${f.reel}/interchange?preset=${mine.id}`);
    expect(withPreset.status).toBe(200);
    expect(withPreset.body.manifest.preset).toMatchObject({
      id: mine.id,
      name: "Social + Archive",
      scope: "PERSONAL",
      outputs: [
        { profile: "SOCIAL", aspect: "9:16", loudness_lufs: -18 },
        { profile: "ARCHIVE", aspect: "16:9", loudness_lufs: -18 },
      ],
    });
    expect((await call(editor2, "GET", `/v1/reels/${f.reel}/interchange?preset=${mine.id}`)).status).toBe(404);
    expect((await call(editor, "GET", `/v1/reels/${f.reel}/interchange?preset=unknown-preset`)).status).toBe(404);

    // Record shareable rights on the video -> rights_state and sharing_allowed update
    await call(a, "POST", `/v1/videos/${f.video}/rights`, {
      rights_state: "EXPORT_ALLOWED",
      allowed_uses: ["VIEW", "SHARE"],
      reason: "league broadcast clause 4",
    });
    const afterRights = (await call(a, "GET", `/v1/reels/${f.reel}/interchange`)).body;
    expect(afterRights.manifest.evidence).toMatchObject({
      rights_state: "EXPORT_ALLOWED",
      sharing_allowed: true,
    });

    // Rejecting the track identity marks the reel's evidence as STALE
    const cur = (await call(a, "GET", `/v1/tracks/${f.track}/identity`)).body;
    await call(a, "POST", `/v1/tracks/${f.track}/identity-decisions`, { state: "REJECTED", player_id: null, supersedes_id: cur.decision_id, reason: "wrong player" });
    const afterReject = (await call(a, "GET", `/v1/reels/${f.reel}/interchange`)).body;
    expect(afterReject.manifest.evidence).toMatchObject({
      player_identity: "STALE",
      target_tracks_current: false,
    });
    expect(afterReject.manifest.targets[0]).toMatchObject({
      decision_current: false,
      state: "REJECTED",
    });

    // Tenant and restricted-project isolation
    expect((await call(b, "GET", `/v1/reels/${f.reel}/interchange`)).status).toBe(404);
    expect((await call(b, "GET", `/v1/reels/${f.reel}/interchange/otio`)).status).toBe(404);
    expect((await call(b, "GET", `/v1/reels/${f.reel}/interchange/otsi-reel`)).status).toBe(404);

    await call(a, "PUT", `/v1/projects/${f.project}/access`, { access: "RESTRICTED" });
    expect((await call(editor, "GET", `/v1/reels/${f.reel}/interchange`)).status).toBe(404);
    expect((await call(a, "GET", `/v1/reels/${f.reel}/interchange`)).status).toBe(200);
  });
});
