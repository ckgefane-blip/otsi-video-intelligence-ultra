/** User-to-user Invite (referral with token rewards, owner decision 2026-11-14): one user invites another
 *  user — a player, a club, an academy, anyone. The inviter shares a link with a code; the invitee signs up
 *  with it and gets a bonus on top of the free grant; the inviter is rewarded only when the invitee does
 *  something real (first match analysis or first pack purchase), never on signup alone.
 *
 *  This is NOT the staff/team invite (invite a person by email to join your club with a role — the /invite
 *  page and TeamSettings): that one adds a member to an organization, this one brings a new user to OTSI.
 *  Invites live on the central server: the code is per user, sign-up accepts it, and both rewards are
 *  wallet ledger rows (INVITE_BONUS / INVITE_REWARD), so the balance is derived from them like any credit.
 */
import { z } from "zod";

/** An invite code: 10 URL-safe characters (no 0/O/1/l, so it reads clearly), generated server-side, one per user. */
export const InviteCode = z.string().regex(/^[A-Za-z0-9]{10}$/);
export type InviteCode = z.infer<typeof InviteCode>;

/** The caller's own invite: just the code. The web builds the share link as <origin>/setup?invite=<code>,
 *  so the server never has to guess the app's public address. */
export const MyInvite = z.object({ code: InviteCode });
export type MyInvite = z.infer<typeof MyInvite>;
