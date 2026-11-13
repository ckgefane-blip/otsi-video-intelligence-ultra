/**
 * Token Wallet & Credit System (ADR-140, migration 0071) through the real API and MySQL: the pack catalogue,
 * the one-time 25-token free grant, the bank-transfer pack flow (request -> invoice -> confirm receipt -> PURCHASE
 * with the invoice reference), charging at analysis enqueue (1 token per started minute), the 402 refusal when
 * the wallet cannot cover it, the refund when a queued run is cancelled, and the Admin wallet (list, top-up,
 * refund, adjustment with a reason). The ledger is immutable: an UPDATE is refused by its trigger.
 * Needs MySQL 8.4 on 127.0.0.1:3507 (global-setup); it cannot run in this VM without it.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, key, rootDb, seedMember, seedRights, startApi, token } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, viewer: Member;
/** The company organisation (OTSI) and its owner: the only one who may do the company billing actions. */
let company: Member;

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

/** An organization with one ACTIVE member, WITHOUT the test wallet funding seedMember adds. */
async function seedBareMember(role = "OWNER"): Promise<Member> {
  const org = uuidv7(), userId = uuidv7(), subject = `sub-${randomUUID()}`;
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [org, `Org ${org.slice(-6)}`, `org-${org}`]);
  await root.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [userId, subject, `${subject}@test.invalid`, "Test User"]);
  await root.query("INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'ACTIVE')", [org, userId, role]);
  return { userId, subject, orgId: org, role, headers: { authorization: `Bearer ${await token(subject)}`, "x-organization-id": org } };
}

/** An INGESTED 90-minute video the organization may analyse. */
async function seedVideo(m: Member, durationUs = 90 * 60 * 1_000_000): Promise<string> {
  const project = uuidv7(), video = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  // an INGESTED video always has its source file (video_sources.ck_ingested_source_asset)
  const source = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', ?, ?, ?)",
    [video, m.orgId, project, durationUs, m.userId, source]);
  await seedRights(root, m.orgId, video);
  return video;
}

const balance = async (m: Member) => (await call(m, "GET", "/v1/wallet")).body;

beforeAll(async () => {
  root = await rootDb();
  // the company organisation (OTSI): the setting names it, so the API under test runs with it set.
  const companyOrgId = uuidv7();
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [companyOrgId, "OTSI", "otsi-wallet"]);
  company = await seedMember(root, "OWNER", companyOrgId);
  app = await startApi({ companyOrganizationId: companyOrgId });
  owner = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", owner.orgId);
});

afterAll(async () => {
  await app.close();
  await root.end();
});

describe("token wallet", () => {
  it("publishes the pack catalogue: four Naira packs, USD equivalents, free tier and costs", async () => {
    const r = await call(owner, "GET", "/v1/wallet/packs");
    expect(r.status).toBe(200);
    expect(r.body.packs.map((p: { code: string }) => p.code)).toEqual(["STARTER", "CLUB", "ACADEMY", "SEASON"]);
    expect(r.body.packs[0]).toMatchObject({ tokens: 100, price_ngn_minor: 1_500_000, price_usd_minor: 4900 });
    expect(r.body.packs[3]).toMatchObject({ tokens: 3000, price_ngn_minor: 25_000_000, price_usd_minor: 89900 });
    expect(r.body.free_grant_tokens).toBe(25);
    // ADR-141 added the AI Analyst cost (10 tokens, like a player report) to the catalogue; the
    // test must expect it — an exact-equality check, so a new cost field fails it until updated.
    expect(r.body.costs).toEqual({ analysis_per_minute: 1, reel_render: 10, player_report: 10, export_pack: 10, ai_analysis: 10 });
    expect(r.body.low_balance_threshold).toBe(90);
  });

  it("starts at zero with a low-balance warning, and the free grant is 25 tokens, once", async () => {
    const m = await seedBareMember();
    expect(await balance(m)).toMatchObject({ balance: 0, spendable_balance: 0, low_balance: true });
    const grant = await call(m, "POST", "/v1/wallet/free-grant");
    expect(grant.status).toBe(201);
    expect(grant.body).toMatchObject({ kind: "FREE_GRANT", amount: 25, balance_after: 25 });
    // the grant is 25 tokens (ADR-140), so the balance is 25 — and 25 is below the 90-token
    // low-balance threshold, so the warning stays on. The old expectation (100, no warning)
    // was stale from when the grant was briefly 100.
    expect(await balance(m)).toMatchObject({ balance: 25, spendable_balance: 25, low_balance: true });
    expect((await call(m, "POST", "/v1/wallet/free-grant")).body.code).toBe("FREE_GRANT_ALREADY_CLAIMED");
    const ledger = await call(m, "GET", "/v1/wallet/ledger");
    expect(ledger.body.entries).toHaveLength(1);
    expect(ledger.body.entries[0].kind).toBe("FREE_GRANT");
  });

  it("runs the bank-transfer pack flow: request -> invoice -> confirm receipt -> PURCHASE with invoice ref", async () => {
    const m = await seedBareMember();
    const req = await call(m, "POST", "/v1/wallet/packs/request", { pack_code: "CLUB", currency: "NGN" });
    expect(req.status).toBe(201);
    expect(req.body).toMatchObject({ pack_code: "CLUB", currency: "NGN", amount_minor: 6_000_000, tokens: 500, status: "REQUESTED" });
    const invoiced = await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/invoice`, { invoice_ref: "INV-2026-001" });
    expect(invoiced.body).toMatchObject({ status: "INVOICED", invoice_ref: "INV-2026-001" });
    // only the company organisation may confirm receipt (ADR-140 §8): neither another customer's owner
    // nor the pack's own owner can — the pack's own owner confirming it would be free tokens.
    expect((await call(owner, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/confirm-receipt`, { invoice_ref: "INV-2026-001" })).status).toBe(403);
    expect((await call(m, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/confirm-receipt`, { invoice_ref: "INV-2026-001" })).status).toBe(403);
    expect((await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/confirm-receipt`, { invoice_ref: "INV-2026-001" })).status).toBe(201);
    const paid = await call(m, "GET", "/v1/wallet/packs/requests");
    expect(paid.body[0]).toMatchObject({ status: "PAID", invoice_ref: "INV-2026-001" });
    expect(await balance(m)).toMatchObject({ balance: 500, spendable_balance: 500, low_balance: false });
    const ledger = await call(m, "GET", "/v1/wallet/ledger");
    expect(ledger.body.entries[0]).toMatchObject({ kind: "PURCHASE", amount: 500, invoice_ref: "INV-2026-001", balance_after: 500 });
  });

  it("refuses an analysis the wallet cannot cover, with 402 and nothing charged", async () => {
    const m = await seedBareMember();
    const video = await seedVideo(m);
    const r = await call(m, "POST", `/v1/videos/${video}/analysis-runs`, {});
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("INSUFFICIENT_TOKENS");
    expect(await balance(m)).toMatchObject({ balance: 0 });
    expect((await call(m, "GET", `/v1/videos/${video}/analysis-runs`)).body).toEqual([]);
  });

  it("charges 90 tokens for a 90-minute analysis at enqueue, and refunds them when the queued run is cancelled", async () => {
    const m = await seedBareMember();
    await call(m, "POST", "/v1/wallet/free-grant");
    // 25 (free grant) + 100 (top-up) = 125. The old numbers (200 / 110 / 200) assumed a
    // 100-token grant, which the grant no longer is — the grant is 25 (ADR-140).
    const topup = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/topup`, { amount: 100, reason: "Test top-up", invoice_ref: "INV-TEST-1" });
    expect(topup.body).toMatchObject({ kind: "PURCHASE", amount: 100, balance_after: 125 });
    const video = await seedVideo(m);
    const run = await call(m, "POST", `/v1/videos/${video}/analysis-runs`, {});
    expect(run.status).toBe(201);
    // the 90-token charge leaves 35, which is below the 90-token low-balance threshold.
    expect(await balance(m)).toMatchObject({ balance: 35, spendable_balance: 35, low_balance: true });
    const cancelled = await call(m, "POST", `/v1/analysis-runs/${run.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(await balance(m)).toMatchObject({ balance: 125 });
    const ledger = await call(m, "GET", "/v1/wallet/ledger");
    expect(ledger.body.entries.map((e: { kind: string }) => e.kind)).toEqual(["REFUND", "SPEND", "PURCHASE", "FREE_GRANT"]);
  });

  it("lets Admin top up, refund and adjust with a reason, and keeps other organizations and viewers out", async () => {
    const m = await seedBareMember();
    expect((await call(viewer, "GET", "/v1/admin/wallet")).status).toBe(403);
    const wallets = await call(m, "GET", "/v1/admin/wallet");
    expect(wallets.status).toBe(200);
    expect(wallets.body).toHaveLength(1);
    expect(wallets.body[0]).toMatchObject({ organization_id: m.orgId });
    // only the company organisation may top a wallet up (ADR-140 §8): another customer's owner cannot,
    // and neither can the wallet's own owner — a top-up is the company crediting tokens it was paid for.
    expect((await call(owner, "POST", `/v1/admin/wallet/${m.orgId}/topup`, { amount: 10, reason: "x", invoice_ref: "INV-X" })).status).toBe(403);
    expect((await call(m, "POST", `/v1/admin/wallet/${m.orgId}/topup`, { amount: 10, reason: "x", invoice_ref: "INV-X" })).status).toBe(403);
    const topped = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/topup`, { amount: 10, reason: "Company top-up", invoice_ref: "INV-X" });
    expect(topped.body).toMatchObject({ kind: "PURCHASE", amount: 10, balance_after: 10 });
    // refund and adjust are company actions (ADR-140 §8): only the company organisation may do them.
    // The wallet's own owner is refused, and so is another customer's owner; the company owner succeeds.
    expect((await call(m, "POST", `/v1/admin/wallet/${m.orgId}/refund`, { amount: 10, reason: "Goodwill refund" })).status).toBe(403);
    expect((await call(owner, "POST", `/v1/admin/wallet/${m.orgId}/refund`, { amount: 10, reason: "Goodwill refund" })).status).toBe(403);
    const refund = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/refund`, { amount: 10, reason: "Goodwill refund" });
    expect(refund.body).toMatchObject({ kind: "REFUND", amount: 10, balance_after: 20 });
    expect((await call(m, "POST", `/v1/admin/wallet/${m.orgId}/adjust`, { amount: -4, reason: "Claw back" })).status).toBe(403);
    const adjust = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/adjust`, { amount: -4, reason: "Claw back 4 tokens for a refunded payment" });
    expect(adjust.body).toMatchObject({ kind: "ADJUSTMENT", amount: -4, balance_after: 16 });
    // a bad request is refused with 422 INVALID_REQUEST (the API's Zod convention)
    expect((await call(company, "POST", `/v1/admin/wallet/${m.orgId}/adjust`, { amount: 5, reason: "" })).status).toBe(422);
    const adminLedger = await call(m, "GET", `/v1/admin/wallet/${m.orgId}/ledger`);
    expect(adminLedger.body.balance).toMatchObject({ balance: 16 });
    expect((await call(viewer, "GET", `/v1/admin/wallet/${m.orgId}/ledger`)).status).toBe(403);
  });

  it("refuses to rewrite ledger history", async () => {
    const m = await seedBareMember();
    await call(m, "POST", "/v1/wallet/free-grant");
    await expect(root.query("UPDATE wallet_ledger SET amount = 999 WHERE organization_id = ?", [m.orgId])).rejects.toThrow();
    await expect(root.query("DELETE FROM wallet_ledger WHERE organization_id = ?", [m.orgId])).rejects.toThrow();
    expect(await balance(m)).toMatchObject({ balance: 25 });
  });
});
