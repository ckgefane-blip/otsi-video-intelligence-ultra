/**
 * B.10 (ADR-086, migration 0055): Smart Search over the search index, through the real API and MySQL. The engine's moments are found by
 * event and by the confirmed player's name (accents and case ignored, Cyrillic too), markers by their words; a rename that published no
 * event is still found (the catch-up); filters narrow; a rejected event, a removed marker and a removed video drop out; another
 * organization finds nothing.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, other: Member;

type Hit = { kind: string; id: string; title: string; detail: string | null; ref: string | null; video_id?: string | null; at_us?: number | null };
async function call(m: Member, method: "GET" | "POST" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const find = async (m: Member, q: string) => ((await call(m, "GET", `/v1/search?q=${encodeURIComponent(q)}`)).body as { hits: Hit[] }).hits;

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  other = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Smart Search (B.10)", () => {
  it("finds moments, markers and renamed videos from the index, with filters and access", async () => {
    const { videoId, runId, trackIds: [t1, t2] } = await seedTracks(root, owner, 2);
    await root.query("UPDATE video_sources SET title = 'Ерцаху Ёлка final' WHERE id = ?", [videoId]);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED' WHERE id = ?", [runId]);
    const ball = uuidv7(), goal = uuidv7(), pass = uuidv7(), tackle = uuidv7();
    await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [ball, owner.orgId, videoId, runId]);
    const ev = (id: string, kind: string, s: number, a: string | null, b: string | null) =>
      root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, secondary_track_id, kit_group, confidence, evidence_state, features)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0.8, 'DETECTED', '{}')`, [id, runId, videoId, ball, kind, s * 1e6, (s + 1) * 1e6, a, b]);
    await ev(goal, "GOAL", 125, t1!, null);
    await ev(pass, "PASS", 60, t2!, t1!);
    await ev(tackle, "TACKLE", 70, t2!, null);
    await ev(uuidv7(), "POSSESSION", 61, t1!, null);                                   // possession spans are not moments

    // the first search builds the index: the goal by its event word, at its time, with the track number while nobody is named
    let hits = await find(owner, "goal");
    expect(hits).toEqual([{ kind: "MOMENT", id: goal, title: "Goal · 2:05", detail: "track 1 · Ерцаху Ёлка final", ref: null, video_id: videoId, at_us: 125_000_000, period: null }]);
    expect((await find(owner, "елка")).map((h) => h.kind)).toEqual(["MATCH", "MOMENT", "MOMENT", "MOMENT"]);   // accents removed, Cyrillic words
    expect(await find(owner, "possession")).toEqual([]);

    // a person confirms track 1: his moments carry his name, found without accents, in any order
    const pl = (await call(owner, "POST", "/v1/players", { display_name: "José Núñez" }, { "idempotency-key": key() })).body.player_id as string;
    expect((await call(owner, "POST", `/v1/tracks/${t1}/identity-decisions`, { state: "CONFIRMED", player_id: pl })).status).toBeLessThan(300);
    hits = await find(owner, "nunez goal");
    expect(hits.map((h) => [h.kind, h.id, h.detail])).toEqual([["MOMENT", goal, "José Núñez · Ерцаху Ёлка final"]]);
    expect((await find(owner, "event:pass jose")).map((h) => [h.id, h.detail])).toEqual([[pass, "track 2 → José Núñez · Ерцаху Ёлка final"]]);
    expect((await find(owner, "jos")).map((h) => h.kind)).toEqual(["PLAYER", "MOMENT", "MOMENT"]);
    expect((await find(owner, "is:confirmed type:moment")).map((h) => h.id)).toEqual([goal]);     // only the goal's player is confirmed

    // a person rejects the tackle: it is no longer a moment
    await root.query("INSERT INTO event_decisions (id, event_id, decision, reviewer_id, reason, decided_at) VALUES (?, ?, 'REJECT', ?, 'no', CURRENT_TIMESTAMP(6))", [uuidv7(), tackle, owner.userId]);
    expect(await find(owner, "tackle")).toEqual([]);

    // E.5: match periods and cross-match period search
    // Pass is at 60s (H1), Goal is at 125s (H2)
    await root.query(`INSERT INTO match_periods (video_id, organization_id, run_id, state, first_start_us, first_end_us, second_start_us, second_end_us, decided_by, decided_at)
                      VALUES (?, ?, ?, 'CONFIRMED', 0, 80000000, 100000000, 180000000, ?, CURRENT_TIMESTAMP(6))`,
      [videoId, owner.orgId, runId, owner.userId]);
    expect((await find(owner, "period:h1")).map((h) => h.id)).toEqual([pass]);
    expect((await find(owner, "period:h2")).map((h) => h.id)).toEqual([goal]);
    expect((await find(owner, "event:goal period:h2")).map((h) => h.id)).toEqual([goal]);
    expect(await find(owner, "event:goal period:h1")).toEqual([]);
    expect((await find(owner, "player:Jose event:goal period:h2")).map((h) => h.id)).toEqual([goal]);

    // markers by their words, at their time; a removed marker is not found
    const mk = uuidv7();
    await root.query("INSERT INTO video_markers (id, organization_id, video_id, at_pts_us, body, created_by) VALUES (?, ?, ?, 95000000, 'Great pressing by the left back', ?)", [mk, owner.orgId, videoId, owner.userId]);
    expect(await find(owner, "pressing left")).toEqual([expect.objectContaining({ kind: "MARKER", id: mk, title: "Great pressing by the left back", video_id: videoId, at_us: 95_000_000 })]);
    await root.query("UPDATE video_markers SET removed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [mk]);
    expect(await find(owner, "pressing left")).toEqual([]);

    // a rename through the API (audited, no event) is found at once; filters
    expect((await call(owner, "PATCH", `/v1/videos/${videoId}`, { title: "Cup final replay" })).status).toBeLessThan(300);
    expect((await find(owner, "replay")).map((h) => [h.kind, h.title])).toEqual([["MATCH", "Cup final replay"], ["MOMENT", "Pass · 1:00"], ["MOMENT", "Goal · 2:05"]]);
    expect((await find(owner, "replay is:analysed")).map((h) => h.kind)).toEqual(["MATCH"]);
    expect(await find(owner, "replay is:not_analysed")).toEqual([]);
    expect((await find(owner, "type:project")).map((h) => h.kind)).toEqual(["PROJECT"]);
    expect((await find(owner, "type:nonsense replay type:match")).map((h) => h.kind)).toEqual(["MATCH"]);    // a filter not understood is left out

    // another organization finds nothing; a removed video takes its moments with it
    expect(await find(other, "goal")).toEqual([]);
    await root.query("UPDATE video_sources SET removed_at = CURRENT_TIMESTAMP(6), removed_by = ? WHERE id = ?", [owner.userId, videoId]);
    expect(await find(owner, "goal")).toEqual([]);
    const [[st]] = await root.query<mysql.RowDataPacket[]>("SELECT version FROM search_index_state WHERE organization_id = ?", [owner.orgId]);
    expect(st!.version).toBe(2);
  });
});
