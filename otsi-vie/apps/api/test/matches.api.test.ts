/**
 * Clubs, matches, rosters, team identity, shirt-number evidence and combined identity candidates (ADR-033) through the real API and
 * MySQL: a roster is edited with history and verified by a person; verification records the player's club and number without touching
 * the OTSI Player ID; a kit group is a team only when a person assigns it; candidates show evidence and conflicts and decide nothing.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: mysql.Connection;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: { ...m.headers, "idempotency-key": key() }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const uniq = () => Math.random().toString(36).slice(2, 8);
const player = async (m: Member, name: string) => (await call(m, "POST", "/v1/players", { display_name: name })).body.player_id as string;

/** two clubs, a match between them linked to a three-track run, and three players */
async function seedMatch(m: Member) {
  const home = (await call(m, "POST", "/v1/clubs", { name: `Home FC ${uniq()}`, short_name: "HOM" })).body;
  const away = (await call(m, "POST", "/v1/clubs", { name: `Away United ${uniq()}` })).body;
  const s = await seedTracks(db, m, 3);
  // tracks 1 and 2 are on screen together (0-2 s, 1-3 s); track 3 later (5-6 s)
  for (const [i, t] of s.trackIds.entries()) {
    await db.query("UPDATE tracks SET class_name = 'PERSON', first_pts_us = ?, last_pts_us = ? WHERE id = ?", [[0, 1, 5][i]! * 1e6, [2, 3, 6][i]! * 1e6, t]);
    await db.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count) VALUES (?, ?, ?, ?, 6)", [t, s.runId, [0, 1, 2][i], ["#FFFFFF", "#CC0000", "#111111"][i]]);
  }
  const match = await call(m, "POST", "/v1/matches", { home_club_id: home.id, away_club_id: away.id, competition: "Sunday League", kickoff_at: "2026-09-13T10:30:00Z", video_id: s.videoId });
  const [p7, q7, p9] = [await player(m, "Home Seven"), await player(m, "Away Seven"), await player(m, "Home Nine")];
  return { home, away, s, match: match.body, p7, q7, p9 };
}

beforeAll(async () => {
  app = await startApi({});
  db = await rootDb();
  a = await seedMember(db, "ANALYST");
  viewer = await seedMember(db, "VIEWER", a.orgId);
  b = await seedMember(db, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe("clubs and matches", () => {
  it("create clubs per organization, search them, and refuse duplicates; a match has two different teams and links its video", async () => {
    const name = `Riverside ${uniq()}`;
    const c = await call(a, "POST", "/v1/clubs", { name });
    expect(c.status).toBe(201);
    expect(c.body).toMatchObject({ name, shared: false });
    expect((await call(a, "POST", "/v1/clubs", { name })).body.code).toBe("CLUB_EXISTS");
    expect((await call(a, "GET", `/v1/clubs?q=${encodeURIComponent(name.slice(0, 12))}`)).body.map((x: { id: string }) => x.id)).toContain(c.body.id);
    expect((await call(b, "GET", `/v1/clubs?q=${encodeURIComponent(name)}`)).body).toEqual([]);              // another organization's club is invisible
    expect((await call(a, "POST", "/v1/matches", { home_club_id: c.body.id, away_club_id: c.body.id })).status).toBe(422);
    const m = await seedMatch(a);
    expect(m.match).toMatchObject({ competition: "Sunday League", home: { id: m.home.id }, away: { id: m.away.id }, video_ids: [m.s.videoId], roster: [], version: 1 });
    const upd = await call(a, "PATCH", `/v1/matches/${m.match.id}`, { version: 1, home_score: 2, away_score: 1 });
    expect(upd.body).toMatchObject({ home_score: 2, away_score: 1, version: 2 });
    expect((await call(a, "PATCH", `/v1/matches/${m.match.id}`, { version: 2, home_score: null, away_score: null })).body).toMatchObject({ home_score: null, away_score: null, version: 3 });   // cleared
    expect((await call(a, "PATCH", `/v1/matches/${m.match.id}`, { version: 3, home_score: 2, away_score: 1 })).body.version).toBe(4);
    expect((await call(a, "PATCH", `/v1/matches/${m.match.id}`, { version: 1, venue: "x" })).body.code).toBe("STALE_VERSION");
    expect((await call(a, "GET", "/v1/matches")).body.map((x: { id: string }) => x.id)).toContain(m.match.id);
    expect((await call(b, "GET", `/v1/matches/${m.match.id}`)).status).toBe(404);
    expect((await call(b, "POST", `/v1/videos/${m.s.videoId}/match`, { match_id: m.match.id })).status).toBe(404);
  });
});

describe("rosters", () => {
  it("are edited with history, one shirt number per team, verified by a person, and corrected only with a reason", async () => {
    const m = await seedMatch(a);
    const url = `/v1/matches/${m.match.id}/roster`;
    const add = await call(a, "POST", url, { player_id: m.p7, club_id: m.home.id, jersey_number: 7, position: "RW", captain: true });
    expect(add.status).toBe(201);
    expect(add.body.roster[0]).toMatchObject({ player_id: m.p7, jersey_number: 7, role: "STARTER", position: "RW", captain: true, verified: false });
    expect((await call(a, "POST", url, { player_id: m.p9, club_id: m.home.id, jersey_number: 7 })).body.code).toBe("SHIRT_NUMBER_TAKEN");
    await call(a, "POST", url, { player_id: m.p9, club_id: m.home.id, jersey_number: 9, role: "SUBSTITUTE" });
    await call(a, "POST", url, { player_id: m.q7, club_id: m.away.id, jersey_number: 7 });                  // same number, other team: fine
    const foreign = (await call(a, "POST", "/v1/clubs", { name: `Elsewhere ${uniq()}` })).body;
    expect((await call(a, "POST", url, { player_id: m.p9, club_id: foreign.id })).body.code).toBe("CLUB_NOT_IN_MATCH");
    expect((await call(b, "POST", `/v1/matches/${m.match.id}/roster`, { player_id: m.p9, club_id: m.home.id })).status).toBe(404);
    expect((await call(viewer, "POST", `${url}/verify`, { verified: true })).body.code).toBe("ROLE_NOT_ALLOWED");

    const v = await call(a, "POST", `${url}/verify`, { verified: true });
    expect(v.body.roster.every((r: { verified: boolean }) => r.verified)).toBe(true);
    expect((await call(a, "POST", url, { player_id: m.p9, club_id: m.home.id, jersey_number: 14 })).body.code).toBe("CORRECTION_REASON_REQUIRED");
    const fixed = await call(a, "POST", url, { player_id: m.p9, club_id: m.home.id, jersey_number: 14, role: "SUBSTITUTE", reason: "team sheet said 14" });
    expect(fixed.body.roster.find((r: { player_id: string }) => r.player_id === m.p9)).toMatchObject({ jersey_number: 14, verified: false });
    expect((await call(a, "DELETE", `${url}/${m.q7}`)).body.code).toBe("CORRECTION_REASON_REQUIRED");
    expect((await call(a, "DELETE", `${url}/${m.q7}?reason=${encodeURIComponent("did not play")}`)).body.roster.map((r: { player_id: string }) => r.player_id)).not.toContain(m.q7);

    const hist = (await call(a, "GET", `${url}/history`)).body;
    expect(hist.filter((h: { player_id: string }) => h.player_id === m.p9).map((h: { action: string }) => h.action).sort()).toEqual(["ADDED", "UPDATED", "VERIFIED"]);
    expect(hist.find((h: { action: string; player_id: string }) => h.action === "UPDATED")).toMatchObject({ reason: "team sheet said 14", before: { jersey_number: 9 }, after: { jersey_number: 14 } });
    expect(hist.find((h: { action: string }) => h.action === "REMOVED").reason).toBe("did not play");
    await expect(db.query("UPDATE match_roster_changes SET reason = 'x' WHERE match_id = ?", [m.match.id])).rejects.toThrow(/APPEND_ONLY/);
  });

  it("record the player's club and number on verification; a later transfer opens new history and the OTSI Player ID never changes", async () => {
    const m = await seedMatch(a);
    await call(a, "POST", `/v1/matches/${m.match.id}/roster`, { player_id: m.p7, club_id: m.home.id, jersey_number: 7 });
    await call(a, "POST", `/v1/matches/${m.match.id}/roster/verify`, { verified: true });
    const [before] = await db.query<mysql.RowDataPacket[]>("SELECT canonical_otsi_id, canonical_state FROM players WHERE id = ?", [m.p7]);
    // the same player turns out for the away club later in the season, wearing 10
    const later = (await call(a, "POST", "/v1/matches", { home_club_id: m.away.id, away_club_id: m.home.id, kickoff_at: "2026-10-04T10:30:00Z" })).body;
    await call(a, "POST", `/v1/matches/${later.id}/roster`, { player_id: m.p7, club_id: m.away.id, jersey_number: 10 });
    await call(a, "POST", `/v1/matches/${later.id}/roster/verify`, { verified: true });
    const [mem] = await db.query<mysql.RowDataPacket[]>("SELECT club_id, DATE_FORMAT(valid_from, '%Y-%m-%d') AS f, DATE_FORMAT(valid_to, '%Y-%m-%d') AS t FROM player_club_memberships WHERE player_id = ? ORDER BY valid_from", [m.p7]);
    expect(mem).toEqual([{ club_id: m.home.id, f: "2026-09-13", t: "2026-10-04" }, { club_id: m.away.id, f: "2026-10-04", t: null }]);
    const [num] = await db.query<mysql.RowDataPacket[]>("SELECT jersey_number, valid_to FROM player_jersey_numbers WHERE player_id = ? ORDER BY valid_from", [m.p7]);
    expect(num.map((n) => [n.jersey_number, n.valid_to === null])).toEqual([[7, false], [10, true]]);
    const [after] = await db.query<mysql.RowDataPacket[]>("SELECT canonical_otsi_id, canonical_state FROM players WHERE id = ?", [m.p7]);
    expect(after[0]).toEqual(before[0]);
    // re-verifying the older match after the transfer does not rewrite later history
    await call(a, "POST", `/v1/matches/${m.match.id}/roster/verify`, { verified: false });
    await call(a, "POST", `/v1/matches/${m.match.id}/roster/verify`, { verified: true });
    const [mem2] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM player_club_memberships WHERE player_id = ?", [m.p7]);
    expect(mem2[0]!.n).toBe(2);
  });
});

describe("team identity, shirt numbers and candidates", () => {
  it("assign kit groups to the match's teams only by a person: not-a-team allowed, one group per team, corrections need a reason", async () => {
    const m = await seedMatch(a);
    const g = `/v1/analysis-runs/${m.s.runId}/kit-groups`;
    const before = (await call(a, "GET", g)).body;
    expect(before).toMatchObject({ match_id: m.match.id, roster_verified: false, teams: [{ id: m.home.id }, { id: m.away.id }] });
    expect(before.groups.map((x: { kit_group: number; assignment: unknown }) => [x.kit_group, x.assignment])).toEqual([[0, null], [1, null], [2, null]]);
    const foreign = (await call(a, "POST", "/v1/clubs", { name: `Elsewhere ${uniq()}` })).body;
    expect((await call(a, "POST", `${g}/0/assignment`, { club_id: foreign.id })).body.code).toBe("CLUB_NOT_IN_MATCH");
    const h = await call(a, "POST", `${g}/0/assignment`, { club_id: m.home.id });
    expect(h.status).toBe(201);
    expect((await call(a, "POST", `${g}/1/assignment`, { club_id: m.home.id })).body.code).toBe("TEAM_ALREADY_ASSIGNED");
    await call(a, "POST", `${g}/1/assignment`, { club_id: m.away.id });
    const ref = await call(a, "POST", `${g}/2/assignment`, { club_id: null });                                  // referee: not a team
    expect(ref.body.groups[2].assignment).toMatchObject({ club_id: null, club_name: null });
    const cur0 = ref.body.groups[0].assignment.assignment_id;
    expect((await call(a, "POST", `${g}/0/assignment`, { club_id: null })).body.code).toBe("STALE_DECISION");
    expect((await call(a, "POST", `${g}/0/assignment`, { club_id: null, supersedes_id: cur0 })).body.code).toBe("CORRECTION_REASON_REQUIRED");
    expect((await call(a, "POST", `${g}/9/assignment`, { club_id: null })).status).toBe(404);
    expect((await call(viewer, "POST", `${g}/0/assignment`, { club_id: null })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(b, "GET", g)).status).toBe(404);
    // a run whose video is not linked to a match: groups can only be "not a team"
    const lone = await seedTracks(db, a, 1);
    await db.query("INSERT INTO track_appearance (track_id, run_id, kit_group, crop_count) VALUES (?, ?, 0, 6)", [lone.trackIds[0], lone.runId]);
    expect((await call(a, "POST", `/v1/analysis-runs/${lone.runId}/kit-groups/0/assignment`, { club_id: m.home.id })).body.code).toBe("NO_MATCH");
  });

  it("show multi-frame shirt-number evidence and record a person's verdict append-only", async () => {
    const m = await seedMatch(a);
    const t = m.s.trackIds[0];
    expect((await call(a, "GET", `/v1/tracks/${t}/jersey`)).body.code).toBe("NOT_MEASURED");
    await db.query("INSERT INTO track_jersey_evidence (track_id, run_id, state, number, confidence, side, candidate_frames, frame_reads, alternatives) VALUES (?, ?, 'RECOGNIZED', '7', 0.83, 'BACK', 4, ?, ?)",
      [t, m.s.runId, JSON.stringify([{ pts_us: 100000, number: "7", confidence: 0.9, texts: ["7"] }, { pts_us: 900000, number: "7", confidence: 0.8, texts: ["7"] }, { pts_us: 1500000, number: "1", confidence: 0.4, texts: ["1"] }]),
       JSON.stringify([{ number: "1", frames: 1, confidence: 0.4 }])]);
    const ev = (await call(a, "GET", `/v1/tracks/${t}/jersey`)).body;
    expect(ev).toMatchObject({ state: "RECOGNIZED", number: "7", side: "BACK", candidate_frames: 4, decision: null, alternatives: [{ number: "1" }] });
    expect(ev.frames).toHaveLength(3);
    expect((await call(a, "POST", `/v1/tracks/${t}/jersey-decisions`, { state: "CONFIRMED" })).status).toBe(422);
    const d = await call(a, "POST", `/v1/tracks/${t}/jersey-decisions`, { state: "CONFIRMED", number: "7" });
    expect(d.body.decision).toMatchObject({ state: "CONFIRMED", number: "7" });
    expect((await call(a, "POST", `/v1/tracks/${t}/jersey-decisions`, { state: "UNREADABLE", supersedes_id: d.body.decision.decision_id })).body.code).toBe("CORRECTION_REASON_REQUIRED");
    const u = await call(a, "POST", `/v1/tracks/${t}/jersey-decisions`, { state: "UNREADABLE", supersedes_id: d.body.decision.decision_id, reason: "it is a 1, folded shirt" });
    expect(u.body.decision).toMatchObject({ state: "UNREADABLE", number: null });
    await expect(db.query("DELETE FROM jersey_number_decisions WHERE track_id = ?", [t])).rejects.toThrow(/APPEND_ONLY/);
    expect((await call(b, "GET", `/v1/tracks/${t}/jersey`)).status).toBe(404);
    expect((await call(viewer, "POST", `/v1/tracks/${t}/jersey-decisions`, { state: "UNREADABLE" })).body.code).toBe("ROLE_NOT_ALLOWED");
  });

  it("combine shirt number, verified roster, team and appearance into ranked suggestions with conflicts, deciding nothing", async () => {
    const m = await seedMatch(a);
    const [t1, t2, t3] = m.s.trackIds as [string, string, string];
    const r = `/v1/matches/${m.match.id}/roster`;
    await call(a, "POST", r, { player_id: m.p7, club_id: m.home.id, jersey_number: 7 });
    await call(a, "POST", r, { player_id: m.q7, club_id: m.away.id, jersey_number: 7 });
    await call(a, "POST", r, { player_id: m.p9, club_id: m.home.id, jersey_number: 9 });
    expect((await call(a, "GET", `/v1/tracks/${t1}/candidates`)).body).toMatchObject({ shirt_number: null, team: null, candidates: [] });   // nothing known: nothing suggested

    await db.query("INSERT INTO track_jersey_evidence (track_id, run_id, state, number, confidence, side, candidate_frames) VALUES (?, ?, 'RECOGNIZED', '7', 0.8, 'BACK', 3)", [t1, m.s.runId]);
    let c = (await call(a, "GET", `/v1/tracks/${t1}/candidates`)).body;
    expect(c.shirt_number).toEqual({ number: "7", source: "RECOGNIZED" });
    expect(c.candidates.map((x: { player_id: string }) => x.player_id).sort()).toEqual([m.p7, m.q7].sort());   // both teams' No. 7: unresolved
    expect(c.candidates[0].strength).toBeCloseTo(0.225, 3);                                                     // 0.45 x 0.5 (roster not verified)
    expect(c.candidates[0].signals[0].detail).toMatch(/roster not verified/);

    await call(a, "POST", `${r}/verify`, { verified: true });
    await call(a, "POST", `/v1/analysis-runs/${m.s.runId}/kit-groups/0/assignment`, { club_id: m.home.id });
    c = (await call(a, "GET", `/v1/tracks/${t1}/candidates`)).body;
    expect(c.team).toMatchObject({ id: m.home.id });
    expect(c.candidates[0]).toMatchObject({ player_id: m.p7, conflicts: [] });
    expect(c.candidates[0].strength).toBeCloseTo(1 - 0.55 * 0.85, 2);                                         // number 0.45 + team 0.15, independent
    const q = c.candidates.find((x: { player_id: string }) => x.player_id === m.q7);
    expect(q.conflicts[0]).toMatch(/plays for/);                                                                 // shown, demoted, not hidden
    expect(q.strength).toBeLessThan(c.candidates[0].strength);

    // the candidate is already confirmed on a track that is on screen at the same time: a conflict
    await call(a, "POST", `/v1/tracks/${t2}/identity-decisions`, { state: "CONFIRMED", player_id: m.p7 });
    c = (await call(a, "GET", `/v1/tracks/${t1}/candidates`)).body;
    expect(c.candidates.find((x: { player_id: string }) => x.player_id === m.p7).conflicts.join(" ")).toMatch(/same time/);

    // look-alike and a suggested link to a confirmed track are both appearance evidence: only the stronger counts
    await db.query("INSERT INTO track_neighbours (track_id, neighbour_id, cosine, kit_similarity, rank_no) VALUES (?, ?, 0.9, 0.8, 1)", [t3, t2]);
    c = (await call(a, "GET", `/v1/tracks/${t3}/candidates`)).body;
    expect(c.candidates[0]).toMatchObject({ player_id: m.p7, signals: [{ kind: "LOOK_ALIKE" }] });
    expect(c.candidates[0].strength).toBeCloseTo(0.18, 3);
    await db.query("INSERT INTO track_links (id, run_id, track_a_id, track_b_id, score, method, crosses_cut, gap_us) VALUES (UUID(), ?, ?, ?, 0.8, 'APPEARANCE', false, 2000000)", [m.s.runId, t2, t3]);
    c = (await call(a, "GET", `/v1/tracks/${t3}/candidates`)).body;
    expect(c.candidates[0].signals.map((s: { kind: string }) => s.kind)).toEqual(["SUGGESTED_LINK"]);
    expect(c.candidates[0].strength).toBeCloseTo(0.28, 3);                                                     // max(0.35 x 0.8, 0.2 x 0.9), not the sum

    const [idState] = await db.query<mysql.RowDataPacket[]>("SELECT identity_state FROM tracks WHERE id IN (?, ?)", [t1, t3]);
    expect(idState.every((x) => x.identity_state !== "CONFIRMED")).toBe(true);                                 // suggestions decided nothing
    expect((await call(b, "GET", `/v1/tracks/${t1}/candidates`)).status).toBe(404);
  });
});
