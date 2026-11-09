/**
 * Team and roles (roadmap Step 1, F01). An owner or admin invites a person by e-mail address with a role, changes a member's role and
 * removes a member. Invitations are one-time links (only the SHA-256 of the token is stored, 7 days, withdrawable). There is no mail
 * service (zero-cost rule): the inviter copies the link and sends it themselves.
 *
 *   GET    /v1/team                               members (name, e-mail, role, two-step on/off) and open invitations   OWNER, ADMIN
 *   POST   /v1/team/invitations                   invite {email, role}; returns the link's token once                   OWNER, ADMIN
 *   DELETE /v1/team/invitations/:id               withdraw an open invitation                                           OWNER, ADMIN
 *   PATCH  /v1/team/members/:userId               change a member's role {role}                                         OWNER, ADMIN
 *   DELETE /v1/team/members/:userId               remove a member from the organization                                 OWNER, ADMIN
 *   GET    /v1/public/invitations/:token          what the person opening the link sees (no sign-in)
 *   POST   /v1/invitations/join                   a signed-in person with an existing account accepts {token}
 *   (POST  /v1/auth/invitations/accept            a new person chooses a name and password and is signed in: auth.controller.ts)
 *
 * Rules, enforced here and not only in the screen: an admin can never invite, change or remove an owner, nor make anyone an owner; nobody
 * changes or removes themselves (another owner does it), so an organization always keeps an owner; another organization's ids answer 404.
 * Every change is audited in the organization it concerns. Removing a member takes effect on their next request (the AuthGuard reads
 * the membership from MySQL every time); what they made stays with the organization.
 */
import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AcceptInvitationRequest, ChangeRoleRequest, CreateInvitationRequest, type CreatedInvitation, type Invitation, InvitationPreview,
  JoinInvitationRequest, type Me, Team } from "@otsi-vie/contracts";
import { createHash, randomBytes } from "node:crypto";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { type Actor, userActor, writeAudit } from "../../core/audit";
import { Account, AccountOnly, AuthGuard, CurrentAccount, CurrentPrincipal, Principal, type Role, Roles } from "../../core/auth";
import { Db, type Executor } from "../../core/db";
import { hashPassword, passwordProblem } from "../../core/passwords";
import { ApiError } from "../../core/problem";
import { AccountService } from "../account/account";
import { uuidParam } from "../players/players.controller";

export const INVITATION_DAYS = 7;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const iso = (v: unknown) => new Date(v as string).toISOString();
const MANAGERS = ["OWNER", "ADMIN"] as const;

const NO_INVITATION = () => new ApiError(404, "INVITATION_NOT_FOUND", "This invitation link is not valid. Ask for a new one.");
const USED = () => new ApiError(410, "INVITATION_USED", "This invitation was already used or withdrawn. Ask for a new one.");
const EXPIRED = () => new ApiError(410, "INVITATION_EXPIRED", "This invitation has expired. Ask for a new one.");

function stateOf(r: RowDataPacket): Invitation["state"] {
  if (r.accepted_at) return "ACCEPTED";
  if (r.revoked_at) return "REVOKED";
  return Number(r.expired) ? "EXPIRED" : "OPEN";
}

function invitationOf(r: RowDataPacket): Invitation {
  return { id: r.id, email: r.email_normalized, role: r.role, invited_by: r.invited_by_name, created_at: iso(r.created_at), expires_at: iso(r.expires_at), state: stateOf(r) };
}

const INVITATION_SELECT = `SELECT i.id, i.organization_id, i.email_normalized, i.role, i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
  i.expires_at <= CURRENT_TIMESTAMP(6) AS expired, u.display_name AS invited_by_name, o.name AS organization_name
  FROM organization_invitations i JOIN users u ON u.id = i.invited_by JOIN organizations o ON o.id = i.organization_id`;

/** an owner-only role decision an admin may not make */
function guardOwnerRule(actor: Principal, ...roles: string[]): void {
  if (actor.role !== "OWNER" && roles.includes("OWNER")) {
    throw new ApiError(403, "OWNER_ONLY", "Only an owner can give, change or remove the owner role.");
  }
}

@Injectable()
export class TeamService {
  constructor(private readonly db: Db, private readonly account: AccountService) {}

  async team(p: Principal): Promise<Team> {
    const members = await this.db.rows<RowDataPacket>(
      `SELECT u.id, u.display_name, u.email, m.role, (t.confirmed_at IS NOT NULL) AS two_step
         FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN user_totp t ON t.user_id = u.id
        WHERE m.organization_id = ? AND m.status = 'ACTIVE'
        ORDER BY FIELD(m.role, 'OWNER', 'ADMIN', 'ANALYST', 'EDITOR', 'SCOUT', 'VIEWER'), u.display_name, u.id`, [p.organizationId]);
    const invitations = await this.db.rows<RowDataPacket>(
      `${INVITATION_SELECT} WHERE i.organization_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL ORDER BY i.created_at DESC LIMIT 200`, [p.organizationId]);
    return Team.parse({
      members: members.map((m) => ({ user_id: m.id, display_name: m.display_name, email: m.email, role: m.role, two_step: !!Number(m.two_step), is_you: m.id === p.userId })),
      invitations: invitations.map(invitationOf),
    });
  }

  async invite(body: CreateInvitationRequest, p: Principal): Promise<CreatedInvitation> {
    guardOwnerRule(p, body.role);
    const token = randomBytes(32).toString("base64url");
    const id = uuidv7();
    await this.db.tx(async (c) => {
      const [member] = await c.query<RowDataPacket[]>(
        `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.status = 'ACTIVE' AND LOWER(u.email) = ?`,
        [p.organizationId, body.email]);
      if (member.length > 0) throw new ApiError(409, "ALREADY_MEMBER", "This person is already a member. Change their role in the list instead.");
      // inviting the same address again replaces the old link (it stops working)
      const [old] = await c.query<RowDataPacket[]>(
        "SELECT id, role FROM organization_invitations WHERE organization_id = ? AND open_email = ? FOR UPDATE", [p.organizationId, body.email]);
      for (const o of old) {
        guardOwnerRule(p, o.role as string);
        await c.query("UPDATE organization_invitations SET revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [o.id]);
        await writeAudit(c, userActor(p), { action: "invitation.replaced", entityType: "invitation", entityId: o.id as string, after: { email: body.email } });
      }
      await c.query(
        `INSERT INTO organization_invitations (id, organization_id, email_normalized, role, token_hash, invited_by, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? DAY))`,
        [id, p.organizationId, body.email, body.role, sha256(token), p.userId, INVITATION_DAYS]);
      await writeAudit(c, userActor(p), { action: "invitation.created", entityType: "invitation", entityId: id, after: { email: body.email, role: body.role } });
    });
    const r = await this.db.one<RowDataPacket>(`${INVITATION_SELECT} WHERE i.id = ?`, [id]);
    return { invitation: invitationOf(r!), token };
  }

  async revoke(id: string, p: Principal): Promise<void> {
    await this.db.tx(async (c) => {
      const [rows] = await c.query<RowDataPacket[]>(
        "SELECT id, role, email_normalized, accepted_at, revoked_at FROM organization_invitations WHERE id = ? AND organization_id = ? FOR UPDATE", [id, p.organizationId]);
      const r = rows[0];
      if (!r) throw new ApiError(404, "INVITATION_NOT_FOUND", "That invitation does not exist.");
      guardOwnerRule(p, r.role as string);
      if (r.accepted_at) throw new ApiError(409, "INVITATION_USED", "That invitation was already accepted. Remove the member instead.");
      if (r.revoked_at) return;
      await c.query("UPDATE organization_invitations SET revoked_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [id]);
      await writeAudit(c, userActor(p), { action: "invitation.revoked", entityType: "invitation", entityId: id, before: { email: r.email_normalized, role: r.role } });
    });
  }

  private async targetMember(c: Executor, userId: string, p: Principal): Promise<{ role: Role; display_name: string }> {
    const [rows] = await c.query<RowDataPacket[]>(
      `SELECT m.role, u.display_name FROM memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'ACTIVE' FOR UPDATE`, [p.organizationId, userId]);
    if (!rows[0]) throw new ApiError(404, "MEMBER_NOT_FOUND", "That person is not a member of this organization.");
    if (userId === p.userId) throw new ApiError(409, "NOT_YOURSELF", "You cannot change or remove yourself. Ask another owner.");
    return { role: rows[0].role as Role, display_name: rows[0].display_name as string };
  }

  /** an organization never ends up without an owner (checked inside the same transaction) */
  private async keepsAnOwner(c: Executor, p: Principal): Promise<void> {
    const [n] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM memberships WHERE organization_id = ? AND role = 'OWNER' AND status = 'ACTIVE'", [p.organizationId]);
    if (Number(n[0]!.n) < 1) throw new ApiError(409, "LAST_OWNER", "An organization needs at least one owner.");
  }

  async changeRole(userId: string, body: ChangeRoleRequest, p: Principal): Promise<Team> {
    await this.db.tx(async (c) => {
      const t = await this.targetMember(c, userId, p);
      guardOwnerRule(p, t.role, body.role);
      if (t.role === body.role) return;
      await c.query("UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ?", [body.role, p.organizationId, userId]);
      await this.keepsAnOwner(c, p);
      await writeAudit(c, userActor(p), { action: "membership.role_changed", entityType: "user", entityId: userId, before: { role: t.role }, after: { role: body.role } });
    });
    return this.team(p);
  }

  async remove(userId: string, p: Principal): Promise<Team> {
    await this.db.tx(async (c) => {
      const t = await this.targetMember(c, userId, p);
      guardOwnerRule(p, t.role);
      await c.query("DELETE FROM memberships WHERE organization_id = ? AND user_id = ?", [p.organizationId, userId]);
      await this.keepsAnOwner(c, p);
      await writeAudit(c, userActor(p), { action: "membership.removed", entityType: "user", entityId: userId, before: { role: t.role, display_name: t.display_name } });
    });
    return this.team(p);
  }

  // ---- the invited person ---------------------------------------------------------------------------------------------------------

  private async openInvitation(c: Executor, token: string, lock: boolean): Promise<RowDataPacket> {
    const [rows] = await c.query<RowDataPacket[]>(`${INVITATION_SELECT} WHERE i.token_hash = ?${lock ? " FOR UPDATE" : ""}`, [sha256(token)]);
    const r = rows[0];
    if (!r) throw NO_INVITATION();
    if (r.accepted_at || r.revoked_at) throw USED();
    if (Number(r.expired)) throw EXPIRED();
    return r;
  }

  async preview(token: string): Promise<InvitationPreview> {
    const r = await this.openInvitation(this.db.pool, token, false);
    const has = await this.db.one<RowDataPacket>(
      "SELECT (EXISTS (SELECT 1 FROM local_credentials WHERE email_normalized = ?) OR EXISTS (SELECT 1 FROM users WHERE LOWER(email) = ?)) AS has", [r.email_normalized, r.email_normalized]);
    return InvitationPreview.parse({ organization_name: r.organization_name, email: r.email_normalized, role: r.role, invited_by: r.invited_by_name,
      expires_at: iso(r.expires_at), has_account: !!Number(has?.has) });
  }

  /** the membership the invitation grants, in the caller's transaction (an earlier SUSPENDED / INVITED row becomes ACTIVE with the role) */
  private async join(c: Executor, inv: RowDataPacket, userId: string): Promise<void> {
    await c.query(
      `INSERT INTO memberships (organization_id, user_id, role, status) VALUES (?, ?, ?, 'ACTIVE')
       ON DUPLICATE KEY UPDATE role = IF(status = 'ACTIVE', role, VALUES(role)), status = 'ACTIVE'`, [inv.organization_id, userId, inv.role]);
    await c.query("UPDATE organization_invitations SET accepted_at = CURRENT_TIMESTAMP(6), accepted_by = ? WHERE id = ?", [userId, inv.id]);
    const actor: Actor = { kind: "USER", userId, organizationId: inv.organization_id as string };
    await writeAudit(c, actor, { action: "invitation.accepted", entityType: "invitation", entityId: inv.id as string, after: { email: inv.email_normalized, role: inv.role } });
    await writeAudit(c, actor, { action: "membership.created", entityType: "user", entityId: userId, after: { role: inv.role, via: "invitation" } });
  }

  /** a new person: account, password and membership in one transaction; returns who to sign in */
  async acceptNew(body: AcceptInvitationRequest): Promise<{ userId: string; subject: string }> {
    const problem = passwordProblem(body.password);
    if (problem) throw new ApiError(400, "WEAK_PASSWORD", problem);
    const hash = await hashPassword(body.password);
    return this.db.tx(async (c) => {
      const inv = await this.openInvitation(c, body.token, true);
      const email = inv.email_normalized as string;
      const [taken] = await c.query<RowDataPacket[]>(
        "SELECT 1 FROM local_credentials WHERE email_normalized = ? UNION SELECT 1 FROM users WHERE LOWER(email) = ?", [email, email]);
      if (taken.length > 0) throw new ApiError(409, "HAS_ACCOUNT", "This e-mail address already has an account. Sign in to accept the invitation.");
      const userId = uuidv7(), subject = `local:${userId}`;
      await c.query("INSERT INTO users (id, external_subject, email, display_name) VALUES (?, ?, ?, ?)", [userId, subject, email, body.display_name]);
      await c.query("INSERT INTO local_credentials (user_id, email_normalized, password_hash) VALUES (?, ?, ?)", [userId, email, hash]);
      await this.join(c, inv, userId);
      return { userId, subject };
    });
  }

  /** a signed-in person whose e-mail address is the invited one */
  async acceptExisting(body: JoinInvitationRequest, a: Account): Promise<Me> {
    await this.db.tx(async (c) => {
      const inv = await this.openInvitation(c, body.token, true);
      const [u] = await c.query<RowDataPacket[]>("SELECT LOWER(email) AS email FROM users WHERE id = ?", [a.userId]);
      if (u[0]?.email !== inv.email_normalized) {
        throw new ApiError(403, "WRONG_ACCOUNT", `This invitation is for ${inv.email_normalized}. Sign out and sign in with that address.`);
      }
      await this.join(c, inv, a.userId);
    });
    return this.account.me(a.userId);
  }
}

@Controller("v1/team")
@UseGuards(AuthGuard)
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @Roles(...MANAGERS)
  list(@CurrentPrincipal() p: Principal) {
    return this.team.team(p);
  }

  @Post("invitations")
  @Roles(...MANAGERS)
  invite(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.team.invite(CreateInvitationRequest.parse(body), p);
  }

  @Delete("invitations/:id")
  @HttpCode(204)
  @Roles(...MANAGERS)
  revoke(@Param("id") id: string, @CurrentPrincipal() p: Principal) {
    return this.team.revoke(uuidParam(id, "Invitation"), p);
  }

  @Patch("members/:userId")
  @Roles(...MANAGERS)
  changeRole(@Param("userId") id: string, @Body() body: unknown, @CurrentPrincipal() p: Principal) {
    return this.team.changeRole(uuidParam(id, "Member"), ChangeRoleRequest.parse(body), p);
  }

  @Delete("members/:userId")
  @HttpCode(200)
  @Roles(...MANAGERS)
  remove(@Param("userId") id: string, @CurrentPrincipal() p: Principal) {
    return this.team.remove(uuidParam(id, "Member"), p);
  }
}

const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;

@Controller("v1/public/invitations")
export class PublicInvitationController {
  constructor(private readonly team: TeamService) {}

  @Get(":token")
  preview(@Param("token") token: string) {
    if (!TOKEN.test(token)) throw NO_INVITATION();
    return this.team.preview(token);
  }
}

@Controller("v1/invitations")
@UseGuards(AuthGuard)
export class InvitationJoinController {
  constructor(private readonly team: TeamService) {}

  @Post("join")
  @HttpCode(200)
  @AccountOnly()
  join(@Body() body: unknown, @CurrentAccount() a: Account) {
    return this.team.acceptExisting(JoinInvitationRequest.parse(body), a);
  }
}
