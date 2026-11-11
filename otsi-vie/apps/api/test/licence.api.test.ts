/**
 * Licence (ADR-144 §1.4/§1.5, v3 Ed25519) through the real HTTP stack and MySQL: the snapshot is derived from
 * the subscription (none here: the free tier), the entitlement grants (none) and the wallet ledger; a refresh
 * with a live session issues a server-signed Ed25519 licence token that verifies against the central server's
 * Ed25519 public key; a tampered token fails, an expired token fails with the stable LICENCE_EXPIRED code, and
 * a refresh without the refresh cookie is refused. The token's claims match the snapshot, and issuance is
 * written to the audit log.
 *
 * The verify function is also exercised directly (no HTTP, no database): the central server verifies its own
 * tokens by deriving its public key from its signing key, and with no key configured at all the engine accepts
 * no licence token.
 *
 * These tests typecheck here but cannot run on this VM — they need the owner's host MySQL 3507 (global-setup).
 */
import { exportPKCS8, exportSPKI, generateKeyPair, importPKCS8, SignJWT } from "jose";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf, type Config } from "../src/core/config";
import { Db } from "../src/core/db";
import { ApiError } from "../src/core/problem";
import { bootstrapOwner } from "../src/modules/auth/bootstrap";
import { LICENCE_AUDIENCE, verifyLicenceToken } from "../src/modules/licence/licence";
import { appDb, AUDIENCE, ISSUER, key, rootDb, seedWallet } from "./helpers";

const ORIGIN = "http://127.0.0.1:4310";
const PASSWORD = "correct horse battery staple";
let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let cfg: Config;
let owner: { email: string; organizationId: string; userId: string };
let accessToken: string;
let refreshCookie: string;
let signingKeyPem: string;

const email = () => `owner-${key().slice(2, 14)}@test.invalid`;

async function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: "POST", url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, cookie: r.headers["set-cookie"] as string | string[] | undefined };
}
async function get(url: string, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: "GET", url, headers: { origin: ORIGIN, ...headers } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
const authed = () => ({ authorization: `Bearer ${accessToken}`, "x-organization-id": owner.organizationId });

/** The refresh cookie value out of a set-cookie header (string or array). */
function cookieValue(setCookie: string | string[] | undefined): string {
  const all = Array.isArray(setCookie) ? setCookie : [setCookie ?? ""];
  for (const c of all) {
    const m = /otsi_vie_refresh=([^;]+)/.exec(c);
    if (m) return decodeURIComponent(m[1]!);
  }
  throw new Error("no refresh cookie was set");
}

describe("licence (ADR-144)", () => {
  beforeAll(async () => {
    const { privateKey: signingKey } = await generateKeyPair("RS256", { extractable: true });
    signingKeyPem = await exportPKCS8(signingKey);
    // the licence key is a SEPARATE Ed25519 pair from the RS256 access-token key: a licence is a server
    // statement, not a session, and the access-token key must never be able to mint one
    const { privateKey: licenceKey, publicKey: licencePublicKey } = await generateKeyPair("EdDSA", { extractable: true });
    const licenceSigningKeyPem = await exportPKCS8(licenceKey);
    const licencePublicKeyPem = await exportSPKI(licencePublicKey);
    cfg = {
      dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: publicKeyOf(signingKeyPem), port: 0,
      localAuth: { signingKeyPem, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN], webauthnRpId: "localhost", webauthnRpName: "OTSI VIE" },
      // this deployment IS the central server, and the Ed25519 public key is configured the way a local engine would hold it
      central: { centralMode: true, centralServerUrl: "https://accounts.test.otsi.invalid", licenceSigningKeyPem, licencePublicKeyPem, licenceGraceDays: 14 },
    };
    app = await createApp(cfg);
    db = appDb();
    root = await rootDb();
    const e = email();
    owner = { email: e, ...(await bootstrapOwner(db, { email: e, displayName: "Owner Person", organizationName: "Owner FC", password: PASSWORD, allowAdditional: true })) };
    const login = await post("/v1/auth/login", { email: e, password: PASSWORD });
    expect(login.status).toBe(200);
    accessToken = login.body.access_token as string;
    refreshCookie = cookieValue(login.cookie);
    await seedWallet(root, owner.organizationId, 500);
  });
  afterAll(async () => {
    await app?.close();
    await db?.onModuleDestroy();
    await root?.end();
  });

  it("the snapshot is the free tier with the wallet's spendable balance", async () => {
    const r = await get("/v1/licence", authed());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      organization_id: owner.organizationId,
      plan: "FREE",
      features: [],
      tokens: 500,
      valid_until: null,
      grace_until: null,
    });
  });

  it("the snapshot reflects the wallet balance when tokens are added", async () => {
    await seedWallet(root, owner.organizationId, 250);
    const r = await get("/v1/licence", authed());
    expect(r.status).toBe(200);
    expect(r.body.tokens).toBe(750);
  });

  it("a refresh issues a signed licence token whose claims match the snapshot", async () => {
    const r = await post("/v1/licence/refresh", {}, { ...authed(), cookie: `otsi_vie_refresh=${encodeURIComponent(refreshCookie)}` });
    expect(r.status).toBe(200);
    expect(typeof r.body.licence_token).toBe("string");
    expect(r.body.expires_at).toBeDefined();
    const claims = await verifyLicenceToken(r.body.licence_token as string, cfg);
    expect(claims).toMatchObject({
      organization_id: owner.organizationId,
      plan: "FREE",
      features: [],
      tokens: 750,
    });
    expect(claims.expires_at).toBe(r.body.expires_at);
    // issuance is audited (and nothing else is written: no ledger row, no subscription)
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT action, entity_type, entity_id FROM audit_events WHERE organization_id = ? AND action = 'licence.refreshed' ORDER BY id DESC LIMIT 1",
      [owner.organizationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "licence.refreshed", entity_type: "organization", entity_id: owner.organizationId });
  });

  it("a refresh without the refresh cookie is refused (a Bearer token alone cannot mint a licence)", async () => {
    const r = await post("/v1/licence/refresh", {}, authed());
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("NO_SESSION");
  });

  it("a refresh with an EXPIRED access token (and a live refresh cookie) succeeds", async () => {
    // the refresh authenticates on the refresh cookie alone: the access token's expiry must not matter
    // (it expires 10 minutes after sign-in, and the licence must outlive it)
    const sub = JSON.parse(Buffer.from(accessToken.split(".")[1]!, "base64url").toString("utf8")).sub as string;
    const key = await importPKCS8(signingKeyPem, "RS256");
    const expired = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setSubject(sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setJti(uuidv7())
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const r = await post("/v1/licence/refresh", {}, {
      authorization: `Bearer ${expired}`,
      "x-organization-id": owner.organizationId,
      cookie: `otsi_vie_refresh=${encodeURIComponent(refreshCookie)}`,
    });
    expect(r.status).toBe(200);
    expect(typeof r.body.licence_token).toBe("string");
    const claims = await verifyLicenceToken(r.body.licence_token as string, cfg);
    expect(claims.organization_id).toBe(owner.organizationId);
  });

  it("a refresh without X-Organization-Id is refused (the cookie alone names no organization)", async () => {
    const r = await post("/v1/licence/refresh", {}, {
      authorization: `Bearer ${accessToken}`,
      cookie: `otsi_vie_refresh=${encodeURIComponent(refreshCookie)}`,
    });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ORGANIZATION_REQUIRED");
  });

  it("a tampered token fails verification with LICENCE_INVALID", async () => {
    const r = await post("/v1/licence/refresh", {}, { ...authed(), cookie: `otsi_vie_refresh=${encodeURIComponent(refreshCookie)}` });
    expect(r.status).toBe(200);
    const parts = (r.body.licence_token as string).split(".");
    const payload = parts[1]!;
    const tampered = `${parts[0]}.${payload.slice(0, -1)}${payload.slice(-1) === "A" ? "B" : "A"}.${parts[2]}`;
    await expect(verifyLicenceToken(tampered, cfg)).rejects.toMatchObject({ status: 401, code: "LICENCE_INVALID" });
  });

  it("an expired token fails verification with LICENCE_EXPIRED", async () => {
    const key = await importPKCS8(cfg.central!.licenceSigningKeyPem!, "EdDSA");
    const expired = await new SignJWT({
      organization_id: owner.organizationId, plan: "FREE", features: [], tokens: 750,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "JWT" })
      .setSubject(owner.organizationId)
      .setIssuer(ISSUER)
      .setAudience(LICENCE_AUDIENCE)
      .setIssuedAt()
      .setJti(uuidv7())
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    await expect(verifyLicenceToken(expired, cfg)).rejects.toMatchObject({ status: 401, code: "LICENCE_EXPIRED" });
  });

  it("the central server verifies its own tokens from its signing key (no licence public key configured)", async () => {
    const r = await post("/v1/licence/refresh", {}, { ...authed(), cookie: `otsi_vie_refresh=${encodeURIComponent(refreshCookie)}` });
    expect(r.status).toBe(200);
    const issuerCfg: Config = { ...cfg, central: { centralMode: true, licenceSigningKeyPem: cfg.central!.licenceSigningKeyPem!, licenceGraceDays: 14 } };
    const claims = await verifyLicenceToken(r.body.licence_token as string, issuerCfg);
    expect(claims.organization_id).toBe(owner.organizationId);
  });

  it("with no verification key at all the engine accepts no licence token", async () => {
    const r = await post("/v1/licence/refresh", {}, { ...authed(), cookie: `otsi_vie_refresh=${encodeURIComponent(refreshCookie)}` });
    expect(r.status).toBe(200);
    const noKeyCfg: Config = { ...cfg, central: { centralMode: false, licenceGraceDays: 14 } };
    await expect(verifyLicenceToken(r.body.licence_token as string, noKeyCfg)).rejects.toMatchObject({ status: 401, code: "LICENCE_NOT_CONFIGURED" });
    // the same token is rejected as a plain ApiError (not a crash) when the caller awaits it directly
    try {
      await verifyLicenceToken("not-a-token", noKeyCfg);
      throw new Error("expected LICENCE_NOT_CONFIGURED");
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).code).toBe("LICENCE_NOT_CONFIGURED");
    }
  });
});
