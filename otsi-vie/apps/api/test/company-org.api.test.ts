/**
 * Company-organisation guard (ADR-140 §8, the bank-account/order fix) through the real API and MySQL:
 * only the company organisation (OTSI, named by the server setting OTSI_VIE_COMPANY_ORG_ID) may do the
 * company billing actions. A customer's owner — even of the order's own organisation — is refused with
 * 403 for each one, and the company owner succeeds. With the setting missing, nobody may do them
 * (fail closed). The Admin › Billing screens are hidden from customer admins in the web UI; this file
 * proves the API refuses them even when called directly.
 * Needs MySQL 8.4 on 127.0.0.1:3507 (global-setup); it cannot run in this VM without it.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi, token } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
/** The company organisation (OTSI) and its owner. */
let company: Member;
/** A customer organisation and its owner. */
let customer: Member;

async function callOn(a: NestFastifyApplication, m: Member | null, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const isRaw = extra["content-type"] === "application/octet-stream";
  const r = await a.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: isRaw ? (body as Buffer) : (body as object) }) });
  return { status: r.statusCode, headers: r.headers, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}
const call = (m: Member | null, method: "GET" | "POST", url: string, body?: unknown, extra?: Record<string, string>) => callOn(app, m, method, url, body, extra);

/** An organization with one ACTIVE member, WITHOUT the test wallet funding seedMember adds. */
async function seedBareMember(role = "OWNER"): Promise<Member> {
  const org = uuidv7(), userId = uuidv7(), subject = `sub-${randomUUID()}`;
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [org, `Org ${org.slice(-6)}`, `org-${org}`]);
  await root.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [userId, subject, `${subject}@test.invalid`, "Test User"]);
  await root.query("INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'ACTIVE')", [org, userId, role]);
  return { userId, subject, orgId: org, role, headers: { authorization: `Bearer ${await token(subject)}`, "x-organization-id": org } };
}

/** A fresh plan order in AWAITING_CONFIRMATION (STARTER, 1 month, NGN: 1,500,000 minor, 100 tokens). */
async function awaitingOrder(m: Member) {
  const created = await call(m, "POST", "/v1/billing/orders", { plan_code: "STARTER", period_months: 1, currency: "NGN" });
  expect(created.status).toBe(201);
  const marked = await call(m, "POST", `/v1/billing/orders/${created.body.order.id}/proof`, {});
  expect(marked.status).toBe(201);
  expect(marked.body.status).toBe("AWAITING_CONFIRMATION");
  return created.body.order as { id: string; amount_minor: number };
}

/** A fresh token-pack request (STARTER, NGN, REQUESTED). */
async function packRequest(m: Member) {
  const req = await call(m, "POST", "/v1/wallet/packs/request", { pack_code: "STARTER", currency: "NGN" });
  expect(req.status).toBe(201);
  expect(req.body.status).toBe("REQUESTED");
  return req.body as { id: string };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-company-org-"));
  root = await rootDb();
  // the company organisation (OTSI): the setting names it, so the API under test runs with it set.
  const companyOrgId = uuidv7();
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [companyOrgId, "OTSI", "otsi-company"]);
  company = await seedMember(root, "OWNER", companyOrgId);
  app = await startApi({ storageDir: dir, companyOrganizationId: companyOrgId });
  customer = await seedBareMember();
  // the company's NGN bank account, so the customer can raise an order at all.
  const account = await call(company, "POST", "/v1/admin/billing/bank-accounts",
    { currency: "NGN", account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank", account_number: "1234567890", swift_iban: null, is_active: true });
  expect(account.status).toBe(201);
});

afterAll(async () => {
  await app.close();
  await root.end();
  await rm(dir, { recursive: true, force: true });
});

describe("company-organisation guard", () => {
  it("a customer's owner cannot change a bank account; the company owner can", async () => {
    const refused = await call(customer, "POST", "/v1/admin/billing/bank-accounts",
      { currency: "USD", account_name: "Attacker", bank_name: "Attacker Bank", account_number: "9999999999", swift_iban: null, is_active: true });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const saved = await call(company, "POST", "/v1/admin/billing/bank-accounts",
      { currency: "USD", account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank USD", account_number: "0987654321", swift_iban: "ZEIBNGLA", is_active: true });
    expect(saved.status).toBe(201);
    expect(saved.body).toMatchObject({ currency: "USD", account_number: "0987654321" });
  });

  it("a customer's owner cannot confirm a plan order; the company owner can", async () => {
    const order = await awaitingOrder(customer);
    const refused = await call(customer, "POST", `/v1/admin/billing/orders/${order.id}/confirm`,
      { amount_received_minor: order.amount_minor, bank_reference: "BANK-1" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${order.id}/confirm`,
      { amount_received_minor: order.amount_minor, bank_reference: "BANK-1" });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ status: "CONFIRMED" });
  });

  it("a customer's owner cannot record a part-payment; the company owner can", async () => {
    const order = await awaitingOrder(customer);
    const refused = await call(customer, "POST", `/v1/admin/billing/orders/${order.id}/record-partial`,
      { amount_received_minor: 500_000, bank_reference: "BANK-PART-1" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const partial = await call(company, "POST", `/v1/admin/billing/orders/${order.id}/record-partial`,
      { amount_received_minor: 500_000, bank_reference: "BANK-PART-1" });
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ status: "PARTIAL", amount_received_minor: 500_000 });
  });

  it("a customer's owner cannot reject a plan order; the company owner can", async () => {
    const order = await awaitingOrder(customer);
    const refused = await call(customer, "POST", `/v1/admin/billing/orders/${order.id}/reject`,
      { reason: "No matching transfer." });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const rejected = await call(company, "POST", `/v1/admin/billing/orders/${order.id}/reject`,
      { reason: "No matching transfer." });
    expect(rejected.status).toBe(201);
    expect(rejected.body).toMatchObject({ status: "REJECTED" });
  });

  it("a customer's owner cannot refund a plan order; the company owner can", async () => {
    const order = await awaitingOrder(customer);
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${order.id}/confirm`,
      { amount_received_minor: order.amount_minor, bank_reference: "BANK-2" });
    expect(confirmed.status).toBe(201);
    const refused = await call(customer, "POST", `/v1/admin/billing/orders/${order.id}/refund`,
      { reason: "Customer asked for a refund.", amount_refunded_minor: order.amount_minor });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const refunded = await call(company, "POST", `/v1/admin/billing/orders/${order.id}/refund`,
      { reason: "Customer asked for a refund.", amount_refunded_minor: order.amount_minor });
    expect(refunded.status).toBe(201);
    expect(refunded.body).toMatchObject({ status: "REFUNDED" });
  });

  it("a customer's owner cannot invoice a token pack; the company owner can", async () => {
    const req = await packRequest(customer);
    const refused = await call(customer, "POST", `/v1/admin/wallet/pack-requests/${req.id}/invoice`,
      { invoice_ref: "INV-2026-100" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const invoiced = await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.id}/invoice`,
      { invoice_ref: "INV-2026-100" });
    expect(invoiced.status).toBe(201);
    expect(invoiced.body).toMatchObject({ status: "INVOICED", invoice_ref: "INV-2026-100" });
  });

  it("a customer's owner cannot confirm a token pack receipt; the company owner can", async () => {
    const req = await packRequest(customer);
    const invoiced = await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.id}/invoice`,
      { invoice_ref: "INV-2026-101" });
    expect(invoiced.status).toBe(201);
    const refused = await call(customer, "POST", `/v1/admin/wallet/pack-requests/${req.id}/confirm-receipt`,
      { invoice_ref: "INV-2026-101" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const paid = await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.id}/confirm-receipt`,
      { invoice_ref: "INV-2026-101" });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ status: "PAID" });
  });

  it("a customer's owner cannot top up a wallet; the company owner can", async () => {
    const refused = await call(customer, "POST", `/v1/admin/wallet/${customer.orgId}/topup`,
      { amount: 50, reason: "Free tokens for myself", invoice_ref: "INV-SELF" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const topped = await call(company, "POST", `/v1/admin/wallet/${customer.orgId}/topup`,
      { amount: 50, reason: "Bank transfer received", invoice_ref: "INV-2026-102" });
    expect(topped.status).toBe(201);
    expect(topped.body).toMatchObject({ kind: "PURCHASE", amount: 50 });
  });

  it("a customer's owner cannot refund a wallet; the company owner can", async () => {
    const m = await seedBareMember();
    const topped = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/topup`,
      { amount: 20, reason: "Bank transfer received", invoice_ref: "INV-2026-103" });
    expect(topped.status).toBe(201);
    const refused = await call(m, "POST", `/v1/admin/wallet/${m.orgId}/refund`,
      { amount: 10, reason: "Goodwill refund" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const refunded = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/refund`,
      { amount: 10, reason: "Goodwill refund" });
    expect(refunded.status).toBe(201);
    expect(refunded.body).toMatchObject({ kind: "REFUND", amount: 10 });
  });

  it("a customer's owner cannot adjust a wallet; the company owner can", async () => {
    const m = await seedBareMember();
    const refused = await call(m, "POST", `/v1/admin/wallet/${m.orgId}/adjust`,
      { amount: 5, reason: "Correction" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const adjusted = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/adjust`,
      { amount: 5, reason: "Correction" });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body).toMatchObject({ kind: "ADJUSTMENT", amount: 5 });
  });

  it("a customer's owner cannot expire credits; the company owner can", async () => {
    const m = await seedBareMember();
    const refused = await call(m, "POST", `/v1/admin/wallet/${m.orgId}/expire`);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const expired = await call(company, "POST", `/v1/admin/wallet/${m.orgId}/expire`);
    expect(expired.status).toBe(201);
    expect(expired.body).toMatchObject({ organization_id: m.orgId, expired: 0 });
  });

  it("a customer's owner cannot run renewals; the company owner can", async () => {
    const refused = await call(customer, "POST", "/v1/admin/billing/renewals/run");
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
    const ran = await call(company, "POST", "/v1/admin/billing/renewals/run");
    expect(ran.status).toBe(201);
    expect(ran.body).toMatchObject({ renewals_created: 0 });
  });

  it("a customer's owner can still order, upload proof and see their own orders", async () => {
    const order = await awaitingOrder(customer);
    const mine = await call(customer, "GET", "/v1/billing/orders");
    expect(mine.status).toBe(200);
    expect(mine.body.map((o: { id: string }) => o.id)).toContain(order.id);
    const one = await call(customer, "GET", `/v1/billing/orders/${order.id}`);
    expect(one.status).toBe(200);
    expect(one.body.order.id).toBe(order.id);
  });
});

describe("company-organisation reads: the company org sees every customer's orders (ADR-140 §8)", () => {
  /** The name seedBareMember gives an organisation, so the test can check the name on each row. */
  const orgName = (m: Member) => `Org ${m.orgId.slice(-6)}`;

  it("the company org lists every customer's order with the customer's name; a customer lists only its own", async () => {
    const a = await seedBareMember();
    const b = await seedBareMember();
    const orderA = await awaitingOrder(a);
    const orderB = await awaitingOrder(b);
    const all = await call(company, "GET", "/v1/admin/billing/orders");
    expect(all.status).toBe(200);
    const rows = all.body as { id: string; organization_name: string | null }[];
    expect(rows.find((o) => o.id === orderA.id)?.organization_name).toBe(orgName(a));
    expect(rows.find((o) => o.id === orderB.id)?.organization_name).toBe(orgName(b));
    const mineA = await call(a, "GET", "/v1/admin/billing/orders");
    expect(mineA.status).toBe(200);
    expect((mineA.body as { id: string }[]).map((o) => o.id)).toContain(orderA.id);
    expect((mineA.body as { id: string }[]).map((o) => o.id)).not.toContain(orderB.id);
    const mineB = await call(b, "GET", "/v1/admin/billing/orders");
    expect((mineB.body as { id: string }[]).map((o) => o.id)).toContain(orderB.id);
    expect((mineB.body as { id: string }[]).map((o) => o.id)).not.toContain(orderA.id);
  });

  it("the company org opens any customer's order; another customer is refused", async () => {
    const a = await seedBareMember();
    const b = await seedBareMember();
    const orderA = await awaitingOrder(a);
    const opened = await call(company, "GET", `/v1/admin/billing/orders/${orderA.id}`);
    expect(opened.status).toBe(200);
    expect(opened.body).toMatchObject({ id: orderA.id, organization_name: orgName(a) });
    const refused = await call(b, "GET", `/v1/admin/billing/orders/${orderA.id}`);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("BILLING_ADMIN_OTHER_ORG");
  });

  it("the company org downloads a customer's receipt; another customer is refused", async () => {
    const a = await seedBareMember();
    const b = await seedBareMember();
    const orderA = await awaitingOrder(a);
    const pdf = Buffer.from("%PDF-1.4 fake receipt for the test, not a real transfer\n", "utf8");
    const uploaded = await call(a, "POST", `/v1/billing/orders/${orderA.id}/proof`, pdf,
      { "content-type": "application/octet-stream", "x-content-type": "application/pdf", "x-file-name": "transfer-receipt.pdf" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({
      proof_filename: "transfer-receipt.pdf",
      proof_sha256: createHash("sha256").update(pdf).digest("hex"),
    });
    const downloaded = await call(company, "GET", `/v1/admin/billing/orders/${orderA.id}/proof`);
    expect(downloaded.status).toBe(200);
    expect(Buffer.from(downloaded.body as Buffer).equals(pdf)).toBe(true);
    expect(String(downloaded.headers["content-disposition"] ?? "")).toContain("transfer-receipt.pdf");
    const refused = await call(b, "GET", `/v1/admin/billing/orders/${orderA.id}/proof`);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("BILLING_ADMIN_OTHER_ORG");
  });

  it("the company org lists every customer's pack request with the customer's name; a customer lists only its own", async () => {
    const a = await seedBareMember();
    const b = await seedBareMember();
    const reqA = await packRequest(a);
    const reqB = await packRequest(b);
    const all = await call(company, "GET", "/v1/admin/wallet/pack-requests");
    expect(all.status).toBe(200);
    const rows = all.body as { id: string; organization_name: string | null }[];
    expect(rows.find((r) => r.id === reqA.id)?.organization_name).toBe(orgName(a));
    expect(rows.find((r) => r.id === reqB.id)?.organization_name).toBe(orgName(b));
    const mineA = await call(a, "GET", "/v1/admin/wallet/pack-requests");
    expect((mineA.body as { id: string }[]).map((r) => r.id)).toContain(reqA.id);
    expect((mineA.body as { id: string }[]).map((r) => r.id)).not.toContain(reqB.id);
  });

  it("the company org's revenue counts every customer's money; a customer sees only its own", async () => {
    const a = await seedBareMember();
    const before = await call(company, "GET", "/v1/admin/billing/revenue-summary");
    expect(before.status).toBe(200);
    const ngnBefore = (before.body.currencies as { currency: string; outstanding: { count: number; total_minor: number } }[])
      .find((c) => c.currency === "NGN");
    const orderA = await awaitingOrder(a);
    const after = await call(company, "GET", "/v1/admin/billing/revenue-summary");
    const ngnAfter = (after.body.currencies as { currency: string; outstanding: { count: number; total_minor: number } }[])
      .find((c) => c.currency === "NGN");
    // one more outstanding order, for exactly the new order's amount (STARTER, 1 month, NGN).
    expect((ngnAfter?.outstanding.count ?? 0) - (ngnBefore?.outstanding.count ?? 0)).toBe(1);
    expect((ngnAfter?.outstanding.total_minor ?? 0) - (ngnBefore?.outstanding.total_minor ?? 0)).toBe(orderA.amount_minor);
    // the customer sees only its own order in its revenue.
    const mine = await call(a, "GET", "/v1/admin/billing/revenue-summary");
    expect(mine.status).toBe(200);
    const ngnMine = (mine.body.currencies as { currency: string; outstanding: { count: number; total_minor: number } }[])
      .find((c) => c.currency === "NGN");
    expect(ngnMine?.outstanding).toEqual({ count: 1, total_minor: orderA.amount_minor });
  });

  it("the company org lists every customer's wallet and reads its ledger; another customer is refused the ledger", async () => {
    const a = await seedBareMember();
    const b = await seedBareMember();
    const all = await call(company, "GET", "/v1/admin/wallet");
    expect(all.status).toBe(200);
    const wallets = all.body as { organization_id: string; organization_name: string }[];
    expect(wallets.map((w) => w.organization_id)).toContain(a.orgId);
    expect(wallets.find((w) => w.organization_id === a.orgId)?.organization_name).toBe(orgName(a));
    const mine = await call(a, "GET", "/v1/admin/wallet");
    expect((mine.body as { organization_id: string }[]).map((w) => w.organization_id)).toEqual([a.orgId]);
    const ledger = await call(company, "GET", `/v1/admin/wallet/${a.orgId}/ledger`);
    expect(ledger.status).toBe(200);
    const refused = await call(b, "GET", `/v1/admin/wallet/${a.orgId}/ledger`);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("WALLET_ADMIN_OTHER_ORG");
  });
});

describe("company-organisation guard, setting missing (fail closed)", () => {
  let app2: NestFastifyApplication;

  beforeAll(async () => {
    // a second app with NO company-organisation setting: nobody may do the company actions.
    app2 = await startApi();
  });

  afterAll(async () => {
    await app2.close();
  });

  it("refuses even the company owner when the setting is missing", async () => {
    const refused = await callOn(app2, company, "POST", "/v1/admin/billing/bank-accounts",
      { currency: "NGN", account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank", account_number: "1234567890", swift_iban: null, is_active: true });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
  });

  it("refuses a plan-order confirm when the setting is missing", async () => {
    const order = await awaitingOrder(customer);
    const refused = await callOn(app2, company, "POST", `/v1/admin/billing/orders/${order.id}/confirm`,
      { amount_received_minor: order.amount_minor, bank_reference: "BANK-3" });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("COMPANY_ORG_ONLY");
  });
});
