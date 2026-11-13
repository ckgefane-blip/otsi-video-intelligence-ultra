/**
 * The licensing circle end to end (ADR-146): a real central server (central mode, the test MySQL/MariaDB database, listening
 * on a port) and a linked desktop (its own SQLite file, as on a club's laptop) talking to it over HTTP.
 *  - "Create account" on the laptop creates the OTSI account and organization on central and mirrors them with the same ids;
 *    the laptop gets a licence with the 200-token offline allowance;
 *  - the wallet page on the laptop shows central's balance (no local ledger);
 *  - paid work charges central and keeps a signed ticket; a job that never starts is refunded; a refund goes back to central;
 *  - no licence: paid work is refused before any charge;
 *  - central down: paid work runs inside the offline allowance, then is refused; sign-in still works with the local copy of
 *    the password; when central is back the background sync settles the offline spends.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportPKCS8, exportSPKI, generateKeyPair } from "jose";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf, type Config } from "../src/core/config";
import { Db } from "../src/core/db";
import { CentralLinkService, LINKED_LICENCE_AUDIENCE } from "../src/modules/central/link";
import { LICENCE_AUDIENCE } from "../src/modules/licence/licence";
import { verifyTicketToken } from "../src/modules/tickets/tickets";
import { WalletService } from "../src/modules/wallet/wallet";
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
let laptopCfg: Config;
let laptopDb: Db;
let laptopFile: string;
let root: mysql.Connection;
let orgId: string;
let userId: string;
let email: string;
let laptopHeaders: Record<string, string>;

async function startCentral(): Promise<void> {
  central = await createApp(centralCfg);
  await central.listen(centralPort, "127.0.0.1");
  centralPort = Number(new URL(await central.getUrl()).port);
}

async function call(a: NestFastifyApplication, method: "GET" | "POST", url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await a.inject({ method, url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

async function centralBalance(): Promise<number> {
  const [r] = await root.query<RowDataPacket[]>("SELECT COALESCE(SUM(amount), 0) AS b FROM wallet_ledger WHERE organization_id = ?", [orgId]);
  return Number(r[0]!.b);
}

const charge = (amount: number, id = uuidv7()) =>
  laptopDb.tx((c) => laptop.get(WalletService).charge(c, orgId, userId, { type: "ANALYSIS", id, amount }));

async function eventually(check: () => Promise<boolean>, ms = 5000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) { if (await check()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error("condition not reached in time");
}

describe("linked desktop against a central server (ADR-146)", () => {
  beforeAll(async () => {
    const { privateKey: licenceKey, publicKey: licencePub } = await generateKeyPair("EdDSA", { extractable: true });
    const licencePublicKeyPem = await exportSPKI(licencePub);
    const centralKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
    centralCfg = {
      dbDsn: inject("appDsn"), jwtIssuer: "https://accounts.test.otsi.invalid", jwtAudience: "otsi-vie-api", jwtPublicKeyPem: publicKeyOf(centralKey), port: 0,
      localAuth: { signingKeyPem: centralKey, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
      central: { centralMode: true, licenceSigningKeyPem: await exportPKCS8(licenceKey), licencePublicKeyPem, licenceGraceDays: 14 },
    } as Config;
    await startCentral();

    laptopFile = path.join(tmpdir(), `otsi-linked-${randomBytes(6).toString("hex")}.db`);
    const raw = new DatabaseSync(laptopFile);
    raw.exec(readFileSync(BOOTSTRAP, "utf8"));
    raw.close();
    const laptopKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
    laptopCfg = {
      dbBackend: "sqlite", dbPath: laptopFile, jwtIssuer: "http://127.0.0.1:4520", jwtAudience: "otsi-vie-api", jwtPublicKeyPem: publicKeyOf(laptopKey), port: 0,
      localAuth: { signingKeyPem: laptopKey, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
      central: { centralMode: false, centralServerUrl: `http://127.0.0.1:${centralPort}`, licencePublicKeyPem, licenceGraceDays: 14 },
    } as Config;
    laptop = await createApp(laptopCfg);
    laptopDb = laptop.get(Db);
    root = await rootDb();
  });

  afterAll(async () => {
    await laptop?.close();
    await central?.close();
    await root?.end();
    for (const suffix of ["", "-wal", "-shm"]) { try { unlinkSync(laptopFile + suffix); } catch { /* gone */ } }
  });

  it("the laptop says it signs in with the OTSI account", async () => {
    expect((await call(laptop, "GET", "/v1/auth/mode")).body).toEqual({ mode: "linked", central_url: `http://127.0.0.1:${centralPort}` });
    expect((await call(central, "GET", "/v1/auth/mode")).body.mode).toBe("central");
    expect(LINKED_LICENCE_AUDIENCE).toBe(LICENCE_AUDIENCE);
  });

  it("Create account makes the account on central and mirrors it here with the same ids, with a licence", async () => {
    email = `club-${key().slice(2, 14)}@test.invalid`;
    const r = await call(laptop, "POST", "/v1/auth/setup", { email, display_name: "Coach Person", organization_name: "Riverside Youth FC", password: PASSWORD });
    expect(r.status).toBe(200);
    orgId = r.body.me.memberships[0].organization_id;
    userId = r.body.me.user.id;
    laptopHeaders = { authorization: `Bearer ${r.body.access_token}`, "x-organization-id": orgId };
    const [c] = await root.query<RowDataPacket[]>("SELECT o.name, m.role FROM organizations o JOIN memberships m ON m.organization_id = o.id WHERE o.id = ? AND m.user_id = ?", [orgId, userId]);
    expect(c.map((x) => [x.name, x.role])).toEqual([["Riverside Youth FC", "OWNER"]]);
    const local = await laptopDb.one<RowDataPacket>("SELECT name FROM organizations WHERE id = ?", [orgId]);
    expect(local?.name).toBe("Riverside Youth FC");
    const link = await laptopDb.one<RowDataPacket>("SELECT refresh_sealed, licence_token FROM central_links WHERE user_id = ? AND organization_id = ?", [userId, orgId]);
    expect(link?.licence_token).toBeTruthy();
    expect(String(link?.refresh_sealed)).toMatch(/^v1\./);                  // sealed, never in clear
    const lic = await laptop.get(CentralLinkService).licence(orgId);
    expect([lic.state, lic.claims?.offline_allowance]).toEqual(["valid", 200]);
  });

  it("the wallet page shows central's balance, and there is no local ledger", async () => {
    await seedWallet(root, orgId, 100);
    const w = await call(laptop, "GET", "/v1/wallet", undefined, laptopHeaders);
    expect([w.status, w.body.spendable_balance]).toEqual([200, 100]);
    const lic = await call(laptop, "GET", "/v1/licence", undefined, laptopHeaders);
    expect([lic.status, lic.body.tokens, lic.body.offline_allowance]).toEqual([200, 100, 200]);
    const local = await laptopDb.one<RowDataPacket>("SELECT COUNT(*) AS n FROM wallet_ledger");
    expect(Number(local?.n)).toBe(0);
  });

  it("paid work charges central and keeps a signed ticket; a refund goes back to central", async () => {
    const id = uuidv7();
    await charge(30, id);
    expect(await centralBalance()).toBe(70);
    const t = await laptopDb.one<RowDataPacket>("SELECT source, state, ticket_token FROM linked_job_tickets WHERE job_id = ?", [id]);
    expect([t?.source, t?.state]).toEqual(["ONLINE", "ACTIVE"]);
    expect((await verifyTicketToken(String(t?.ticket_token), centralCfg)).job_id).toBe(id);
    // the same job again: no second charge
    await charge(30, id);
    expect(await centralBalance()).toBe(70);
    await laptopDb.tx((c) => laptop.get(WalletService).refundForJob(c, orgId, userId, { type: "ANALYSIS", id, reason: "Cancelled before it started" }));
    expect(await centralBalance()).toBe(100);
  });

  it("a job that never starts (its transaction rolls back) gets its central charge back", async () => {
    const id = uuidv7();
    await expect(laptopDb.tx(async (c) => {
      await laptop.get(WalletService).charge(c, orgId, userId, { type: "REEL_RENDER", id, amount: 10 });
      throw new Error("the job could not be queued");
    })).rejects.toThrow("could not be queued");
    await eventually(async () => (await centralBalance()) === 100);
    expect(await laptopDb.one<RowDataPacket>("SELECT id FROM linked_job_tickets WHERE job_id = ?", [id])).toBeUndefined();
  });

  it("a short central balance is refused with central's own message", async () => {
    await expect(charge(500)).rejects.toMatchObject({ status: 402, code: "INSUFFICIENT_TOKENS" });
    expect(await centralBalance()).toBe(100);
  });

  it("no licence on this computer: paid work is refused before any charge", async () => {
    const saved = await laptopDb.one<RowDataPacket>("SELECT licence_token FROM central_links WHERE organization_id = ?", [orgId]);
    await laptopDb.rows("UPDATE central_links SET licence_token = NULL WHERE organization_id = ?", [orgId]);
    await expect(charge(5)).rejects.toMatchObject({ status: 402, code: "LICENCE_REQUIRED" });
    expect(await centralBalance()).toBe(100);
    await laptopDb.rows("UPDATE central_links SET licence_token = ? WHERE organization_id = ?", [saved?.licence_token, orgId]);
  });

  it("central down: work runs inside the 200-token allowance, sign-in still works; back online, it settles", async () => {
    await central.close();
    const a = uuidv7(), b = uuidv7();
    await charge(120, a);
    await charge(80, b);
    await expect(charge(1)).rejects.toMatchObject({ status: 402, code: "OFFLINE_ALLOWANCE_USED" });
    const off = await laptopDb.rows<RowDataPacket>("SELECT source, state FROM linked_job_tickets WHERE job_id IN (?, ?)", [a, b]);
    expect(off.map((x) => `${x.source}:${x.state}`)).toEqual(["OFFLINE:ACTIVE", "OFFLINE:ACTIVE"]);
    // the wallet page says plainly that the account cannot be reached
    expect((await call(laptop, "GET", "/v1/wallet", undefined, laptopHeaders)).body.code).toBe("CENTRAL_UNREACHABLE");
    // the licence still shows, from the signed copy on this computer (valid until that copy expires, then its grace)
    const lic = await call(laptop, "GET", "/v1/licence", undefined, laptopHeaders);
    expect([lic.status, lic.body.organization_id, lic.body.offline_allowance]).toEqual([200, orgId, 200]);
    expect(Date.parse(lic.body.grace_until) - Date.parse(lic.body.valid_until)).toBe(14 * 86_400_000);
    // sign-in on this computer with the local copy of the password
    const login = await call(laptop, "POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect((await call(laptop, "POST", "/v1/auth/login", { email, password: "wrong password here" })).status).toBe(401);
    // back online, after a top-up (100 + 200 = 300): the sync settles both offline jobs, oldest first
    await startCentral();
    await seedWallet(root, orgId, 200);
    const out = await laptop.get(CentralLinkService).sync(orgId);
    expect(out).toEqual({ settled: 2, owed: 0 });
    expect(await centralBalance()).toBe(100);
    const settled = await laptopDb.rows<RowDataPacket>("SELECT state FROM linked_job_tickets WHERE job_id IN (?, ?)", [a, b]);
    expect(settled.map((x) => x.state)).toEqual(["SETTLED", "SETTLED"]);
  });

  it("signing in again online goes through central", async () => {
    const login = await call(laptop, "POST", "/v1/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.me.memberships.map((m: { organization_id: string }) => m.organization_id)).toContain(orgId);
  });
});
