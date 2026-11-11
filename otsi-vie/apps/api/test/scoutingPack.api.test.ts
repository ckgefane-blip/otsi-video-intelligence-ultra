/**
 * Scouting Pack HTTP API (ADR-142, ultra-only). Needs the real MySQL schema (migration 0073) and the
 * least-privilege runtime account, so it runs only on the owner's host — it cannot run in this VM (no MySQL 8.4
 * on 127.0.0.1:3507 here). These tests cover the gates that need no render: an unknown reel or player is refused
 * before any token moves, and listing a player with no Packs is empty. The full build — charge 10, report made
 * with charge: false, published brief in the ZIP, draft brief excluded, refund on build failure, ZIP contents
 * against the manifest — needs a finished render and a player report, so it must be exercised on the host with
 * real footage. The manifest logic itself is unit-tested without MySQL in apps/web/test/scoutingPack.test.ts.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: mysql.Connection;
let owner: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const createPlayer = (m: Member, name = "Pack Player") => call(m, "POST", "/v1/players", { display_name: name }, { "idempotency-key": key() });

async function ledgerSpends(orgId: string): Promise<number> {
  const [rows] = await db.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM wallet_ledger WHERE organization_id = ? AND kind = 'SPEND'", [orgId]);
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  app = await startApi();
  db = await rootDb();
  owner = await seedMember(db, "OWNER");
});

afterAll(async () => {
  await app.close();
  await db.end();
});

describe("Scouting Pack API", () => {
  it("lists no Packs for a new player", async () => {
    const created = await createPlayer(owner);
    expect(created.status).toBe(201);
    const playerId = created.body.id as string;
    const list = await call(owner, "GET", `/v1/players/${playerId}/scouting-packs`);
    expect(list.status).toBe(200);
    expect(list.body).toEqual([]);
  });

  it("refuses an unknown reel before any token moves", async () => {
    const created = await createPlayer(owner);
    const playerId = created.body.id as string;
    const before = await ledgerSpends(owner.orgId);
    const r = await call(owner, "POST", `/v1/players/${playerId}/scouting-packs`, { reel_id: randomUUID(), include_report: true, include_analyst_brief: true });
    expect(r.status).toBe(404);
    expect(await ledgerSpends(owner.orgId)).toBe(before);
  });

  it("refuses an unknown player", async () => {
    const r = await call(owner, "POST", `/v1/players/${randomUUID()}/scouting-packs`, { reel_id: randomUUID() });
    expect(r.status).toBe(404);
    const list = await call(owner, "GET", `/v1/players/${randomUUID()}/scouting-packs`);
    expect(list.status).toBe(404);
  });

  it("refuses an unknown Pack id for a real player", async () => {
    const created = await createPlayer(owner);
    const playerId = created.body.id as string;
    const r = await call(owner, "GET", `/v1/players/${playerId}/scouting-packs/${randomUUID()}`);
    expect(r.status).toBe(404);
  });
});
