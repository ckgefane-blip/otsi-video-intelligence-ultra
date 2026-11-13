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
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi, token } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
/** The company organisation (OTSI) and its owner. */
let company: Member;
/** A customer organisation and its owner. */
let customer: Member;

async function callOn(a: NestFastifyApplication, m: Member | null, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await a.inject({ method, url, headers: { ...(m?.headers ?? {}) }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}
const call = (m: Member | null, method: "GET" | "POST", url: string, body?: unknown) => callOn(app, m, method, url, body);

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
  root = await rootDb();
  // the company organisation (OTSI): the setting names it, so the API under test runs with it set.
  const companyOrgId = uuidv7();
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [companyOrgId, "OTSI", "otsi"]);
  company = await seedMember(root, "OWNER", companyOrgId);
  app = await startApi({ companyOrganizationId: companyOrgId });
  customer = await seedBareMember();
  // the company's NGN bank account, so the customer can raise an order at all.
  const account = await call(company, "POST", "/v1/admin/billing/bank-accounts",
    { currency: "NGN", account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank", account_number: "1234567890", swift_iban: null, is_active: true });
  expect(account.status).toBe(201);
});

afterAll(async () => {
  await app.close();
  await root.end();
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
