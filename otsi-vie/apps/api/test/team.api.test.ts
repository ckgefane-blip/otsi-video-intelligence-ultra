/**
 * Team and access (roadmap Step 1) through the real HTTP stack and MySQL: inviting by one-time link, a new person accepting with a
 * password, an existing account accepting after sign-in, roles and the owner rules, removing a member, tenant isolation, and two-step
 * sign-in with an authenticator app (set-up, sign-in with a code, replay refused, recovery codes, lockout, switching off).
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { exportPKCS8, generateKeyPair } from "jose";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf } from "../src/core/config";
import { Db } from "../src/core/db";
import { base32Decode, codeAt, stepAt } from "../src/core/totp";
import { bootstrapOwner } from "../src/modules/auth/bootstrap";
import { appDb, AUDIENCE, ISSUER, key, rootDb } from "./helpers";

const ORIGIN = "http://127.0.0.1:4310";
const PASSWORD = "correct horse battery staple";
let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;

const email = (tag = "p") => `${tag}-${key().slice(2, 14)}@test.invalid`;

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", url: string, opts: { body?: unknown; headers?: Record<string, string> } = {}) {
  const r = await app.inject({ method, url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...opts.headers }, ...(opts.body === undefined ? {} : { payload: opts.body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, cookie: r.headers["set-cookie"] as string | undefined };
}
const login = (e: string, p = PASSWORD) => call("POST", "/v1/auth/login", { body: { email: e, password: p } });

interface Person { email: string; userId: string; token: string; headers: Record<string, string>; account: Record<string, string> }
async function signedIn(e: string, orgId: string): Promise<Person> {
  const r = await login(e);
  expect(r.status).toBe(200);
  const account = { authorization: `Bearer ${r.body.access_token}` };
  return { email: e, userId: r.body.me.user.id, token: r.body.access_token, account, headers: { ...account, "x-organization-id": orgId } };
}

let orgId: string;
let owner: Person;

/** owner invites `role`; a brand-new person accepts with a password and is signed in */
async function newMember(role: string, by: Person = owner): Promise<Person> {
  const e = email(role.toLowerCase());
  const inv = await call("POST", "/v1/team/invitations", { headers: by.headers, body: { email: e, role } });
  expect(inv.status).toBe(201);
  const acc = await call("POST", "/v1/auth/invitations/accept", { body: { token: inv.body.token, display_name: `${role} Person`, password: PASSWORD } });
  expect(acc.status).toBe(200);
  return signedIn(e, orgId);
}

beforeAll(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  const signingKeyPem = await exportPKCS8(privateKey);
  app = await createApp({
    dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: publicKeyOf(signingKeyPem), port: 0,
    localAuth: { signingKeyPem, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN] },
  });
  db = appDb();
  root = await rootDb();
  const e = email("owner");
  orgId = (await bootstrapOwner(db, { email: e, displayName: "Team Owner", organizationName: "Team FC", password: PASSWORD, allowAdditional: true })).organizationId;
  owner = await signedIn(e, orgId);
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("invitations", () => {
  it("invites by one-time link: only the hash is stored, the link shows who invited whom, a new person accepts and is signed in", async () => {
    const e = email("new");
    const inv = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: e.toUpperCase(), role: "ANALYST" } });
    expect(inv.status).toBe(201);
    expect(inv.body.invitation).toMatchObject({ email: e, role: "ANALYST", invited_by: "Team Owner", state: "OPEN" });
    expect(inv.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [rows] = await root.query<RowDataPacket[]>("SELECT token_hash FROM organization_invitations WHERE id = ?", [inv.body.invitation.id]);
    expect(rows[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.token_hash).not.toContain(inv.body.token);

    const preview = await call("GET", `/v1/public/invitations/${inv.body.token}`);
    expect(preview.body).toMatchObject({ organization_name: "Team FC", email: e, role: "ANALYST", invited_by: "Team Owner", has_account: false });

    const weak = await call("POST", "/v1/auth/invitations/accept", { body: { token: inv.body.token, display_name: "New Person", password: "short" } });
    expect([weak.status, weak.body.code]).toEqual([400, "WEAK_PASSWORD"]);
    const acc = await call("POST", "/v1/auth/invitations/accept", { body: { token: inv.body.token, display_name: "New Person", password: PASSWORD } });
    expect(acc.status).toBe(200);
    expect(acc.cookie).toMatch(/^otsi_vie_refresh=/);
    // the new person is a member of Team FC — and Team FC is not the company org, so the
    // membership carries is_company_org: false (the bank-account fix adds that flag to every
    // membership in the Me contract; a company-org member would read true).
    expect(acc.body.me.memberships).toEqual([{ organization_id: orgId, organization_name: "Team FC", role: "ANALYST", is_company_org: false }]);
    // the link works once
    const again = await call("POST", "/v1/auth/invitations/accept", { body: { token: inv.body.token, display_name: "Someone Else", password: PASSWORD } });
    expect([again.status, again.body.code]).toEqual([410, "INVITATION_USED"]);
    expect((await call("GET", `/v1/public/invitations/${inv.body.token}`)).status).toBe(410);
    const [a] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE organization_id = ? AND entity_id IN (?, ?) ORDER BY id",
      [orgId, inv.body.invitation.id, acc.body.me.user.id]);
    expect(a.map((r) => r.action)).toEqual(["invitation.created", "invitation.accepted", "membership.created"]);
  });

  it("answers an unknown, malformed, withdrawn or expired link without joining anyone", async () => {
    expect((await call("GET", "/v1/public/invitations/not-a-real-token-but-long-enough")).body.code).toBe("INVITATION_NOT_FOUND");
    expect((await call("GET", "/v1/public/invitations/x")).status).toBe(404);
    const inv = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: email(), role: "VIEWER" } });
    expect((await call("DELETE", `/v1/team/invitations/${inv.body.invitation.id}`, { headers: owner.headers })).status).toBe(204);
    expect((await call("POST", "/v1/auth/invitations/accept", { body: { token: inv.body.token, display_name: "Late Person", password: PASSWORD } })).body.code).toBe("INVITATION_USED");
    const old = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: email(), role: "VIEWER" } });
    await root.query("UPDATE organization_invitations SET created_at = NOW(6) - INTERVAL 8 DAY, expires_at = NOW(6) - INTERVAL 1 DAY WHERE id = ?", [old.body.invitation.id]);
    expect((await call("GET", "/v1/team", { headers: owner.headers })).body.invitations.find((i: { id: string }) => i.id === old.body.invitation.id).state).toBe("EXPIRED");
    expect((await call("POST", "/v1/auth/invitations/accept", { body: { token: old.body.token, display_name: "Late Person", password: PASSWORD } })).body.code).toBe("INVITATION_EXPIRED");
  });

  it("inviting the same address again replaces the old link; a current member cannot be invited", async () => {
    const e = email();
    const first = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: e, role: "VIEWER" } });
    const second = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: e, role: "SCOUT" } });
    expect(second.status).toBe(201);
    expect((await call("GET", `/v1/public/invitations/${first.body.token}`)).body.code).toBe("INVITATION_USED");
    expect((await call("GET", `/v1/public/invitations/${second.body.token}`)).body.role).toBe("SCOUT");
    const dup = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: owner.email, role: "VIEWER" } });
    expect([dup.status, dup.body.code]).toEqual([409, "ALREADY_MEMBER"]);
  });

  it("an existing account accepts after signing in, only with the invited address", async () => {
    const otherOwnerEmail = email("other");
    const other = await bootstrapOwner(db, { email: otherOwnerEmail, displayName: "Other Owner", organizationName: "Other FC", password: PASSWORD, allowAdditional: true });
    const inv = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: otherOwnerEmail, role: "SCOUT" } });
    expect((await call("GET", `/v1/public/invitations/${inv.body.token}`)).body.has_account).toBe(true);
    const asNew = await call("POST", "/v1/auth/invitations/accept", { body: { token: inv.body.token, display_name: "Impostor", password: PASSWORD } });
    expect([asNew.status, asNew.body.code]).toEqual([409, "HAS_ACCOUNT"]);
    const wrong = await call("POST", "/v1/invitations/join", { headers: owner.account, body: { token: inv.body.token } });
    expect([wrong.status, wrong.body.code]).toEqual([403, "WRONG_ACCOUNT"]);
    const them = await signedIn(otherOwnerEmail, other.organizationId);
    const joined = await call("POST", "/v1/invitations/join", { headers: them.account, body: { token: inv.body.token } });
    expect(joined.status).toBe(200);
    expect(joined.body.memberships.map((m: { organization_name: string; role: string }) => [m.organization_name, m.role]).sort())
      .toEqual([["Other FC", "OWNER"], ["Team FC", "SCOUT"]]);
  });
});

describe("roles", () => {
  it("only an owner or admin manages the team; the list shows name, e-mail, role and two-step", async () => {
    const viewer = await newMember("VIEWER");
    const analyst = await newMember("ANALYST");
    for (const p of [viewer, analyst]) {
      expect((await call("GET", "/v1/team", { headers: p.headers })).body.code).toBe("ROLE_NOT_ALLOWED");
      expect((await call("POST", "/v1/team/invitations", { headers: p.headers, body: { email: email(), role: "VIEWER" } })).status).toBe(403);
    }
    const team = await call("GET", "/v1/team", { headers: owner.headers });
    expect(team.body.members[0]).toMatchObject({ role: "OWNER", email: owner.email, is_you: true, two_step: false });
    expect(team.body.members.find((m: { user_id: string }) => m.user_id === viewer.userId)).toMatchObject({ role: "VIEWER", email: viewer.email, is_you: false });
    // a role change takes effect on the next request: the former viewer can now create a player
    expect((await call("PATCH", `/v1/team/members/${viewer.userId}`, { headers: owner.headers, body: { role: "EDITOR" } })).status).toBe(200);
    const created = await app.inject({ method: "POST", url: "/v1/players", headers: { ...viewer.headers, "idempotency-key": key() }, payload: { display_name: "By Editor" } });
    expect(created.statusCode).toBe(201);
  });

  it("an admin cannot make, change or remove an owner; nobody changes themselves; the organization keeps an owner", async () => {
    const admin = await newMember("ADMIN");
    const second = await newMember("VIEWER");
    expect((await call("POST", "/v1/team/invitations", { headers: admin.headers, body: { email: email(), role: "OWNER" } })).body.code).toBe("OWNER_ONLY");
    expect((await call("PATCH", `/v1/team/members/${owner.userId}`, { headers: admin.headers, body: { role: "VIEWER" } })).body.code).toBe("OWNER_ONLY");
    expect((await call("DELETE", `/v1/team/members/${owner.userId}`, { headers: admin.headers })).body.code).toBe("OWNER_ONLY");
    expect((await call("PATCH", `/v1/team/members/${second.userId}`, { headers: admin.headers, body: { role: "OWNER" } })).body.code).toBe("OWNER_ONLY");
    expect((await call("PATCH", `/v1/team/members/${admin.userId}`, { headers: admin.headers, body: { role: "OWNER" } })).body.code).toBe("NOT_YOURSELF");
    expect((await call("PATCH", `/v1/team/members/${owner.userId}`, { headers: owner.headers, body: { role: "ADMIN" } })).body.code).toBe("NOT_YOURSELF");
    // an admin can invite and manage non-owners
    expect((await call("PATCH", `/v1/team/members/${second.userId}`, { headers: admin.headers, body: { role: "ANALYST" } })).status).toBe(200);
    // an owner can make another owner
    const promoted = await call("PATCH", `/v1/team/members/${admin.userId}`, { headers: owner.headers, body: { role: "OWNER" } });
    expect(promoted.body.members.find((m: { user_id: string }) => m.user_id === admin.userId).role).toBe("OWNER");
    const [a] = await root.query<RowDataPacket[]>("SELECT before_state, after_state FROM audit_events WHERE organization_id = ? AND action = 'membership.role_changed' AND entity_id = ?", [orgId, admin.userId]);
    expect(a.map((r) => [r.before_state.role, r.after_state.role])).toEqual([["ADMIN", "OWNER"]]);
  });

  it("removing a member ends their access at once; another organization's people answer 404", async () => {
    const leaving = await newMember("EDITOR");
    expect((await call("GET", "/v1/members", { headers: leaving.headers })).status).toBe(200);
    const after = await call("DELETE", `/v1/team/members/${leaving.userId}`, { headers: owner.headers });
    expect(after.body.members.some((m: { user_id: string }) => m.user_id === leaving.userId)).toBe(false);
    expect((await call("GET", "/v1/members", { headers: leaving.headers })).body.code).toBe("NOT_A_MEMBER");
    // another organization's owner cannot see or change this one
    const e = email("x");
    const x = await bootstrapOwner(db, { email: e, displayName: "X Owner", organizationName: "X FC", password: PASSWORD, allowAdditional: true });
    const xo = await signedIn(e, x.organizationId);
    expect((await call("PATCH", `/v1/team/members/${owner.userId}`, { headers: xo.headers, body: { role: "VIEWER" } })).status).toBe(404);
    const inv = await call("POST", "/v1/team/invitations", { headers: owner.headers, body: { email: email(), role: "VIEWER" } });
    expect((await call("DELETE", `/v1/team/invitations/${inv.body.invitation.id}`, { headers: xo.headers })).status).toBe(404);
    expect((await call("GET", `/v1/team`, { headers: xo.headers })).body.members.map((m: { email: string }) => m.email)).toEqual([e]);
  });
});

describe("two-step sign-in", () => {
  /** the current code from the set-up key, as the phone app shows it; offset in 30-second steps */
  const codeFor = (secret: string, offset = 0) => codeAt(base32Decode(secret), stepAt(Date.now()) + offset);

  it("sets up with the password and a code, then sign-in needs a code; a used code and a wrong code are refused", async () => {
    const me = await newMember("ANALYST");
    expect((await call("POST", "/v1/me/two-step/setup", { headers: me.account, body: { password: "wrong password" } })).body.code).toBe("INVALID_PASSWORD");
    const setup = await call("POST", "/v1/me/two-step/setup", { headers: me.account, body: { password: PASSWORD } });
    expect(setup.status).toBe(200);
    expect(setup.body.otpauth_url).toMatch(/^otpauth:\/\/totp\/OTSI%20VIE:.+\?secret=[A-Z2-7]{32}&issuer=OTSI%20VIE&algorithm=SHA1&digits=6&period=30$/);
    expect(setup.body.qr_data_url).toMatch(/^data:image\/png;base64,/);
    const [row] = await root.query<RowDataPacket[]>("SELECT secret_sealed FROM user_totp WHERE user_id = ?", [me.userId]);
    expect(row[0]!.secret_sealed).toMatch(/^v1\./);
    expect(row[0]!.secret_sealed).not.toContain(setup.body.secret.replace(/ /g, ""));
    // not on until confirmed: sign-in still needs only the password
    expect((await login(me.email)).body.access_token).toBeTruthy();
    expect((await call("POST", "/v1/me/two-step/confirm", { headers: me.account, body: { code: "000000" } })).body.code).toBe("INVALID_CODE");
    const on = await call("POST", "/v1/me/two-step/confirm", { headers: me.account, body: { code: codeFor(setup.body.secret, -1) } });
    expect(on.status).toBe(200);
    expect(on.body.recovery_codes).toHaveLength(10);
    expect((await call("GET", "/v1/me/two-step", { headers: me.account })).body).toEqual({ enabled: true, recovery_codes_left: 10 });
    expect((await call("GET", "/v1/team", { headers: owner.headers })).body.members.find((m: { user_id: string }) => m.user_id === me.userId).two_step).toBe(true);

    const step1 = await login(me.email);
    expect(step1.body).toMatchObject({ mfa_required: true, expires_in: 300 });
    expect(step1.body.access_token).toBeUndefined();
    expect(step1.cookie).toBeUndefined();
    // the challenge token is not an access token
    expect((await call("GET", "/v1/me", { headers: { authorization: `Bearer ${step1.body.mfa_token}` } })).body.code).toBe("INVALID_TOKEN");
    expect((await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: step1.body.mfa_token, code: "123456" } })).body.code).toBe("INVALID_CODE");
    const code = codeFor(setup.body.secret);
    const step2 = await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: step1.body.mfa_token, code } });
    expect(step2.status).toBe(200);
    expect(step2.cookie).toMatch(/^otsi_vie_refresh=/);
    expect(step2.body.me.user.id).toBe(me.userId);
    // the same code cannot be used twice (replay)
    const again = await login(me.email);
    expect((await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: again.body.mfa_token, code } })).body.code).toBe("INVALID_CODE");
    // a recovery code works once
    const rc = on.body.recovery_codes[0];
    expect((await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: again.body.mfa_token, code: rc.toUpperCase() } })).status).toBe(200);
    const third = await login(me.email);
    expect((await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: third.body.mfa_token, code: rc } })).body.code).toBe("INVALID_CODE");
    expect((await call("GET", "/v1/me/two-step", { headers: me.account })).body.recovery_codes_left).toBe(9);
    // a forged or foreign challenge token is refused
    expect((await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: me.token, code: codeFor(setup.body.secret, 1) } })).body.code).toBe("TWO_STEP_EXPIRED");
  });

  it("wrong codes lock the account like wrong passwords; switching off needs the password and a code", async () => {
    const me = await newMember("VIEWER");
    const setup = await call("POST", "/v1/me/two-step/setup", { headers: me.account, body: { password: PASSWORD } });
    await call("POST", "/v1/me/two-step/confirm", { headers: me.account, body: { code: codeFor(setup.body.secret, -1) } });
    expect((await call("POST", "/v1/me/two-step/setup", { headers: me.account, body: { password: PASSWORD } })).body.code).toBe("TWO_STEP_ON");
    const s1 = await login(me.email);
    for (let i = 0; i < 5; i++) expect((await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: s1.body.mfa_token, code: "999999" } })).status).toBe(401);
    const locked = await call("POST", "/v1/auth/login/two-step", { body: { mfa_token: s1.body.mfa_token, code: codeFor(setup.body.secret) } });
    expect([locked.status, locked.body.code]).toEqual([429, "ACCOUNT_LOCKED"]);
    await root.query("UPDATE local_credentials SET locked_until = NOW(6) - INTERVAL 1 SECOND, failed_attempts = 0 WHERE user_id = ?", [me.userId]);
    expect((await call("POST", "/v1/me/two-step/disable", { headers: me.account, body: { password: PASSWORD, code: "111111" } })).body.code).toBe("INVALID_CODE");
    const off = await call("POST", "/v1/me/two-step/disable", { headers: me.account, body: { password: PASSWORD, code: codeFor(setup.body.secret) } });
    expect(off.body).toEqual({ enabled: false, recovery_codes_left: 0 });
    expect((await login(me.email)).body.access_token).toBeTruthy();
    const [a] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE organization_id = ? AND entity_id = ? AND action LIKE 'user.two_step%' ORDER BY id", [orgId, me.userId]);
    expect(a.map((r) => r.action)).toEqual(["user.two_step_enabled", "user.two_step_disabled"]);
  });
});
