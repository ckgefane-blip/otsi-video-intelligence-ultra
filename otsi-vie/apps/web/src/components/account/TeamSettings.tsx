"use client";
/**
 * Team and roles (account menu, owners and admins): invite a person by e-mail with a role, copy or e-mail the one-time link, change a
 * member's role, remove a member, withdraw an invitation. Everything shown comes from GET /v1/team; every rule is enforced by the API
 * (the screen only hides what the API would refuse). There is no mail service: the link is copied, or handed to the person's own e-mail
 * app with a ready message.
 */
import { ROLE_SUMMARY, type CreatedInvitation, type Team, type TeamMember } from "@otsi-vie/contracts";
import { Check, Copy, Loader2, Mail, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";

const ROLES = ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT", "VIEWER"] as const;
type RoleName = (typeof ROLES)[number];
const roleLabel = (r: string) => r.charAt(0) + r.slice(1).toLowerCase();
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const ctl = "rounded-ctl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary";
const msgOf = (x: unknown) => (x instanceof ApiProblem ? x.message : "Could not reach OTSI VIE. Try again.");

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite#${token}`;
}

export function TeamSettings() {
  const { organization } = useAuth();
  const myRole = organization?.role as RoleName | undefined;
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleName>("VIEWER");
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Team>("/v1/team").then((t) => { setTeam(t); setError(null); }, (x) => setError(msgOf(x)));
  }, []);
  useEffect(load, [load, organization?.organization_id]);

  if (myRole !== "OWNER" && myRole !== "ADMIN") {
    return <section className="rounded-card border border-line bg-panel p-6" role="alert"><h1 className="text-xl font-bold">Team and roles</h1>
      <p className="mt-2 text-sm text-muted">Only an owner or an admin of {organization?.organization_name ?? "the organization"} manages the team.</p></section>;
  }
  const grantable = ROLES.filter((r) => r !== "OWNER" || myRole === "OWNER");
  const canManage = (m: TeamMember) => !m.is_you && (m.role !== "OWNER" || myRole === "OWNER");

  async function invite(e: FormEvent) {
    e.preventDefault();
    setBusy("invite"); setError(null); setCreated(null); setCopied(false);
    try {
      setCreated(await api<CreatedInvitation>("/v1/team/invitations", { method: "POST", json: { email, role } }));
      setEmail("");
      load();
    } catch (x) { setError(msgOf(x)); } finally { setBusy(null); }
  }

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key); setError(null);
    try { const r = await run(); if (r && typeof r === "object" && "members" in r) setTeam(r as Team); else load(); }
    catch (x) { setError(msgOf(x)); load(); } finally { setBusy(null); setConfirmRemove(null); }
  }

  const link = created ? inviteLink(created.token) : "";
  const mail = created ? `mailto:${encodeURIComponent(created.invitation.email)}?subject=${encodeURIComponent(`Join ${organization?.organization_name ?? "us"} on OTSI VIE`)}&body=${encodeURIComponent(
    `Hello,\n\nYou are invited to join ${organization?.organization_name ?? "our organization"} on OTSI VIE as ${roleLabel(created.invitation.role)}.\nOpen this link to choose your password (it works once, for 7 days):\n\n${link}\n`)}` : "";

  return (
    <div className="mx-auto max-w-5xl space-y-5" data-team-settings>
      <header>
        <h1 className="text-2xl font-bold">Team and roles</h1>
        <p className="mt-1 text-sm text-muted">Who can use {organization?.organization_name}, and what each person may do.</p>
      </header>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      <section className="rounded-card border border-line bg-panel p-5" aria-labelledby="invite-h">
        <h2 id="invite-h" className="text-lg font-semibold">Invite a person</h2>
        <form onSubmit={invite} className="mt-3 flex flex-wrap items-end gap-3" data-invite-create>
          <label className="flex min-w-[16rem] flex-1 flex-col text-sm">E-mail address
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 ${ctl}`} placeholder="name@club.com" />
          </label>
          <label className="flex flex-col text-sm">Role
            <select value={role} onChange={(e) => setRole(e.target.value as RoleName)} className={`mt-1 ${ctl}`} data-invite-role>
              {grantable.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy === "invite"} className="flex items-center gap-2 rounded-ctl bg-primary px-4 py-2 font-semibold text-white disabled:opacity-60">
            {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Create invitation link
          </button>
        </form>
        <p className="mt-2 text-xs text-muted">{roleLabel(role)}: {ROLE_SUMMARY[role]}</p>
        {created && (
          <div className="mt-4 rounded-ctl border border-primary/50 bg-primary/10 p-3" data-invite-link>
            <p className="text-sm font-semibold">Send this link to {created.invitation.email}</p>
            <p className="mt-1 text-xs text-muted">It works once, until {day(created.invitation.expires_at)}. It is shown only now: if it is lost, invite the address again.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input readOnly value={link} aria-label="Invitation link" className={`min-w-[16rem] flex-1 font-mono text-xs ${ctl}`} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" data-invite-copy onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
                className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
                {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy link"}
              </button>
              <a href={mail} className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60"><Mail className="h-4 w-4" /> Open in my e-mail</a>
            </div>
          </div>
        )}
      </section>

      <section className="rounded-card border border-line bg-panel p-5" aria-labelledby="members-h">
        <h2 id="members-h" className="text-lg font-semibold">Members {team && <span className="text-sm font-normal text-muted">({team.members.length})</span>}</h2>
        {!team ? <p className="mt-3 text-sm text-muted" role="status">Loading...</p> : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm" data-members>
              <thead className="text-left text-xs uppercase tracking-wide text-muted">
                <tr><th className="py-2 pr-3">Name</th><th className="py-2 pr-3">E-mail</th><th className="py-2 pr-3">Role</th><th className="py-2 pr-3">2-step</th><th className="py-2" /></tr>
              </thead>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.user_id} className="border-t border-line" data-member={m.email}>
                    <td className="py-2 pr-3 font-medium">{m.display_name}{m.is_you && <span className="ml-2 text-xs text-muted">(you)</span>}</td>
                    <td className="py-2 pr-3 text-muted">{m.email}</td>
                    <td className="py-2 pr-3">
                      {canManage(m) ? (
                        <select aria-label={`Role of ${m.display_name}`} value={m.role} disabled={busy === m.user_id} className={ctl} data-member-role
                          onChange={(e) => void act(m.user_id, () => api<Team>(`/v1/team/members/${m.user_id}`, { method: "PATCH", json: { role: e.target.value } }))}>
                          {grantable.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
                        </select>
                      ) : roleLabel(m.role)}
                    </td>
                    <td className="py-2 pr-3">{m.two_step ? <span className="inline-flex items-center gap-1 text-ok"><ShieldCheck className="h-4 w-4" /> On</span> : <span className="text-muted">Off</span>}</td>
                    <td className="py-2 text-right">
                      {canManage(m) && (confirmRemove === m.user_id ? (
                        <span className="inline-flex gap-2">
                          <button type="button" data-member-remove-confirm disabled={busy === m.user_id} className="rounded-ctl bg-danger px-3 py-1.5 text-xs font-semibold text-white"
                            onClick={() => void act(m.user_id, () => api<Team>(`/v1/team/members/${m.user_id}`, { method: "DELETE" }))}>Remove {m.display_name.split(" ")[0]}</button>
                          <button type="button" className="text-xs text-muted underline" onClick={() => setConfirmRemove(null)}>Keep</button>
                        </span>
                      ) : (
                        <button type="button" data-member-remove onClick={() => setConfirmRemove(m.user_id)} aria-label={`Remove ${m.display_name}`}
                          className="inline-flex items-center gap-1 rounded-ctl border border-line px-2 py-1.5 text-xs text-muted hover:border-danger hover:text-danger">
                          <Trash2 className="h-3.5 w-3.5" /> Remove
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {team && team.invitations.length > 0 && (
        <section className="rounded-card border border-line bg-panel p-5" aria-labelledby="pending-h">
          <h2 id="pending-h" className="text-lg font-semibold">Invitations not yet accepted</h2>
          <ul className="mt-3 divide-y divide-line text-sm" data-invitations>
            {team.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2" data-invitation={i.email}>
                <span className="flex-1 font-medium">{i.email}</span>
                <span>{roleLabel(i.role)}</span>
                <span className="text-xs text-muted">by {i.invited_by}, {i.state === "EXPIRED" ? `expired ${day(i.expires_at)}` : `until ${day(i.expires_at)}`}</span>
                {(i.role !== "OWNER" || myRole === "OWNER") && (
                  <button type="button" data-invitation-revoke disabled={busy === i.id} onClick={() => void act(i.id, () => api(`/v1/team/invitations/${i.id}`, { method: "DELETE" }))}
                    className="rounded-ctl border border-line px-2 py-1 text-xs text-muted hover:border-danger hover:text-danger">{i.state === "EXPIRED" ? "Clear" : "Withdraw"}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-card border border-line bg-panel p-5" aria-labelledby="roles-h">
        <h2 id="roles-h" className="text-lg font-semibold">What each role may do</h2>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          {ROLES.map((r) => <div key={r}><dt className="font-semibold">{roleLabel(r)}</dt><dd className="text-muted">{ROLE_SUMMARY[r]}</dd></div>)}
        </dl>
      </section>
    </div>
  );
}
