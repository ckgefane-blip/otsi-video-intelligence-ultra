/**
 * Two-step sign-in with an authenticator app (roadmap Step 1; RFC 6238 codes from core/totp.ts). A person switches it on for their own
 * account; from then on signing in needs the password AND a 6-digit code from the app (or one of ten one-time recovery codes).
 *
 *   GET  /v1/me/two-step            on or off, and how many recovery codes are left
 *   POST /v1/me/two-step/setup      {password} -> a new key (QR picture + text) waiting for confirmation; refused while it is on
 *   POST /v1/me/two-step/confirm    {code} from the app -> switched on; returns ten recovery codes, shown once
 *   POST /v1/me/two-step/disable    {password, code} -> switched off (a recovery code works as the code)
 *
 * Wrong passwords and wrong codes count toward the same lockout as sign-in (5 in a row: 15 minutes). A code is accepted at most once
 * (`last_used_step`), so a code seen over someone's shoulder cannot be reused. Switching on or off is audited in each of the person's
 * organizations, so their owners can see it.
 */
import { Body, Controller, Get, HttpCode, Inject, Injectable, Post, UseGuards } from "@nestjs/common";
import { PasswordConfirm, type RecoveryCodes, TwoStepConfirmRequest, TwoStepDisableRequest, type TwoStepSetup, type TwoStepStatus } from "@otsi-vie/contracts";
import { RowDataPacket } from "mysql2/promise";
import { toDataURL } from "qrcode";
import { v7 as uuidv7 } from "uuid";
import { writeAudit } from "../../core/audit";
import { Account, AccountOnly, AuthGuard, CurrentAccount } from "../../core/auth";
import { CONFIG, Config } from "../../core/config";
import { Db, type Executor } from "../../core/db";
import { verifyPassword } from "../../core/passwords";
import { ApiError } from "../../core/problem";
import { base32Encode, isRecoveryCode, matchStep, newRecoveryCodes, newSecret, openSecret, otpauthUrl, recoveryCodeHash, sealSecret } from "../../core/totp";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCK_MINUTES = 15;

const WRONG_CODE = () => new ApiError(401, "INVALID_CODE", "That code is not right. Use the newest code from your authenticator app.");
const LOCKED = () => new ApiError(429, "ACCOUNT_LOCKED", `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);

@Injectable()
export class TwoStepService {
  private readonly keyPem: string;

  constructor(@Inject(CONFIG) cfg: Config, private readonly db: Db) {
    if (!cfg.localAuth) throw new Error("two-step sign-in needs local sign-in (OTSI_VIE_LOCAL_SIGNING_KEY_FILE)");
    this.keyPem = cfg.localAuth.signingKeyPem;
  }

  async enabled(userId: string, ex: Executor = this.db.pool): Promise<boolean> {
    return !!(await this.db.one<RowDataPacket>("SELECT 1 AS x FROM user_totp WHERE user_id = ? AND confirmed_at IS NOT NULL", [userId], ex));
  }

  async status(userId: string): Promise<TwoStepStatus> {
    const left = await this.db.one<RowDataPacket>("SELECT COUNT(*) AS n FROM user_recovery_codes WHERE user_id = ? AND used_at IS NULL", [userId]);
    const on = await this.enabled(userId);
    return { enabled: on, recovery_codes_left: on ? Number(left?.n ?? 0) : 0 };
  }

  /** a failed password or code: one step closer to the lockout (the decision is made before the increment, as at sign-in) */
  async countFailure(userId: string, ex: Executor = this.db.pool): Promise<void> {
    await ex.query(
      `UPDATE local_credentials SET locked_until = IF(failed_attempts + 1 >= ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MINUTE), locked_until),
              failed_attempts = failed_attempts + 1 WHERE user_id = ?`, [MAX_FAILED_ATTEMPTS, LOCK_MINUTES, userId]);
  }

  async assertNotLocked(userId: string, ex: Executor = this.db.pool): Promise<void> {
    const r = await this.db.one<RowDataPacket>("SELECT locked_until > CURRENT_TIMESTAMP(6) AS locked FROM local_credentials WHERE user_id = ?", [userId], ex);
    if (r && Number(r.locked)) throw LOCKED();
  }

  private async checkPassword(userId: string, password: string): Promise<void> {
    await this.assertNotLocked(userId);
    const r = await this.db.one<RowDataPacket>("SELECT password_hash FROM local_credentials WHERE user_id = ?", [userId]);
    if (!r) throw new ApiError(409, "NO_PASSWORD", "This account signs in elsewhere; set up two-step sign-in with that provider.");
    if (!(await verifyPassword(password, r.password_hash as string))) {
      await this.countFailure(userId);
      throw new ApiError(401, "INVALID_PASSWORD", "The password is not right.");
    }
  }

  /**
   * Check a 6-digit code (or a recovery code) for a person who has two-step sign-in switched on, inside the caller's transaction.
   * true: accepted and spent (the step or the recovery code cannot be used again). false: wrong — the caller counts the failure.
   */
  async spendCode(userId: string, code: string, ex: Executor, pending = false): Promise<boolean> {
    const [rows] = await ex.query<RowDataPacket[]>(
      `SELECT secret_sealed, last_used_step FROM user_totp WHERE user_id = ? AND confirmed_at IS ${pending ? "" : "NOT "}NULL FOR UPDATE`, [userId]);
    const t = rows[0];
    if (!t) return false;
    const c = code.trim();
    if (!pending && isRecoveryCode(c)) {
      const [r] = await ex.query("UPDATE user_recovery_codes SET used_at = CURRENT_TIMESTAMP(6) WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
        [userId, recoveryCodeHash(c)]);
      return (r as { affectedRows: number }).affectedRows === 1;
    }
    const step = matchStep(openSecret(t.secret_sealed as string, userId, this.keyPem), c);
    if (step === null || (t.last_used_step !== null && step <= Number(t.last_used_step))) return false;
    await ex.query("UPDATE user_totp SET last_used_step = ? WHERE user_id = ?", [step, userId]);
    return true;
  }

  async setup(userId: string, body: PasswordConfirm): Promise<TwoStepSetup> {
    await this.checkPassword(userId, body.password);
    if (await this.enabled(userId)) throw new ApiError(409, "TWO_STEP_ON", "Two-step sign-in is already on. Switch it off first to use a new phone.");
    const u = await this.db.one<RowDataPacket>("SELECT email FROM users WHERE id = ?", [userId]);
    const secret = newSecret(), b32 = base32Encode(secret);
    await this.db.pool.query(
      `INSERT INTO user_totp (user_id, secret_sealed, confirmed_at, last_used_step) VALUES (?, ?, NULL, NULL)
       ON DUPLICATE KEY UPDATE secret_sealed = VALUES(secret_sealed), confirmed_at = NULL, last_used_step = NULL, created_at = CURRENT_TIMESTAMP(6)`,
      [userId, sealSecret(secret, userId, this.keyPem)]);
    const url = otpauthUrl(b32, (u?.email as string | undefined) ?? "account");
    return { secret: b32.replace(/(.{4})/g, "$1 ").trim(), otpauth_url: url, qr_data_url: await toDataURL(url, { errorCorrectionLevel: "M", margin: 1, width: 240 }) };
  }

  private async auditEverywhere(ex: Executor, userId: string, action: string): Promise<void> {
    const [orgs] = await ex.query<RowDataPacket[]>("SELECT organization_id FROM memberships WHERE user_id = ? AND status = 'ACTIVE'", [userId]);
    for (const o of orgs) {
      await writeAudit(ex, { kind: "USER", userId, organizationId: o.organization_id as string }, { action, entityType: "user", entityId: userId });
    }
  }

  async confirm(userId: string, body: TwoStepConfirmRequest): Promise<RecoveryCodes> {
    await this.assertNotLocked(userId);
    const codes = newRecoveryCodes();
    const ok = await this.db.tx(async (c) => {
      if (!(await this.spendCode(userId, body.code, c, true))) return false;
      await c.query("UPDATE user_totp SET confirmed_at = CURRENT_TIMESTAMP(6) WHERE user_id = ?", [userId]);
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = ?", [userId]);
      for (const k of codes) await c.query("INSERT INTO user_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)", [uuidv7(), userId, recoveryCodeHash(k)]);
      await this.auditEverywhere(c, userId, "user.two_step_enabled");
      return true;
    });
    if (!ok) {
      const pending = await this.db.one<RowDataPacket>("SELECT 1 AS x FROM user_totp WHERE user_id = ? AND confirmed_at IS NULL", [userId]);
      if (!pending) throw new ApiError(409, "NO_SETUP", "Start the set-up again: no new key is waiting.");
      await this.countFailure(userId);
      throw WRONG_CODE();
    }
    return { recovery_codes: codes };
  }

  async disable(userId: string, body: TwoStepDisableRequest): Promise<TwoStepStatus> {
    await this.checkPassword(userId, body.password);
    if (!(await this.enabled(userId))) return this.status(userId);
    const ok = await this.db.tx(async (c) => {
      if (!(await this.spendCode(userId, body.code, c))) return false;
      await c.query("DELETE FROM user_recovery_codes WHERE user_id = ?", [userId]);
      await c.query("DELETE FROM user_totp WHERE user_id = ?", [userId]);
      await this.auditEverywhere(c, userId, "user.two_step_disabled");
      return true;
    });
    if (!ok) {
      await this.countFailure(userId);
      throw WRONG_CODE();
    }
    await this.db.pool.query("UPDATE local_credentials SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?", [userId]);
    return this.status(userId);
  }
}

@Controller("v1/me/two-step")
@UseGuards(AuthGuard)
export class TwoStepController {
  constructor(private readonly twoStep: TwoStepService) {}

  @Get()
  @AccountOnly()
  status(@CurrentAccount() a: Account) {
    return this.twoStep.status(a.userId);
  }

  @Post("setup")
  @HttpCode(200)
  @AccountOnly()
  setup(@CurrentAccount() a: Account, @Body() body: unknown) {
    return this.twoStep.setup(a.userId, PasswordConfirm.parse(body));
  }

  @Post("confirm")
  @HttpCode(200)
  @AccountOnly()
  confirm(@CurrentAccount() a: Account, @Body() body: unknown) {
    return this.twoStep.confirm(a.userId, TwoStepConfirmRequest.parse(body));
  }

  @Post("disable")
  @HttpCode(200)
  @AccountOnly()
  disable(@CurrentAccount() a: Account, @Body() body: unknown) {
    return this.twoStep.disable(a.userId, TwoStepDisableRequest.parse(body));
  }
}
