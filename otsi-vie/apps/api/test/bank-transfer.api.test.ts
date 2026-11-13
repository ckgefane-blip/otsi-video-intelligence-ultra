/**
 * Bank-transfer billing for plans (ADR-144 §1.7, migration 0075) through the real API and MySQL: the plan
 * catalogue, bank accounts (one per currency, owner-entered), the order flow (create -> pro-forma invoice
 * with a unique per-year reference -> proof / mark paid -> admin confirm -> subscription ACTIVE, entitlement
 * grant, wallet PURCHASE with the invoice reference), rejection (never activates), partial payment (never
 * activates, completes only through confirm), double-confirm idempotency (no double wallet credit), money
 * refund (claws the tokens back), renewals (7 days before expiry, no duplicates) and expiry + grace (drops
 * to the free tier, projects kept).
 * Needs MySQL 8.4 on 127.0.0.1:3507 (global-setup); it cannot run in this VM without it.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, sleep, startApi, token } from "./helpers";
import { BillingService } from "../src/modules/billing/billing";

let app: NestFastifyApplication;
let root: mysql.Connection;
let owner: Member, viewer: Member;
/** The company organisation (OTSI) and its owner: the only one who may do the company billing actions. */
let company: Member;
let dir: string;

async function call(m: Member | null, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const isRaw = extra["content-type"] === "application/octet-stream";
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: isRaw ? (body as Buffer) : (body as object) }) });
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

const balance = async (m: Member) => (await call(m, "GET", "/v1/wallet")).body.balance as number;
const year = new Date().getUTCFullYear();

async function seedBankAccount(currency: "NGN" | "USD") {
  const r = await call(company, "POST", "/v1/admin/billing/bank-accounts",
    { currency, account_name: "Osio & Tee Solutions International Ltd", bank_name: currency === "NGN" ? "Zenith Bank" : "Zenith Bank USD", account_number: currency === "NGN" ? "1234567890" : "0987654321", swift_iban: currency === "USD" ? "ZEIBNGLA" : null, is_active: true });
  expect(r.status).toBe(201);
  return r.body;
}

async function createOrder(m: Member, plan = "CLUB", period = 1, currency: "NGN" | "USD" = "NGN") {
  const r = await call(m, "POST", "/v1/billing/orders", { plan_code: plan, period_months: period, currency });
  expect(r.status).toBe(201);
  return r.body;
}

async function subscriptionOf(orgId: string) {
  const [rows] = await root.query<mysql.RowDataPacket[]>("SELECT * FROM subscriptions WHERE organization_id = ? ORDER BY created_at DESC LIMIT 1", [orgId]);
  return rows[0] as mysql.RowDataPacket | undefined;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-billing-"));
  root = await rootDb();
  // the company organisation (OTSI): the setting names it, so the API under test runs with it set.
  const companyOrgId = uuidv7();
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [companyOrgId, "OTSI", "otsi"]);
  company = await seedMember(root, "OWNER", companyOrgId);
  app = await startApi({ storageDir: dir, companyOrganizationId: companyOrgId });
  owner = await seedMember(root, "OWNER");
  viewer = await seedMember(root, "VIEWER", owner.orgId);
});

afterAll(async () => {
  await app.close();
  await root.end();
  await rm(dir, { recursive: true, force: true });
});

describe("bank-transfer billing", () => {
  it("publishes the plan catalogue: four billable plans, 1/12-month periods, online payment coming soon", async () => {
    const m = await seedBareMember();
    const r = await call(m, "GET", "/v1/billing/plans");
    expect(r.status).toBe(200);
    expect(r.body.plans.filter((p: { code: string }) => p.code !== "FREE").map((p: { code: string }) => p.code)).toEqual(["STARTER", "CLUB", "ACADEMY", "SEASON"]);
    expect(r.body.plans.find((p: { code: string }) => p.code === "CLUB")).toMatchObject({ tokens_per_month: 500, price_ngn_minor: 6_000_000, price_usd_minor: 19900 });
    expect(r.body.periods_months).toEqual([1, 12]);
    expect(r.body).toMatchObject({ order_expiry_days: 14, renewal_window_days: 7, renewal_grace_days: 14, online_payment: "coming_soon" });
  });

  it("generates references that are unique and sequential per year", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const first = await createOrder(m, "STARTER", 1, "NGN");
    const second = await createOrder(m, "CLUB", 1, "NGN");
    expect(first.order.reference).toMatch(new RegExp(`^OTSI-INV-${year}-\\d{6}$`));
    expect(second.order.reference).toMatch(new RegExp(`^OTSI-INV-${year}-\\d{6}$`));
    expect(first.order.reference).not.toBe(second.order.reference);
    const seq = (ref: string) => Number(ref.slice(-6));
    expect(seq(second.order.reference)).toBe(seq(first.order.reference) + 1);
    expect(first.invoice).toMatchObject({
      reference: first.order.reference, plan_code: "STARTER", amount_minor: 1_500_000, currency: "NGN",
      bank_account: { account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank", account_number: "1234567890" },
    });
    expect(first.invoice.pay_reference_note).toContain("transfer description");
  });

  it("refuses an order in a currency with no bank account set up", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const r = await call(m, "POST", "/v1/billing/orders", { plan_code: "CLUB", period_months: 1, currency: "USD" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("BANK_ACCOUNT_NOT_CONFIGURED");
  });

  it("refuses to confirm an order before it is awaiting confirmation, and activates nothing", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const before = await balance(m);
    const created = await createOrder(m, "CLUB", 1, "NGN");
    const r = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-1" });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("ORDER_NOT_AWAITING_CONFIRMATION");
    expect(await balance(m)).toBe(before);
    expect(await subscriptionOf(m.orgId)).toBeUndefined();
  });

  it("runs the full flow: proof -> confirm -> ACTIVE subscription, grant, wallet PURCHASE; a second confirm never double-credits", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const before = await balance(m);
    const created = await createOrder(m, "CLUB", 1, "NGN");
    expect(created.order).toMatchObject({ status: "ORDERED", amount_minor: 6_000_000, tokens_granted: 500 });
    const marked = await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    expect(marked.status).toBe(201);
    expect(marked.body).toMatchObject({ status: "AWAITING_CONFIRMATION" });
    // an OWNER of another organization cannot confirm this order (ADR-140 §8: only the company
    // organisation may confirm a plan order — not the order's own owner, and not another customer)
    expect((await call(owner, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-1" })).status).toBe(403);
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-REF-1001" });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ status: "CONFIRMED", bank_reference: "BANK-REF-1001", amount_received_minor: 6_000_000 });
    expect(confirmed.body.subscription_id).toBeTruthy();
    expect(await balance(m)).toBe(before + 500);
    const sub = await subscriptionOf(m.orgId);
    expect(sub).toMatchObject({ state: "ACTIVE", id: confirmed.body.subscription_id });
    const [grants] = await root.query<mysql.RowDataPacket[]>("SELECT * FROM entitlement_grants WHERE organization_id = ? AND source_subscription_id = ?", [m.orgId, confirmed.body.subscription_id]);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ feature_key: "plan:club", limit_value: 500 });
    const ledger = await call(m, "GET", "/v1/wallet/ledger");
    expect(ledger.body.entries[0]).toMatchObject({ kind: "PURCHASE", amount: 500, invoice_ref: created.order.reference, balance_after: before + 500 });
    // confirming twice: refused, and the wallet does not move (idempotency on top of the status guard)
    const again = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-REF-1001" });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe("ORDER_NOT_AWAITING_CONFIRMATION");
    expect(await balance(m)).toBe(before + 500);
    const ledger2 = await call(m, "GET", "/v1/wallet/ledger");
    expect(ledger2.body.entries.filter((e: { kind: string; invoice_ref: string }) => e.kind === "PURCHASE" && e.invoice_ref === created.order.reference)).toHaveLength(1);
  });

  it("accepts a receipt file as proof, recording filename, size and sha256", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const created = await createOrder(m, "STARTER", 1, "NGN");
    const pdf = Buffer.from("%PDF-1.4 fake receipt for the test, not a real transfer\n", "utf8");
    const r = await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, pdf,
      { "content-type": "application/octet-stream", "x-content-type": "application/pdf", "x-file-name": "transfer-receipt.pdf" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: "AWAITING_CONFIRMATION", proof_filename: "transfer-receipt.pdf", proof_content_type: "application/pdf",
      proof_size_bytes: pdf.length, proof_sha256: createHash("sha256").update(pdf).digest("hex"),
    });
    expect(r.body.proof_uploaded_at).toBeTruthy();
  });

  it("rejection never activates: no subscription, no grant, no wallet credit, and it cannot be confirmed after", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const before = await balance(m);
    const created = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const rejected = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/reject`, { reason: "No matching transfer on the bank statement." });
    expect(rejected.status).toBe(201);
    expect(rejected.body).toMatchObject({ status: "REJECTED", reject_reason: "No matching transfer on the bank statement." });
    expect(await balance(m)).toBe(before);
    expect(await subscriptionOf(m.orgId)).toBeUndefined();
    const confirm = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-1" });
    expect(confirm.status).toBe(409);
  });

  it("a partial payment never activates, and the remainder completes only through confirm", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const before = await balance(m);
    const created = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const partial = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/record-partial`, { amount_received_minor: 2_500_000, bank_reference: "BANK-PART-1" });
    expect(partial.status).toBe(201);
    expect(partial.body).toMatchObject({ status: "PARTIAL", amount_received_minor: 2_500_000 });
    expect(await balance(m)).toBe(before);
    expect(await subscriptionOf(m.orgId)).toBeUndefined();
    // a part-payment that would complete the order is refused here — the final amount goes through confirm
    const tooMuch = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/record-partial`, { amount_received_minor: 3_500_000 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.code).toBe("ORDER_AMOUNT_MISMATCH");
    // and confirming with the wrong remainder is refused too
    const wrong = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 1_000_000, bank_reference: "BANK-PART-2" });
    expect(wrong.status).toBe(409);
    expect(wrong.body.code).toBe("ORDER_AMOUNT_MISMATCH");
    expect(await balance(m)).toBe(before);
    // the exact remainder confirms and activates
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 3_500_000, bank_reference: "BANK-PART-2" });
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ status: "CONFIRMED", amount_received_minor: 6_000_000 });
    expect(await balance(m)).toBe(before + 500);
    expect((await subscriptionOf(m.orgId))?.state).toBe("ACTIVE");
  });

  it("a money refund claws the granted tokens back and cancels the subscription", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const before = await balance(m);
    const created = await createOrder(m, "STARTER", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 1_500_000, bank_reference: "BANK-2" });
    expect(confirmed.status).toBe(201);
    expect(await balance(m)).toBe(before + 100);
    const refunded = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/refund`, { reason: "Customer asked for a refund; money sent back.", amount_refunded_minor: 1_500_000 });
    expect(refunded.status).toBe(201);
    expect(refunded.body).toMatchObject({ status: "REFUNDED", amount_refunded_minor: 1_500_000, refund_reason: "Customer asked for a refund; money sent back." });
    expect(await balance(m)).toBe(before);
    expect((await subscriptionOf(m.orgId))?.state).toBe("CANCELED");
    const ledger = await call(m, "GET", "/v1/wallet/ledger");
    const clawback = ledger.body.entries.find((e: { kind: string; amount: number; reason: string }) => e.kind === "ADJUSTMENT" && e.amount === -100);
    expect(clawback).toBeTruthy();
    expect(clawback?.reason).toContain("Money refund");
  });

  it("creates one renewal order 7 days before expiry, never a second, and drops to free after expiry + grace", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const created = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-3" });
    const subId = confirmed.body.subscription_id as string;
    // move the subscription so it expires in 3 days: a renewal order is due
    await root.query("UPDATE subscriptions SET period_end = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 3 DAY) WHERE id = ?", [subId]);
    const run1 = await call(company, "POST", "/v1/admin/billing/renewals/run");
    expect(run1.status).toBe(201);
    expect(run1.body.renewals_created).toBe(1);
    expect(run1.body.renewal_order_ids).toHaveLength(1);
    const [renewals] = await root.query<mysql.RowDataPacket[]>("SELECT * FROM bank_transfer_orders WHERE renews_subscription_id = ?", [subId]);
    expect(renewals).toHaveLength(1);
    expect(renewals[0]).toMatchObject({ plan_code: "CLUB", period_months: 1, amount_minor: 6_000_000, currency: "NGN", status: "ORDERED" });
    expect(renewals[0]?.reference).not.toBe(created.order.reference);
    // a second run creates no duplicate renewal
    const run2 = await call(company, "POST", "/v1/admin/billing/renewals/run");
    expect(run2.body.renewals_created).toBe(0);
    // move the subscription 20 days past its end (grace is 14 days): it drops to the free tier, projects kept
    await root.query("UPDATE subscriptions SET period_end = DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 20 DAY) WHERE id = ?", [subId]);
    const [projectsBefore] = await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM projects WHERE organization_id = ?", [m.orgId]);
    const run3 = await call(company, "POST", "/v1/admin/billing/renewals/run");
    expect(run3.body.downgraded_to_free).toBe(1);
    const sub = await subscriptionOf(m.orgId);
    expect(sub?.state).toBe("CANCELED");
    const [plan] = await root.query<mysql.RowDataPacket[]>("SELECT p.code FROM plans p JOIN plan_versions pv ON pv.plan_id = p.id WHERE pv.id = ?", [sub?.plan_version_id]);
    expect(plan[0]?.code).toBe("FREE");
    const [projectsAfter] = await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM projects WHERE organization_id = ?", [m.orgId]);
    expect(projectsAfter[0]?.n).toBe(projectsBefore[0]?.n);
  });

  it("two renewal runs at the same time still create only one renewal order", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const created = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-4" });
    const subId = confirmed.body.subscription_id as string;
    await root.query("UPDATE subscriptions SET period_end = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 3 DAY) WHERE id = ?", [subId]);
    const [runA, runB] = await Promise.all([
      call(company, "POST", "/v1/admin/billing/renewals/run"),
      call(company, "POST", "/v1/admin/billing/renewals/run"),
    ]);
    expect(runA.status).toBe(201);
    expect(runB.status).toBe(201);
    expect((runA.body.renewals_created as number) + (runB.body.renewals_created as number)).toBe(1);
    const [renewals] = await root.query<mysql.RowDataPacket[]>("SELECT * FROM bank_transfer_orders WHERE renews_subscription_id = ?", [subId]);
    expect(renewals).toHaveLength(1);
  });

  it("the central-mode daily job runs renewals at start-up, and later ticks plus a manual run create no duplicates", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const created = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-5" });
    const subId = confirmed.body.subscription_id as string;
    await root.query("UPDATE subscriptions SET period_end = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 3 DAY) WHERE id = ?", [subId]);
    // the daily job's start-up run fires inside createApp (onModuleInit, not awaited), so poll until it lands
    const centralApp = await startApi({ centralMode: true });
    try {
      const deadline = Date.now() + 10_000;
      let renewals: mysql.RowDataPacket[] = [];
      while (Date.now() < deadline) {
        [renewals] = await root.query<mysql.RowDataPacket[]>("SELECT * FROM bank_transfer_orders WHERE renews_subscription_id = ?", [subId]);
        if (renewals.length === 1) break;
        await sleep(100);
      }
      expect(renewals).toHaveLength(1);
      // short-interval ticks, then a manual run: still exactly one renewal order
      const billing = centralApp.get(BillingService);
      billing.stopRenewalScheduler();
      billing.startRenewalScheduler(50);
      await sleep(250);
      billing.stopRenewalScheduler();
      const manual = await call(company, "POST", "/v1/admin/billing/renewals/run");
      expect(manual.body.renewals_created).toBe(0);
      const [after] = await root.query<mysql.RowDataPacket[]>("SELECT * FROM bank_transfer_orders WHERE renews_subscription_id = ?", [subId]);
      expect(after).toHaveLength(1);
    } finally {
      await centralApp.close();
    }
  });

  it("keeps viewers and other organizations out of billing admin", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const created = await createOrder(m, "CLUB", 1, "NGN");
    expect((await call(viewer, "GET", "/v1/admin/billing/orders")).status).toBe(403);
    expect((await call(viewer, "GET", "/v1/admin/billing/bank-accounts")).status).toBe(403);
    expect((await call(owner, "GET", `/v1/admin/billing/orders/${created.order.id}`)).status).toBe(403);
    expect((await call(owner, "GET", `/v1/billing/orders/${created.order.id}`)).status).toBe(404);
    // a member of another organization cannot even see the order in their own list
    const otherList = await call(owner, "GET", "/v1/billing/orders");
    expect(otherList.body.map((o: { id: string }) => o.id)).not.toContain(created.order.id);
  });

  it("reads the live subscription: null before any order, ACTIVE after confirm, gone after a refund", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    expect((await call(m, "GET", "/v1/billing/subscription")).body).toBeNull();
    const created = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, {});
    const confirmed = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-SUB-1" });
    expect(confirmed.status).toBe(201);
    const sub = await call(m, "GET", "/v1/billing/subscription");
    expect(sub.status).toBe(200);
    expect(sub.body).toMatchObject({ plan_code: "CLUB", state: "ACTIVE", id: confirmed.body.subscription_id });
    expect(sub.body.period_end).toBeTruthy();
    // a refund cancels the subscription, so the read goes back to null
    const refunded = await call(company, "POST", `/v1/admin/billing/orders/${created.order.id}/refund`, { reason: "Duplicate payment" });
    expect(refunded.status).toBe(201);
    expect((await call(m, "GET", "/v1/billing/subscription")).body).toBeNull();
  });

  it("sums the revenue: confirmed, outstanding, refunded and part-payments, per currency", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    // one confirmed order (CLUB, ₦60,000), one outstanding (STARTER, ₦15,000, still ORDERED),
    // one part-paid (ACADEMY, ₦120,000, ₦20,000 received) and one refunded (SEASON, ₦250,000)
    const confirmed = await createOrder(m, "CLUB", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${confirmed.order.id}/proof`, {});
    await call(company, "POST", `/v1/admin/billing/orders/${confirmed.order.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-REV-1" });
    await createOrder(m, "STARTER", 1, "NGN");
    const partial = await createOrder(m, "ACADEMY", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${partial.order.id}/proof`, {});
    const part = await call(company, "POST", `/v1/admin/billing/orders/${partial.order.id}/record-partial`, { amount_received_minor: 2_000_000, bank_reference: "BANK-REV-2" });
    expect(part.status).toBe(201);
    const refunded = await createOrder(m, "SEASON", 1, "NGN");
    await call(m, "POST", `/v1/billing/orders/${refunded.order.id}/proof`, {});
    await call(company, "POST", `/v1/admin/billing/orders/${refunded.order.id}/confirm`, { amount_received_minor: 25_000_000, bank_reference: "BANK-REV-3" });
    const ref = await call(company, "POST", `/v1/admin/billing/orders/${refunded.order.id}/refund`, { reason: "Charged twice" });
    expect(ref.status).toBe(201);
    const summary = await call(m, "GET", "/v1/admin/billing/revenue-summary");
    expect(summary.status).toBe(200);
    expect(summary.body.currencies).toHaveLength(1);
    expect(summary.body.currencies[0]).toMatchObject({
      currency: "NGN",
      confirmed: { count: 1, total_minor: 6_000_000 },
      outstanding: { count: 2, total_minor: 11_500_000 },
      refunded: { count: 1, total_minor: 25_000_000 },
      partial: { count: 1, total_minor: 2_000_000 },
    });
    expect((await call(viewer, "GET", "/v1/admin/billing/revenue-summary")).status).toBe(403);
  });

  it("shows a pack request's payment details to its own organization only, and only after invoicing", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const req = await call(m, "POST", "/v1/wallet/packs/request", { pack_code: "CLUB", currency: "NGN" });
    expect(req.status).toBe(201);
    // requested, not yet invoiced: no bank details, only the pay-reference note
    const before = await call(m, "GET", `/v1/wallet/packs/requests/${req.body.id}`);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ request: { id: req.body.id, status: "REQUESTED", invoice_ref: null }, bank_account: null });
    expect(before.body.pay_reference_note).toBeTruthy();
    // after the invoice, the bank details the owner saved are on the read
    const invoiced = await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/invoice`, { invoice_ref: "INV-2026-777" });
    expect(invoiced.status).toBe(201);
    const after = await call(m, "GET", `/v1/wallet/packs/requests/${req.body.id}`);
    expect(after.status).toBe(200);
    expect(after.body.bank_account).toMatchObject({ bank_name: "Zenith Bank", account_number: "1234567890", currency: "NGN" });
    expect(after.body.request.invoice_ref).toBe("INV-2026-777");
    // another organization, and a viewer, cannot read it
    expect((await call(owner, "GET", `/v1/wallet/packs/requests/${req.body.id}`)).status).toBe(403);
    expect((await call(viewer, "GET", `/v1/wallet/packs/requests/${req.body.id}`)).status).toBe(403);
  });

  it("streams the uploaded receipt back to the admin, and 404s when there is none", async () => {
    const m = await seedBareMember();
    await seedBankAccount("NGN");
    const created = await createOrder(m, "STARTER", 1, "NGN");
    expect((await call(m, "GET", `/v1/admin/billing/orders/${created.order.id}/proof`)).status).toBe(404);
    const pdf = Buffer.from("%PDF-1.4 fake receipt for the download test\\n", "utf8");
    const uploaded = await call(m, "POST", `/v1/billing/orders/${created.order.id}/proof`, pdf,
      { "content-type": "application/octet-stream", "x-content-type": "application/pdf", "x-file-name": "transfer-receipt.pdf" });
    expect(uploaded.status).toBe(201);
    const download = await app.inject({
      method: "GET", url: `/v1/admin/billing/orders/${created.order.id}/proof`,
      headers: { ...(m.headers ?? {}) },
    });
    expect(download.statusCode).toBe(200);
    expect(download.headers["content-type"]).toBe("application/pdf");
    expect(download.headers["content-disposition"]).toContain("transfer-receipt.pdf");
    expect(Buffer.compare(Buffer.from(download.rawPayload as Buffer), pdf)).toBe(0);
    // a viewer cannot download it, and another organization cannot either
    expect((await call(viewer, "GET", `/v1/admin/billing/orders/${created.order.id}/proof`)).status).toBe(403);
    expect((await call(owner, "GET", `/v1/admin/billing/orders/${created.order.id}/proof`)).status).toBe(403);
  });
});
