/** Broadcast lineup cards (ADR-039) through the real API and MySQL: reading starts by itself once per video or on request, a person's
 * approval turns the cards into clubs, a match, players and the roster, and nothing crosses organizations. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { publish } from "../src/core/outbox/publish";
import { autoLineupsStarter, lineupsJobStarter } from "../src/core/outbox/subscribers";
import { appDb, key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member, viewer: Member, b: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function seedVideo(m: Member): Promise<string> {
  const project = uuidv7(), video = uuidv7(), source = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, width, height, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, 1280, 720, ?, ?)", [video, m.orgId, project, m.userId, source]);
  return video;
}

/** a finished read with two cards, as the worker leaves them */
async function seedCards(m: Member, video: string, home: string, away: string) {
  const read = uuidv7(), h = uuidv7(), w = uuidv7();
  await root.query("INSERT INTO lineup_reads (id, organization_id, video_id, status) VALUES (?, ?, ?, 'SUCCEEDED')", [read, m.orgId, video]);
  const rows = (names: string[]) => JSON.stringify(names.map((n, i) => ({ number: String(i + 1), name: n, role: i < 2 ? "STARTER" : "SUBSTITUTE", confidence: 0.98 })));
  await root.query("INSERT INTO lineup_cards (id, organization_id, read_id, video_id, pts_us, team_name, coach_name, entries) VALUES (?, ?, ?, ?, 1000000, ?, 'COACH A', ?), (?, ?, ?, ?, 9000000, ?, 'COACH B', ?)",
    [h, m.orgId, read, video, home, rows(["ALPHA ONE", "ALPHA TWO", "ALPHA THREE"]), w, m.orgId, read, video, away, rows(["BETA ONE", "BETA TWO"])]);
  return { read, h, w };
}

beforeAll(async () => {
  app = await startApi({});
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await db?.onModuleDestroy(); await root?.end(); });

describe("lineup cards", () => {
  it("are read by themselves once per video when an analysis finishes, and on request", async () => {
    const video = await seedVideo(a);
    expect((await call(a, "GET", `/v1/videos/${video}/lineups`)).body).toMatchObject({ read: null, cards: [], match_id: null });
    for (const k of [1, 2]) {
      const run = uuidv7();
      await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'SUCCEEDED')", [run, video, a.orgId]);
      await publish(root as never, { organizationId: a.orgId, aggregateType: "analysis_run", aggregateId: run, eventType: "analysis.completed", payload: { run_id: run, video_id: video }, dedupeKey: `t:${run}:${k}` });
    }
    const d = new OutboxDispatcher(db, [lineupsJobStarter(), autoLineupsStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [reads] = await root.query<RowDataPacket[]>("SELECT id, requested_by FROM lineup_reads WHERE video_id = ?", [video]);
    expect(reads).toHaveLength(1);                                                   // two analyses, one read: a video's cards do not change
    expect((await call(a, "GET", `/v1/videos/${video}/lineups`)).body.read).toMatchObject({ status: "QUEUED", automatic: true });
    expect((await call(a, "POST", `/v1/videos/${video}/lineups`)).body.code).toBe("LINEUPS_BEING_READ");
    await root.query("UPDATE lineup_reads SET status = 'SUCCEEDED' WHERE id = ?", [reads[0]!.id]);
    const again = await call(a, "POST", `/v1/videos/${video}/lineups`);
    expect(again.status).toBe(202);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind FROM worker_jobs WHERE subject_id = ?", [again.body.read.id]);
    expect(jobs).toEqual([{ kind: "READ_LINEUPS" }]);
    expect((await call(viewer, "POST", `/v1/videos/${video}/lineups`)).status).toBe(403);
    expect((await call(b, "GET", `/v1/videos/${video}/lineups`)).status).toBe(404);
  });

  it("an approval creates the clubs, the match and the players and fills the roster; a known player is found; a clash is reported", async () => {
    const video = await seedVideo(a);
    const home = `Home ${uuidv7().slice(-6)}`, away = `Away ${uuidv7().slice(-6)}`;
    const c = await seedCards(a, video, home, away);
    const listed = (await call(a, "GET", `/v1/videos/${video}/lineups`)).body;
    expect(listed.cards.map((x: { team_name: string; entries: unknown[] }) => [x.team_name, x.entries.length])).toEqual([[home, 3], [away, 2]]);
    // a player already in the registry under that exact name is used, not duplicated
    const known = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: `Beta Known ${home}` } })).body).player_id;
    expect((await call(a, "POST", `/v1/videos/${video}/lineups/apply`, { cards: [{ card_id: c.h, side: "HOME", team_name: home, entries: [{ number: 1, name: "Alpha One", role: "STARTER" }] }] })).body.code)
      .toBe("BOTH_TEAMS_NEEDED");
    const r = await call(a, "POST", `/v1/videos/${video}/lineups/apply`, { cards: [
      { card_id: c.h, side: "HOME", team_name: home, entries: [{ number: 1, name: "Alpha One", role: "STARTER" }, { number: 2, name: "Alpha Two", role: "STARTER" }, { number: 2, name: "Alpha Clash", role: "SUBSTITUTE" }] },
      { card_id: c.w, side: "AWAY", team_name: away, entries: [{ number: 1, name: `beta known ${home}`, role: "STARTER" }, { number: 7, name: "Beta Two", role: "SUBSTITUTE" }] },
    ] });
    expect(r.status).toBe(201);
    expect(r.body.match).toMatchObject({ home: { name: home }, away: { name: away }, video_ids: [video] });
    expect(r.body.rows.map((x: { name: string; outcome: string }) => [x.name, x.outcome])).toEqual([
      ["Alpha One", "CREATED"], ["Alpha Two", "CREATED"], ["Alpha Clash", "FAILED"], [`beta known ${home}`, "FOUND"], ["Beta Two", "CREATED"]]);
    expect(r.body.rows.find((x: { outcome: string }) => x.outcome === "FOUND").player_id).toBe(known);
    expect(r.body.rows.find((x: { outcome: string }) => x.outcome === "FAILED").message).toMatch(/number/i);
    const roster = r.body.match.roster.map((e: { display_name: string; jersey_number: number; role: string; canonical_otsi_id: string | null }) => [e.display_name, e.jersey_number, e.role, e.canonical_otsi_id]);
    expect(roster).toEqual(expect.arrayContaining([["Alpha One", 1, "STARTER", null], ["Beta Two", 7, "SUBSTITUTE", null]]));
    expect(roster).toHaveLength(4);
    const after = (await call(a, "GET", `/v1/videos/${video}/lineups`)).body;
    expect(after.match_id).toBe(r.body.match.id);
    expect(after.cards.map((x: { state: string }) => x.state)).toEqual(["APPLIED", "APPLIED"]);
    expect((await call(a, "POST", `/v1/lineup-cards/${c.h}/dismiss`)).body.code).toBe("LINEUP_ALREADY_APPLIED");
    expect((await call(viewer, "POST", `/v1/videos/${video}/lineups/apply`, { cards: [{ card_id: c.h, side: "HOME", team_name: home, entries: [{ number: 9, name: "X Y", role: "STARTER" }] }] })).status).toBe(403);
    expect((await call(b, "POST", `/v1/lineup-cards/${c.w}/dismiss`)).status).toBe(404);
    expect((await call(a, "GET", `/v1/lineup-cards/${c.h}/image`)).status).toBe(404);              // no frame stored in this test
  });

  it("with a match already linked, one card fills its side; a card can be dismissed", async () => {
    const video = await seedVideo(a);
    const c = await seedCards(a, video, `H ${uuidv7().slice(-6)}`, `A ${uuidv7().slice(-6)}`);
    const mkClub = async (n: string) => (await call(a, "POST", "/v1/clubs", { name: n })).body.id as string;
    const hc = await mkClub(`Linked Home ${uuidv7().slice(-6)}`), ac = await mkClub(`Linked Away ${uuidv7().slice(-6)}`);
    const m = (await call(a, "POST", "/v1/matches", { home_club_id: hc, away_club_id: ac, video_id: video })).body;
    const r = await call(a, "POST", `/v1/videos/${video}/lineups/apply`, { cards: [{ card_id: c.w, side: "AWAY", team_name: "ignored: the match has its teams", entries: [{ number: 10, name: "Solo Player", role: "STARTER" }] }] });
    expect(r.body.match.id).toBe(m.id);
    expect(r.body.match.roster).toEqual([expect.objectContaining({ display_name: "Solo Player", club_id: ac, jersey_number: 10 })]);
    expect((await call(a, "POST", `/v1/lineup-cards/${c.h}/dismiss`)).status).toBe(204);
    expect((await call(a, "GET", `/v1/videos/${video}/lineups`)).body.cards.map((x: { state: string }) => x.state)).toEqual(["DISMISSED", "APPLIED"]);
  });
});

describe("lineup names across alphabets", () => {
  it("a Cyrillic name on the card finds the player already registered in Latin letters", async () => {
    const video = await seedVideo(a);
    const c = await seedCards(a, video, `Хозяева ${uuidv7().slice(-5)}`, `Гости ${uuidv7().slice(-5)}`);
    const tag = uuidv7().slice(-6).replace(/\d/g, "x");                              // letters only: part of the name
    const latin = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: `Chinazom Godwin${tag}` } })).body).player_id;
    const cyr = `ЧИНАЗОМ ГОДВИН${tag.toUpperCase().replace(/[A-Z]/g, (ch) => ({ A: "А", B: "Б", C: "Ц", D: "Д", E: "Е", F: "Ф", X: "КС" } as Record<string, string>)[ch] ?? ch)}`;
    const r = await call(a, "POST", `/v1/videos/${video}/lineups/apply`, { cards: [
      { card_id: c.h, side: "HOME", team_name: "Хозяева", entries: [{ number: 4, name: cyr, role: "STARTER" }] },
      { card_id: c.w, side: "AWAY", team_name: "Гости", entries: [{ number: 9, name: "ДРУГОЙ ИГРОК", role: "STARTER" }] }] });
    expect(r.body.rows[0]).toMatchObject({ outcome: "FOUND", player_id: latin });
    expect(r.body.rows[0].message).toMatch(/same name/);
    expect(r.body.rows[1]).toMatchObject({ outcome: "CREATED" });
  });
});

describe("naming tracks from shirt numbers", () => {
  it("propose the roster player for each read number: ticked only with a known kit team, a clear read and no clash", async () => {
    // eight person tracks: kit 0 = home, kit 1 = away, kit 2 = referees; numbers as read
    const s = await seedTracks(root, a, 8);
    const T = s.trackIds;
    const spec: [number, number, number | null, string, string][] = [   // [first s, last s, kit, state, number]
      [0, 5, 0, "RECOGNIZED", "4"],     // home No. 4: ticked
      [10, 15, 1, "RECOGNIZED", "4"],   // away No. 4: ticked (the kit decides between the two No. 4s)
      [20, 25, null, "RECOGNIZED", "4"],// no kit: both teams have a No. 4 -> no player
      [30, 35, null, "RECOGNIZED", "9"],// no kit, only home has No. 9 -> proposed, not ticked
      [40, 45, 0, "UNCERTAIN", "7"],    // uncertain read -> proposed, not ticked
      [50, 55, 0, "RECOGNIZED", "8"],   // home No. 8 ...
      [52, 58, 0, "RECOGNIZED", "8"],   // ... read twice on screen at once: both unticked
      [60, 65, 2, "RECOGNIZED", "4"],   // a referee's kit: not a team
    ];
    for (const [i, [f, l, kit, st, num]] of spec.entries()) {
      await root.query("UPDATE tracks SET class_name = 'PERSON', first_pts_us = ?, last_pts_us = ? WHERE id = ?", [f * 1e6, l * 1e6, T[i]]);
      await root.query("INSERT INTO track_appearance (track_id, run_id, kit_group, kit_rgb, crop_count, drift_score) VALUES (?, ?, ?, '#FFFFFF', 3, 0.9)", [T[i], s.runId, kit]);
      await root.query("INSERT INTO track_jersey_evidence (track_id, run_id, state, number, confidence) VALUES (?, ?, ?, ?, 0.95)", [T[i], s.runId, st, num]);
    }
    const url = `/v1/analysis-runs/${s.runId}/number-proposals`;
    expect((await call(a, "GET", url)).body).toMatchObject({ match_id: null });
    expect((await call(a, "GET", url)).body.proposals.every((x: { player: unknown }) => x.player === null)).toBe(true);    // no roster yet
    const club = async (n: string) => (await call(a, "POST", "/v1/clubs", { name: `${n} ${uuidv7().slice(-6)}` })).body.id as string;
    const home = await club("Home"), away = await club("Away");
    const m = (await call(a, "POST", "/v1/matches", { home_club_id: home, away_club_id: away, video_id: s.videoId })).body;
    const mk = async (n: string) => JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: n } })).body).player_id as string;
    const P = { h4: await mk("Home Four"), a4: await mk("Away Four"), h9: await mk("Home Nine"), h7: await mk("Home Seven"), h8: await mk("Home Eight") };
    for (const [pid, c, n] of [[P.h4, home, 4], [P.a4, away, 4], [P.h9, home, 9], [P.h7, home, 7], [P.h8, home, 8]] as [string, string, number][]) {
      await call(a, "POST", `/v1/matches/${m.id}/roster`, { player_id: pid, club_id: c, jersey_number: n });
    }
    for (const [g, c] of [[0, home], [1, away], [2, null]] as [number, string | null][]) await call(a, "POST", `/v1/analysis-runs/${s.runId}/kit-groups/${g}/assignment`, { club_id: c });
    const got = (await call(a, "GET", url)).body;
    expect(got.kits_unassigned).toBe(0);
    const by = (i: number) => got.proposals.find((x: { track_id: string }) => x.track_id === T[i]);
    expect(by(0)).toMatchObject({ player: { player_id: P.h4 }, team: { club_id: home, from: "KIT" }, accept: true });
    expect(by(1)).toMatchObject({ player: { player_id: P.a4 }, team: { club_id: away, from: "KIT" }, accept: true });
    expect(by(2)).toMatchObject({ player: null, accept: false });
    expect(by(2).note).toMatch(/Both teams/);
    expect(by(3)).toMatchObject({ player: { player_id: P.h9 }, team: { from: "ROSTER" }, accept: false });
    expect(by(4)).toMatchObject({ player: { player_id: P.h7 }, shirt: { source: "UNCERTAIN" }, accept: false });
    expect([by(5).accept, by(6).accept]).toEqual([false, false]);
    expect(by(5).note).toMatch(/same time/);
    expect(by(7)).toMatchObject({ player: null, accept: false });
    expect(by(7).note).toMatch(/not a team/);
    // a named track leaves the list; "not him" removes the proposal
    await call(a, "POST", `/v1/tracks/${T[0]}/identity-decisions`, { state: "CONFIRMED", player_id: P.h4 });
    await call(a, "POST", `/v1/tracks/${T[1]}/identity-decisions`, { state: "REJECTED", player_id: P.a4 });
    const after = (await call(a, "GET", url)).body;
    expect(after.proposals.some((x: { track_id: string }) => x.track_id === T[0])).toBe(false);
    expect(after.proposals.find((x: { track_id: string }) => x.track_id === T[1])).toMatchObject({ player: null, accept: false });
    expect((await call(b, "GET", url)).status).toBe(404);
    expect((await call(viewer, "GET", url)).status).toBe(200);
  });
});

describe("named players of a run", () => {
  it("lists every player named on the run's tracks with a count, beyond any page of the track list", async () => {
    const s = await seedTracks(root, a, 3);
    const p = JSON.parse((await app.inject({ method: "POST", url: "/v1/players", headers: { ...a.headers, "idempotency-key": key() }, payload: { display_name: "Named Twice" } })).body).player_id;
    for (const t of s.trackIds.slice(0, 2)) {
      await root.query("UPDATE tracks SET class_name = 'PERSON' WHERE id = ?", [t]);
      await call(a, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: p });
    }
    const r = (await call(a, "GET", `/v1/analysis-runs/${s.runId}/named-players`)).body;
    expect(r).toEqual([expect.objectContaining({ player_id: p, display_name: "Named Twice", tracks: 2 })]);
    expect((await call(b, "GET", `/v1/analysis-runs/${s.runId}/named-players`)).status).toBe(404);
  });
});
