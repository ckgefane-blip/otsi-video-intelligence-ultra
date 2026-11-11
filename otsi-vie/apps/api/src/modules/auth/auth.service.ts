/**
 * Local sign-in (ADR-021). Email + password -> a short-lived RS256 access token (the same kind the AuthGuard verifies for any issuer)
 * and a long-lived opaque refresh token, stored only as a SHA-256 hash and sent only in an HttpOnly cookie.
 *
 *  - Wrong email and wrong password give the same answer in about the same time (dummy hash) — no account enumeration.
 *  - 5 consecutive failures lock the credential for 15 minutes.
 *  - Every refresh rotates the token. Presenting an already-rotated token means it leaked: the whole session family is revoked —
 *    except within a short grace window after the rotation, where it is a lost response (an aborted request) and continues the family.
 *  - A user with no ACTIVE membership can still sign in but can act for no organization (GET /v1/me shows none).
 *  - Two-step sign-in (two-step.ts): when it is on, the right password returns a challenge instead of a session: a 5-minute token for a
 *    different audience (the AuthGuard never accepts it) that is exchanged, with a code from the app, for the session. Wrong codes count
 *    toward the same lockout as wrong passwords.
 *  - A new person accepting an invitation (team.ts) gets their account and is signed in by the same `issue`.
 */
import { Inject, Injectable } from "@nestjs/common";
import { type AcceptInvitationRequest, type MfaChallenge, SessionResponse } from "@otsi-vie/contracts";
import { createHash, randomBytes } from "node:crypto";
import { importPKCS8, importSPKI, jwtVerify, KeyLike, SignJWT } from "jose";
import { RowDataPacket } from "mysql2/promise";
import { v4 as uuidv4, v7 as uuidv7 } from "uuid";
import { CONFIG, Config, LocalAuthConfig, publicKeyOf } from "../../core/config";
import { Db } from "../../core/db";
import { dummyHash, verifyPassword } from "../../core/passwords";
import { ApiError } from "../../core/problem";
import { AccountService } from "../account/account";
import { TeamService } from "../team/team";
import { TwoStepService } from "./two-step";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ClientInfo { userAgent: string | undefined; ip: string | undefined }
export interface IssuedSession { body: SessionResponse; refreshToken: string; refreshMaxAgeSeconds: number }
/** the password was right; a code from the authenticator app is still needed */
export interface PendingSecondStep { challenge: MfaChallenge }
export const MFA_TOKEN_SECONDS = 300;

const BAD_LOGIN = () => new ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");

@Injectable()
export class AuthService {
  private key: Promise<KeyLike> | undefined;
  private readonly local: LocalAuthConfig;

  private verifyKey: Promise<KeyLike> | undefined;

  constructor(@Inject(CONFIG) private readonly cfg: Config, private readonly db: Db, private readonly account: AccountService,
              private readonly twoStep: TwoStepService, private readonly team: TeamService) {
    if (!cfg.localAuth) throw new Error("local sign-in is not configured (OTSI_VIE_LOCAL_SIGNING_KEY_FILE)");
    this.local = cfg.localAuth;
  }

  get settings(): LocalAuthConfig { return this.local; }

  private signingKey(): Promise<KeyLike> {
    return (this.key ??= importPKCS8(this.local.signingKeyPem, "RS256"));
  }

  private async accessToken(subject: string): Promise<string> {
    return new SignJWT({}).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setSubject(subject).setIssuer(this.cfg.jwtIssuer)
      .setAudience(this.cfg.jwtAudience).setIssuedAt().setJti(uuidv4()).setExpirationTime(`${this.local.accessTtlSeconds}s`)
      .sign(await this.signingKey());
  }

  /** the second-step token: same key, but its own audience and purpose, so it is never an access token */
  private get mfaAudience(): string { return `${this.cfg.jwtAudience}#two-step`; }

  private async challenge(userId: string): Promise<PendingSecondStep> {
    const t = await new SignJWT({ purpose: "two-step" }).setProtectedHeader({ alg: "RS256", typ: "JWT" }).setSubject(userId).setIssuer(this.cfg.jwtIssuer)
      .setAudience(this.mfaAudience).setIssuedAt().setJti(uuidv4()).setExpirationTime(`${MFA_TOKEN_SECONDS}s`).sign(await this.signingKey());
    return { challenge: { mfa_required: true, mfa_token: t, expires_in: MFA_TOKEN_SECONDS } };
  }

  private async issue(userId: string, subject: string, familyId: string, client: ClientInfo): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString("base64url");
    await this.db.pool.query(
      `INSERT INTO auth_sessions (id, family_id, user_id, refresh_hash, expires_at, user_agent, ip)
       VALUES (?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? DAY), ?, ?)`,
      [uuidv7(), familyId, userId, sha256(refreshToken), this.local.refreshTtlDays, client.userAgent?.slice(0, 255) ?? null, client.ip?.slice(0, 64) ?? null]);
    return {
      refreshToken,
      refreshMaxAgeSeconds: this.local.refreshTtlDays * 86_400,
      body: SessionResponse.parse({ access_token: await this.accessToken(subject), token_type: "Bearer", expires_in: this.local.accessTtlSeconds, me: await this.account.me(userId) }),
    };
  }

  /**
   * Issue a fresh session for a user who has already been verified by another factor (a passkey, webauthn.ts).
   * The same issue() path as password sign-in, so the session, the refresh cookie and the access token are
   * identical - only the factor differs. The caller is responsible for the verification: the user must exist
   * and have completed account setup (a row in local_credentials), the same bar password sign-in sets.
   */
  async issueSession(userId: string, client: ClientInfo): Promise<IssuedSession> {
    const u = await this.db.one<RowDataPacket>("SELECT external_subject FROM users WHERE id = ?", [userId]);
    if (!u) throw BAD_LOGIN();
    return this.issue(userId, u.external_subject as string, uuidv7(), client);
  }

  async login(email: string, password: string, client: ClientInfo): Promise<IssuedSession | PendingSecondStep> {
    const row = await this.db.one<RowDataPacket>(
      `SELECT c.user_id, c.password_hash, c.failed_attempts, c.locked_until > CURRENT_TIMESTAMP(6) AS locked, u.external_subject
         FROM local_credentials c JOIN users u ON u.id = c.user_id WHERE c.email_normalized = ?`, [email.trim().toLowerCase()]);
    if (!row) {
      await verifyPassword(password, await dummyHash());
      throw BAD_LOGIN();
    }
    const ok = await verifyPassword(password, row.password_hash as string);
    if (Number(row.locked)) throw new ApiError(429, "ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
    if (!ok) {
      await this.db.pool.query(
        // MySQL applies SET assignments left to right with already-updated values: decide the lock BEFORE incrementing
        `UPDATE local_credentials SET locked_until = IF(failed_attempts + 1 >= ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MINUTE), locked_until),
                failed_attempts = failed_attempts + 1
          WHERE user_id = ?`, [MAX_FAILED_ATTEMPTS, LOCK_MINUTES, row.user_id]);
      throw BAD_LOGIN();
    }
    // two-step on: the failure count is reset only once the code is right too
    if (await this.twoStep.enabled(row.user_id as string)) return this.challenge(row.user_id as string);
    await this.db.pool.query("UPDATE local_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [row.user_id]);
    return this.issue(row.user_id as string, row.external_subject as string, uuidv7(), client);
  }

  /** sign-in step 2: the challenge token from step 1 and a code from the app (or a recovery code) */
  async loginSecondStep(mfaToken: string, code: string, client: ClientInfo): Promise<IssuedSession> {
    let userId: string;
    try {
      this.verifyKey ??= importSPKI(publicKeyOf(this.local.signingKeyPem), "RS256");
      const { payload } = await jwtVerify(mfaToken, await this.verifyKey, { issuer: this.cfg.jwtIssuer, audience: this.mfaAudience, algorithms: ["RS256"] });
      if (payload.purpose !== "two-step" || !payload.sub) throw new Error("purpose");
      userId = payload.sub;
    } catch {
      throw new ApiError(401, "TWO_STEP_EXPIRED", "The sign-in took too long. Enter your password again.");
    }
    await this.twoStep.assertNotLocked(userId);
    const ok = await this.db.tx((c) => this.twoStep.spendCode(userId, code, c));
    if (!ok) {
      await this.twoStep.countFailure(userId);
      throw new ApiError(401, "INVALID_CODE", "That code is not right. Use the newest code from your authenticator app.");
    }
    const u = await this.db.one<RowDataPacket>("SELECT external_subject FROM users WHERE id = ?", [userId]);
    if (!u) throw BAD_LOGIN();
    await this.db.pool.query("UPDATE local_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [userId]);
    return this.issue(userId, u.external_subject as string, uuidv7(), client);
  }

  /** a new person accepts an invitation: their account is created and they are signed in */
  async acceptInvitation(body: AcceptInvitationRequest, client: ClientInfo): Promise<IssuedSession> {
    const { userId, subject } = await this.team.acceptNew(body);
    return this.issue(userId, subject, uuidv7(), client);
  }

  async refresh(refreshToken: string | undefined, client: ClientInfo): Promise<IssuedSession> {
    if (!refreshToken) throw new ApiError(401, "NO_SESSION", "Sign in first.");
    // The reuse-grace cutoff as a plain value, not `INTERVAL ? MICROSECOND`:
    // a bound parameter inside an INTERVAL expression is rejected by some
    // MySQL drivers/servers and the query then fails with a server error
    // (500) instead of the 401 a dead session should get, so the session
    // never renews and the user has to sign in again and again.
    const graceCutoff = new Date(Date.now() - this.local.refreshReuseGraceSeconds * 1000);
    const found = await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>(
        `SELECT s.id, s.family_id, s.user_id, s.rotated_at, s.revoked_at, s.expires_at > CURRENT_TIMESTAMP(6) AS live, u.external_subject,
                s.rotated_at > ? AS in_grace
           FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = ? FOR UPDATE`,
        [graceCutoff, sha256(refreshToken)]);
      const s = rows[0];
      if (!s) return null;
      if (s.rotated_at && !s.revoked_at && Number(s.in_grace) && Number(s.live)) {
        // the previous response was lost (aborted request): continue the same family instead of treating it as theft
        return { userId: s.user_id as string, subject: s.external_subject as string, familyId: s.family_id as string };
      }
      if (s.rotated_at || s.revoked_at) {
        if (s.rotated_at && !s.revoked_at) {                      // a rotated token came back: it was copied. End every session of the family.
          await c.query("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(6), revoke_reason = 'REUSE_DETECTED' WHERE family_id = ? AND revoked_at IS NULL", [s.family_id]);
        }
        return { reused: true } as const;
      }
      if (!Number(s.live)) return null;
      await c.query("UPDATE auth_sessions SET rotated_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [s.id]);
      return { userId: s.user_id as string, subject: s.external_subject as string, familyId: s.family_id as string };
    });
    if (!found) throw new ApiError(401, "NO_SESSION", "Your session has ended. Sign in again.");
    if ("reused" in found) throw new ApiError(401, "SESSION_REVOKED", "This session was ended for safety. Sign in again.");
    return this.issue(found.userId, found.subject, found.familyId, client);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const [rows] = await this.db.pool.query<RowDataPacket[]>("SELECT family_id FROM auth_sessions WHERE refresh_hash = ?", [sha256(refreshToken)]);
    if (rows[0]) {
      await this.db.pool.query("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP(6), revoke_reason = 'LOGOUT' WHERE family_id = ? AND revoked_at IS NULL", [rows[0].family_id]);
    }
  }
}
