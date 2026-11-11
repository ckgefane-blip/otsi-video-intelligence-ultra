/**
 * v3 Phase A.8 (S03, ADR-070): the palette's commands, one table, each with the organization roles that may use it (the same roles the
 * API enforces for what it opens; a command a role may not use is not offered). Pages come from lib/pages.ts.
 */
import type { Ctx } from "./workContext";

/** not a page: the palette opens the keyboard map (A.9, ADR-071) */
export const KEYMAP_HREF = "#keyboard-map";

export interface Command { id: string; label: string; hint: string; href: string; roles: readonly string[] | null; words: string }
const ALL = null;
const WRITERS = ["OWNER", "ADMIN", "ANALYST", "EDITOR"] as const;
const MANAGERS = ["OWNER", "ADMIN"] as const;

export function commands(ctx: Ctx): Command[] {
  const list: Command[] = [
    { id: "upload", label: "Upload a video", hint: "Bring a match into a project", href: "/upload", roles: WRITERS, words: "add new import file link" },
    { id: "players", label: "Players", hint: "Every player the organization has recorded", href: "/players", roles: ALL, words: "roster people list" },
    { id: "matches", label: "Matches", hint: "Matches, clubs and team sheets", href: "/matches", roles: ALL, words: "fixtures games clubs teams" },
    { id: "admin", label: "Admin console", hint: "Models, workers, concurrency, audit log", href: "/settings/admin", roles: MANAGERS, words: "admin console workers concurrency models audit logs system governance" },
    { id: "wallet", label: "Token Wallet", hint: "Balance, ledger, token packs", href: "/settings/wallet", roles: ALL, words: "wallet tokens balance credits packs buy ledger billing" },
    { id: "billing", label: "Billing", hint: "Pack requests, top-ups, refunds, ledger", href: "/settings/admin/billing", roles: MANAGERS, words: "billing invoices bank transfer top up refund adjust packs" },
    { id: "team", label: "Team and roles", hint: "Invite people, change roles", href: "/settings/team", roles: MANAGERS, words: "invite members users access" },
    { id: "keys", label: "Keyboard shortcuts", hint: "Every key, this page's first (also: ?)", href: KEYMAP_HREF, roles: ALL, words: "keys keyboard hotkeys map" },
    { id: "security", label: "Security: two-step sign-in", hint: "Your account's sign-in protection", href: "/settings/security", roles: ALL, words: "password mfa 2fa account" },
  ];
  if (ctx.video) list.unshift({ id: "continue", label: "Continue on the open match", hint: "Analysis of the match in the context bar", href: `/analysis?video=${ctx.video}`, roles: ALL, words: "resume back analysis" });
  if (ctx.reel) list.unshift({ id: "studio", label: "Edit the open reel in Clip Studio", hint: "The reel in the context bar", href: `/studio?reel=${ctx.reel}`, roles: ALL, words: "edit timeline clip" });
  return list;
}

/** the commands this role may use whose words match the search, the label's start first */
export function matchCommands(cmds: Command[], role: string | null | undefined, q: string): Command[] {
  const allowed = cmds.filter((c) => !c.roles || (!!role && c.roles.includes(role)));
  const n = q.trim().toLowerCase();
  if (!n) return allowed;
  const starts = allowed.filter((c) => c.label.toLowerCase().startsWith(n));
  return [...starts, ...allowed.filter((c) => !starts.includes(c) && `${c.label} ${c.hint} ${c.words}`.toLowerCase().includes(n))];
}
