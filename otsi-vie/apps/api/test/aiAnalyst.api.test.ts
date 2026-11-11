/**
 * AI Analyst HTTP API (ADR-141, ultra-only). Needs the real MySQL schema (migration 0072) and the least-privilege
 * runtime account, so it runs only on the owner's host — it cannot run in this VM (no MySQL 8.4 on 127.0.0.1:3507
 * here). No provider is configured in the test environment, so these tests cover the gates that need no model:
 * the "not configured" status, the identity refusal, the consent requirement, and the minimum-data draft.
 * The provider call, the post-check retry and the publish flow against a live model are covered by the guardrail
 * unit tests (apps/web/test/aiAnalyst.test.ts) and must be exercised on the host with a configured provider.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: mysql.Connection;
let owner: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}
const create = (m: Member, name = "Test Player") => call(m, "POST", "/v1/players", { display_name: name }, { "idempotency-key": key() });
const register = (m: Member, id: string, country = "NGA") => call(m, "POST", `/v1/players/${id}/registration`, { country_code: country }, { "idempotency-key": key() });

async function ledgerSpends(orgId: string): Promise<number> {
  const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM wallet_ledger WHERE organization_id = ? AND kind = 'SPEND'", [orgId]);
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  app = await startApi();
  db = await rootDb();
  owner = await seedMember(db, "OWNER");
});

afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe("AI Analyst status (ADR-141)", () => {
  it("reports 'not configured' with no provider in the environment, and the 10-token cost", async () => {
    const p = (await create(owner, "Status Player")).body.player_id as string;
    const r = await call(owner, "GET", `/v1/players/${p}/ai-analysis/status`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: false, provider: null, model: null, cost_tokens: 10 });
    expect(typeof r.body.privacy_note).toBe("string");
    expect(r.body.privacy_note).toContain("No video");
  });

  it("answers 404 when no assessment exists yet", async () => {
    const p = (await create(owner, "No Assessment Player")).body.player_id as string;
    expect((await call(owner, "GET", `/v1/players/${p}/ai-analysis`)).status).toBe(404);
  });
});

describe("AI Analyst identity gate (ADR-141, scope §5 Rule 4 / §4)", () => {
  it("refuses a provisional player — identity not verified — and charges nothing", async () => {
    const p = (await create(owner, "Provisional Player")).body.player_id as string;
    const spendsBefore = await ledgerSpends(owner.orgId);
    const r = await call(owner, "POST", `/v1/players/${p}/ai-analysis`, { language: "en", consent_acknowledged: true });
    expect([r.status, r.body.code]).toEqual([409, "IDENTITY_UNCONFIRMED"]);
    expect(r.body.message).toContain("identity unconfirmed");
    expect(await ledgerSpends(owner.orgId)).toBe(spendsBefore);
    const [rows] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM ai_analyst_assessments WHERE player_id = ?", [p]);
    expect(Number(rows[0]?.n ?? 0)).toBe(0);
  });

  it("requires the organization's consent before any generation (422 without it)", async () => {
    const p = (await create(owner, "No Consent Player")).body.player_id as string;
    const r = await call(owner, "POST", `/v1/players/${p}/ai-analysis`, { language: "en" });
    expect([r.status, r.body.code]).toEqual([422, "INVALID_REQUEST"]);
  });

  it("stores a NOT_ENOUGH_DATA draft — and charges nothing — for a verified player with too little data", async () => {
    const p = (await create(owner, "Thin Data Player")).body.player_id as string;
    await register(owner, p, "NGA");
    // one track confirmed as him, but no events and no match analysed: below the minimum-data rule.
    // seedTracks writes class_name 'PLAYER'; the identity gate counts 'PERSON' tracks, so fix the fixture row.
    const { trackIds } = await seedTracks(db, owner, 1);
    await db.query("UPDATE tracks SET class_name = 'PERSON' WHERE id = ?", [trackIds[0]]);
    const decision = await call(owner, "POST", `/v1/tracks/${trackIds[0]}/identity-decisions`, { state: "CONFIRMED", player_id: p });
    expect(decision.status).toBe(201);
    const spendsBefore = await ledgerSpends(owner.orgId);
    const r = await call(owner, "POST", `/v1/players/${p}/ai-analysis`, { language: "en", consent_acknowledged: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "DRAFT", confidence_overall: "NOT_ENOUGH_DATA" });
    expect(typeof r.body.not_enough_data_reason).toBe("string");
    expect(r.body.strengths).toEqual([]);
    expect(await ledgerSpends(owner.orgId)).toBe(spendsBefore);
    // a not-enough-data draft has nothing to publish
    const pub = await call(owner, "POST", `/v1/players/${p}/ai-analysis/${r.body.id}/publish`, {});
    expect([pub.status, pub.body.code]).toEqual([409, "AI_ANALYSIS_NOT_READY"]);
  });

  it("answers 404 when publishing or unpublishing an assessment that does not exist", async () => {
    const p = (await create(owner, "Ghost Publish Player")).body.player_id as string;
    const ghost = "11111111-1111-4111-8111-111111111111";
    expect((await call(owner, "POST", `/v1/players/${p}/ai-analysis/${ghost}/publish`, {})).status).toBe(404);
    expect((await call(owner, "POST", `/v1/players/${p}/ai-analysis/${ghost}/unpublish`, {})).status).toBe(404);
  });
});
