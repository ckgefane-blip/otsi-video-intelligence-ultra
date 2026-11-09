/**
 * B.12 (ADR-088): the Library table's facts through the real API and MySQL: rights (state, uses, why locked), evidence (analysed,
 * tracks, person-confirmed tracks of the latest finished run) and profile (the latest run's, else the upload's choice); another
 * organization sees none of it.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedRights, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, other: Member;
async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => { app = await startApi(); root = await rootDb(); owner = await seedMember(root, "OWNER"); other = await seedMember(root, "OWNER"); });
afterAll(async () => { await app?.close(); await root?.end(); });

describe("Library facts (B.12)", () => {
  it("rights, evidence and profile of each video, from recorded rows only", async () => {
    const a = await seedTracks(root, owner, 3), b = await seedTracks(root, owner, 1);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = CURRENT_TIMESTAMP(6), config = JSON_OBJECT('profile', 'HIGH_ACCURACY') WHERE id = ?", [a.runId]);
    await seedRights(root, owner.orgId, a.videoId);
    await seedRights(root, owner.orgId, b.videoId, ["VIEW"]);
    const pl = (await call(owner, "POST", "/v1/players", { display_name: "Ada Obi" }, { "idempotency-key": key() })).body.player_id as string;
    await call(owner, "POST", `/v1/tracks/${a.trackIds[0]}/identity-decisions`, { state: "CONFIRMED", player_id: pl });
    const f = (await call(owner, "GET", "/v1/library/facts")).body.videos as { video_id: string }[];
    const fa = f.find((x) => x.video_id === a.videoId), fb = f.find((x) => x.video_id === b.videoId);
    expect(fa).toEqual({ video_id: a.videoId, rights: { state: "INTERNAL", uses: ["VIEW", "ANALYZE", "PRODUCE"], produce_block: null, analyse_block: null },
      analysed: true, tracks: 3, confirmed_tracks: 1, profile: "HIGH_ACCURACY" });
    expect(fb).toMatchObject({ analysed: false, tracks: 0, confirmed_tracks: 0, profile: null,
      rights: { state: "INTERNAL", uses: ["VIEW"], produce_block: "This video's rights do not allow analysis.", analyse_block: "This video's rights do not allow analysis." } });
    expect((await call(other, "GET", "/v1/library/facts")).body.videos).toEqual([]);
  });
});
