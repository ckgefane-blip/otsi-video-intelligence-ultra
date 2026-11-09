/**
 * B.7 (ADR-084): the identity impact preview through the real API and MySQL: a reel following the track under its current decision (with a
 * finished render and a live share link) and made PDF reports of the player who loses or gains the track are listed before a decision is
 * saved; an unchanged decision lists nothing; another organization gets 404; a bad query 422.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { impactText } from "@otsi-vie/contracts";
import { createHash } from "node:crypto";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, other: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  other = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("identity impact (B.7)", () => {
  it("lists the reels and made reports a decision would put out of date, before it is saved", async () => {
    const { videoId, trackIds: [t, t2] } = await seedTracks(root, owner, 2);
    const a = (await call(owner, "POST", "/v1/players", { display_name: "Ada Obi" }, { "idempotency-key": key() })).body.player_id as string;
    const b = (await call(owner, "POST", "/v1/players", { display_name: "Bea Eze" }, { "idempotency-key": key() })).body.player_id as string;
    const d = (await call(owner, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: a })).body.decision_id as string;
    // a reel following the track under that decision, rendered and shared; a made PDF report of Ada
    const [[v]] = await root.query<mysql.RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [videoId]);
    const reel = uuidv7(), render = uuidv7(), asset = uuidv7();
    await root.query("INSERT INTO reel_projects (id, organization_id, project_id, video_id, name, created_by, player_id) VALUES (?, ?, ?, ?, 'Ada highlights', ?, ?)", [reel, owner.orgId, v!.project_id, videoId, owner.userId, a]);
    await root.query("INSERT INTO reel_targets (reel_id, track_id, player_id, identity_decision_id) VALUES (?, ?, ?, ?)", [reel, t, a, d]);
    await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'REEL', ?, 'local', 10)", [asset, owner.orgId, v!.project_id, `r/${asset}.mp4`]);
    await root.query("INSERT INTO render_jobs (id, reel_id, organization_id, requested_by, state, config, output_asset_id, idempotency_key) VALUES (?, ?, ?, ?, 'SUCCEEDED', '{}', ?, ?)",
      [render, reel, owner.orgId, owner.userId, asset, key()]);
    await root.query("INSERT INTO share_links (id, organization_id, asset_id, created_by, token_hash) VALUES (?, ?, ?, ?, ?)",
      [uuidv7(), owner.orgId, asset, owner.userId, createHash("sha256").update(uuidv7()).digest("hex")]);
    await root.query("INSERT INTO report_jobs (id, organization_id, project_id, player_id, requested_by, state, report_type) VALUES (?, ?, ?, ?, ?, 'SUCCEEDED', 'PLAYER')",
      [uuidv7(), owner.orgId, v!.project_id, a, owner.userId]);

    const q = (state: string, player?: string, ids = [t]) => `/v1/identity-impact?track_ids=${ids.join(",")}&state=${state}${player ? `&player_id=${player}` : ""}`;
    // taking the name off: the reel goes stale, Ada's report no longer matches
    const off = (await call(owner, "GET", q("UNRESOLVED"))).body;
    expect(off).toMatchObject({ changing_tracks: 1, unchanged_tracks: 0, reels: [{ reel_id: reel, name: "Ada highlights", renders: 1, live_links: 1 }],
      reports: [{ player_id: a, name: "Ada Obi", pdfs: 1, role: "LOSES" }] });
    expect(impactText(off)).toBe("The reel “Ada highlights” will need its targets refreshed before rendering again (it was already rendered, and shared by link); Ada Obi's PDF report will no longer match.");
    // naming him someone else: Bea gains him (no PDFs yet)
    const swap = (await call(owner, "GET", q("CONFIRMED", b))).body;
    expect(swap.reports.map((r: { name: string; role: string }) => [r.name, r.role])).toEqual([["Ada Obi", "LOSES"], ["Bea Eze", "GAINS"]]);
    // the same decision again changes nothing
    expect((await call(owner, "GET", q("CONFIRMED", a))).body).toEqual({ changing_tracks: 0, unchanged_tracks: 1, reels: [], reports: [] });
    // naming the other, unreeled track: only Ada's report changes (she gains it)
    const gain = (await call(owner, "GET", q("CONFIRMED", a, [t2!]))).body;
    expect(gain).toMatchObject({ changing_tracks: 1, reels: [], reports: [{ player_id: a, role: "GAINS", pdfs: 1 }] });
    // once the reel is stale it is not listed again
    await call(owner, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "UNRESOLVED", player_id: null, supersedes_id: d, reason: "not sure any more" });
    expect((await call(owner, "GET", q("CONFIRMED", a))).body.reels).toEqual([]);
    // scope and input
    expect((await call(other, "GET", q("UNRESOLVED"))).status).toBe(404);
    expect((await call(owner, "GET", "/v1/identity-impact?track_ids=nope&state=CONFIRMED")).body.code).toBe("BAD_IMPACT_QUERY");
  });
});
