/** Possession and passes (migration 0031, ADR-040) through the real API and MySQL: the latest ball track's events, match time only, teams
 * named by the kit -> club assignment at read time (unassigned kits are not teams once any kit is assigned), tenancy. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi } from "./helpers";

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
afterAll(async () => { await app?.close(); await root?.end(); });

/** a 60-minute video, halves 5-25 and 32-52 min; kits 0 and 1 (players) and 2 (the referee); events of an old and a new ball track */
async function seed(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), oldBall = uuidv7(), ball = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, duration_us, created_by) VALUES (?, ?, ?, 'UPLOAD', 3600000000, ?)", [video, m.orgId, project, m.userId]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (?, ?, ?, 'test', 'SUCCEEDED', '{}')", [run, video, m.orgId]);
  await root.query(`INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us, decided_by, decided_at)
                    VALUES (?, ?, ?, 'CONFIRMED', 300000000, 1500000000, 1920000000, 3120000000, ?, NOW(6))`, [video, m.orgId, run, m.userId]);
  const tr: string[] = [];
  for (const [i, kit] of [0, 0, 1, 2].entries()) {
    const t = uuidv7(); tr.push(t);
    await root.query("INSERT INTO tracks (id, run_id, video_id, internal_track_number, class_name, first_pts_us, last_pts_us) VALUES (?, ?, ?, ?, 'PERSON', 0, 3600000000)", [t, run, video, i + 1]);
    await root.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count) VALUES (?, ?, ?, ?, 3)", [t, run, kit, ["#FFFFFF", "#FFFFFF", "#0000FF", "#000000"][i]]);
  }
  for (const [id, done] of [[oldBall, "2026-11-01 10:00:00"], [ball, "2026-11-01 11:00:00"]]) {
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, created_at, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', ?, ?)", [id, m.orgId, video, run, done, done]);
  }
  const ev = (bt: string, kind: string, s: number, e: number, p: string | null, q: string | null, kit: number, f: object = {}) =>
    root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0.8, 'DETECTED', ?)`, [uuidv7(), run, video, bt, kind, s * 1e6, e * 1e6, p, q, kit, JSON.stringify(f)]);
  await ev(oldBall, "PASS", 400, 401, tr[0]!, tr[1]!, 0);                                // replaced by the newer ball track: not counted
  await ev(ball, "PASS", 100, 101, tr[0]!, tr[1]!, 0);                                   // pre-match programme: not counted
  await ev(ball, "PASS", 400, 401, tr[0]!, tr[1]!, 0, { length_m: 18.5, from: [0.25, 0.5], to: [0.6, 0.55] });
  await ev(ball, "PASS", 2000, 2001, tr[1]!, tr[0]!, 0, { key: true });
  await ev(ball, "SHOT", 2003, 2004, tr[0]!, null, 0, { speed_ms: 24.1, distance_m: 15.2 });
  await ev(ball, "SHOT", 2010, 2011, tr[3]!, null, 2, { speed_ms: 20 });                // the referee's kit: not a team's shot
  await ev(ball, "PRESSURE", 405, 409, tr[2]!, tr[1]!, 1, { from_kit_group: 0, regain: true });
  await ev(ball, "PRESSURE", 2000, 2001, tr[0]!, tr[2]!, 0, { from_kit_group: 1, regain: false });
  await ev(ball, "PRESSURE", 2005, 2006, tr[3]!, tr[0]!, 2, { from_kit_group: 0, regain: false });   // the referee standing by: not a team
  await ev(ball, "TACKLE", 410, 411, tr[2]!, tr[1]!, 1, { from_kit_group: 0 });          // served as the change's possible kind
  await ev(ball, "POSSESSION_CHANGE", 410, 411, tr[1]!, tr[2]!, 1, { from_kit_group: 0 });
  await ev(ball, "SET_PIECE", 415, 420, tr[2]!, null, 1, { kind: "CORNER", still_s: 5 });
  await ev(ball, "SET_PIECE", 2020, 2023, tr[3]!, null, 2, { kind: null });            // the referee at the ball (a drop ball): no taker
  await ev(ball, "SET_PIECE", 100, 104, tr[0]!, null, 0, { kind: "KICK_OFF" });        // before kick-off time: not counted
  await ev(ball, "GOAL", 2030, 2045, tr[0]!, null, 0, { from: "scoreboard", side: 1, score: [0, 1], changed_by_us: 2050e6, set_piece: "FREE_KICK", set_piece_taker: tr[0] });
  await ev(ball, "GOAL", 2500, 2510, null, null, 0, { from: "scoreboard", side: 0, score: [1, 1], changed_by_us: 2600e6, set_piece: null, set_piece_taker: null });
  await ev(ball, "TEAM_POSSESSION", 290, 1000, null, null, 0);                            // 700 s inside the 1st half (from 300 s)
  await ev(ball, "TEAM_POSSESSION", 1001, 1301, null, null, 1);                           // 300 s: 1000 s seen of 2400, enough for shares
  await ev(ball, "TEAM_POSSESSION", 500, 510, null, null, 2);                             // the referee's kit: 10 s
  return { video, run, tr };
}

describe("possession and passes", () => {
  it("count the latest ball track in match time, by kit until kits are named, then by club", async () => {
    const s = await seed(a);
    const url = `/v1/videos/${s.video}/events`;
    let e = (await call(a, url)).body;
    expect(e.state).toBe("READY");
    expect(e.match_time).toBe(true);
    expect(e.passes.map((p: { start_us: number }) => p.start_us)).toEqual([400e6, 2000e6]);
    expect(e.passes[0]).toMatchObject({ from_track_id: s.tr[0], to_track_id: s.tr[1], kit_group: 0, length_m: 18.5, evidence: "DETECTED", from_player_id: null });
    expect(e.passes.map((p: { key: boolean }) => p.key)).toEqual([false, true]);
    expect(e.passes.map((p: { from_xy: unknown; to_xy: unknown }) => [p.from_xy, p.to_xy])).toEqual([[[0.25, 0.5], [0.6, 0.55]], [null, null]]);   // the ball's picture ends, when recorded
    expect(e.shots).toHaveLength(1);
    expect(e.shots[0]).toMatchObject({ at_us: 2003e6, track_id: s.tr[0], kit_group: 0, speed_ms: 24.1, distance_m: 15.2 });
    expect(e.pressures.map((p: { presser_track_id: string; regain: boolean }) => [p.presser_track_id, p.regain])).toEqual([[s.tr[2], true], [s.tr[0], false]]);
    expect(e.changes).toHaveLength(1);
    expect(e.set_pieces.map((x: { at_us: number; kind: string | null; track_id: string | null; kit_group: number | null }) => [x.at_us, x.kind, x.track_id, x.kit_group]))
      .toEqual([[420e6, "CORNER", s.tr[2], 1], [2023e6, null, null, null]]);
    expect(e.changes[0]).toMatchObject({ from_kit_group: 0, to_kit_group: 1, won_track_id: s.tr[2], how: "TACKLE" });
    expect(e.goals).toMatchObject([   // ADR-049: the scoreboard's +1, the possible scorer, the free kick he took just before
      { id: expect.any(String), start_us: 2030e6, end_us: 2045e6, scoreboard_us: 2050e6, side: 1, score: [0, 1], track_id: s.tr[0], player_id: null, kit_group: 0, set_piece: "FREE_KICK", set_piece_by_scorer: true },
      { id: expect.any(String), start_us: 2500e6, end_us: 2510e6, scoreboard_us: 2600e6, side: 0, score: [1, 1], track_id: null, player_id: null, kit_group: 0, set_piece: null, set_piece_by_scorer: false }]);
    const byKit = Object.fromEntries(e.teams.map((t: { kit_group: number }) => [t.kit_group, t]));
    expect(byKit[0]).toMatchObject({ name: null, possession_s: 700, passes: 2, won: 0 });
    expect(byKit[1]).toMatchObject({ possession_s: 300, won: 1, pressures: 1, press_regains: 1 });
    expect(e.teams).toHaveLength(2);                                                       // nothing named yet: the two team colours, not the officials' (2)
    // a person names kits 0 and 1: shares are of the two clubs; the officials' kit 2 stays out
    const home = uuidv7(), away = uuidv7();
    await root.query("INSERT INTO clubs (id, canonical_name) VALUES (?, 'Home FC'), (?, 'Away FC')", [home, away]);
    for (const [g, c] of [[0, home], [1, away]] as [number, string][]) {
      await root.query("INSERT INTO run_team_assignments (id, run_id, kit_group, club_id, decided_by) VALUES (?, ?, ?, ?, ?)", [uuidv7(), s.run, g, c, a.userId]);
    }
    e = (await call(a, url)).body;
    expect(e.teams.map((t: { name: string; share: number }) => [t.name, t.share])).toEqual([["Home FC", 70], ["Away FC", 30]]);
    expect(e.possession_known_s).toBe(1000);
    expect((await call(b, url)).status).toBe(404);                                         // another organisation
  });

  it("a video whose ball was never followed has none", async () => {
    const project = uuidv7(), video = uuidv7();
    await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, a.orgId, a.userId]);
    await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, created_by) VALUES (?, ?, ?, 'UPLOAD', ?)", [video, a.orgId, project, a.userId]);
    expect((await call(a, `/v1/videos/${video}/events`)).body).toMatchObject({ state: "NONE", passes: [], teams: [] });
  });
});

describe("possession shares", () => {
  it("are not given while teams were seen on the ball for less than a quarter of match time", async () => {
    const s = await seed(a);
    await root.query("UPDATE event_candidates SET end_pts_us = start_pts_us + 60000000 WHERE video_id = ? AND event_type = 'TEAM_POSSESSION'", [s.video]);
    const e = (await call(a, `/v1/videos/${s.video}/events`)).body;
    expect(e.teams.every((t: { share: number | null }) => t.share === null)).toBe(true);
    expect(e.teams.find((t: { kit_group: number }) => t.kit_group === 0).possession_s).toBe(50);              // 4:50-5:50, kick-off at 5:00
  });
});

describe("is this him (ADR-046)", () => {
  it("offers only the unnamed players of the events who could be the reel's player, most alike first; his kit, never on screen with him, never 'not him'", async () => {
    const s = await seed(a);
    // his track 1 is on screen 0-1000 s; tracks 2 and 3 from 1100 s (never with him); the referee (4) the whole time
    await root.query("UPDATE tracks SET first_pts_us = 0, last_pts_us = 1000000000 WHERE id = ?", [s.tr[0]]);
    await root.query("UPDATE tracks SET first_pts_us = 1100000000, last_pts_us = 3600000000 WHERE id IN (?, ?)", [s.tr[1], s.tr[2]]);
    const mk = async (n: string) => JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": `k-${uuidv7()}` }, payload: { display_name: n } })).body).player_id as string;
    const him = await mk("Reel Player");
    const url = `/v1/videos/${s.video}/who-is-this?player=${him}`;
    // nobody named yet: his kit is unknown, so both teams' players are offered (not the referee), the most events first
    let w = (await call(a, url)).body;
    expect(w).toMatchObject({ state: "READY", player: { player_id: him, display_name: "Reel Player" }, his_tracks: 0, kit_group: null, his_events: 0 });
    expect(w.items.map((i: { track_number: number; events: number }) => [i.track_number, i.events])).toEqual([[1, 4], [3, 3], [2, 2]]);                       // track 3 also takes a corner
    expect(w.items[0].moment).toEqual({ kind: "SHOT", start_us: 2003e6, end_us: 2004e6 });
    // the person says track 1 is him: his kit (0) decides; track 3 (kit 1) is not offered; his events are counted
    await app.inject({ method: "POST", url: `/v1/tracks/${s.tr[0]}/identity-decisions`, headers: a.headers, payload: { state: "CONFIRMED", player_id: him } });
    await root.query("INSERT INTO track_neighbours (track_id, neighbour_id, cosine, kit_similarity, rank_no) VALUES (?, ?, 0.9, 1, 1)", [s.tr[0], s.tr[1]]);
    w = (await call(a, url)).body;
    expect(w).toMatchObject({ his_tracks: 1, kit_group: 0, his_events: 4 });
    expect(w.items.map((i: { track_number: number; look: number | null }) => [i.track_number, i.look])).toEqual([[2, 0.9]]);
    // on screen with him: someone else
    await root.query("UPDATE tracks SET first_pts_us = 500000000 WHERE id = ?", [s.tr[1]]);
    expect((await call(a, url)).body.items).toEqual([]);
    await root.query("UPDATE tracks SET first_pts_us = 1100000000 WHERE id = ?", [s.tr[1]]);
    // "not him": gone for him, but still offered for another player
    await app.inject({ method: "POST", url: `/v1/tracks/${s.tr[1]}/identity-decisions`, headers: a.headers, payload: { state: "REJECTED", player_id: him } });
    expect((await call(a, url)).body.items).toEqual([]);
    // revisiting the "not him" ones (to move the box onto him): only those, marked
    expect((await call(a, `${url}&revisit=1`)).body.items.map((i: { track_number: number; said_not_him: boolean }) => [i.track_number, i.said_not_him])).toEqual([[2, true]]);
    expect((await call(a, url)).body.his_spans).toEqual([{ track_id: s.tr[0], first_pts_us: 0, last_pts_us: 1000000000 }]);
    const other = await mk("Other Player");
    expect((await call(a, `/v1/videos/${s.video}/who-is-this?player=${other}`)).body.items.map((i: { track_number: number }) => i.track_number)).toEqual([3, 2]);
    expect((await call(a, `/v1/videos/${s.video}/who-is-this`)).status).not.toBe(200);           // always for one player
    expect((await call(b, url)).status).toBe(404);
  });
});

describe("event verification decisions (ADR-118, Phase E.1)", () => {
  it("allows analyst to confirm, edit, and reject events with full audit logging and exclusion", async () => {
    const s = await seed(a);
    const initialEvents = (await call(a, `/v1/videos/${s.video}/events`)).body;
    expect(initialEvents.passes).toHaveLength(2);
    expect(initialEvents.rejected_events_count).toBe(0);

    const targetPassId = initialEvents.passes[0].id;

    // 1. Analyst confirms the event
    const confirmRes = await app.inject({
      method: "POST",
      url: `/v1/videos/${s.video}/events/${targetPassId}/decision`,
      headers: a.headers,
      payload: { decision: "CONFIRM", reason: "Clearly visible complete pass" },
    });
    expect(confirmRes.statusCode).toBe(201);
    const confirmedRecord = JSON.parse(confirmRes.body);
    expect(confirmedRecord).toMatchObject({
      event_id: targetPassId,
      decision: "CONFIRM",
      reviewer_id: a.userId,
      reason: "Clearly visible complete pass",
    });

    // Verify it shows decision: CONFIRM on GET /v1/videos/:id/events
    let currentEvents = (await call(a, `/v1/videos/${s.video}/events`)).body;
    expect(currentEvents.passes[0].decision).toBe("CONFIRM");
    expect(currentEvents.passes[0].reviewer_id).toBe(a.userId);

    // 2. Analyst edits the event (e.g. adjusts boundaries)
    const editRes = await app.inject({
      method: "POST",
      url: `/v1/videos/${s.video}/events/${targetPassId}/decision`,
      headers: a.headers,
      payload: { decision: "EDIT", revised_start_us: 400500000, revised_end_us: 401500000, reason: "Tightened release point" },
    });
    expect(editRes.statusCode).toBe(201);
    currentEvents = (await call(a, `/v1/videos/${s.video}/events`)).body;
    expect(currentEvents.passes[0].decision).toBe("EDIT");
    expect(currentEvents.passes[0].start_us).toBe(400500000);
    expect(currentEvents.passes[0].end_us).toBe(401500000);

    // 3. Analyst rejects the event (e.g. false positive detection)
    const rejectRes = await app.inject({
      method: "POST",
      url: `/v1/videos/${s.video}/events/${targetPassId}/decision`,
      headers: a.headers,
      payload: { decision: "REJECT", reason: "Deflected out of play, not a completed pass" },
    });
    expect(rejectRes.statusCode).toBe(201);

    // When rejected, the event is excluded from standard analysis and counted as rejected
    currentEvents = (await call(a, `/v1/videos/${s.video}/events`)).body;
    expect(currentEvents.passes).toHaveLength(1);
    expect(currentEvents.rejected_events_count).toBe(1);
    expect(currentEvents.passes.find((p: { id: string }) => p.id === targetPassId)).toBeUndefined();

    // Querying with ?all=1 includes the rejected event
    const allEvents = (await call(a, `/v1/videos/${s.video}/events?all=1`)).body;
    expect(allEvents.passes).toHaveLength(2);
    const rejectedPass = allEvents.passes.find((p: { id: string }) => p.id === targetPassId);
    expect(rejectedPass).toBeDefined();
    expect(rejectedPass.decision).toBe("REJECT");

    // 4. Query decision history
    const decisionsRes = await call(a, `/v1/videos/${s.video}/events/decisions?event_id=${targetPassId}`);
    expect(decisionsRes.status).toBe(200);
    expect(decisionsRes.body).toHaveLength(3); // CONFIRM, EDIT, REJECT in reverse chronological order
    expect(decisionsRes.body[0].decision).toBe("REJECT");
    expect(decisionsRes.body[1].decision).toBe("EDIT");
    expect(decisionsRes.body[2].decision).toBe("CONFIRM");

    // 5. Verify audit events recorded
    const [auditRows] = await root.query<mysql.RowDataPacket[]>(
      "SELECT action, entity_type, entity_id FROM audit_events WHERE entity_id = ? ORDER BY id ASC",
      [targetPassId],
    );
    expect(auditRows.map((r: { action: string }) => r.action)).toEqual(["event.confirm", "event.edit", "event.reject"]);

    // 6. Tenancy protection: org b cannot decide or inspect org a's video events
    const crossOrgDecision = await app.inject({
      method: "POST",
      url: `/v1/videos/${s.video}/events/${targetPassId}/decision`,
      headers: b.headers,
      payload: { decision: "CONFIRM" },
    });
    expect(crossOrgDecision.statusCode).toBe(404);
  });
});
