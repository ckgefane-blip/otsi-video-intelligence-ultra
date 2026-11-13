/**
 * Company billing on a linked desktop (ADR-146 §7c, staging plan A): the OTSI company organisation's pages
 * (/v1/admin/billing/...) are answered by the central server, not by the laptop. A linked desktop that belongs
 * to the company org lists every customer's orders, enters bank details, confirms payments and downloads
 * receipts; a customer asking the same pages gets central's 403; and the signed-in membership shows the
 * company flag on the laptop, so the pages appear in the app at all.
 *
 * Setup: a real central server (central mode, the test MySQL/MariaDB database, its own receipt storage) and a
 * linked desktop (its own SQLite file, as on a club's laptop). The company org is created on central, then
 * central is restarted with it named as the company organisation — the same order the staging plan uses.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf, type Config } from "../src/core/config";
import { Db } from "../src/core/db";
import { key, rootDb, seedWallet } from "./helpers";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

const ORIGIN = "http://127.0.0.1:4310";
const PASSWORD = "correct horse battery staple";
const BOOTSTRAP = path.resolve(__dirname, "../../../database/sqlite-bootstrap.sql");

let central: NestFastifyApplication;
let centralCfg: Config;
let centralPort = 0;
let laptop: NestFastifyApplication;
let laptopDb: Db;
let laptopFile: string;
let root: mysql.Connection;
let storageDir: string;
let customerOrgId: string;
let customerHeaders: Record<string, string>;
let companyOrgId: string;
let companyHeaders: Record<string, string>;
let orderId: string;
let orderAmountMinor: number;

async function startCentral(): Promise<void> {
  central = await createApp(centralCfg);
  await central.listen(centralPort, "127.0.0.1");
  centralPort = Number(new URL(await central.getUrl()).port);
}

async function call(a: NestFastifyApplication, method: "GET" | "POST", url: string, body?: unknown, headers: Record<string, string> = {}) {
  const isRaw = headers["content-type"] === "application/octet-stream";
  const r = await a.inject({ method, url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: isRaw ? (body as Buffer) : (body as object) }) });
  const contentType = r.headers["content-type"]?.toString() ?? "";
  return { status: r.statusCode, body: contentType.includes("json") ? JSON.parse(r.body) : r.rawPayload, headers: r.headers, rawBody: r.rawPayload };
}

describe("company billing on a linked desktop (ADR-146 §7c)", () => {
  beforeAll(async () => {
    const { privateKey: licenceKey, publicKey: licencePub } = await generateKeyPair("EdDSA", { extractable: true });
    const licencePublicKeyPem = await exportSPKI(licencePub);
    const centralKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
    storageDir = await mkdtemp(path.join(tmpdir(), "otsi-central-storage-"));
    centralCfg = {
      dbDsn: inject("appDsn"), jwtIssuer: "https://accounts.test.otsi.invalid", jwtAudience: "otsi-vie-api", jwtPublicKeyPem: publicKeyOf(centralKey), port: 0,
      localAuth: { signingKeyPem: centralKey, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
      central: { centralMode: true, licenceSigningKeyPem: await exportPKCS8(licenceKey), licencePublicKeyPem, licenceGraceDays: 14 },
      storage: { dir: storageDir, partBytes: 1024 * 1024, maxUploadBytes: 64 * 1024 ** 3 },
    } as Config;
    await startCentral();

    laptopFile = path.join(tmpdir(), `otsi-linked-admin-${randomBytes(6).toString("hex")}.db`);
    const raw = new DatabaseSync(laptopFile);
    raw.exec(readFileSync(BOOTSTRAP, "utf8"));
    raw.close();
    const laptopKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
    const laptopCfg = {
      dbBackend: "sqlite", dbPath: laptopFile, jwtIssuer: "http://127.0.0.1:4520", jwtAudience: "otsi-vie-api", jwtPublicKeyPem: publicKeyOf(laptopKey), port: 0,
      localAuth: { signingKeyPem: laptopKey, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
      central: { centralMode: false, centralServerUrl: `http://127.0.0.1:${centralPort}`, licencePublicKeyPem, licenceGraceDays: 14 },
    } as Config;
    laptop = await createApp(laptopCfg);
    laptopDb = laptop.get(Db);
    root = await rootDb();

    // the customer club, signed up on the laptop (so central and the laptop both know it)
    const customerEmail = `club-${key().slice(2, 14)}@test.invalid`;
    const setup = await call(laptop, "POST", "/v1/auth/setup", { email: customerEmail, display_name: "Coach Person", organization_name: "Riverside Youth FC", password: PASSWORD });
    expect(setup.status).toBe(200);
    customerOrgId = setup.body.me.memberships[0].organization_id;
    customerHeaders = { authorization: `Bearer ${setup.body.access_token}`, "x-organization-id": customerOrgId };
    await seedWallet(root, customerOrgId, 100);

    // the company organisation (OTSI), created on central directly, then named as the company org
    const companyEmail = `otsi-${key().slice(2, 14)}@test.invalid`;
    const signup = await call(central, "POST", "/v1/auth/sign-up", { email: companyEmail, display_name: "OTSI Owner", organization_name: "Osio & Tee Solutions International Ltd", password: PASSWORD });
    expect(signup.status).toBe(200);
    companyOrgId = signup.body.me.memberships[0].organization_id;
    await central.close();
    centralCfg = { ...centralCfg, companyOrganizationId: companyOrgId };
    await startCentral();

    // the laptop signs in as the company owner: the org is mirrored here with the same id
    const login = await call(laptop, "POST", "/v1/auth/login", { email: companyEmail, password: PASSWORD });
    expect(login.status).toBe(200);
    companyHeaders = { authorization: `Bearer ${login.body.access_token}`, "x-organization-id": companyOrgId };
    const local = await laptopDb.one<RowDataPacket>("SELECT name FROM organizations WHERE id = ?", [companyOrgId]);
    expect(local?.name).toBe("Osio & Tee Solutions International Ltd");
  });

  afterAll(async () => {
    await laptop?.close();
    await central?.close();
    await root?.end();
    for (const suffix of ["", "-wal", "-shm"]) { try { unlinkSync(laptopFile + suffix); } catch { /* gone */ } }
    await rm(storageDir, { recursive: true, force: true });
  });

  it("the company enters bank details on the laptop and they land on central", async () => {
    const created = await call(laptop, "POST", "/v1/admin/billing/bank-accounts",
      { currency: "NGN", account_name: "Osio & Tee Solutions International Ltd", bank_name: "Zenith Bank", account_number: "1234567890", swift_iban: null, is_active: true }, companyHeaders);
    expect(created.status).toBe(201);
    const list = await call(laptop, "GET", "/v1/admin/billing/bank-accounts", undefined, companyHeaders);
    expect(list.status).toBe(200);
    expect((list.body as Array<{ currency: string; account_number: string }>).map((b) => [b.currency, b.account_number]))
      .toContainEqual(["NGN", "1234567890"]);
    const [rows] = await root.query<RowDataPacket[]>("SELECT account_number FROM bank_accounts WHERE currency = ?", ["NGN"]);
    expect(rows[0]?.account_number).toBe("1234567890");
  });

  it("a customer asking the company pages sees only their own orders, and cannot act on them", async () => {
    // reads: the company sees every customer's orders, a customer only their own (ADR-140 §8)
    const r = await call(laptop, "GET", "/v1/admin/billing/orders", undefined, customerHeaders);
    expect(r.status).toBe(200);
    expect((r.body as Array<{ organization_id: string }>).every((o) => o.organization_id === customerOrgId)).toBe(true);
    // actions: only the company organisation may enter bank details (central's COMPANY_ORG_ONLY)
    const bank = await call(laptop, "POST", "/v1/admin/billing/bank-accounts",
      { currency: "NGN", account_name: "X", bank_name: "Y", account_number: "1", swift_iban: null, is_active: true }, customerHeaders);
    expect(bank.status).toBe(403);
    expect(bank.body.code).toBe("COMPANY_ORG_ONLY");
  });

  it("the company org lists every customer's order on the laptop, with the customer named", async () => {
    // the customer orders the Club plan on the laptop; the order lives on central
    const order = await call(laptop, "POST", "/v1/billing/orders", { plan_code: "CLUB", period_months: 1, currency: "NGN" }, customerHeaders);
    expect(order.status).toBe(201);
    orderId = order.body.order.id;
    orderAmountMinor = order.body.order.amount_minor;
    const r = await call(laptop, "GET", "/v1/admin/billing/orders", undefined, companyHeaders);
    expect(r.status).toBe(200);
    const found = (r.body as Array<{ id: string; organization_name?: string; status: string }>).find((o) => o.id === orderId);
    expect(found).toBeTruthy();
    expect(found?.organization_name).toBe("Riverside Youth FC");
    expect(found?.status).toBe("ORDERED");
    const one = await call(laptop, "GET", `/v1/admin/billing/orders/${orderId}`, undefined, companyHeaders);
    expect([one.status, one.body.organization_name]).toEqual([200, "Riverside Youth FC"]);
  });

  it("the signed-in membership says the company org is the company, and the customer is not", async () => {
    const companyMe = await call(laptop, "GET", "/v1/me", undefined, { authorization: companyHeaders.authorization! });
    expect(companyMe.status).toBe(200);
    expect(companyMe.body.memberships.find((m: { organization_id: string }) => m.organization_id === companyOrgId)?.is_company_org).toBe(true);
    const customerMe = await call(laptop, "GET", "/v1/me", undefined, { authorization: customerHeaders.authorization! });
    expect(customerMe.status).toBe(200);
    expect(customerMe.body.memberships.find((m: { organization_id: string }) => m.organization_id === customerOrgId)?.is_company_org).toBe(false);
  });

  it("the receipt comes back byte for byte through the laptop", async () => {
    const pdf = Buffer.from("%PDF-1.4 fake receipt for the test, not a real transfer\n", "utf8");
    const uploaded = await call(laptop, "POST", `/v1/billing/orders/${orderId}/proof`, pdf,
      { ...customerHeaders, "content-type": "application/octet-stream", "x-content-type": "application/pdf", "x-file-name": "transfer-receipt.pdf" });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body).toMatchObject({ status: "AWAITING_CONFIRMATION", proof_filename: "transfer-receipt.pdf",
      proof_size_bytes: pdf.length, proof_sha256: createHash("sha256").update(pdf).digest("hex") });
    const mine = await laptop.inject({ method: "GET", url: `/v1/admin/billing/orders/${orderId}/proof`,
      headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...companyHeaders } });
    expect(mine.statusCode).toBe(200);
    expect(mine.headers["content-type"]).toContain("application/pdf");
    expect(mine.headers["content-disposition"]).toContain("transfer-receipt.pdf");
    expect(Buffer.compare(mine.rawPayload as Buffer, pdf)).toBe(0);
  });

  it("the company confirms the customer's order on the laptop; central activates it and credits the wallet", async () => {
    const confirmed = await call(laptop, "POST", `/v1/admin/billing/orders/${orderId}/confirm`,
      { amount_received_minor: orderAmountMinor, bank_reference: "BANK-TEST-1" }, companyHeaders);
    expect(confirmed.status).toBe(201);
    expect(confirmed.body).toMatchObject({ status: "CONFIRMED", bank_reference: "BANK-TEST-1" });
    const [subs] = await root.query<RowDataPacket[]>("SELECT state FROM subscriptions WHERE id = ?", [confirmed.body.subscription_id]);
    expect(subs[0]?.state).toBe("ACTIVE");
    const [w] = await root.query<RowDataPacket[]>("SELECT COALESCE(SUM(amount), 0) AS b FROM wallet_ledger WHERE organization_id = ?", [customerOrgId]);
    expect(Number(w[0]?.b)).toBe(100 + 1000);
  });

  it("central down: the company pages say the account cannot be reached, never a local empty list", async () => {
    await central.close();
    const r = await call(laptop, "GET", "/v1/admin/billing/orders", undefined, companyHeaders);
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("CENTRAL_UNREACHABLE");
    await startCentral();
  });
});
