/**
 * Reel Builder through the real API and MySQL (ADR-032): a reel follows a CONFIRMED player only, its targets are pinned decisions (stale
 * after a correction until refreshed), moments come from the player's observations, clips are the user's, and a render becomes exactly one
 * RENDER worker job; the rendered file is served only through short-lived signed URLs. The worker itself is tested in services/worker.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { renderJobStarter } from "../src/core/outbox/subscribers";
import { appDb, key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let dir: string;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload, headers: r.headers };
}

/** an analysed video: track 1 seen at 2-6 s and 20-22 s (two moments), track 2 someone else */
async function seedAnalysed(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)",
    [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  const times = [2, 3, 4, 5, 6, 20, 21, 22];
  for (const s of [...times, 30]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  const tracks = [uuidv7(), uuidv7()];
  for (const [i, t] of tracks.entries()) {
    const ts = i === 0 ? times : [30];
    await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count)
                      VALUES (?, ?, ?, ?, ?, 'PERSON', ?, ?, 'ENDED', ?)`, [t, run, video, shot, i + 1, ts[0]! * 1e6, ts[ts.length - 1]! * 1e6, ts.length]);
    for (const s of ts) {
      await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')",
        [video, s * 25, t, s * 1_000_000]);
    }
  }
  const player = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...m.headers, "idempotency-key": key() }, payload: { display_name: "Reel Player" } })).body).player_id as string;
  return { video, run, tracks, player };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-reels-"));
  app = await startApi({ storageDir: dir });
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("reels", () => {
  it("follow only a confirmed player; targets pin the exact decisions; private to the organization", async () => {
    const s = await seedAnalysed(a);
    expect((await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body.code).toBe("NO_CONFIRMED_TRACKS");
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const r = await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: "Reel Player — highlights", aspect: "16:9", stale: false, clips: [], player: { display_name: "Reel Player", canonical_otsi_id: null },
      targets: [{ track_id: s.tracks[0], track_number: 1, decision_current: true }], settings: { dim: 0.55, ring: true } });
    const [pins] = await root.query<RowDataPacket[]>("SELECT identity_decision_id FROM reel_targets WHERE reel_id = ?", [r.body.id]);
    expect(pins[0]!.identity_decision_id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await call(b, "GET", `/v1/reels/${r.body.id}`)).status).toBe(404);
    expect((await call(viewer, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(a, "GET", `/v1/reels?video_id=${s.video}`)).body.map((x: { id: string }) => x.id)).toContain(r.body.id);
  });

  it("suggest the player's events first, ranked, and visible stretches only where no event moment is (ADR-043)", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    const ball = uuidv7();
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [ball, a.orgId, s.video, s.run]);
    const ev = (kind: string, from: number, to: number, p: string | null, q: string | null, f: object = {}) =>
      root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.8, 'DETECTED', ?)`, [uuidv7(), s.run, s.video, ball, kind, from * 1e6, to * 1e6, p, q, JSON.stringify(f)]);
    await ev("PASS", 4, 5, s.tracks[0]!, s.tracks[1]!);
    await ev("POSSESSION_CHANGE", 21, 21.5, s.tracks[1]!, s.tracks[0]!);
    await ev("TACKLE", 21, 21.5, s.tracks[0]!, s.tracks[1]!);                       // the rule reads that ball won as a tackle
    await ev("POSSESSION_CHANGE", 40, 41, s.tracks[0]!, s.tracks[1]!);              // he lost it: not his highlight
    await ev("PRESSURE", 30, 31, s.tracks[1]!, s.tracks[0]!);                       // someone pressed him: not his
    await ev("SHOT", 50, 51, s.tracks[0]!, null);
    await ev("PASS", 52, 53, s.tracks[1]!, s.tracks[0]!);                           // joins the shot's moment
    await ev("SET_PIECE", 30, 36, s.tracks[0]!, null, { kind: "FREE_KICK" });       // he takes a free kick: from 2 s before the kick
    // ADR-049: the scoreboard went up after a play where he was last on the ball, straight from his free kick: a free-kick goal, first
    await ev("GOAL", 9.5, 15.5, s.tracks[0]!, null, { from: "scoreboard", side: 0, score: [1, 0], set_piece: "FREE_KICK", set_piece_taker: s.tracks[0] });
    const moments = (await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body;
    expect(moments.map((m: { kind: string; label: string; in_pts_us: number; out_pts_us: number }) => [m.kind, m.label, m.in_pts_us, m.out_pts_us])).toEqual([
      // 5 s after each event, events up to 3 s apart joined (owner 2026-11-02: clips cut just before his pass): his pass and the goal are one
      ["EVENT", "Free-kick goal + pass", 0, 15_500_000],
      ["EVENT", "Shot + pass received", 46_000_000, 58_000_000], ["EVENT", "Tackle (possible)", 17_000_000, 26_500_000], ["EVENT", "Free kick", 30_000_000, 41_000_000]]);
    expect(moments[1]).toMatchObject({ events: ["SHOT", "PASS_RECEIVED"], score: 6, track_numbers: [1], in_reel: false });

    // B.25 (ADR-100): a clip cut inside the shot's moment gets an Inferred suggestion to hold it; a clip that already does gets none
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 48_000_000, out_pts_us: 52_000_000, origin: "MANUAL" });
    const r2 = (await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 15_500_000, origin: "SUGGESTED" })).body;
    const sug = (await call(viewer, "GET", `/v1/reels/${reel.id}/boundary-suggestions`)).body;
    expect(sug).toHaveLength(1);
    expect(sug[0]).toMatchObject({ clip_id: r2.clips[0].id, from_in_us: 48_000_000, from_out_us: 52_000_000, in_pts_us: 46_000_000, out_pts_us: 58_000_000,
      events: ["SHOT", "PASS_RECEIVED"], evidence: "INFERRED" });
    expect(sug[0].why).toBe("start 2.0 s earlier, end 6.0 s later: to hold the engine's 2 events of his around this clip");
    expect((await call(b, "GET", `/v1/reels/${reel.id}/boundary-suggestions`)).status).toBe(404);
    await call(a, "PATCH", `/v1/reels/${reel.id}/clips/${sug[0].clip_id}`, { in_pts_us: sug[0].in_pts_us, out_pts_us: sug[0].out_pts_us });
    expect((await call(a, "GET", `/v1/reels/${reel.id}/boundary-suggestions`)).body).toEqual([]);
  });

  it("draft reels and template slots (E4, ADR-067): key times, three drafts, use one, keep its structure, fill another player's reel", async () => {
    const seedEvents = async (s: Awaited<ReturnType<typeof seedAnalysed>>) => {
      const ball = uuidv7();
      await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [ball, a.orgId, s.video, s.run]);
      const ev = (kind: string, from: number, to: number, p: string | null, q: string | null, f: object = {}) =>
        root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.8, 'DETECTED', ?)`, [uuidv7(), s.run, s.video, ball, kind, from * 1e6, to * 1e6, p, q, JSON.stringify(f)]);
      await ev("POSSESSION_CHANGE", 21, 21.5, s.tracks[1]!, s.tracks[0]!);
      await ev("TACKLE", 21, 21.5, s.tracks[0]!, s.tracks[1]!);
      await ev("SHOT", 50, 51, s.tracks[0]!, null);
      await ev("SET_PIECE", 30, 36, s.tracks[0]!, null, { kind: "FREE_KICK" });
      await ev("GOAL", 9.5, 15.5, s.tracks[0]!, null, { from: "scoreboard", side: 0, score: [1, 0] });
    };
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    await seedEvents(s);
    const ms = (await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body;
    expect(ms.filter((m: { kind: string }) => m.kind === "EVENT").map((m: { label: string; key_at_us: number }) => [m.label, m.key_at_us]))
      .toEqual([["Goal + tackle (possible)", 12_500_000], ["Shot", 50_000_000], ["Free kick", 36_000_000]]);      // a goal: its middle; a free kick: the kick
    // drafts: anyone in the organization may look; nothing changes
    const res = (await call(viewer, "POST", `/v1/reels/${reel.id}/candidates`, { target_s: 30, theme: "BEST" })).body;
    expect(res.moments).toBe(ms.length);
    const top = res.candidates.find((c: { key: string }) => c.key === "TOP");
    expect(top.duration_us).toBeLessThanOrEqual(33_000_000);
    expect(top.clips.every((c: { kind: string }) => c.kind === "EVENT")).toBe(true);
    expect(top.clips.find((c: { events: string[] }) => c.events[0] === "GOAL").effect).toMatchObject({ kind: "RAMP", at_us: 12_500_000 });
    expect((await call(a, "GET", `/v1/reels/${reel.id}`)).body.clips).toEqual([]);
    expect((await call(b, "POST", `/v1/reels/${reel.id}/candidates`, {})).status).toBe(404);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/candidates`, { target_s: 5 })).status).toBe(422);
    // use one: the server computes it again from the same choice
    const v = reel.version;
    expect((await call(viewer, "POST", `/v1/reels/${reel.id}/assemble`, { key: "TOP", target_s: 30, theme: "BEST", version: v })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(a, "POST", `/v1/reels/${reel.id}/assemble`, { key: "TOP", target_s: 30, theme: "BEST", version: v + 9 })).body.code).toBe("STALE_VERSION");
    const used = (await call(a, "POST", `/v1/reels/${reel.id}/assemble`, { key: "TOP", target_s: 30, theme: "BEST", version: v })).body;
    expect(used.clips.map((c: { in_pts_us: number; out_pts_us: number; effect: { kind: string } }) => [c.in_pts_us, c.out_pts_us, c.effect.kind]))
      .toEqual(top.clips.map((c: { in_pts_us: number; out_pts_us: number; effect: { kind: string } }) => [c.in_pts_us, c.out_pts_us, c.effect.kind]));
    expect(used.duration_us).toBe(top.duration_us);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/assemble`, { key: "EVERY", target_s: 30, theme: "BEST", version: used.version })).body.code).toBe("REEL_NOT_EMPTY");
    const every = (await call(a, "POST", `/v1/reels/${reel.id}/assemble`, { key: "EVERY", target_s: 30, theme: "BEST", version: used.version, replace: true })).body;
    expect(every.clips.every((c: { in_pts_us: number; out_pts_us: number }) => c.out_pts_us - c.in_pts_us <= 5_000_000)).toBe(true);
    const [audit] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_events WHERE entity_id = ? AND action = 'reel.assembled'", [reel.id]);
    expect(Number(audit[0]!.n)).toBe(2);
    // a template keeps the TOP reel's structure; on an empty reel there is nothing to keep
    const back = (await call(a, "POST", `/v1/reels/${reel.id}/assemble`, { key: "TOP", target_s: 30, theme: "BEST", version: every.version, replace: true })).body;
    const empty = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect((await call(a, "POST", "/v1/reel-templates", { name: `E4 none ${key()}`, reel_id: empty.id, with_structure: true })).body.code).toBe("REEL_EMPTY");
    const tpl = (await call(a, "POST", "/v1/reel-templates", { name: `E4 slots ${key()}`, reel_id: reel.id, with_structure: true })).body;
    expect(tpl.structure.slots.length).toBe(back.clips.length);
    expect(tpl.structure.slots.find((x: { effect: string }) => x.effect === "RAMP")).toMatchObject({ family: "GOAL" });
    const look = (await call(a, "POST", "/v1/reel-templates", { name: `E4 look ${key()}`, reel_id: reel.id })).body;
    expect(look.structure).toBeNull();
    // fill another player's reel on another match with the same kinds of moment: every slot filled, in the template's order
    const s2 = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s2.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s2.player });
    const r2 = (await call(a, "POST", "/v1/reels", { video_id: s2.video, player_id: s2.player })).body;
    await seedEvents(s2);
    expect((await call(a, "POST", `/v1/reels/${r2.id}/apply-template`, { template_id: look.id, version: r2.version, clips: "FILL" })).body.code).toBe("TEMPLATE_HAS_NO_SLOTS");
    const filled = (await call(a, "POST", `/v1/reels/${r2.id}/apply-template`, { template_id: tpl.id, version: r2.version, clips: "FILL" })).body;
    expect(filled.left_out).toEqual([]);
    expect(filled.reel.clips.map((c: { in_pts_us: number; effect: { kind: string } }) => [c.in_pts_us, c.effect.kind]))
      .toEqual(back.clips.map((c: { in_pts_us: number; effect: { kind: string } }) => [c.in_pts_us, c.effect.kind]));
    // a reel whose player has no events: no slot can be filled, the look is applied and the clips are kept, each slot named
    const s3 = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s3.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s3.player });
    const r3 = (await call(a, "POST", "/v1/reels", { video_id: s3.video, player_id: s3.player })).body;
    const none = (await call(a, "POST", `/v1/reels/${r3.id}/apply-template`, { template_id: tpl.id, version: r3.version, clips: "FILL" })).body;
    expect(none.reel.clips).toEqual([]);
    expect(none.left_out[0]).toMatch(/^slot 1 \(.+\): none of his in this match$/);
    expect(none.left_out[none.left_out.length - 1]).toBe("no slot could be filled: the reel's clips were kept");
  });

  it("a moment runs on while he still has the ball, until he has played it (owner 2026-11-02); no-action stretches say so plainly", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    const ball = uuidv7();
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [ball, a.orgId, s.video, s.run]);
    const ev = (kind: string, from: number, to: number, p: string | null, q: string | null) =>
      root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.8, 'DETECTED', '{}')`, [uuidv7(), s.run, s.video, ball, kind, from * 1e6, to * 1e6, p, q]);
    await ev("PASS", 4, 5, s.tracks[1]!, s.tracks[0]!);                             // he receives at 5 s ...
    await ev("POSSESSION", 5, 13, s.tracks[0]!, null);                              // ... and carries it to 13 s
    const moments = (await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body;
    const m = moments.find((x: { kind: string }) => x.kind === "EVENT");
    expect([m.label, m.in_pts_us, m.out_pts_us]).toEqual(["Pass received", 0, 16_000_000]);          // 3 s after he played it, not 10 s
    const vis = moments.filter((x: { kind: string }) => x.kind === "VISIBLE");
    expect(vis.length).toBeGreaterThan(0);
    expect(vis.every((x: { label: string }) => x.label === "On camera, no action found")).toBe(true);
    // a no-action clip carries no event tag into the render (nor one added under the older wording)
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: vis[0].in_pts_us, out_pts_us: vis[0].out_pts_us, origin: "SUGGESTED", label: vis[0].label });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 2_000_000, origin: "SUGGESTED", label: "Test Player visible 2.0 s" });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 16_000_000, origin: "SUGGESTED", label: "Pass received" });
    const r = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    expect(r.body.config.clips.map((c: { label: string | null }) => c.label)).toEqual([null, null, "Pass received"]);
  });

  it("suggest moments where the player is visible, and let the user add, trim, reorder and remove clips", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    const moments = (await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body;
    expect(moments.map((m: { in_pts_us: number; out_pts_us: number }) => [m.in_pts_us, m.out_pts_us])).toEqual([[1_000_000, 7_000_000], [19_000_000, 23_000_000]]);
    expect(moments[0]).toMatchObject({ visible_us: 4_000_000, observations: 5, track_numbers: [1], in_reel: false });
    let r = (await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 19_000_000, out_pts_us: 23_000_000, origin: "SUGGESTED", label: moments[1].label })).body;
    r = (await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED" })).body;
    expect(r.clips.map((c: { in_pts_us: number }) => c.in_pts_us)).toEqual([19_000_000, 1_000_000]);
    expect(r.duration_us).toBe(10_000_000);
    expect((await call(a, "GET", `/v1/reels/${reel.id}/moments`)).body.every((m: { in_reel: boolean }) => m.in_reel)).toBe(true);
    r = (await call(a, "POST", `/v1/reels/${reel.id}/clips/order`, { clip_ids: [r.clips[1].id, r.clips[0].id] })).body;
    expect(r.clips.map((c: { in_pts_us: number }) => c.in_pts_us)).toEqual([1_000_000, 19_000_000]);
    r = (await call(a, "PATCH", `/v1/reels/${reel.id}/clips/${r.clips[0].id}`, { in_pts_us: 1_500_000, out_pts_us: 6_500_000 })).body;
    expect(r.clips[0]).toMatchObject({ in_pts_us: 1_500_000, out_pts_us: 6_500_000 });
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 61_000_000 })).body.code).toBe("CLIP_TOO_LONG");
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 5, out_pts_us: 1 })).body.code).toBe("INVALID_REQUEST");
    r = (await call(a, "DELETE", `/v1/reels/${reel.id}/clips/${r.clips[1].id}`)).body;
    expect(r.clips).toHaveLength(1);
    const upd = await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: r.version, aspect: "9:16", settings: { dim: 0.7, ring_color: "#F1A824" } });
    expect(upd.body).toMatchObject({ aspect: "9:16", settings: { dim: 0.7, ring_color: "#F1A824", ring: true } });
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: r.version, name: "x" })).body.code).toBe("STALE_VERSION");
  });

  it("bulk (owner 2026-11-02): add every suggested moment in match order, then remove every clip in one call", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 19_000_000, out_pts_us: 23_000_000, origin: "SUGGESTED" });
    expect((await call(viewer, "POST", `/v1/reels/${reel.id}/clips/add-moments`)).status).toBe(403);
    expect((await call(b, "DELETE", `/v1/reels/${reel.id}/clips`)).status).toBe(404);                                // another organization
    let r = await call(a, "POST", `/v1/reels/${reel.id}/clips/add-moments`);
    expect(r.status).toBe(200);
    expect(r.body.clips.map((c: { in_pts_us: number }) => c.in_pts_us)).toEqual([19_000_000, 1_000_000]);          // the one already in is not added twice
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips/add-moments`)).body.clips).toHaveLength(2);
    r = await call(a, "DELETE", `/v1/reels/${reel.id}/clips`);
    expect([r.status, r.body.clips.length, r.body.duration_us]).toEqual([200, 0, 0]);
  });

  it("player profile (owner 2026-11-02): recorded once on the Players list, shown on the reel; only the creating organization edits it", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.player.profile).toMatchObject({ birth_date: null, age: null, preferred_foot: null, nationality: null, editable: true });
    expect((await call(a, "GET", "/v1/countries")).body).toContainEqual({ code: "NGA", name: "Nigeria" });
    const url = `/v1/players/${s.player}/profile`;
    expect((await call(viewer, "PATCH", url, { preferred_foot: "LEFT" })).status).toBe(403);
    expect((await call(b, "PATCH", url, { preferred_foot: "LEFT" })).status).toBe(404);                              // another organization
    expect((await call(a, "PATCH", url, { birth_date: "2999-01-01" })).body.code).toBe("INVALID_BIRTH_DATE");
    expect((await call(a, "PATCH", url, { nationality: "ZZZ" })).body.code).toBe("UNKNOWN_COUNTRY");
    const born = `${new Date().getUTCFullYear() - 20}-01-01`;
    expect((await call(a, "PATCH", url, { position: "XX" })).status).toBe(422);
    const up = await call(a, "PATCH", url, { birth_date: born, preferred_foot: "RIGHT", nationality: "NGA", position: "CM" });
    expect([up.status, up.body.age, up.body.preferred_foot, up.body.nationality, up.body.position]).toEqual([200, 20, "RIGHT", { code: "NGA", name: "Nigeria" }, "CM"]);
    await call(a, "PATCH", url, { nationality: "GHA" });
    const [nat] = await root.query<RowDataPacket[]>("SELECT country_code, valid_to IS NULL AS cur FROM player_nationalities WHERE player_id = ? ORDER BY recorded_at", [s.player]);
    expect(nat.map((n) => [n.country_code, Number(n.cur)])).toEqual([["NGA", 0], ["GHA", 1]]);                      // the history is kept
    expect((await call(a, "PATCH", url, { preferred_foot: null })).body).toMatchObject({ preferred_foot: null, birth_date: born });   // only what is sent changes
    expect((await call(a, "GET", `/v1/reels/${reel.id}`)).body.player.profile).toMatchObject({ age: 20, nationality: { code: "GHA" }, position: "CM" });
    const list = (await call(a, "GET", "/v1/player-list")).body;
    expect(list.find((x: { player_id: string }) => x.player_id === s.player)?.profile).toMatchObject({ birth_date: born, editable: true });
    expect((await call(b, "GET", "/v1/player-list")).body.some((x: { player_id: string }) => x.player_id === s.player)).toBe(false);
  });

  it("go stale when a followed identity is corrected, refuse to render until the targets are refreshed", async () => {
    const s = await seedAnalysed(a);
    const d = (await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player })).body;
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    // a correction (same player, new decision): the pinned decision is no longer current
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player, supersedes_id: d.decision_id, reason: "re-checked the shirt" });
    const stale = (await call(a, "GET", `/v1/reels/${reel.id}`)).body;
    expect(stale.stale).toBe(true);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("REEL_TARGETS_STALE");
    const fresh = (await call(a, "POST", `/v1/reels/${reel.id}/refresh-targets`)).body;
    expect(fresh.stale).toBe(false);
  });

  it("live preview path (E1, ADR-064): the confirmed player's positions inside the clips only; none when stale; private", async () => {
    const s = await seedAnalysed(a);
    const d = (await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player })).body;
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect((await call(a, "GET", `/v1/reels/${reel.id}/path`)).body).toEqual({ stale: false, max_interp_s: 0.6, points: [] });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    const p = (await call(a, "GET", `/v1/reels/${reel.id}/path`)).body;
    expect(p.points.map((x: { pts_us: number }) => x.pts_us)).toEqual([2, 3, 4, 5, 6].map((t) => t * 1_000_000));   // not 20-22 s, not track 2 at 30 s
    expect(p.points[0]).toEqual({ pts_us: 2_000_000, x: 0.4, y: 0.4, w: 0.05, h: 0.15, state: "DETECTED" });   // B.14: with its recorded state
    expect((await call(b, "GET", `/v1/reels/${reel.id}/path`)).status).toBe(404);
    const v = (await call(a, "GET", `/v1/reels/${reel.id}`)).body.version;
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: v, settings: { lock: 1 } })).status).toBe(200);
    expect((await call(a, "GET", `/v1/reels/${reel.id}/path`)).body.max_interp_s).toBe(0.9);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player, supersedes_id: d.decision_id, reason: "re-checked" });
    expect((await call(a, "GET", `/v1/reels/${reel.id}/path`)).body).toMatchObject({ stale: true, points: [] });
  });

  it("speed effects (E2, ADR-065): slow motion, freeze and ramp change the reel length, need a key moment inside the clip, go into the render", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    const r1 = (await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000 })).body;
    const clip = r1.clips[0].id, url = `/v1/reels/${reel.id}/clips/${clip}/effect`;
    expect(r1.clips[0].effect).toEqual({ kind: "NONE", at_us: null, speed: 1, hold_ms: 0 });
    let r = (await call(a, "PATCH", url, { kind: "SLOW", speed: 0.5 })).body;
    expect(r.duration_us).toBe(8_000_000);
    r = (await call(a, "PATCH", url, { kind: "FREEZE", at_us: 2_000_000, hold_ms: 1500, speed: 0.5 })).body;
    expect(r.clips[0].effect).toEqual({ kind: "FREEZE", at_us: 2_000_000, speed: 1, hold_ms: 1500 });
    expect(r.duration_us).toBe(5_500_000);
    expect((await call(a, "PATCH", url, { kind: "RAMP", at_us: 6_000_000, speed: 0.35 })).body.code).toBe("EFFECT_OUTSIDE_CLIP");
    expect((await call(a, "PATCH", url, { kind: "FREEZE", hold_ms: 1000 })).status).toBe(422);
    expect((await call(b, "PATCH", url, { kind: "NONE" })).status).toBe(404);
    expect((await call(viewer, "PATCH", url, { kind: "NONE" })).body.code).toBe("ROLE_NOT_ALLOWED");
    // a trim that leaves the key moment outside keeps the effect, inactive: the length is the plain clip's again; trimming back restores it
    r = (await call(a, "PATCH", `/v1/reels/${reel.id}/clips/${clip}`, { in_pts_us: 3_000_000, out_pts_us: 5_000_000 })).body;
    expect([r.clips[0].effect.kind, r.duration_us]).toEqual(["FREEZE", 2_000_000]);
    r = (await call(a, "PATCH", `/v1/reels/${reel.id}/clips/${clip}`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000 })).body;
    expect(r.duration_us).toBe(5_500_000);
    const job = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body;
    expect(job.config.clips[0].effect).toEqual({ kind: "FREEZE", at_us: 2_000_000, speed: 1, hold_ms: 1500 });
    expect(job.config.overlay).toMatchObject({ player_number: null, player_position: null });
    await root.query("UPDATE render_jobs SET state = 'CANCELLED' WHERE id = ?", [job.id]);
    expect((await call(a, "PATCH", url, { kind: "NONE" })).body.duration_us).toBe(4_000_000);
  });

  it("export profiles (E3, ADR-066): one edit, a scout 16:9 and a social 9:16 file, each with its loudness; one open render per profile; formats", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.settings).toMatchObject({ reframe_speed: 0.5, duck_music: true });
    expect(reel.formats).toEqual([]);
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000 });
    const scout = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "SCOUT" }, { "idempotency-key": key() })).body;
    expect(scout.config).toMatchObject({ profile: "SCOUT", aspect: "16:9", bitrate_mbps: 8, audio: { lufs: -16, true_peak_db: -1.5, duck_music: true } });
    const social = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "SOCIAL" }, { "idempotency-key": key() })).body;
    expect(social.config).toMatchObject({ profile: "SOCIAL", aspect: "9:16", audio: { lufs: -14 } });
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "SOCIAL" }, { "idempotency-key": key() })).body.code).toBe("RENDER_ALREADY_RUNNING");
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "WEB" }, { "idempotency-key": key() })).status).toBe(422);
    // the archive master's own bitrate; the reel profile keeps the reel's frame
    const arch = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "ARCHIVE", bitrate_mbps: 4 }, { "idempotency-key": key() })).body;
    expect(arch.config).toMatchObject({ profile: "ARCHIVE", aspect: "16:9", bitrate_mbps: 20, audio: { lufs: -23 } });
    // B.20 (ADR-095): the reel's own loudness target replaces the profile's for every file
    const cur = (await call(a, "GET", `/v1/reels/${reel.id}`)).body;
    expect(cur.settings.loudness_lufs).toBeNull();
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: cur.version, settings: { loudness_lufs: -40 } })).status).toBe(422);
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: cur.version, settings: { loudness_lufs: -23 } })).body.settings.loudness_lufs).toBe(-23);
    const own = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "REEL" }, { "idempotency-key": key() })).body;
    expect(own.config).toMatchObject({ profile: "REEL", audio: { lufs: -23 } });
    // the worker's outcome for both cuts: Reel.formats lists the newest file of each profile and frame
    for (const [j, w, h] of [[scout, 1920, 1080], [social, 608, 1080]] as const) {
      const out = uuidv7(), man = uuidv7(), k = `org/${a.orgId}/reels/${reel.id}/${j.id}.mp4`;
      await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 10, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
        [out, a.orgId, k, man, a.orgId, `${k}.json`]);
      await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [j.id]);
      await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, result = JSON_OBJECT('width', ?, 'height', ?), completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, w, h, j.id]);
    }
    await root.query("UPDATE render_jobs SET state = 'CANCELLED' WHERE id = ?", [arch.id]);
    const got = (await call(a, "GET", `/v1/reels/${reel.id}`)).body;
    expect(got.formats.map((f: { profile: string; aspect: string; width: number }) => [f.profile, f.aspect, f.width]).sort())
      .toEqual([["SCOUT", "16:9", 1920], ["SOCIAL", "9:16", 608]]);
    expect((await call(b, "GET", `/v1/reels/${reel.id}`)).status).toBe(404);
    // the person's reframe speed and ducking go into the next render
    const v = got.version;
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: v, settings: { reframe_speed: 0.9, duck_music: false } })).body.settings).toMatchObject({ reframe_speed: 0.9, duck_music: false });
    const again = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, { profile: "SOCIAL" }, { "idempotency-key": key() })).body;
    expect(again.config).toMatchObject({ settings: { reframe_speed: 0.9 }, audio: { duck_music: false } });
    await root.query("UPDATE render_jobs SET state = 'CANCELLED' WHERE id = ?", [again.id]);
  });

  it("pro polish (E5, ADR-068): a clip's zoom and drawings, the reel's look, reviewers' comments placed by the render's lead time", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.settings.look).toEqual({ exposure: 0, contrast: 1, saturation: 1, temperature: 0, preset: "NONE", strength: 1, match: null });
    const r1 = (await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 5_000_000 })).body;
    const clip = r1.clips[0].id, url = `/v1/reels/${reel.id}/clips/${clip}/fx`;
    expect(r1.clips[0].fx).toEqual({ zoom: [], drawings: [], gap_ms: 0, gain_db: 0 });
    const arrow = { kind: "ARROW", x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6, at_ms: 1200 };
    let r = (await call(a, "PATCH", url, { zoom: [{ at_ms: 2000, zoom: 2 }, { at_ms: 0, zoom: 1, ease: "LINEAR" }], drawings: [arrow] })).body;
    expect(r.clips[0].fx).toEqual({ zoom: [{ at_ms: 0, zoom: 1, ease: "LINEAR" }, { at_ms: 2000, zoom: 2, ease: "EASE" }],            // sorted, defaults filled
      drawings: [{ ...arrow, color: "YELLOW", draw_ms: 600, hold_ms: 2000 }], gap_ms: 0, gain_db: 0 });
    expect((await call(a, "PATCH", url, { zoom: [{ at_ms: 4500, zoom: 2 }], drawings: [] })).body.code).toBe("FX_OUTSIDE_CLIP");     // the clip is 4 s
    expect((await call(a, "PATCH", url, { zoom: [{ at_ms: 0, zoom: 4 }], drawings: [] })).status).toBe(422);
    expect((await call(a, "PATCH", url, { zoom: [], drawings: [{ ...arrow, x2: 1.5 }] })).status).toBe(422);
    expect((await call(viewer, "PATCH", url, { zoom: [], drawings: [] })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(b, "PATCH", url, { zoom: [], drawings: [] })).status).toBe(404);
    // slow motion makes the clip longer in the reel: a time in its slowed part is inside it
    await call(a, "PATCH", `/v1/reels/${reel.id}/clips/${clip}/effect`, { kind: "SLOW", speed: 0.5 });
    expect((await call(a, "PATCH", url, { zoom: [{ at_ms: 0, zoom: 1 }, { at_ms: 7000, zoom: 1.5 }], drawings: [arrow] })).status).toBe(200);
    await call(a, "PATCH", `/v1/reels/${reel.id}/clips/${clip}/effect`, { kind: "NONE" });
    r = (await call(a, "PATCH", url, { zoom: [{ at_ms: 0, zoom: 1 }, { at_ms: 2000, zoom: 2 }], drawings: [arrow] })).body;
    // the look: validated, saved with the reel, into the render with the clip's effects
    const look = { preset: "FILM", strength: 0.6, exposure: 0.1, match: { r: [1.1, -0.02], g: [1, 0], b: [0.9, 0.03], label: "Reel X at 00:12" } };
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: r.version, settings: { look: { ...look, contrast: 2 } } })).status).toBe(422);
    r = (await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: r.version, settings: { look } })).body;
    expect(r.settings.look).toMatchObject({ ...look, contrast: 1, saturation: 1 });
    const job = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body;
    expect(job.config.settings.look).toMatchObject({ preset: "FILM", strength: 0.6 });
    expect(job.config.clips[0].fx.zoom).toHaveLength(2);
    expect(job.config.clips[0].fx.drawings[0]).toMatchObject({ kind: "ARROW", color: "YELLOW" });
    // a copy of the reel keeps the clip's effects
    const copy = (await call(a, "POST", `/v1/reels/${reel.id}/duplicate`)).body;
    expect(copy.clips[0].fx).toEqual(r.clips[0].fx);
    // the worker's result for that render, then a reviewer's comment on its share link
    const out = uuidv7(), man = uuidv7(), k = `org/${a.orgId}/reels/${reel.id}/${job.id}.mp4`;
    await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 10, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
      [out, a.orgId, k, man, a.orgId, `${k}.json`]);
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [job.id]);
    await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, result = JSON_OBJECT('lead_s', 3), completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, job.id]);
    expect((await call(a, "GET", `/v1/reels/${reel.id}/review-comments`)).body).toEqual([]);
    const link = uuidv7();
    await root.query("INSERT INTO share_links (id, organization_id, asset_id, created_by, token_hash, expires_at, can_download) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), 0)",
      [link, a.orgId, out, a.userId, uuidv7().replace(/-/g, "").padEnd(64, "0")]);
    const [[pr]] = await root.query<RowDataPacket[]>("SELECT project_id FROM reel_projects WHERE id = ?", [reel.id]);
    await root.query("INSERT INTO comments (id, organization_id, project_id, reel_id, author_id, share_link_id, guest_name, body, at_pts_us) VALUES (?, ?, ?, ?, NULL, ?, 'Coach', 'Great run here', 4500000)",
      [uuidv7(), a.orgId, pr!.project_id, reel.id, link]);
    const rv = (await call(a, "GET", `/v1/reels/${reel.id}/review-comments`)).body;
    expect(rv).toMatchObject([{ name: "Coach", body: "Great run here", at_s: 4.5, render_id: job.id, lead_s: 3 }]);
    expect((await call(viewer, "GET", `/v1/reels/${reel.id}/review-comments`)).status).toBe(200);
    expect((await call(b, "GET", `/v1/reels/${reel.id}/review-comments`)).status).toBe(404);
    // clearing every key and drawing stores nothing
    expect((await call(a, "PATCH", url, { zoom: [], drawings: [] })).body.clips[0].fx).toEqual({ zoom: [], drawings: [], gap_ms: 0, gain_db: 0 });
    expect((await root.query<RowDataPacket[]>("SELECT clip_fx FROM reel_clips WHERE id = ?", [clip]))[0][0]!.clip_fx).toBeNull();
    // B.19 (ADR-094): a spacer before the clip adds its length to the reel, is one undoable change, and is cleared like the rest
    const len0 = (await call(a, "GET", `/v1/reels/${reel.id}`)).body.duration_us as number;
    const spaced = (await call(a, "PATCH", url, { zoom: [], drawings: [], gap_ms: 1500 })).body;
    expect(spaced.clips[0].fx.gap_ms).toBe(1500);
    expect(spaced.duration_us).toBe(len0 + 1_500_000);
    expect((await call(a, "PATCH", url, { zoom: [], drawings: [], gap_ms: 10_001 })).status).toBe(422);
    expect((await call(viewer, "PATCH", url, { zoom: [], drawings: [], gap_ms: 500 })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(a, "POST", `/v1/reels/${reel.id}/history/undo`, {})).body.duration_us).toBe(len0);
    // B.20 (ADR-095): the clip's own sound level, muted at -60 dB; above +12 dB refused
    expect((await call(a, "PATCH", url, { zoom: [], drawings: [], gain_db: -60 })).body.clips[0].fx.gain_db).toBe(-60);
    expect((await call(a, "PATCH", url, { zoom: [], drawings: [], gain_db: 13 })).status).toBe(422);
  });

  it("render: one job per request key, one RENDER worker job, signed playback and download once the file exists", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("REEL_EMPTY");
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {})).body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const k = key();
    const r1 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": k });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ state: "QUEUED", has_output: false, config: { codec: "h264", bitrate_mbps: 8, clips: [{ in_pts_us: 1_000_000, out_pts_us: 7_000_000 }] } });
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": k })).body.id).toBe(r1.body.id);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("RENDER_ALREADY_RUNNING");
    const d = new OutboxDispatcher(db, [renderJobStarter()]);
    for (let i = 0; i < 10; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, payload FROM worker_jobs WHERE subject_id = ?", [r1.body.id]);
    expect(jobs.map((j) => j.kind)).toEqual(["RENDER"]);
    expect((await call(a, "GET", `/v1/renders/${r1.body.id}/playback`)).status).toBe(404);
    // the worker's outcome, as it records it: the file, the manifest, SUCCEEDED
    const out = uuidv7(), man = uuidv7(), keyOut = `org/${a.orgId}/reels/${reel.id}/render.mp4`;
    await mkdir(path.join(dir, "org", a.orgId, "reels", reel.id), { recursive: true });
    await writeFile(path.join(dir, ...keyOut.split("/")), Buffer.alloc(4000, 7));
    await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 4000, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
      [out, a.orgId, keyOut, man, a.orgId, `${keyOut}.json`]);
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [r1.body.id]);
    await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, r1.body.id]);
    const pb = await call(a, "GET", `/v1/renders/${r1.body.id}/playback`);
    expect(pb.body).toMatchObject({ mime: "video/mp4", notice: expect.stringContaining("Development output") });
    const watch = await app.inject({ method: "GET", url: pb.body.url.replace("/api", ""), headers: { range: "bytes=0-99" } });
    expect([watch.statusCode, watch.headers["content-disposition"]]).toEqual([206, undefined]);
    const dl = await app.inject({ method: "GET", url: pb.body.download_url.replace("/api", "") });
    expect(dl.statusCode).toBe(200);
    expect(String(dl.headers["content-disposition"])).toMatch(/^attachment; filename="otsi-reel-.+\.mp4"$/);
    expect((await call(b, "GET", `/v1/renders/${r1.body.id}`)).status).toBe(404);
  });

  it("overlays and branding (ADR-044): logos only with a rights declaration, private to the organization; the render fixes what the overlays draw", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.settings).toMatchObject({ vignette: 0, lock: 0.5, auto_track: true, score_bug: false, end_screen: false, competition_logo_id: null });
    expect(reel.match).toBeNull();
    // a 1x1 PNG
    const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const logo = { kind: "COMPETITION_LOGO", name: "League", rights_holder: "The League", rights_basis: "LICENSED", confirm_rights: true, data_base64: png };
    expect((await call(a, "POST", "/v1/brand-assets", { ...logo, confirm_rights: false })).status).toBe(422);
    expect((await call(a, "POST", "/v1/brand-assets", { ...logo, data_base64: Buffer.from("GIF89a not a png or jpeg").toString("base64") })).body.code).toBe("LOGO_NOT_AN_IMAGE");
    expect((await call(viewer, "POST", "/v1/brand-assets", logo)).status).toBe(403);
    const up = await call(a, "POST", "/v1/brand-assets", logo);
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ kind: "COMPETITION_LOGO", mime: "image/png", rights_ok: true, rights_holder: "The League", rights_basis: "LICENSED" });
    const [grant] = await root.query<RowDataPacket[]>("SELECT g.rights_state, g.allowed_uses FROM brand_assets b JOIN rights_grants g ON g.id = b.rights_grant_id WHERE b.id = ?", [up.body.id]);
    expect(grant[0]).toMatchObject({ rights_state: "EXPORT_ALLOWED", allowed_uses: ["REEL_OVERLAY"] });
    expect((await call(a, "GET", "/v1/brand-assets?kind=COMPETITION_LOGO")).body.map((x: { id: string }) => x.id)).toContain(up.body.id);
    expect((await call(b, "GET", "/v1/brand-assets")).body.map((x: { id: string }) => x.id)).not.toContain(up.body.id);
    expect((await call(b, "GET", `/v1/brand-assets/${up.body.id}/image`)).status).toBe(404);
    const img = await call(a, "GET", `/v1/brand-assets/${up.body.id}/image`);
    expect([img.status, img.headers["content-type"]]).toEqual([200, "image/png"]);
    // a reel may show it as the competition logo, not as the custom logo; another organization's reel cannot use it
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { custom_logo_id: up.body.id } })).body.code).toBe("LOGO_NOT_FOUND");
    const set = await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { competition_logo_id: up.body.id, score_bug: true, end_screen: true, vignette: 0.4, lock: 0.2, auto_track: false } });
    expect(set.status).toBe(200);
    expect(set.body.settings).toMatchObject({ competition_logo_id: up.body.id, score_bug: true, end_screen: true, vignette: 0.4, lock: 0.2, auto_track: false });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    const r1 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() });
    expect(r1.status).toBe(201);
    expect(r1.body.config).toMatchObject({ settings: { competition_logo_id: up.body.id, end_screen: true },
      overlay: { title: "Reel Player — highlights", home: null, away: null, periods: null, player_club: null, competition_logo_key: expect.stringMatching(/^org\/.+\/brand\/.+\.png$/), custom_logo_key: null } });
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [r1.body.id]);
    await root.query("UPDATE render_jobs SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [r1.body.id]);
    // rights withdrawn (expired): no render with that logo
    await root.query("UPDATE rights_grants g JOIN brand_assets b ON b.rights_grant_id = g.id SET g.valid_until = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 HOUR), g.valid_from = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 2 HOUR) WHERE b.id = ?", [up.body.id]);
    expect((await call(a, "GET", "/v1/brand-assets?kind=COMPETITION_LOGO")).body.find((x: { id: string }) => x.id === up.body.id).rights_ok).toBe(false);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("BRAND_RIGHTS_MISSING");
    // retired: gone from the list, and a reel cannot choose it
    expect((await call(a, "DELETE", `/v1/brand-assets/${up.body.id}`)).status).toBe(204);
    expect((await call(a, "GET", "/v1/brand-assets")).body.map((x: { id: string }) => x.id)).not.toContain(up.body.id);
  });

  it("music (ADR-047): uploaded with a rights declaration, real audio only, private; the render fixes the file and the loudness", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.settings).toMatchObject({ music_id: null, music_volume: 0.8, match_volume: 0.3 });
    const meta = (m: object) => Buffer.from(JSON.stringify(m)).toString("base64url");
    const ok = { name: "Our anthem", rights_holder: "OTSI Ltd", rights_basis: "FREE_LICENCE", confirm_rights: true };
    const mp3 = Buffer.concat([Buffer.from("ID3"), Buffer.alloc(64, 1)]);
    const up = (m: Member, body: Buffer, info: object | null, type = "audio/mpeg") =>
      app.inject({ method: "POST", url: "/v1/brand-assets/music", headers: { ...m.headers, "content-type": type, ...(info ? { "x-asset-meta": meta(info) } : {}) }, payload: body });
    expect(JSON.parse((await up(a, mp3, null)).body).code).toBe("MUSIC_DETAILS_MISSING");
    expect(JSON.parse((await up(a, mp3, { ...ok, confirm_rights: false })).body).code).toBe("MUSIC_DETAILS_MISSING");
    expect(JSON.parse((await up(a, Buffer.from("<html>not music at all</html>"), ok)).body).code).toBe("MUSIC_NOT_AUDIO");
    expect((await up(viewer, mp3, ok)).statusCode).toBe(403);
    const r = await up(a, mp3, ok);
    expect(r.statusCode).toBe(201);
    const music = JSON.parse(r.body);
    expect(music).toMatchObject({ kind: "MUSIC", mime: "audio/mpeg", rights_ok: true, rights_basis: "FREE_LICENCE" });
    const [grant] = await root.query<RowDataPacket[]>("SELECT g.allowed_uses FROM brand_assets b JOIN rights_grants g ON g.id = b.rights_grant_id WHERE b.id = ?", [music.id]);
    expect(grant[0]!.allowed_uses).toEqual(["REEL_AUDIO"]);
    expect((await call(a, "GET", "/v1/brand-assets?kind=MUSIC")).body.map((x: { id: string }) => x.id)).toEqual([music.id]);
    expect((await call(b, "GET", `/v1/brand-assets/${music.id}/file`)).status).toBe(404);
    const f = await call(a, "GET", `/v1/brand-assets/${music.id}/file`);
    expect([f.status, f.headers["content-type"]]).toEqual([200, "audio/mpeg"]);
    // music is not a logo, and a logo is not music
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { custom_logo_id: music.id } })).body.code).toBe("LOGO_NOT_FOUND");
    const set = await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { music_id: music.id, music_volume: 0.6, match_volume: 0.1 } });
    expect(set.body.settings).toMatchObject({ music_id: music.id, music_volume: 0.6, match_volume: 0.1 });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    const r1 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    expect(r1.body.config.music).toEqual({ key: expect.stringMatching(/^org\/.+\/brand\/.+\.mp3$/), volume: 0.6, match_volume: 0.1 });
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [r1.body.id]);
    await root.query("UPDATE render_jobs SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [r1.body.id]);
    // rights withdrawn: no render with that music
    await root.query("UPDATE rights_grants g JOIN brand_assets b ON b.rights_grant_id = g.id SET g.valid_until = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 HOUR), g.valid_from = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 2 HOUR) WHERE b.id = ?", [music.id]);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("BRAND_RIGHTS_MISSING");
  });

  it("intro / outro videos (ADR-050): uploaded with a rights declaration, real video only, private; the render fixes both files", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.settings).toMatchObject({ intro_id: null, outro_id: null, event_tags: true, match_card: true });
    const meta = (m: object) => Buffer.from(JSON.stringify(m)).toString("base64url");
    const ok = { name: "Club intro", rights_holder: "OTSI Ltd", rights_basis: "OWN_BRAND", confirm_rights: true };
    const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(64, 1)]);
    const up = (m: Member, body: Buffer, info: object | null, type = "video/mp4") =>
      app.inject({ method: "POST", url: "/v1/brand-assets/video", headers: { ...m.headers, "content-type": type, ...(info ? { "x-asset-meta": meta(info) } : {}) }, payload: body });
    expect(JSON.parse((await up(a, mp4, null)).body).code).toBe("VIDEO_DETAILS_MISSING");
    expect(JSON.parse((await up(a, Buffer.from("<html>not a video at all</html>"), ok)).body).code).toBe("VIDEO_NOT_VIDEO");
    expect((await up(viewer, mp4, ok)).statusCode).toBe(403);
    const r = await up(a, mp4, ok);
    expect(r.statusCode).toBe(201);
    const video = JSON.parse(r.body);
    expect(video).toMatchObject({ kind: "REEL_VIDEO", mime: "video/mp4", rights_ok: true });
    const [grant] = await root.query<RowDataPacket[]>("SELECT g.allowed_uses FROM brand_assets b JOIN rights_grants g ON g.id = b.rights_grant_id WHERE b.id = ?", [video.id]);
    expect(grant[0]!.allowed_uses).toEqual(["REEL_OVERLAY", "REEL_AUDIO"]);                      // it is seen and heard
    expect((await call(b, "GET", `/v1/brand-assets/${video.id}/file`)).status).toBe(404);
    expect((await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { music_id: video.id } })).body.code).toBe("MUSIC_NOT_FOUND");
    const set = await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { intro_id: video.id, outro_id: video.id, event_tags: false } });
    expect(set.body.settings).toMatchObject({ intro_id: video.id, outro_id: video.id, event_tags: false, match_card: true });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, label: "Free-kick goal" });
    const r1 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    const file = expect.stringMatching(/^org\/.+\/brand\/.+\.mp4$/);
    expect([r1.body.config.intro, r1.body.config.outro]).toEqual([{ key: file }, { key: file }]);
    expect(r1.body.config.clips.map((c: { label: string | null }) => c.label)).toEqual(["Free-kick goal"]);
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [r1.body.id]);
    await root.query("UPDATE render_jobs SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [r1.body.id]);
    await call(a, "DELETE", `/v1/brand-assets/${video.id}`);                                     // retired: the reel cannot render with it
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body.code).toBe("VIDEO_NOT_FOUND");
  });

  it("a reel is at most 10 minutes (owner 2026-11-02)", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    for (let i = 0; i < 9; i++) expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 60_000_000 })).status).toBe(201);
    expect((await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 60_000_000 })).status).toBe(201);   // exactly 10:00
    const over = await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 0, out_pts_us: 1_000_000 });
    expect(over.body).toMatchObject({ code: "REEL_TOO_LONG", message: "A reel can be at most 10 minutes." });
  });

  it("cancel a render (owner 2026-11-02): it stops, the worker loses its claim, the reel can be generated again", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    const r1 = (await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).body;
    const d = new OutboxDispatcher(db, [renderJobStarter()]);
    for (let i = 0; i < 10; i++) if ((await d.runOnce()).claimed === 0) break;
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [r1.id]);
    await root.query("UPDATE worker_jobs SET state = 'RUNNING', claim_token = 'w1', lease_expires_at = CURRENT_TIMESTAMP(6) + INTERVAL 2 MINUTE WHERE subject_id = ?", [r1.id]);   // a worker has it
    expect((await call(viewer, "POST", `/v1/renders/${r1.id}/cancel`)).status).toBe(403);
    expect((await call(b, "POST", `/v1/renders/${r1.id}/cancel`)).status).toBe(404);                                // another organization
    const c = await call(a, "POST", `/v1/renders/${r1.id}/cancel`);
    expect([c.status, c.body.state]).toEqual([200, "CANCELLED"]);
    const [[job]] = await root.query<RowDataPacket[][]>("SELECT state, claim_token FROM worker_jobs WHERE subject_id = ?", [r1.id]);
    expect(job).toMatchObject({ state: "CANCELLED", claim_token: null });                                            // the worker's claim is gone
    expect((await call(a, "POST", `/v1/renders/${r1.id}/cancel`)).body.code).toBe("RENDER_NOT_RUNNING");
    const again = await call(a, "GET", `/v1/reels/${reel.id}`);
    expect(again.body.latest_render).toMatchObject({ id: r1.id, state: "CANCELLED" });
    expect(again.body.last_good_render).toBeNull();                                                                  // nothing finished with a file
    expect((await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() })).status).toBe(201);   // start again at once
  });

  it("score and time (ADR-044): team names from the video's match; the clock only from halves a person confirmed; never a score", async () => {
    const s = await seedAnalysed(a);
    await call(a, "POST", `/v1/tracks/${s.tracks[0]}/identity-decisions`, { state: "CONFIRMED", player_id: s.player });
    const home = uuidv7(), away = uuidv7(), match = uuidv7();
    await root.query("INSERT INTO clubs (id, canonical_name, short_name, created_by_organization_id) VALUES (?, 'Home Town FC', 'HOME', ?), (?, 'Away City', NULL, ?)", [home, a.orgId, away, a.orgId]);
    await root.query("INSERT INTO matches (id, organization_id, competition, home_club_id, away_club_id, home_score, away_score, kickoff_at, venue) VALUES (?, ?, 'Cup', ?, ?, 3, 1, '2026-10-11 14:00:00', 'Town Ground')", [match, a.orgId, home, away]);
    await root.query("UPDATE video_sources SET match_id = ? WHERE id = ?", [match, s.video]);
    await root.query("INSERT INTO match_periods (video_id, organization_id, state, first_start_us, first_end_us) VALUES (?, ?, 'PROPOSED', 1000000, 40000000)", [s.video, a.orgId]);
    const reel = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player })).body;
    expect(reel.match).toEqual({ home: "Home Town FC", away: "Away City", competition: "Cup", clock: "PROPOSED" });
    await call(a, "PATCH", `/v1/reels/${reel.id}`, { version: reel.version, settings: { score_bug: true } });
    await call(a, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000 });
    const r1 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    expect(r1.body.config.overlay).toMatchObject({ home: "HOME", away: "Away City", competition: "Cup", periods: null });       // proposed halves: no clock
    // ADR-050: the match card's facts (full names, the kick-off's day, the venue) and each clip's tag
    expect(r1.body.config.overlay).toMatchObject({ home_name: "Home Town FC", away_name: "Away City", date: "2026-10-11", venue: "Town Ground" });
    expect(r1.body.config.clips.map((c: { label: string | null }) => c.label)).toEqual([null]);
    expect(JSON.stringify(r1.body.config)).not.toMatch(/score"?:\s*[0-9]/);
    await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [r1.body.id]);
    await root.query("UPDATE render_jobs SET state = 'FAILED', completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [r1.body.id]);
    await root.query("UPDATE match_periods SET state = 'CONFIRMED', decided_by = ?, decided_at = CURRENT_TIMESTAMP(6) WHERE video_id = ?", [a.userId, s.video]);
    expect((await call(a, "GET", `/v1/reels/${reel.id}`)).body.match.clock).toBe("CONFIRMED");
    const r2 = await call(a, "POST", `/v1/reels/${reel.id}/renders`, {}, { "idempotency-key": key() });
    expect(r2.body.config.overlay.periods).toEqual({ first: [1_000_000, 40_000_000], second: null });
  });
});
