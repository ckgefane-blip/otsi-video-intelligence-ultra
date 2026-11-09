/**
 * v3 Phase E.8 (ADR-122): Player roles confirmed by a person.
 *
 * Rules:
 *  - Player role/position can be proposed or provisional, but filtering in players list,
 *    global search, and reports requires confirmed roles only.
 *  - Role confirmation metadata (confirmed_by, confirmed_at, confirmation_state) is audited.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member;

async function call(m: Member, method: "GET" | "POST" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("Roles confirmed by person (ADR-122 / Phase E.8)", () => {
  it("tracks role confirmation state, analyst metadata, and filters exclusively by confirmed roles", async () => {
    // 1. Create two players: Player One and Player Two
    const p1 = (await call(owner, "POST", "/v1/players", { display_name: "Luka Modric" }, { "idempotency-key": key() })).body.player_id as string;
    const p2 = (await call(owner, "POST", "/v1/players", { display_name: "Toni Kroos" }, { "idempotency-key": key() })).body.player_id as string;

    // 2. Set Modric's position to CM with confirmation (default when analyst sets position)
    const prof1 = (await call(owner, "PATCH", `/v1/players/${p1}/profile`, { position: "CM", confirm_role: true })).body;
    expect(prof1.position).toBe("CM");
    expect(prof1.role_confirmed).toBe(true);
    expect(prof1.role_confirmation_state).toBe("ROLE_CONFIRMED");
    expect(prof1.role_confirmed_by).toBe(owner.userId);
    expect(prof1.role_confirmed_at).toBeTruthy();

    // 3. Set Kroos's position to CM as provisional (confirm_role: false)
    const prof2 = (await call(owner, "PATCH", `/v1/players/${p2}/profile`, { position: "CM", confirm_role: false })).body;
    expect(prof2.position).toBe("CM");
    expect(prof2.role_confirmed).toBe(false);
    expect(prof2.role_confirmation_state).toBe("ROLE_PROVISIONAL");

    // 4. GET /v1/players?role=CM must return ONLY confirmed roles (Modric, NOT Kroos)
    const searchRes = (await call(owner, "GET", "/v1/players?role=CM")).body;
    const playerIds = searchRes.map((p: { player_id: string }) => p.player_id);
    expect(playerIds).toContain(p1);
    expect(playerIds).not.toContain(p2);

    // 5. GET /v1/player-list?role=CM must return ONLY Modric
    const listRes = (await call(owner, "GET", "/v1/player-list?role=CM")).body;
    const listIds = listRes.map((p: { player_id: string }) => p.player_id);
    expect(listIds).toContain(p1);
    expect(listIds).not.toContain(p2);

    // 6. Confirm Kroos's role explicitly
    const prof2Confirmed = (await call(owner, "PATCH", `/v1/players/${p2}/profile`, { confirm_role: true })).body;
    expect(prof2Confirmed.role_confirmed).toBe(true);
    expect(prof2Confirmed.role_confirmation_state).toBe("ROLE_CONFIRMED");

    // 7. Now both are returned in role filter
    const listResAfter = (await call(owner, "GET", "/v1/player-list?role=CM")).body;
    const listIdsAfter = listResAfter.map((p: { player_id: string }) => p.player_id);
    expect(listIdsAfter).toContain(p1);
    expect(listIdsAfter).toContain(p2);

    // 8. Global smart search: search with role:cm
    const smartSearchRes = (await call(owner, "GET", "/v1/search?q=role:cm")).body;
    const searchHits = smartSearchRes.hits.map((h: { id: string }) => h.id);
    expect(searchHits).toContain(p1);
    expect(searchHits).toContain(p2);
  });
});
