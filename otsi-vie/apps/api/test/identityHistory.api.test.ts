/**
 * B.6 (ADR-084): a track's identity history for the Properties card: every decision newest first, who made it, when, why, which is
 * current; a corrected decision stays listed as replaced; another organization gets 404.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
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

describe("identity history (B.6)", () => {
  it("lists every decision on the track, newest first, with who, when, why and which one stands", async () => {
    const { trackIds: [t] } = await seedTracks(root, owner, 1);
    const url = `/v1/tracks/${t}/identity-history`;
    expect((await call(owner, "GET", url)).body).toEqual([]);
    const a = (await call(owner, "POST", "/v1/players", { display_name: "First Guess" }, { "idempotency-key": key() })).body.player_id as string;
    const b = (await call(owner, "POST", "/v1/players", { display_name: "Right Player" }, { "idempotency-key": key() })).body.player_id as string;
    const d1 = await call(owner, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: a });
    expect(d1.status).toBe(201);
    const d2 = await call(owner, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: b, supersedes_id: d1.body.decision_id, reason: "Shirt 9 seen clearly at 12:40" });
    expect(d2.status).toBe(201);
    const h = (await call(owner, "GET", url)).body;
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ decision_id: d2.body.decision_id, state: "CONFIRMED", basis: "HUMAN", current: true, reason: "Shirt 9 seen clearly at 12:40",
      player: { player_id: b, display_name: "Right Player" }, decided_by: { user_id: owner.userId, name: "Test User" }, supersedes_id: d1.body.decision_id });
    expect(h[1]).toMatchObject({ decision_id: d1.body.decision_id, current: false, player: { player_id: a }, reason: null });
    expect(new Date(h[0].decided_at).getTime()).toBeGreaterThanOrEqual(new Date(h[1].decided_at).getTime());
    expect((await call(other, "GET", url)).status).toBe(404);
  });
});
