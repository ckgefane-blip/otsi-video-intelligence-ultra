/**
 * The licensing circle on the central server (ADR-146 §2–§4), through the real HTTP stack and database:
 *  - public sign-up creates a new organization with the person as OWNER and signs them in; a taken email is 409; the
 *    sign-up is rate-limited; anywhere but the central server it is 404;
 *  - a job ticket charges the central wallet once (asking again returns the same ticket, never a second charge), is
 *    Ed25519-signed for audience "otsi-vie-ticket" and verifies; a short balance is 402 and charges nothing;
 *  - a refund returns the tokens once;
 *  - offline spends settle: charged when the balance covers them, OWED when it does not; while tokens are owed no new
 *    ticket is issued; a top-up lets the debt be collected (oldest first) and tickets flow again; an owed spend that is
 *    refunded is simply cleared;
 *  - the licence carries the 200-token offline allowance.
 */
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
import { resetSignUpLimits, SIGN_UP_LIMIT_PER_IP } from "../src/modules/auth/auth.service";
import { verifyLicenceToken } from "../src/modules/licence/licence";
import { TICKET_AUDIENCE, verifyTicketToken } from "../src/modules/tickets/tickets";
import { appDb, AUDIENCE, ISSUER, key, rootDb, seedWallet } from "./helpers";

const ORIGIN = "http://127.0.0.1:4310";
const PASSWORD = "correct horse battery staple";
let app: NestFastifyApplication;
let localApp: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let cfg: Config;

const email = () => `club-${key().slice(2, 14)}@test.invalid`;

async function post(a: NestFastifyApplication, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await a.inject({ method: "POST", url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, cookie: r.headers["set-cookie"] as string | string[] | undefined };
}

interface Account { orgId: string; userId: string; headers: Record<string, string>; cookie: string }

/** Sign up a new club through the public endpoint, from its own network address. */
async function signUp(over: Partial<{ email: string; ip: string }> = {}): Promise<{ status: number; body: any; account?: Account }> {
  const r = await app.inject({
    method: "POST", url: "/v1/auth/sign-up", remoteAddress: over.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    headers: { "x-otsi-csrf": "1", origin: ORIGIN },
    payload: { email: over.email ?? email(), display_name: "Coach Person", organization_name: "Riverside Youth FC", password: PASSWORD },
  });
  const body = r.body ? JSON.parse(r.body) : undefined;
  if (r.statusCode !== 200) return { status: r.statusCode, body };
  const set = r.headers["set-cookie"];
  const cookie = /otsi_vie_refresh=([^;]+)/.exec(Array.isArray(set) ? set.join(";") : String(set))![1]!;
  const orgId = body.me.memberships[0].organization_id as string;
  return { status: 200, body, account: { orgId, userId: body.me.user.id, headers: { authorization: `Bearer ${body.access_token}`, "x-organization-id": orgId }, cookie } };
}

const job = () => ({ job_type: "ANALYSIS" as const, job_id: uuidv7() });

async function balance(orgId: string): Promise<number> {
  const [r] = await root.query<RowDataPacket[]>("SELECT COALESCE(SUM(amount), 0) AS b FROM wallet_ledger WHERE organization_id = ?", [orgId]);
  return Number(r[0]!.b);
}

describe("licensing circle on the central server (ADR-146)", () => {
  beforeAll(async () => {
    const { privateKey: signingKey } = await generateKeyPair("RS256", { extractable: true });
    const signingKeyPem = await exportPKCS8(signingKey);
    const { privateKey: licenceKey, publicKey: licencePublicKey } = await generateKeyPair("EdDSA", { extractable: true });
    const base = {
      dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: publicKeyOf(signingKeyPem), port: 0,
      localAuth: { signingKeyPem, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
    };
    cfg = { ...base, central: { centralMode: true, licenceSigningKeyPem: await exportPKCS8(licenceKey), licencePublicKeyPem: await exportSPKI(licencePublicKey), licenceGraceDays: 14 } } as Config;
    app = await createApp(cfg);
    localApp = await createApp(base as Config);          // a local install: no bank, no public sign-up
    db = appDb();
    root = await rootDb();
    resetSignUpLimits();
  });
  afterAll(async () => {
    await app?.close();
    await localApp?.close();
    await db?.onModuleDestroy();
    await root?.end();
  });

  describe("public sign-up", () => {
    it("creates a new organization with the person as OWNER and signs them in", async () => {
      const r = await signUp();
      expect(r.status).toBe(200);
      expect(r.body.access_token).toBeTruthy();
      const [m] = await root.query<RowDataPacket[]>(
        "SELECT m.role, o.name FROM memberships m JOIN organizations o ON o.id = m.organization_id WHERE m.user_id = ?", [r.account!.userId]);
      expect(m.map((x) => [x.role, x.name])).toEqual([["OWNER", "Riverside Youth FC"]]);
      // no free tokens appear by themselves: the free grant stays a claim button
      expect(await balance(r.account!.orgId)).toBe(0);
    });

    it("refuses a taken email (409) and a weak password (400)", async () => {
      const e = email();
      expect((await signUp({ email: e })).status).toBe(200);
      const again = await signUp({ email: e.toUpperCase() });
      expect([again.status, again.body.code]).toEqual([409, "EMAIL_TAKEN"]);
      const weak = await app.inject({ method: "POST", url: "/v1/auth/sign-up", remoteAddress: "10.9.9.9", headers: { "x-otsi-csrf": "1", origin: ORIGIN },
        payload: { email: email(), display_name: "Coach", organization_name: "Some FC", password: "short" } });
      expect(weak.statusCode).toBe(400);
    });

    it("is rate-limited per network address", async () => {
      resetSignUpLimits();
      const ip = "10.77.77.77";
      for (let i = 0; i < SIGN_UP_LIMIT_PER_IP; i++) expect((await signUp({ ip })).status).toBe(200);
      const over = await signUp({ ip });
      expect([over.status, over.body.code]).toEqual([429, "TOO_MANY_SIGN_UPS"]);
      resetSignUpLimits();
    });

    it("does not exist on a local install, and needs the app's CSRF header", async () => {
      const local = await post(localApp, "/v1/auth/sign-up", { email: email(), display_name: "Coach", organization_name: "Some FC", password: PASSWORD });
      expect(local.status).toBe(404);
      const r = await app.inject({ method: "POST", url: "/v1/auth/sign-up", headers: { origin: ORIGIN },
        payload: { email: email(), display_name: "Coach", organization_name: "Some FC", password: PASSWORD } });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("job tickets", () => {
    it("charge the central wallet once and come back signed for the ticket audience", async () => {
      const { account: a } = await signUp();
      await seedWallet(root, a!.orgId, 100);
      const j = job();
      const t = await post(app, "/v1/tickets", { ...j, amount: 30 }, a!.headers);
      expect(t.status).toBe(200);
      expect(t.body.balance).toBe(70);
      const claims = await verifyTicketToken(t.body.ticket_token, cfg);
      expect(claims).toMatchObject({ organization_id: a!.orgId, job_type: "ANALYSIS", job_id: j.job_id, amount: 30, ticket_id: t.body.ticket_id });
      // asking again for the same job: the same ticket, no second charge
      const again = await post(app, "/v1/tickets", { ...j, amount: 30 }, a!.headers);
      expect([again.status, again.body.ticket_id, again.body.balance]).toEqual([200, t.body.ticket_id, 70]);
      expect(await balance(a!.orgId)).toBe(70);
      // the same job for a different amount is refused
      expect((await post(app, "/v1/tickets", { ...j, amount: 40 }, a!.headers)).body.code).toBe("TICKET_AMOUNT_MISMATCH");
      // a ticket is not a licence: the licence check refuses it
      await expect(verifyLicenceToken(t.body.ticket_token, cfg)).rejects.toMatchObject({ code: "LICENCE_INVALID" });
      expect(TICKET_AUDIENCE).toBe("otsi-vie-ticket");
    });

    it("a short balance is 402 and charges nothing; another organization cannot refund it", async () => {
      const { account: a } = await signUp();
      await seedWallet(root, a!.orgId, 10);
      const r = await post(app, "/v1/tickets", { ...job(), amount: 30 }, a!.headers);
      expect([r.status, r.body.code]).toEqual([402, "INSUFFICIENT_TOKENS"]);
      expect(await balance(a!.orgId)).toBe(10);
      const j = job();
      expect((await post(app, "/v1/tickets", { ...j, amount: 10 }, a!.headers)).status).toBe(200);
      const { account: b } = await signUp();
      const other = await post(app, "/v1/tickets/refund", { ...j, reason: "not mine" }, b!.headers);
      expect(other.body.state).toBe("NONE");
      expect(await balance(a!.orgId)).toBe(0);
    });

    it("a refund returns the tokens once", async () => {
      const { account: a } = await signUp();
      await seedWallet(root, a!.orgId, 50);
      const j = job();
      await post(app, "/v1/tickets", { ...j, amount: 20 }, a!.headers);
      const r1 = await post(app, "/v1/tickets/refund", { ...j, reason: "Cancelled before it started" }, a!.headers);
      expect([r1.status, r1.body.state, r1.body.balance]).toEqual([200, "REFUNDED", 50]);
      const r2 = await post(app, "/v1/tickets/refund", { ...j, reason: "Cancelled before it started" }, a!.headers);
      expect([r2.body.state, r2.body.balance]).toEqual(["NONE", 50]);
      // a refunded job cannot be re-ticketed under the same id
      expect((await post(app, "/v1/tickets", { ...j, amount: 20 }, a!.headers)).body.code).toBe("TICKET_NOT_ACTIVE");
    });

    it("are refused to a VIEWER and on a local install", async () => {
      const { account: a } = await signUp();
      await root.query("UPDATE memberships SET role = 'VIEWER' WHERE user_id = ?", [a!.userId]);
      expect((await post(app, "/v1/tickets", { ...job(), amount: 1 }, a!.headers)).status).toBe(403);
      await root.query("UPDATE memberships SET role = 'OWNER' WHERE user_id = ?", [a!.userId]);
      // the local install does not know this central-signed access token's session, and has no bank anyway
      const local = await post(localApp, "/v1/tickets", { ...job(), amount: 1 }, a!.headers);
      expect(local.status).toBe(404);
    });
  });

  describe("offline spends", () => {
    it("settle: charged while the balance covers them, then OWED; no new ticket while owed; a top-up collects the debt", async () => {
      const { account: a } = await signUp();
      await seedWallet(root, a!.orgId, 50);
      const at = (m: number) => new Date(Date.UTC(2026, 10, 13, 10, m)).toISOString();
      const s1 = { ...job(), amount: 30, spent_at: at(1) }, s2 = { ...job(), amount: 30, spent_at: at(2) }, s3 = { ...job(), amount: 5, spent_at: at(3) };
      const r = await post(app, "/v1/tickets/settle", { spends: [s3, s1, s2] }, a!.headers);
      expect(r.status).toBe(200);
      // oldest first: s1 is charged; s2 does not fit; s3 would fit but queues behind the debt
      expect(Object.fromEntries(r.body.results.map((x: { job_id: string; state: string }) => [x.job_id, x.state])))
        .toEqual({ [s1.job_id]: "CHARGED", [s2.job_id]: "OWED", [s3.job_id]: "OWED" });
      expect([r.body.owed, r.body.balance]).toEqual([35, 20]);
      // settling again changes nothing
      const again = await post(app, "/v1/tickets/settle", { spends: [s1, s2, s3] }, a!.headers);
      expect([again.body.owed, again.body.balance]).toEqual([35, 20]);
      // while tokens are owed (and the balance cannot cover them), no new ticket
      const blocked = await post(app, "/v1/tickets", { ...job(), amount: 1 }, a!.headers);
      expect([blocked.status, blocked.body.code]).toEqual([402, "TOKENS_OWED"]);
      // the owed s3 job failed: it is simply cleared, no ledger movement
      const cleared = await post(app, "/v1/tickets/refund", { job_type: s3.job_type, job_id: s3.job_id, reason: "Failed" }, a!.headers);
      expect([cleared.body.state, cleared.body.balance]).toEqual(["REFUNDED", 20]);
      // a top-up: the next ticket first collects the 30 owed, then charges
      await seedWallet(root, a!.orgId, 100);
      const t = await post(app, "/v1/tickets", { ...job(), amount: 10 }, a!.headers);
      expect([t.status, t.body.balance]).toEqual([200, 80]);
      const [rows] = await root.query<RowDataPacket[]>("SELECT state, COUNT(*) AS n FROM job_tickets WHERE organization_id = ? GROUP BY state ORDER BY state", [a!.orgId]);
      expect(rows.map((x) => [x.state, Number(x.n)])).toEqual([["CHARGED", 3], ["REFUNDED", 1]]);
    });

    it("the licence carries the 200-token offline allowance", async () => {
      const { account: a } = await signUp();
      const snap = await app.inject({ method: "GET", url: "/v1/licence", headers: { origin: ORIGIN, ...a!.headers } });
      expect(JSON.parse(snap.body).offline_allowance).toBe(200);
      const r = await post(app, "/v1/licence/refresh", undefined, { "x-organization-id": a!.orgId, cookie: `otsi_vie_refresh=${a!.cookie}` });
      expect(r.status).toBe(200);
      expect((await verifyLicenceToken(r.body.licence_token, cfg)).offline_allowance).toBe(200);
    });
  });
});
