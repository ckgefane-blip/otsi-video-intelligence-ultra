/** GET /v1/notifications and POST /v1/notifications/read (v3 Phase A.15, ADR-075, migration 0049): the header bell, from recorded rows only. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
/** The company organisation (OTSI): the admin side of the billing bell test runs as it. */
let company: Member;

async function call(m: Member | null, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
type N = { id: string; kind: string; title: string; detail: string | null; href: string; unread: boolean };
const bell = async (m: Member) => (await call(m, "GET", "/v1/notifications")).body as { items: N[]; unread: number; seen_at: string | null; window_days: number };

beforeAll(async () => {
  root = await rootDb();
  const companyOrgId = uuidv7();
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [companyOrgId, "OTSI", "otsi-notif"]);
  company = await seedMember(root, "OWNER", companyOrgId);
  app = await startApi({ companyOrganizationId: companyOrgId });
});
afterAll(async () => { await app?.close(); await root?.end(); });

describe("notifications bell", () => {
  it("is empty for a new organization; needs sign-in", async () => {
    const m = await seedMember(root, "OWNER");
    expect(await bell(m)).toEqual({ items: [], unread: 0, seen_at: null, window_days: 14 });
    expect((await call(null, "GET", "/v1/notifications")).status).toBe(401);
    expect((await call(null, "POST", "/v1/notifications/read")).status).toBe(401);
  });

  it("job done, review asked for the reel's player only, team sheet, share-link comment, rights ending; read per person; hidden projects and other organizations left out", async () => {
    const m = await seedMember(root, "OWNER"), viewer = await seedMember(root, "VIEWER", m.orgId), other = await seedMember(root, "OWNER");
    const { runId, videoId, trackIds: [t1, t2] } = await seedTracks(root, m, 2);
    const project = (await root.query<mysql.RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [videoId]))[0][0]!.project_id as string;
    await root.query("UPDATE video_sources SET title = 'Bell Match' WHERE id = ?", [videoId]);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [runId]);
    const player = (await call(m, "POST", "/v1/players", { display_name: "Bell Player" }, { "idempotency-key": key() })).body.player_id as string;
    const someone = (await call(m, "POST", "/v1/players", { display_name: "Someone Else" }, { "idempotency-key": key() })).body.player_id as string;
    const reel = uuidv7();
    await root.query("INSERT INTO reel_projects (id, organization_id, project_id, video_id, name, created_by, player_id) VALUES (?, ?, ?, ?, 'Bell Reel', ?, ?)", [reel, m.orgId, project, videoId, m.userId, player]);
    expect((await call(m, "POST", `/v1/tracks/${t1}/identity-decisions`, { state: "CANDIDATE", player_id: player })).status).toBe(201);
    expect((await call(m, "POST", `/v1/tracks/${t2}/identity-decisions`, { state: "CANDIDATE", player_id: someone })).status).toBe(201);   // not the reel's player
    const read = uuidv7();
    await root.query("INSERT INTO lineup_reads (id, organization_id, video_id, requested_by, status) VALUES (?, ?, ?, ?, 'SUCCEEDED')", [read, m.orgId, videoId, m.userId]);
    await root.query("INSERT INTO lineup_cards (id, organization_id, read_id, video_id, pts_us, entries) VALUES (?, ?, ?, ?, 0, '[]')", [uuidv7(), m.orgId, read, videoId]);
    const asset = uuidv7(), link = uuidv7();
    await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 1, 'video/mp4')", [asset, m.orgId, `org/${m.orgId}/bell/${asset}.mp4`]);
    await root.query("INSERT INTO share_links (id, organization_id, asset_id, created_by, token_hash, expires_at, can_download) VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY), 0)", [link, m.orgId, asset, m.userId, uuidv7().replace(/-/g, "").padEnd(64, "0")]);
    const comment = (body: string) => root.query("INSERT INTO comments (id, organization_id, project_id, reel_id, author_id, share_link_id, guest_name, body) VALUES (?, ?, ?, ?, NULL, ?, 'Coach Ana', ?)", [uuidv7(), m.orgId, project, reel, link, body]);
    await comment("Great run at 0:12");
    await root.query("INSERT INTO rights_grants (id, organization_id, video_id, rights_state, valid_until, created_at) VALUES (?, ?, ?, 'INTERNAL', CURRENT_TIMESTAMP(6) + INTERVAL 5 DAY - INTERVAL 1 HOUR, CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY)", [uuidv7(), m.orgId, videoId]);
    await root.query("INSERT INTO render_jobs (id, reel_id, organization_id, requested_by, state, config, idempotency_key, completed_at) VALUES (?, ?, ?, ?, 'FAILED', '{}', ?, CURRENT_TIMESTAMP(6))", [uuidv7(), reel, m.orgId, m.userId, key()]);

    let b = await bell(m);
    const got = b.items.map((i) => [i.kind, i.title, i.detail, i.href]);
    expect(got).toEqual(expect.arrayContaining([
      ["JOB_DONE", "Analysis finished", "Bell Match", `/processing?video=${videoId}`],
      ["JOB_FAILED", "Render failed", "Bell Reel", "/exports"],
      ["REVIEW", "Is this him? 1 moment to check", "Bell Reel", `/analysis?video=${videoId}`],
      ["REVIEW", "1 team sheet to approve", "Bell Match", `/analysis?video=${videoId}`],
      ["COMMENT", "Coach Ana commented through a share link", "Bell Reel: “Great run at 0:12”", "/exports"],
    ]));
    const rights = b.items.find((i) => i.kind === "RIGHTS")!;
    expect(rights.title).toBe("Rights end in 5 days");
    expect(rights.detail).toMatch(/^Bell Match · until \d{4}-\d{2}-\d{2}$/);
    expect(b.items).toHaveLength(6);
    expect([b.unread, b.seen_at]).toEqual([6, null]);

    // opening the bell reads everything so far, for that person only
    const r = await call(m, "POST", "/v1/notifications/read");
    expect(r.status).toBe(200);
    b = await bell(m);
    expect([b.unread, b.seen_at, b.items.every((i) => !i.unread)]).toEqual([0, r.body.seen_at, true]);
    await new Promise((res) => setTimeout(res, 5));
    await comment("And the second goal");
    b = await bell(m);
    expect(b.unread).toBe(1);
    expect(b.items[0]).toMatchObject({ kind: "COMMENT", unread: true });
    expect((await bell(viewer)).unread).toBe(7);
    expect((await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM notification_reads WHERE user_id = ?", [m.userId]))[0][0]!.n).toBe(1);
    await call(m, "POST", "/v1/notifications/read");                                     // again: one row, moved on
    expect((await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM notification_reads WHERE user_id = ?", [m.userId]))[0][0]!.n).toBe(1);

    // a restricted project the viewer is not in: none of it reaches him; the owner still sees it
    await root.query("UPDATE projects SET access = 'RESTRICTED' WHERE id = ?", [project]);
    expect((await bell(viewer)).items).toEqual([]);
    expect((await bell(m)).items).toHaveLength(7);
    expect(await bell(other)).toEqual({ items: [], unread: 0, seen_at: null, window_days: 14 });
  });

  it("billing: order placed, marked paid, confirmed, rejected and refunded show as BILLING items linking to the order; a subscription ending within 7 days is news too", async () => {
    const m = await seedMember(root, "OWNER");
    // The customer places the orders and uploads proof; the company org (OTSI) does the admin side —
    // bank account, confirm, reject, refund — because the company lock refuses those to a customer
    // (that 403 is the lock working, not a failure). The bell is the customer's: the BILLING items
    // are read off the customer's own orders, whoever confirmed them.
    const bank = await call(company, "POST", "/v1/admin/billing/bank-accounts",
      { currency: "NGN", account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank", account_number: "1234567890", swift_iban: null, is_active: true });
    expect(bank.status).toBe(201);
    const create = async (plan: string) =>
      (await call(m, "POST", "/v1/billing/orders", { plan_code: plan, period_months: 1, currency: "NGN" })).body.order as { id: string; reference: string };
    // confirmed (placed -> marked paid -> confirmed)
    const done = await create("CLUB");
    await call(m, "POST", `/v1/billing/orders/${done.id}/proof`, {});
    expect((await call(company, "POST", `/v1/admin/billing/orders/${done.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-NOTIF-1" })).status).toBe(201);
    // still awaiting: marked paid, not yet confirmed — the "marked paid" item only fires while it awaits
    const awaiting = await create("STARTER");
    await call(m, "POST", `/v1/billing/orders/${awaiting.id}/proof`, { note: "Sent from Karo" });
    // rejected
    const rejected = await create("STARTER");
    expect((await call(company, "POST", `/v1/admin/billing/orders/${rejected.id}/reject`, { reason: "Wrong plan" })).status).toBe(201);
    // refunded (placed -> marked paid -> confirmed -> refunded)
    const refunded = await create("CLUB");
    await call(m, "POST", `/v1/billing/orders/${refunded.id}/proof`, {});
    await call(company, "POST", `/v1/admin/billing/orders/${refunded.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-NOTIF-2" });
    expect((await call(company, "POST", `/v1/admin/billing/orders/${refunded.id}/refund`, { reason: "Charged twice" })).status).toBe(201);

    const b = await bell(m);
    const billing = b.items.filter((i) => i.kind === "BILLING");
    const got = billing.map((i) => [i.title, i.href]);
    expect(got).toEqual(expect.arrayContaining([
      ["Order placed — CLUB · 1 month", `/settings/billing/orders/${done.id}`],
      ["Payment confirmed — CLUB · 1 month active", `/settings/billing/orders/${done.id}`],
      ["Marked paid — no receipt", `/settings/billing/orders/${awaiting.id}`],
      ["Order rejected", `/settings/billing/orders/${rejected.id}`],
      ["Refund issued", `/settings/billing/orders/${refunded.id}`],
    ]));
    const confirmedItem = billing.find((i) => i.title === "Payment confirmed — CLUB · 1 month active")!;
    expect(confirmedItem.detail).toMatch(/^OTSI-INV-\d{4}-\d{6} · 500 tokens$/);
    const rejectedItem = billing.find((i) => i.title === "Order rejected")!;
    expect(rejectedItem.detail).toContain("Wrong plan");
    // the refund above ended this organisation's plan, so the subscription warning is checked on a second
    // customer with one confirmed CLUB order: it ends in a month, so it is not news yet; move it to 3 days out
    const m2 = await seedMember(root, "OWNER");
    const o2 = (await call(m2, "POST", "/v1/billing/orders", { plan_code: "CLUB", period_months: 1, currency: "NGN" })).body.order as { id: string };
    await call(m2, "POST", `/v1/billing/orders/${o2.id}/proof`, {});
    expect((await call(company, "POST", `/v1/admin/billing/orders/${o2.id}/confirm`, { amount_received_minor: 6_000_000, bank_reference: "BANK-NOTIF-3" })).status).toBe(201);
    const [subs] = await root.query<mysql.RowDataPacket[]>("SELECT id FROM subscriptions WHERE organization_id = ? AND state = 'ACTIVE'", [m2.orgId]);
    expect(subs).toHaveLength(1);
    await root.query("UPDATE subscriptions SET period_end = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL 3 DAY) WHERE id = ?", [subs[0]!.id]);
    const b2 = await bell(m2);
    const subItem = b2.items.find((i) => i.title.startsWith("Subscription ends in"))!;
    expect(subItem).toMatchObject({ kind: "BILLING", href: "/settings/billing" });
    expect(subItem.title).toBe("Subscription ends in 3 days");
    expect(subItem.detail).toMatch(/^CLUB · until \d{4}-\d{2}-\d{2}$/);
  });
});

describe("company bell (owner 2026-11-13): OTSI hears when a customer pays", () => {
  it("the company org sees a customer's paid order and pack request until it acts; the customer and other orgs do not", async () => {
    const m = await seedMember(root, "OWNER");
    const other = await seedMember(root, "OWNER");
    const [[org]] = await root.query<mysql.RowDataPacket[]>("SELECT name FROM organizations WHERE id = ?", [m.orgId]);
    const name = String(org!.name);
    const order = (await call(m, "POST", "/v1/billing/orders", { plan_code: "STARTER", period_months: 1, currency: "NGN" })).body.order as { id: string; reference: string; amount_minor: number };
    expect((await call(m, "POST", `/v1/billing/orders/${order.id}/proof`, { note: "Sent today" })).status).toBe(201);
    const pack = await call(m, "POST", "/v1/wallet/packs/request", { pack_code: "STARTER", currency: "NGN" });
    expect(pack.status).toBe(201);

    const mine = (await bell(company)).items.filter((i) => i.id.startsWith("company-") && (i.id.includes(order.id) || i.id.includes(pack.body.id)));
    expect(mine.map((i) => [i.title, i.href, i.unread])).toEqual(expect.arrayContaining([
      [`${name} paid — confirm the money`, "/settings/admin/billing", true],
      [`${name} wants a token pack — send the invoice`, "/settings/admin/billing", true],
    ]));
    expect(mine.find((i) => i.id.includes(order.id))!.detail).toContain(order.reference);
    // the customer's own bell and another customer's bell carry no company alerts
    expect((await bell(m)).items.some((i) => i.id.startsWith("company-"))).toBe(false);
    expect((await bell(other)).items.some((i) => i.id.startsWith("company-"))).toBe(false);

    // once OTSI confirms the money, the alert is gone
    expect((await call(company, "POST", `/v1/admin/billing/orders/${order.id}/confirm`, { amount_received_minor: order.amount_minor, bank_reference: "BANK-BELL-1" })).status).toBe(201);
    expect((await bell(company)).items.some((i) => i.id === `company-order:${order.id}:paid`)).toBe(false);
  });
});
