/**
 * Passkey sign-in (ADR-143) through the real HTTP stack and MySQL: register/options stores a challenge,
 * register/verify rejects a bad attestation, login/options does not enumerate an unknown email, login/verify
 * rejects an expired challenge and a counter that goes backwards (a possible clone), and a counter that moves
 * forward signs in and updates the stored counter. Listing and removing passkeys are covered too.
 *
 * The counter tests build a real ES256 assertion by hand (a COSE public key + a DER-to-raw signature), because no
 * authenticator is available in tests. The signature is verified by the same library the API uses, so a counter
 * rejection proves the counter check — not the signature — is what refused the login.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { publicKeyOf } from "../src/core/config";
import { Db } from "../src/core/db";
import { bootstrapOwner } from "../src/modules/auth/bootstrap";
import { appDb, AUDIENCE, ISSUER, key, rootDb } from "./helpers";

const ORIGIN = "http://127.0.0.1:4310";
const RP_ID = "127.0.0.1";
const PASSWORD = "correct horse battery staple";
let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let owner: { email: string; organizationId: string; userId: string };
let accessToken: string;

const email = () => `owner-${key().slice(2, 14)}@test.invalid`;

async function post(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: "POST", url, headers: { "x-otsi-csrf": "1", origin: ORIGIN, ...headers }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined, cookie: r.headers["set-cookie"] as string | undefined };
}
async function get(url: string, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: "GET", url, headers: { origin: ORIGIN, ...headers } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
async function del(url: string, headers: Record<string, string> = {}) {
  const r = await app.inject({ method: "DELETE", url, headers: { origin: ORIGIN, ...headers } });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
const authed = () => ({ authorization: `Bearer ${accessToken}` });

/** A COSE public key (CBOR map {1: 2, 3: -7, -1: 1, -2: x, -3: y}) for an ES256 P-256 key. */
function cosePublicKey(x: Buffer, y: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x,
    Buffer.from([0x22, 0x58, 0x20]), y,
  ]);
}

/** A valid assertion for `credentialId`, signed with `privateKey`, carrying `counter`. */
function buildAssertion(credentialId: string, challenge: string, counter: number, privateKey: KeyObject) {
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN }), "utf8").toString("base64url");
  const rpIdHash = createHash("sha256").update(RP_ID).digest();
  const flags = Buffer.from([0x05]); // user present + user verified
  const counterBuf = Buffer.alloc(4);
  counterBuf.writeUInt32BE(counter);
  const authenticatorData = Buffer.concat([rpIdHash, flags, counterBuf]);
  const signed = Buffer.concat([authenticatorData, createHash("sha256").update(Buffer.from(clientDataJSON, "base64url")).digest()]);
  // The assertion signature is sent as the DER (ASN.1) ECDSA signature Node's sign() returns.
  // @simplewebauthn/server expects DER and unwraps it to raw R||S itself (unwrapEC2Signature);
  // converting it to raw R||S here made the library's ASN.1 parser throw "Too big integer" and
  // every forward-counter login fail with WEBAUTHN_VERIFICATION_FAILED. (The backwards-counter
  // test masked this: the library's counter check throws before signature verification.)
  const signature = sign("SHA256", signed, privateKey);
  return {
    id: credentialId,
    rawId: credentialId,
    response: {
      clientDataJSON,
      authenticatorData: authenticatorData.toString("base64url"),
      signature: signature.toString("base64url"),
    },
    type: "public-key",
  };
}

describe("passkey sign-in (ADR-143)", () => {
  let credentialId: string;
  let privateKey: KeyObject;

  beforeAll(async () => {
    const { privateKey: signingKey } = await generateKeyPair("RS256", { extractable: true });
    const signingKeyPem = await exportPKCS8(signingKey);
    app = await createApp({
      dbDsn: inject("appDsn"), jwtIssuer: ISSUER, jwtAudience: AUDIENCE, jwtPublicKeyPem: publicKeyOf(signingKeyPem), port: 0,
      localAuth: { signingKeyPem, accessTtlSeconds: 600, refreshTtlDays: 14, refreshReuseGraceSeconds: 20, secureCookies: false, allowedOrigins: [ORIGIN], webauthnRpId: RP_ID, webauthnRpName: "OTSI VIE" },
    });
    db = appDb();
    root = await rootDb();
    const e = email();
    owner = { email: e, ...(await bootstrapOwner(db, { email: e, displayName: "Owner Person", organizationName: "Owner FC", password: PASSWORD, allowAdditional: true })) };
    const login = await post("/v1/auth/login", { email: e, password: PASSWORD });
    accessToken = login.body.access_token as string;
    expect(decodeJwt(accessToken).sub).toBeDefined();

    // a passkey for the owner, as if Windows Hello had created it: counter 5, public key from a real P-256 pair
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    privateKey = pair.privateKey;
    const jwk = pair.publicKey.export({ format: "jwk" });
    const x = Buffer.from(jwk.x!, "base64url");
    const y = Buffer.from(jwk.y!, "base64url");
    credentialId = randomBytes(32).toString("base64url");
    await db.pool.query(
      `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_name)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uuidv7(), owner.userId, credentialId, cosePublicKey(x, y).toString("base64url"), 5, null, "Test passkey"]);
  });
  afterAll(async () => {
    await app?.close();
    await db?.onModuleDestroy();
    await root?.end();
  });

  it("register/options returns creation options and stores a challenge", async () => {
    const r = await post("/v1/auth/webauthn/register/options", {}, authed());
    expect(r.status).toBe(200);
    expect(r.body.rp.id).toBe(RP_ID);
    expect(r.body.user.name).toBe(owner.email);
    expect(typeof r.body.challenge).toBe("string");
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT purpose, user_id FROM webauthn_challenges WHERE purpose = 'register' AND challenge = ?", [r.body.challenge]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.user_id).toBe(owner.userId);
  });

  it("register/verify rejects a bad attestation (no crash, no session)", async () => {
    const options = await post("/v1/auth/webauthn/register/options", {}, authed());
    expect(options.status).toBe(200);
    const bad = {
      id: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      rawId: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      response: { clientDataJSON: "not-json", attestationObject: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" },
      type: "public-key",
    };
    const r = await post("/v1/auth/webauthn/register/verify", { response: bad }, authed());
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("WEBAUTHN_CHALLENGE_INVALID");
  });

  it("login/options does not enumerate an unknown email", async () => {
    const r = await post("/v1/auth/webauthn/login/options", { email: "nobody@test.invalid" });
    expect(r.status).toBe(200);
    expect(r.body.rpId).toBe(RP_ID);
    expect(typeof r.body.challenge).toBe("string");
    expect(r.body.allowCredentials).toEqual([]);
    const [rows] = await root.query<RowDataPacket[]>(
      "SELECT email FROM webauthn_challenges WHERE purpose = 'login' AND challenge = ?", [r.body.challenge]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.email).toBe("nobody@test.invalid");
  });

  it("login/verify rejects an expired challenge", async () => {
    const options = await post("/v1/auth/webauthn/login/options", { email: owner.email });
    expect(options.status).toBe(200);
    await root.query("UPDATE webauthn_challenges SET expires_at = DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL 1 MINUTE) WHERE challenge = ?", [options.body.challenge]);
    const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.body.challenge, origin: ORIGIN }), "utf8").toString("base64url");
    const r = await post("/v1/auth/webauthn/login/verify", {
      response: { id: credentialId, rawId: credentialId, response: { clientDataJSON, authenticatorData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", signature: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }, type: "public-key" },
    });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("WEBAUTHN_CHALLENGE_EXPIRED");
  });

  it("login/verify rejects a counter that goes backwards (possible cloning)", async () => {
    const options = await post("/v1/auth/webauthn/login/options", { email: owner.email });
    expect(options.status).toBe(200);
    const assertion = buildAssertion(credentialId, options.body.challenge as string, 3, privateKey); // stored counter is 5
    const r = await post("/v1/auth/webauthn/login/verify", { response: assertion });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("WEBAUTHN_COUNTER_REJECTED");
    // the stored counter is left untouched
    const [rows] = await root.query<RowDataPacket[]>("SELECT counter FROM webauthn_credentials WHERE credential_id = ?", [credentialId]);
    expect(Number(rows[0]!.counter)).toBe(5);
  });

  it("login/verify signs in when the counter moves forward, and updates the stored counter", async () => {
    const options = await post("/v1/auth/webauthn/login/options", { email: owner.email });
    expect(options.status).toBe(200);
    const assertion = buildAssertion(credentialId, options.body.challenge as string, 6, privateKey); // stored counter is 5
    const r = await post("/v1/auth/webauthn/login/verify", { response: assertion });
    expect(r.status).toBe(200);
    expect(r.body.token_type).toBe("Bearer");
    expect(r.body.me.user.id).toBe(owner.userId);
    expect(r.cookie).toMatch(/otsi_vie_refresh=/);
    const [rows] = await root.query<RowDataPacket[]>("SELECT counter, last_used_at FROM webauthn_credentials WHERE credential_id = ?", [credentialId]);
    expect(Number(rows[0]!.counter)).toBe(6);
    expect(rows[0]!.last_used_at).not.toBeNull();
  });

  it("login/verify rejects a passkey that is not in this app's table (another localhost app's credential)", async () => {
    // Every local app shares the RP ID "localhost", so Windows Hello can offer a passkey from another app
    // on the same PC (e.g. the old "Karo" passkey) in the picker. The server must refuse it: its credential
    // id is not in this app's webauthn_credentials table, so no session is issued however well-formed the
    // assertion is.
    const options = await post("/v1/auth/webauthn/login/options", { email: owner.email });
    expect(options.status).toBe(200);
    const foreignId = randomBytes(32).toString("base64url");
    const assertion = buildAssertion(foreignId, options.body.challenge as string, 1, privateKey);
    const r = await post("/v1/auth/webauthn/login/verify", { response: assertion });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("WEBAUTHN_VERIFICATION_FAILED");
  });

  it("a used challenge cannot be replayed", async () => {
    const options = await post("/v1/auth/webauthn/login/options", { email: owner.email });
    expect(options.status).toBe(200);
    const assertion = buildAssertion(credentialId, options.body.challenge as string, 7, privateKey);
    const first = await post("/v1/auth/webauthn/login/verify", { response: assertion });
    expect(first.status).toBe(200);
    const second = await post("/v1/auth/webauthn/login/verify", { response: assertion });
    expect(second.status).toBe(401);
    expect(second.body.code).toBe("WEBAUTHN_CHALLENGE_INVALID");
  });

  it("lists passkeys without the public key, and removes one", async () => {
    const list = await get("/v1/auth/webauthn/credentials", authed());
    expect(list.status).toBe(200);
    expect(list.body.credentials).toHaveLength(1);
    expect(list.body.credentials[0]).toMatchObject({ device_name: "Test passkey" });
    expect(list.body.credentials[0].public_key).toBeUndefined();
    const id = list.body.credentials[0].id as string;
    const removed = await del(`/v1/auth/webauthn/credentials/${id}`, authed());
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);
    const again = await get("/v1/auth/webauthn/credentials", authed());
    expect(again.body.credentials).toHaveLength(0);
    const missing = await del(`/v1/auth/webauthn/credentials/${id}`, authed());
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("WEBAUTHN_CREDENTIAL_NOT_FOUND");
  });
});
