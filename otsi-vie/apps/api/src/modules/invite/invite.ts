/**
 * User-to-user Invite (referral with token rewards, owner decision 2026-11-14): one user invites another
 * user — a player, a club, an academy, anyone. The inviter shares a link with a code; the invitee signs up
 * with it and gets +25 tokens on top of the free grant; the inviter gets +100 tokens only when the invitee
 * does something real (first match analysis or first pack purchase), never on signup alone.
 *
 * This is NOT the staff/team invite (invite a person by email to join your club with a role — the /invite
 * page and TeamSettings): that one adds a member to an organization, this one brings a new user to OTSI.
 * Invites live on the central server: the code is per user, sign-up accepts it, and both rewards are wallet
 * ledger rows (INVITE_BONUS / INVITE_REWARD), so the balance is derived from them like any credit.
 *
 * The reward is paid by WalletService itself (its private maybePayInviteReward, called from charge() for an
 * ANALYSIS and from confirmReceipt() for a PURCHASE), inside their transaction and on the server that holds
 * the wallet — so on a linked desktop it runs on central, not locally. This service only owns the code and
 * the sign-up acceptance, and calls WalletService.credit for the invitee bonus; it never takes WalletService
 * as a dependency the other way round, so there is no circular import.
 */
import { randomBytes } from "node:crypto";
import { Controller, Get, Injectable, UseGuards } from "@nestjs/common";
import { FREE_GRANT_EXPIRY_DAYS, INVITE_BONUS_TOKENS, MyInvite } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { AuthGuard, CurrentPrincipal, type Principal } from "../../core/auth";
import { recordChange, userActor } from "../../core/audit";
import { Db } from "../../core/db";
import { ApiError } from "../../core/problem";
import { WalletService } from "../wallet/wallet";

/** 10 URL-safe characters, without 0/O/1/l so the code reads clearly when shared. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const CODE_LENGTH = 10;

function newInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

export interface ResolvedInvite { inviterUserId: string; inviterOrgId: string }

@Injectable()
export class InviteService {
  constructor(
    private readonly db: Db,
    private readonly wallet: WalletService,
  ) {}

  /** The caller's own invite code, created on first read and the same ever after. One code per user. */
  async myInvite(p: Principal): Promise<MyInvite> {
    return this.db.tx(async (c) => {
      const existing = await this.db.one<RowDataPacket>("SELECT code FROM user_invites WHERE user_id = ?", [p.userId], c);
      if (existing) return MyInvite.parse({ code: String(existing.code) });
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newInviteCode();
        try {
          await c.query("INSERT INTO user_invites (user_id, code) VALUES (?, ?)", [p.userId, code]);
          return MyInvite.parse({ code });
        } catch (e) {
          // a colliding code (the unique key) — try another; anything else is a real failure
          if (!/Duplicate entry/i.test(e instanceof Error ? e.message : String(e))) throw e;
        }
      }
      throw new ApiError(500, "INVITE_CODE_FAILED", "Could not create an invite code. Try again.");
    });
  }

  /**
   * Resolve an invite code at sign-up, BEFORE the account is created, so a bad code refuses the sign-up
   * instead of creating an account without the bonus. The inviter is the code owner's own organisation —
   * the one they created when they signed up (their OWNER membership, oldest first); a user with no OWNER
   * membership falls back to any active one. A code whose owner has the same email as the new account is
   * refused: you cannot invite yourself.
   */
  async resolveInvite(code: string, signupEmail: string): Promise<ResolvedInvite> {
    const normalized = code.trim();
    if (!/^[A-Za-z0-9]{10}$/.test(normalized)) {
      throw new ApiError(400, "INVITE_CODE_INVALID", "That invite code is not valid. Check the link and try again — or sign up without it.");
    }
    const row = await this.db.one<RowDataPacket>(
      `SELECT i.user_id AS inviter_user_id, m.organization_id AS inviter_org_id, u.email AS inviter_email
         FROM user_invites i
         JOIN users u ON u.id = i.user_id
         JOIN memberships m ON m.user_id = i.user_id AND m.status = 'ACTIVE'
         JOIN organizations o ON o.id = m.organization_id
        WHERE i.code = ?
        ORDER BY (m.role = 'OWNER') DESC, o.created_at ASC, o.id ASC LIMIT 1`,
      [normalized]);
    if (!row) {
      throw new ApiError(400, "INVITE_CODE_INVALID", "That invite code is not valid. Check the link and try again — or sign up without it.");
    }
    if (String(row.inviter_email).trim().toLowerCase() === signupEmail.trim().toLowerCase()) {
      throw new ApiError(400, "INVITE_SELF", "You cannot use your own invite code.");
    }
    return { inviterUserId: String(row.inviter_user_id), inviterOrgId: String(row.inviter_org_id) };
  }

  /**
   * Record a referral and credit the invitee's bonus, after the account is created. One inviter per new
   * user (the invitee organisation id is the key); the bonus is +25 on top of the free grant, expiring 30
   * days after signup like the grant. Idempotent: a second call for the same organisation returns without
   * writing again.
   */
  async acceptInvite(inviter: ResolvedInvite, invitee: { userId: string; organizationId: string }, code: string): Promise<void> {
    const now = new Date().toISOString();
    const expiresAt = addDays(now, FREE_GRANT_EXPIRY_DAYS);
    await this.db.tx(async (c) => {
      const existing = await this.db.one<RowDataPacket>(
        "SELECT invitee_org_id FROM invite_referrals WHERE invitee_org_id = ?", [invitee.organizationId], c);
      if (existing) return;
      await c.query(
        "INSERT INTO invite_referrals (invitee_org_id, invitee_user_id, inviter_user_id, inviter_org_id, invite_code) VALUES (?, ?, ?, ?, ?)",
        [invitee.organizationId, invitee.userId, inviter.inviterUserId, inviter.inviterOrgId, code.trim()]);
      await this.wallet.credit(c, invitee.organizationId, invitee.userId, {
        kind: "INVITE_BONUS", amount: INVITE_BONUS_TOKENS, idempotencyKey: `invite-bonus:${invitee.organizationId}`,
        reason: `Invite bonus: ${INVITE_BONUS_TOKENS} tokens for signing up with an invite — on top of the free grant.`,
        expiresAt,
      });
      await recordChange(c, userActor({ userId: invitee.userId, organizationId: invitee.organizationId } as Principal),
        { action: "invite.accepted", entityType: "organization", entityId: invitee.organizationId,
          after: { invite_code: code.trim(), inviter_org_id: inviter.inviterOrgId, bonus_tokens: INVITE_BONUS_TOKENS } });
    });
  }
}

@Controller("v1/invites")
export class InviteController {
  constructor(private readonly invites: InviteService) {}

  /** The caller's own invite code, for the share link in the top bar's gift button. Any signed-in user. */
  @Get("mine")
  @UseGuards(AuthGuard)
  async mine(@CurrentPrincipal() p: Principal): Promise<MyInvite> {
    return this.invites.myInvite(p);
  }
}
