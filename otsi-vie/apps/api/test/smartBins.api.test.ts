/**
 * B.11 (ADR-087): Smart Bins through the real API and MySQL: a bin is a person's saved Smart Search that fills itself (a new event is in
 * it at once); it is not one of the Library's saved searches and their names never overwrite each other; unknown filters and empty
 * searches are refused; ?video= narrows its items; another person and another organization cannot read or delete it.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, colleague: Member, other: Member;

async function call(m: Member, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  colleague = await seedMember(root, "ANALYST", owner.orgId);
  other = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Smart Bins (B.11)", () => {
  it("saves a search that fills itself, apart from the Library's saved searches", async () => {
    const { videoId, runId, trackIds: [t1] } = await seedTracks(root, owner, 1);
    const second = await seedTracks(root, owner, 1);
    const ball = uuidv7(), ball2 = uuidv7();
    for (const [b, v, r] of [[ball, videoId, runId], [ball2, second.videoId, second.runId]] as const)
      await root.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id, status, finished_at) VALUES (?, ?, ?, ?, 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [b, owner.orgId, v, r]);
    const goal = (b: string, v: string, r: string, s: number, t: string | null) => root.query(`INSERT INTO event_candidates (id, run_id, video_id, ball_track_id, event_type, start_pts_us, end_pts_us, primary_track_id, kit_group, confidence, evidence_state, features)
      VALUES (?, ?, ?, ?, 'GOAL', ?, ?, ?, 0, 0.9, 'DETECTED', '{}')`, [uuidv7(), r, v, b, s * 1e6, (s + 5) * 1e6, t]);
    await goal(ball, videoId, runId, 100, t1!);

    // refused: no criteria, a filter not understood, a missing name
    expect((await call(owner, "POST", "/v1/smart-bins", { name: "x", q: "%%" })).body.code).toBe("BAD_BIN_QUERY");
    const bad = (await call(owner, "POST", "/v1/smart-bins", { name: "x", q: "event:goal is:great" })).body;
    expect(bad).toMatchObject({ code: "BAD_BIN_QUERY" });
    expect(bad.detail ?? bad.message ?? JSON.stringify(bad)).toContain("is:great");
    expect((await call(owner, "POST", "/v1/smart-bins", { name: "", q: "event:goal" })).status).toBe(422);

    const made = await call(owner, "POST", "/v1/smart-bins", { name: "Goals", q: "event:goal" });
    expect(made.status).toBeLessThan(300);
    expect(made.body).toMatchObject({ name: "Goals", q: "event:goal", count: 1, more: false });
    const id = made.body.id as string;

    // it fills itself: a new goal is in it at once
    await goal(ball2, second.videoId, second.runId, 30, null);
    expect((await call(owner, "GET", "/v1/smart-bins")).body).toEqual([expect.objectContaining({ id, count: 2 })]);
    const items = (await call(owner, "GET", `/v1/smart-bins/${id}/items`)).body;
    expect(items.hits.map((h: { kind: string }) => h.kind)).toEqual(["MOMENT", "MOMENT"]);
    const one = (await call(owner, "GET", `/v1/smart-bins/${id}/items?video=${videoId}`)).body;
    expect(one.hits.map((h: { video_id: string; at_us: number }) => [h.video_id, h.at_us])).toEqual([[videoId, 100_000_000]]);

    // saving the same name again replaces its query
    expect((await call(owner, "POST", "/v1/smart-bins", { name: "Goals", q: "event:goal is:confirmed" })).body).toMatchObject({ id, count: 0 });

    // apart from the Library's saved searches, and their names never overwrite each other
    expect((await call(owner, "GET", "/v1/saved-searches")).body).toEqual([]);
    expect((await call(owner, "POST", "/v1/saved-searches", { name: "Goals", query: { tab: 0 } })).body.code).toBe("NAME_TAKEN");
    expect((await call(owner, "POST", "/v1/saved-searches", { name: "Mine", query: { tab: 1 } })).status).toBeLessThan(300);
    expect((await call(owner, "POST", "/v1/smart-bins", { name: "Mine", q: "goal" })).body.code).toBe("NAME_TAKEN");
    expect((await call(owner, "POST", "/v1/saved-searches", { name: "Sneaky", query: { smart: "goal" } })).status).toBe(422);
    expect((await call(owner, "GET", "/v1/smart-bins")).body.map((b: { name: string }) => b.name)).toEqual(["Goals"]);

    // a person's own: a colleague and another organization neither see, read nor delete it
    expect((await call(colleague, "GET", "/v1/smart-bins")).body).toEqual([]);
    expect((await call(colleague, "GET", `/v1/smart-bins/${id}/items`)).status).toBe(404);
    expect((await call(other, "DELETE", `/v1/smart-bins/${id}`)).status).toBe(404);
    expect((await call(owner, "DELETE", `/v1/saved-searches/${id}`)).status).toBe(404);          // not through the Library's endpoint
    expect((await call(owner, "DELETE", `/v1/smart-bins/${id}`)).status).toBe(204);
    expect((await call(owner, "GET", "/v1/smart-bins")).body).toEqual([]);
  });
});
