/**
 * WebAuthn passkeys (ADR-143, ultra-only): sign in with Windows Hello (fingerprint, face or PIN) instead of typing
 * email + password every time. Password sign-in stays as the fallback and recovery path — there is no
 * self-service forgot-password flow.
 *
 *   POST /v1/auth/webauthn/register/options   (signed in)  start adding a passkey -> creation options + challenge
 *   POST /v1/auth/webauthn/register/verify    (signed in)  the browser's attestation -> the passkey is stored
 *   POST /v1/auth/webauthn/login/options      (public)     {email} -> request options + challenge
 *   POST /v1/auth/webauthn/login/verify       (public)     the browser's assertion -> a session, exactly like
 *                                                           password sign-in (same issue() path, same refresh
 *                                                           cookie + access token)
 *   GET  /v1/auth/webauthn/credentials        (signed in)  the person's passkeys (never the public key)
 *   DELETE /v1/auth/webauthn/credentials/:id  (signed in)  remove one passkey
 *
 * The server stores ONLY the public half (credential id, COSE public key, counter) — see migration 0074. A private
 * key is never stored, sent, or logged; it never leaves the authenticator.
 *
 * Challenges are stored server-side, single-use, and expire after ~5 minutes. A challenge is consumed (deleted)
 * BEFORE the signature is checked, so a failed attempt cannot be replayed with the same challenge. Registration
 * challenges are tied to the signed-in user; login challenges are tied to the email the sign-in started with.
 *
 * The counter is the clone detector: on every login the authenticator's counter must be HIGHER than the stored
 * one. A counter that goes backwards (or stays the same while the stored one is non-zero) means the credential may
 * have been cloned, so the login is rejected and the stored counter is left untouched. The person removes the
 * passkey in Settings and adds a new one.
 *
 * A passkey login only succeeds for a verified (non-provisional) user — the same bar password sign-in sets: the
 * user must have completed account setup (a row in local_credentials). An invited-only user has none, so a passkey
 * cannot sign them in. A passkey is possession + a biometric/PIN (userVerification required), which is at least as
 * strong as password + authenticator code, so a passkey login does not ask for a two-step code.
 *
 * RP (relying party): the desktop app runs on http://127.0.0.1:4311, a loopback origin, which is a secure context
 * for WebAuthn. The RP ID is configurable (OTSI_VIE_WEBAUTHN_RP_ID, default "127.0.0.1") and the RP name is
 * "OTSI VIE". The RP ID is the loopback host, never a public domain, so a passkey created here cannot be used to
 * sign in to any other site.
 *
 * The two public login endpoints use the same CSRF header + origin guard and the same refresh-cookie helpers as
 * AuthController (auth.controller.ts) — the helpers are mirrored here because AuthController keeps its own private.
 */
import { Body, Controller, Delete, Get, Headers, HttpCode, Inject, Injectable, Param, Post, Req, Res, UseGuards } from "@nestjs/common";
import { WebAuthnCredentialListResponse, WebAuthnLoginOptionsRequest, WebAuthnLoginVerifyRequest, WebAuthnRegisterVerifyRequest, type SessionResponse, type WebAuthnCredential } from "@otsi-vie/contracts";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON, type RegistrationResponseJSON } from "@simplewebauthn/server";
import { decodeClientDataJSON, isoBase64URL } from "@simplewebauthn/server/helpers";
import type { FastifyReply, FastifyRequest } from "fastify";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { Account, AccountOnly, AuthGuard, CurrentAccount } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";
import { CSRF_HEADER } from "./auth.controller";
import { AuthService, ClientInfo, type IssuedSession } from "./auth.service";

/** A challenge lives 5 minutes; the browser's own ceremony timeout is 60 seconds, so 5 minutes is generous. */
const CHALLENGE_TTL_MINUTES = 5;
const CHALLENGE_INVALID = () => new ApiError(401, "WEBAUTHN_CHALLENGE_INVALID", "That passkey request has expired or was already used. Start again.");
const CHALLENGE_EXPIRED = () => new ApiError(401, "WEBAUTHN_CHALLENGE_EXPIRED", "That passkey request expired. Start again.");
const VERIFICATION_FAILED = () => new ApiError(401, "WEBAUTHN_VERIFICATION_FAILED", "That passkey could not be verified. Try your password.");
const COUNTER_REJECTED = () => new ApiError(401, "WEBAUTHN_COUNTER_REJECTED", "That passkey's counter went backwards, which can mean it was cloned. Remove it in Settings and sign in with your password.");
const CREDENTIAL_NOT_FOUND = () => new ApiError(404, "WEBAUTHN_CREDENTIAL_NOT_FOUND", "That passkey was not found.");

interface ChallengeRow { id: string; user_id: string | null; email: string | null; expires_at: Date }
interface CredentialRow extends RowDataPacket { id: string; user_id: string; credential_id: string; public_key: string; counter: number; transports: string | null; device_name: string | null; created_at: Date; last_used_at: Date | null }

/** An allow/exclude credential for the browser: the transports key is omitted (not set to undefined) when unknown. */
function credentialRef(id: string, transportsJson: string | null): { id: string; type: "public-key"; transports?: string[] } {
  const transports = transportsJson ? (JSON.parse(transportsJson) as string[]) : undefined;
  return transports ? { id, type: "public-key", transports } : { id, type: "public-key" };
}

@Injectable()
export class WebAuthnService {
  private readonly rpId: string;
  private readonly rpName: string;
  private readonly allowedOrigins: string[];

  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db, private readonly auth: AuthService) {
    if (!cfg.localAuth) throw new Error("passkey sign-in needs local sign-in (OTSI_VIE_LOCAL_SIGNING_KEY_FILE)");
    this.rpId = cfg.localAuth.webauthnRpId ?? "127.0.0.1";
    this.rpName = cfg.localAuth.webauthnRpName ?? "OTSI VIE";
    this.allowedOrigins = cfg.localAuth.allowedOrigins;
  }

  /** The origins a WebAuthn ceremony may come from: the configured web origins, or — when none are configured —
   *  the request's own loopback origin, or the desktop app's loopback origin. */
  private expectedOrigins(reqOrigin?: string): string[] {
    if (this.allowedOrigins.length > 0) return this.allowedOrigins;
    if (reqOrigin && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(reqOrigin)) return [reqOrigin];
    return ["http://127.0.0.1:4311"];
  }

  private async storeChallenge(purpose: "register" | "login", userId: string | null, email: string | null, challenge: string): Promise<void> {
    await this.db.pool.query(
      `INSERT INTO webauthn_challenges (id, purpose, user_id, email, challenge, expires_at)
       VALUES (?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ${CHALLENGE_TTL_MINUTES} MINUTE))`,
      [uuidv7(), purpose, userId, email, challenge]);
  }

  /** Take a challenge out of the store (single-use) and return it, or throw if it is unknown or expired. */
  private async consumeChallenge(purpose: "register" | "login", challenge: string): Promise<ChallengeRow> {
    const row = await this.db.tx(async (c) => {
      const r = await this.db.one<RowDataPacket>(
        "SELECT id, user_id, email, expires_at FROM webauthn_challenges WHERE purpose = ? AND challenge = ? FOR UPDATE",
        [purpose, challenge], c);
      if (!r) return null;
      await c.query("DELETE FROM webauthn_challenges WHERE id = ?", [r.id]);
      return r as unknown as ChallengeRow;
    });
    if (!row) throw CHALLENGE_INVALID();
    if (new Date(row.expires_at).getTime() <= Date.now()) throw CHALLENGE_EXPIRED();
    return row;
  }

  /** The challenge the browser's answer carries (in its client data). A malformed answer has none. */
  private challengeOf(response: { response: { clientDataJSON: string } }): string {
    try {
      return decodeClientDataJSON(response.response.clientDataJSON).challenge;
    } catch {
      throw CHALLENGE_INVALID();
    }
  }

  /** Map a verification failure to the API's answer. A counter going backwards is a possible clone: its own code. */
  private verificationError(err: unknown): ApiError {
    if (err instanceof Error && /counter value/i.test(err.message)) return COUNTER_REJECTED();
    return VERIFICATION_FAILED();
  }

  private toCredential(row: CredentialRow): WebAuthnCredential {
    return {
      id: row.id,
      device_name: row.device_name,
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      last_used_at: row.last_used_at ? (row.last_used_at instanceof Date ? row.last_used_at.toISOString() : String(row.last_used_at)) : null,
    };
  }

  async registerOptions(userId: string): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const user = await this.db.one<RowDataPacket>("SELECT email, display_name FROM users WHERE id = ?", [userId]);
    if (!user) throw VERIFICATION_FAILED();
    const existing = await this.db.rows<RowDataPacket>("SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?", [userId]);
    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpId,
      userName: user.email as string,
      userID: new TextEncoder().encode(userId),
      userDisplayName: (user.display_name as string | null) || (user.email as string),
      attestationType: "none",
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      excludeCredentials: existing.map((c) => credentialRef(c.credential_id as string, c.transports as string | null)),
    });
    await this.storeChallenge("register", userId, null, options.challenge);
    return options;
  }

  async registerVerify(userId: string, body: unknown, reqOrigin?: string): Promise<WebAuthnCredential> {
    const { response, device_name } = WebAuthnRegisterVerifyRequest.parse(body);
    const challenge = this.challengeOf(response);
    const stored = await this.consumeChallenge("register", challenge);
    if (stored.user_id !== userId) throw CHALLENGE_INVALID();
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.expectedOrigins(reqOrigin),
        expectedRPID: this.rpId,
        requireUserVerification: true,
      });
    } catch (err) {
      throw this.verificationError(err);
    }
    if (!verified.verified || !verified.registrationInfo) throw VERIFICATION_FAILED();
    const { credential } = verified.registrationInfo;
    const id = uuidv7();
    const transports = (response.response as { transports?: unknown }).transports;
    try {
      await this.db.pool.query(
        `INSERT INTO webauthn_credentials (id, user_id, credential_id, public_key, counter, transports, device_name)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, userId, credential.id, isoBase64URL.fromBuffer(credential.publicKey), credential.counter,
          transports ? JSON.stringify(transports) : null, device_name ?? null]);
    } catch (err) {
      if (err instanceof Error && /Duplicate entry/i.test(err.message)) {
        throw new ApiError(409, "WEBAUTHN_CREDENTIAL_EXISTS", "That passkey is already registered on this account.");
      }
      throw err;
    }
    const row = await this.db.one<CredentialRow>("SELECT * FROM webauthn_credentials WHERE id = ?", [id]);
    if (!row) throw VERIFICATION_FAILED();
    return this.toCredential(row);
  }

  async loginOptions(email: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const normalized = email.trim().toLowerCase();
    const user = await this.db.one<RowDataPacket>("SELECT id FROM users WHERE email = ?", [normalized]);
    const allowCredentials = user
      ? (await this.db.rows<RowDataPacket>("SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = ?", [user.id as string]))
          .map((c) => credentialRef(c.credential_id as string, c.transports as string | null))
      : [];
    const options = await generateAuthenticationOptions({
      rpID: this.rpId,
      allowCredentials,
      userVerification: "required",
    });
    await this.storeChallenge("login", null, normalized, options.challenge);
    return options;
  }

  async loginVerify(body: unknown, client: ClientInfo, reqOrigin?: string): Promise<IssuedSession> {
    const { response } = WebAuthnLoginVerifyRequest.parse(body);
    const challenge = this.challengeOf(response);
    const stored = await this.consumeChallenge("login", challenge);
    const cred = await this.db.one<CredentialRow>("SELECT * FROM webauthn_credentials WHERE credential_id = ?", [response.id]);
    if (!cred) throw VERIFICATION_FAILED();
    const user = await this.db.one<RowDataPacket>("SELECT id, email FROM users WHERE id = ?", [cred.user_id]);
    if (!user) throw VERIFICATION_FAILED();
    // the challenge was started for this email, and the passkey must belong to the same person
    if (!stored.email || (user.email as string).toLowerCase() !== stored.email.toLowerCase()) throw VERIFICATION_FAILED();
    // verified (non-provisional) user only — the same bar password sign-in sets (an invited-only user has no row)
    const setup = await this.db.one<RowDataPacket>("SELECT 1 AS x FROM local_credentials WHERE user_id = ?", [user.id as string]);
    if (!setup) throw VERIFICATION_FAILED();
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response: response as AuthenticationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.expectedOrigins(reqOrigin),
        expectedRPID: this.rpId,
        credential: {
          id: cred.credential_id,
          publicKey: isoBase64URL.toBuffer(cred.public_key),
          counter: Number(cred.counter),
          ...(cred.transports ? { transports: JSON.parse(cred.transports) as string[] } : {}),
        },
        requireUserVerification: true,
      });
    } catch (err) {
      throw this.verificationError(err);
    }
    if (!verified.verified || !verified.authenticationInfo) throw VERIFICATION_FAILED();
    await this.db.pool.query(
      "UPDATE webauthn_credentials SET counter = ?, last_used_at = CURRENT_TIMESTAMP(6) WHERE id = ?",
      [verified.authenticationInfo.newCounter, cred.id]);
    return this.auth.issueSession(user.id as string, client);
  }

  async listCredentials(userId: string): Promise<WebAuthnCredentialListResponse> {
    const rows = await this.db.rows<CredentialRow>(
      "SELECT * FROM webauthn_credentials WHERE user_id = ? ORDER BY created_at DESC", [userId]);
    return { credentials: rows.map((r) => this.toCredential(r)) };
  }

  async deleteCredential(userId: string, credentialId: string): Promise<void> {
    const [r] = await this.db.pool.query(
      "DELETE FROM webauthn_credentials WHERE id = ? AND user_id = ?", [credentialId, userId]);
    if ((r as { affectedRows: number }).affectedRows === 0) throw CREDENTIAL_NOT_FOUND();
  }
}

@Controller("v1/auth/webauthn")
export class WebAuthnController {
  constructor(private readonly webauthn: WebAuthnService, private readonly auth: AuthService) {}

  // -- the same cookie-endpoint helpers as AuthController (CSRF header + origin guard, refresh cookie) --
  private secure(req: FastifyRequest): boolean {
    const origin = req.headers.origin ?? "";
    return this.auth.settings.secureCookies && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  }

  private cookieName(req: FastifyRequest): string {
    return this.secure(req) ? "__Host-otsi_vie_refresh" : "otsi_vie_refresh";
  }

  private guard(req: FastifyRequest, csrf: string | undefined): void {
    if (csrf !== "1") throw new ApiError(403, "CSRF_HEADER_REQUIRED", "This request must come from the OTSI VIE app.");
    const origin = req.headers.origin;
    const allowed = this.auth.settings.allowedOrigins;
    if (origin && allowed.length > 0 && !allowed.includes(origin)) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request must come from the OTSI VIE app.");
  }

  private setCookie(req: FastifyRequest, res: FastifyReply, value: string, maxAge: number): void {
    const secure = this.secure(req) ? "; Secure" : "";
    void res.header("set-cookie", `${this.cookieName(req)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
    void res.header("cache-control", "no-store");
  }

  private client(req: FastifyRequest): ClientInfo {
    return { userAgent: req.headers["user-agent"], ip: req.ip };
  }

  @Post("register/options")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AccountOnly()
  registerOptions(@CurrentAccount() account: Account) {
    return this.webauthn.registerOptions(account.userId);
  }

  @Post("register/verify")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AccountOnly()
  registerVerify(@CurrentAccount() account: Account, @Body() body: unknown, @Req() req: FastifyRequest) {
    return this.webauthn.registerVerify(account.userId, body, req.headers.origin);
  }

  @Post("login/options")
  @HttpCode(200)
  loginOptions(@Body() body: unknown, @Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest) {
    this.guard(req, csrf);
    const { email } = WebAuthnLoginOptionsRequest.parse(body);
    return this.webauthn.loginOptions(email);
  }

  @Post("login/verify")
  @HttpCode(200)
  async loginVerify(@Body() body: unknown, @Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply): Promise<SessionResponse> {
    this.guard(req, csrf);
    const s = await this.webauthn.loginVerify(body, this.client(req), req.headers.origin);
    this.setCookie(req, res, s.refreshToken, s.refreshMaxAgeSeconds);
    return s.body;
  }

  @Get("credentials")
  @UseGuards(AuthGuard)
  @AccountOnly()
  listCredentials(@CurrentAccount() account: Account) {
    return this.webauthn.listCredentials(account.userId);
  }

  @Delete("credentials/:id")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @AccountOnly()
  async deleteCredential(@CurrentAccount() account: Account, @Param("id") id: string) {
    await this.webauthn.deleteCredential(account.userId, id);
    return { deleted: true };
  }
}
