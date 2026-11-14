/**
 * User-to-user Invite (referral with token rewards, owner decision 2026-11-14), through the real HTTP stack
 * and database on the central server:
 *  - every user has their own invite code (GET /v1/invites/mine), the same on every read, different per user;
 *  - signing up with a valid code credits +25 at signup, so with the claimed 100-token grant the invitee
 *    holds 125; the inviter gets nothing at signup;
 *  - the inviter gets +100 exactly once when the invitee does something real — their first match analysis,
 *    or their first pack purchase. A second analysis, or a pack after the analysis, pays nothing more;
 *  - your own code and an unknown code are refused (400), and no account is created in either case.
 * The invite is for users (a player, a club, an academy — anyone), never framed as club-to-club.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportPKCS8, exportSPKI, generateKeyPair, SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf, type Config } from "../src/core/config";
import { Db } from "../src/core/db";
import { resetSignUpLimits } from "../src/modules/auth/auth.service";
import { appDb, AUDIENCE, ISSUER, key, rootDb, seedRights, seedWallet } from "./helpers";

const ORIGIN = "http://127.0.0.1:4310";
const PASSWORD = "correct horse battery staple";
let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let company: { orgId: string; headers: Record<string, string> };
/** The app's own signing key: session tokens from sign-up are signed with it, and the company member's
 *  test token below is signed with it too (the helpers' token() uses the global-setup key, which this
 *  app does not verify against — its jwtPublicKeyPem is this key's public half). */
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];

async function companyToken(sub: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: "RS256" }).setSubject(sub).setIssuer(ISSUER).setAudience(AUDIENCE)
    .setIssuedAt().setExpirationTime(Math.floor(Date.now() / 1000) + 600).sign(signingKey);
}

const email = () => `club-${key().slice(2, 14)}@test.invalid`;

async function post(a: NestFastifyApplication, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await a.inject({ method: "POST", url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

async function call(m: { headers: Record<string, string> }, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: { ...m.headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload };
}

interface Account { orgId: string; userId: string; email: string; headers: Record<string, string> }

/** Sign up a new user through the public endpoint, from its own network address. */
async function signUp(over: Partial<{ email: string; ip: string; inviteCode: string }> = {}): Promise<{ status: number; body: any; account?: Account }> {
  const e = over.email ?? email();
  const r = await app.inject({
    method: "POST", url: "/v1/auth/sign-up", remoteAddress: over.ip ?? `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`,
    headers: { "x-otsi-csrf": "1", origin: ORIGIN },
    payload: { email: e, display_name: "Coach Person", organization_name: "Riverside Youth FC", password: PASSWORD,
      ...(over.inviteCode ? { invite_code: over.inviteCode } : {}) },
  });
  const body = r.body ? JSON.parse(r.body) : undefined;
  if (r.statusCode !== 200) return { status: r.statusCode, body };
  const orgId = body.me.memberships[0].organization_id as string;
  return { status: 200, body, account: { orgId, userId: body.me.user.id, email: e,
    headers: { authorization: `Bearer ${body.access_token}`, "x-organization-id": orgId } } };
}

const balance = async (m: { headers: Record<string, string> }) => (await call(m, "GET", "/v1/wallet")).body;
const ledgerKinds = async (m: { headers: Record<string, string> }) =>
  (await call(m, "GET", "/v1/wallet/ledger")).body.entries.map((e: { kind: string }) => e.kind);

/** An INGESTED 90-minute video the organization may analyse (as in wallet.api.test.ts). */
async function seedVideo(m: Account, durationUs = 90 * 60 * 1_000_000): Promise<string> {
  const project = uuidv7(), video = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  const source = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', ?, ?, ?)",
    [video, m.orgId, project, durationUs, m.userId, source]);
  await seedRights(root, m.orgId, video);
  return video;
}

async function inviteCodeOf(m: Account): Promise<string> {
  const r = await call(m, "GET", "/v1/invites/mine");
  expect(r.status).toBe(200);
  return r.body.code as string;
}

beforeAll(async () => {
  ({ privateKey: signingKey } = await generateKeyPair("RS256", { extractable: true }));
  const signingKeyPem = await exportPKCS8(signingKey);
  const { privateKey: licenceKey, publicKey: licencePublicKey } = await generateKeyPair("EdDSA", { extractable: true });
  const companyOrgId = uuidv7();
  const cfg = {
    dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: publicKeyOf(signingKeyPem), port: 0,
    companyOrganizationId: companyOrgId,
    localAuth: { signingKeyPem, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
    central: { centralMode: true, licenceSigningKeyPem: await exportPKCS8(licenceKey), licencePublicKeyPem: await exportSPKI(licencePublicKey), licenceGraceDays: 14 },
  } as Config;
  app = await createApp(cfg);
  db = appDb();
  root = await rootDb();
  resetSignUpLimits();
  await root.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [companyOrgId, "OTSI", "otsi-invite"]);
  const companyUserId = uuidv7();
  const companySubject = `sub-${randomUUID()}`;
  await root.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [companyUserId, companySubject, `${companySubject}@test.invalid`, "OTSI Owner"]);
  await root.query("INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'ACTIVE')", [companyOrgId, companyUserId, "OWNER"]);
  await seedWallet(root, companyOrgId);
  company = { orgId: companyOrgId, headers: { authorization: `Bearer ${await companyToken(companySubject)}`, "x-organization-id": companyOrgId } };
  // OTSI's bank account, so a pack can be requested and confirmed in the pack-purchase test
  const bank = await post(app, "/v1/admin/billing/bank-accounts",
    { currency: "NGN", account_name: "OTSI", bank_name: "Test Bank", account_number: "1234567890", swift_iban: null, is_active: true }, company.headers);
  expect(bank.status).toBe(201);
});

afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("user-to-user invite", () => {
  it("gives every user their own invite code, the same on every read", async () => {
    const a = (await signUp()).account!;
    const first = await call(a, "GET", "/v1/invites/mine");
    expect(first.status).toBe(200);
    expect(first.body.code).toMatch(/^[A-Za-z0-9]{10}$/);
    const second = await call(a, "GET", "/v1/invites/mine");
    expect(second.body.code).toBe(first.body.code);
    const b = (await signUp()).account!;
    expect(await inviteCodeOf(b)).not.toBe(first.body.code);
    expect((await call({ headers: {} }, "GET", "/v1/invites/mine")).status).toBe(401);
  });

  it("credits +25 at signup with a valid code (125 with the grant), and pays the inviter nothing yet", async () => {
    const inviter = (await signUp()).account!;
    const code = await inviteCodeOf(inviter);
    const invitee = (await signUp({ inviteCode: code })).account!;
    // the bonus lands at signup, before the grant is claimed
    expect(await balance(invitee)).toMatchObject({ balance: 25, spendable_balance: 25 });
    expect((await call(invitee, "GET", "/v1/wallet/ledger")).body.entries[0]).toMatchObject({ kind: "INVITE_BONUS", amount: 25 });
    const grant = await call(invitee, "POST", "/v1/wallet/free-grant");
    expect(grant.status).toBe(201);
    expect(await balance(invitee)).toMatchObject({ balance: 125, spendable_balance: 125 });
    expect(await ledgerKinds(invitee)).toEqual(["FREE_GRANT", "INVITE_BONUS"]);
    // the inviter gets nothing at signup — only when the invitee does something real
    expect(await balance(inviter)).toMatchObject({ balance: 0 });
  });

  it("pays the inviter +100 on the invitee's first match analysis, exactly once", async () => {
    const inviter = (await signUp()).account!;
    const code = await inviteCodeOf(inviter);
    const invitee = (await signUp({ inviteCode: code })).account!;
    await call(invitee, "POST", "/v1/wallet/free-grant");
    const video = await seedVideo(invitee);
    const run = await call(invitee, "POST", `/v1/videos/${video}/analysis-runs`, {});
    expect(run.status).toBe(201);
    expect(await balance(invitee)).toMatchObject({ balance: 35 }); // 125 - 90 for the 90-minute analysis
    expect(await balance(inviter)).toMatchObject({ balance: 100 });
    expect(await ledgerKinds(inviter)).toEqual(["INVITE_REWARD"]);
    // the referral is marked paid, and a second analysis pays nothing more
    const [ref] = await root.query<RowDataPacket[]>("SELECT reward_paid_at FROM invite_referrals WHERE invitee_org_id = ?", [invitee.orgId]);
    expect(ref[0]!.reward_paid_at).not.toBeNull();
    await seedWallet(root, invitee.orgId, 100_000);
    const video2 = await seedVideo(invitee);
    expect((await call(invitee, "POST", `/v1/videos/${video2}/analysis-runs`, {})).status).toBe(201);
    expect(await balance(inviter)).toMatchObject({ balance: 100 });
    // a pack purchase after the analysis pays nothing more either — one reward per invitee
    const req = await call(invitee, "POST", "/v1/wallet/packs/request", { blocks: 1, currency: "NGN" });
    expect(req.status).toBe(201);
    expect((await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/confirm-receipt`, { invoice_ref: req.body.invoice_ref })).status).toBe(201);
    expect(await balance(inviter)).toMatchObject({ balance: 100 });
  });

  it("pays the inviter +100 on the invitee's first pack purchase instead", async () => {
    const inviter = (await signUp()).account!;
    const code = await inviteCodeOf(inviter);
    const invitee = (await signUp({ inviteCode: code })).account!;
    const req = await call(invitee, "POST", "/v1/wallet/packs/request", { blocks: 1, currency: "NGN" });
    expect(req.status).toBe(201);
    expect(await balance(inviter)).toMatchObject({ balance: 0 });
    expect((await call(company, "POST", `/v1/admin/wallet/pack-requests/${req.body.id}/confirm-receipt`, { invoice_ref: req.body.invoice_ref })).status).toBe(201);
    expect(await balance(inviter)).toMatchObject({ balance: 100 });
    expect(await ledgerKinds(inviter)).toEqual(["INVITE_REWARD"]);
    expect(await balance(invitee)).toMatchObject({ balance: 125 }); // 25 bonus + 100 pack
  });

  it("refuses your own code and an unknown code, and creates no account", async () => {
    const inviter = (await signUp()).account!;
    const code = await inviteCodeOf(inviter);
    const self = await signUp({ email: inviter.email, inviteCode: code });
    expect([self.status, self.body.code]).toEqual([400, "INVITE_SELF"]);
    // the refused sign-up created no account: the same email signs up cleanly without a code
    const unknownEmail = email();
    const unknown = await signUp({ email: unknownEmail, inviteCode: "ZZZZZZZZZZ" });
    expect([unknown.status, unknown.body.code]).toEqual([400, "INVITE_CODE_INVALID"]);
    expect((await signUp({ email: unknownEmail })).status).toBe(200);
    const malformed = await signUp({ inviteCode: "not-a-code" });
    expect([malformed.status, malformed.body.code]).toEqual([400, "INVITE_CODE_INVALID"]);
  });
});
