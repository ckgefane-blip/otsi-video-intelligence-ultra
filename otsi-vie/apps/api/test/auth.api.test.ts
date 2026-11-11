/**
 * Local sign-in (ADR-021) through the real HTTP stack and MySQL: first-owner bootstrap, login, CSRF / origin checks, no account
 * enumeration, lockout, refresh rotation with reuse detection, logout, GET /v1/me, and the issued tokens working on tenant endpoints.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf } from "../src/core/config";
import { Db } from "../src/core/db";
import { bootstrapOwner } from "../src/modules/auth/bootstrap";
import { appDb, AUDIENCE, ISSUER, key, rootDb } from "./helpers";

const ORIGIN = "http://127.0.0.1:4310";
const PASSWORD = "correct horse battery staple";
let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let owner: { email: string; organizationId: string; userId: string };

const email = () => `owner-${key().slice(2, 14)}@test.invalid`;

async function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: "POST", url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, cookie: r.headers["set-cookie"] as string | undefined };
}
const cookieValue = (setCookie: string | undefined) => /^(otsi_vie_refresh=[^;]*)/.exec(setCookie ?? "")?.[1] ?? "";
const login = (e: string, p = PASSWORD, h: Record<string, string> = {}) => post("/v1/auth/login", { email: e, password: p }, h);

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const signingKeyPem = await exportPKCS8(privateKey);
  app = await createApp({
    dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: publicKeyOf(signingKeyPem), port: 0,
    localAuth: { signingKeyPem, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN] },
  });
  db = appDb();
  root = await rootDb();
  const e = email();
  owner = { email: e, ...(await bootstrapOwner(db, { email: e, displayName: "Owner Person", organizationName: "Owner FC", password: PASSWORD, allowAdditional: true })) };
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("first-owner bootstrap", () => {
  it("creates the organization, owner membership, credential and audit rows, storing only a hash", async () => {
    const [m] = await root.query<RowDataPacket[]>("SELECT role, status FROM memberships WHERE organization_id = ? AND user_id = ?", [owner.organizationId, owner.userId]);
    expect(m[0]).toEqual({ role: "OWNER", status: "ACTIVE" });
    const [c] = await root.query<RowDataPacket[]>("SELECT password_hash FROM local_credentials WHERE user_id = ?", [owner.userId]);
    expect(c[0]!.password_hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(c[0]!.password_hash).not.toContain(PASSWORD);
    const [a] = await root.query<RowDataPacket[]>("SELECT action, actor_kind, actor_service FROM audit_events WHERE organization_id = ? ORDER BY id", [owner.organizationId]);
    expect(a).toEqual([
      { action: "organization.created", actor_kind: "SYSTEM", actor_service: "bootstrap" },
      { action: "membership.created", actor_kind: "SYSTEM", actor_service: "bootstrap" },
    ]);
  });

  it("refuses a second organization unless asked, a reused email, and a short password", async () => {
    await expect(bootstrapOwner(db, { email: email(), displayName: "X Y", organizationName: "Another", password: PASSWORD })).rejects.toThrow(/already has an organization/);
    await expect(bootstrapOwner(db, { email: owner.email, displayName: "X Y", organizationName: "Another", password: PASSWORD, allowAdditional: true })).rejects.toThrow(/already has an account/);
    await expect(bootstrapOwner(db, { email: email(), displayName: "X Y", organizationName: "Another", password: "short", allowAdditional: true })).rejects.toThrow(/at least 12/);
  });
});

describe("login", () => {
  it("signs in, sets an HttpOnly SameSite=Strict refresh cookie, and the token works for /me and tenant endpoints", async () => {
    const r = await login(owner.email.toUpperCase());                               // emails are case-insensitive
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ token_type: "Bearer", expires_in: 600, me: { user: { id: owner.userId }, memberships: [{ organization_id: owner.organizationId, organization_name: "Owner FC", role: "OWNER" }] } });
    expect(r.cookie).toMatch(/^otsi_vie_refresh=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=1209600$/);
    const claims = decodeJwt(r.body.access_token);
    expect([claims.iss, claims.aud, claims.sub, (claims.exp ?? 0) - (claims.iat ?? 0)]).toEqual([ISSUER, AUDIENCE, `local:${owner.userId}`, 600]);
    const auth = { authorization: `Bearer ${r.body.access_token}` };
    const me = await app.inject({ method: "GET", url: "/v1/me", headers: auth });
    expect(JSON.parse(me.body).user.email).toBe(owner.email);
    const created = await app.inject({ method: "POST", url: "/v1/players", headers: { ...auth, "x-organization-id": owner.organizationId, "idempotency-key": key() }, payload: { display_name: "Real Player" } });
    expect(created.statusCode).toBe(201);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const unknown = await login(email(), PASSWORD);
    const wrong = await login(owner.email, "not the password at all");
    expect([unknown.status, unknown.body.code, unknown.body.message]).toEqual([401, "INVALID_CREDENTIALS", "Email or password is incorrect."]);
    expect([wrong.status, wrong.body.code, wrong.body.message]).toEqual([unknown.status, unknown.body.code, unknown.body.message]);
    expect(unknown.cookie).toBeUndefined();
  });

  it("requires the app's CSRF header and an allowed origin", async () => {
    const noHeader = await app.inject({ method: "POST", url: "/v1/auth/login", headers: { origin: ORIGIN }, payload: { email: owner.email, password: PASSWORD } });
    expect([noHeader.statusCode, JSON.parse(noHeader.body).code]).toEqual([403, "CSRF_HEADER_REQUIRED"]);
    const evil = await login(owner.email, PASSWORD, { origin: "https://evil.example" });
    expect([evil.status, evil.body.code]).toEqual([403, "ORIGIN_NOT_ALLOWED"]);
    expect((await login(owner.email, PASSWORD, { "x-otsi-csrf": "0" })).body.code).toBe("CSRF_HEADER_REQUIRED");
  });

  it("locks the credential after 5 failures, even for the right password, until the lock expires", async () => {
    const e = email();
    await bootstrapOwner(db, { email: e, displayName: "Lock Test", organizationName: "Lock FC", password: PASSWORD, allowAdditional: true });
    for (let i = 0; i < 5; i++) expect((await login(e, "wrong password here")).status).toBe(401);
    const locked = await login(e, PASSWORD);
    expect([locked.status, locked.body.code]).toEqual([429, "ACCOUNT_LOCKED"]);
    await root.query("UPDATE local_credentials SET locked_until = NOW(6) - INTERVAL 1 SECOND WHERE email_normalized = ?", [e]);
    expect((await login(e, PASSWORD)).status).toBe(200);
    const [c] = await root.query<RowDataPacket[]>("SELECT failed_attempts, locked_until FROM local_credentials WHERE email_normalized = ?", [e]);
    expect(c[0]).toEqual({ failed_attempts: 0, locked_until: null });
  });
});

describe("sessions", () => {
  it("rotates the refresh token; a replay soon after is a lost response, a later replay ends the whole session family", async () => {
    const first = cookieValue((await login(owner.email)).cookie);
    const r1 = await post("/v1/auth/refresh", undefined, { cookie: first });
    expect(r1.status).toBe(200);
    const second = cookieValue(r1.cookie);
    expect(second).not.toBe(first);
    // within the grace window a replay is a lost response (aborted request): it continues the family
    const lost = await post("/v1/auth/refresh", undefined, { cookie: first });
    expect(lost.status).toBe(200);
    // after the window, a replayed token is theft
    await root.query("UPDATE auth_sessions SET rotated_at = rotated_at - INTERVAL 60 SECOND WHERE rotated_at IS NOT NULL AND user_id = ?", [owner.userId]);
    const replay = await post("/v1/auth/refresh", undefined, { cookie: first });
    expect([replay.status, replay.body.code]).toEqual([401, "SESSION_REVOKED"]);
    expect(replay.cookie).toMatch(/Max-Age=0/);
    const afterTheft = await post("/v1/auth/refresh", undefined, { cookie: second });   // the legitimate newer token is revoked too
    expect(afterTheft.status).toBe(401);
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT DISTINCT revoke_reason FROM auth_sessions WHERE family_id = (SELECT family_id FROM auth_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1)", [owner.userId]);
    expect(rows.map((r) => r.revoke_reason)).toEqual(["REUSE_DETECTED"]);
  });

  it("logs out: the cookie is cleared and the session cannot be refreshed", async () => {
    const c = cookieValue((await login(owner.email)).cookie);
    const out = await post("/v1/auth/logout", undefined, { cookie: c });
    expect(out.status).toBe(204);
    expect(out.cookie).toMatch(/^otsi_vie_refresh=; Path=\/; HttpOnly; SameSite=Strict; Max-Age=0$/);
    expect((await post("/v1/auth/refresh", undefined, { cookie: c })).body.code).toBe("SESSION_REVOKED");
    expect((await post("/v1/auth/refresh")).body.code).toBe("NO_SESSION");
  });

  it("a malformed refresh cookie is no session (401), not a server error (500)", async () => {
    const r = await post("/v1/auth/refresh", undefined, { cookie: "otsi_vie_refresh=%zz" });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("NO_SESSION");
  });

  it("stores only the hash of a refresh token", async () => {
    const c = cookieValue((await login(owner.email)).cookie).split("=")[1]!;
    const [rows] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM auth_sessions WHERE refresh_hash = ?", [c]);
    expect(Number(rows[0]!.n)).toBe(0);
  });
});

describe("accounts without an organization", () => {
  it("can sign in but act for no organization", async () => {
    const e = email();
    const r = await bootstrapOwner(db, { email: e, displayName: "Former Member", organizationName: "Old FC", password: PASSWORD, allowAdditional: true });
    await root.query("UPDATE memberships SET status = 'SUSPENDED' WHERE user_id = ?", [r.userId]);
    const s = await login(e);
    expect(s.body.me.memberships).toEqual([]);
    const denied = await app.inject({ method: "GET", url: "/v1/players/00000000-0000-0000-0000-000000000000",
      headers: { authorization: `Bearer ${s.body.access_token}`, "x-organization-id": r.organizationId } });
    expect([denied.statusCode, JSON.parse(denied.body).code]).toEqual([403, "NOT_A_MEMBER"]);
  });

  it("/me needs a valid token", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/me" });
    expect([r.statusCode, JSON.parse(r.body).code]).toEqual([401, "UNAUTHENTICATED"]);
  });
});
