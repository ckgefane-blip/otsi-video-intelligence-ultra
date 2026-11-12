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
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

const ROLES = ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT", "VIEWER"] as const;
type RoleName = (typeof ROLES)[number];
const roleLabel = (t: { body: { settings: Record<string, string> } }, r: string) => ({ OWNER: t.body.settings.roleOwner, ADMIN: t.body.settings.roleAdmin, ANALYST: t.body.settings.roleAnalyst, EDITOR: t.body.settings.roleEditor, SCOUT: t.body.settings.roleScout, VIEWER: t.body.settings.roleViewer } as Record<string, string>)[r] ?? (r.charAt(0) + r.slice(1).toLowerCase());
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const ctl = "rounded-ctl border border-line bg-canvas px-3 py-2 outline-none focus:border-primary";
const msgOf = (t: { body: { settings: { unreachable: string } } }, x: unknown) => (x instanceof ApiProblem ? x.message : t.body.settings.unreachable);

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite#${token}`;
}

export function TeamSettings() {
  const { t } = useLocale();
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
    void api<Team>("/v1/team").then((tm) => { setTeam(tm); setError(null); }, (x) => setError(msgOf(t, x)));
  }, []);
  useEffect(load, [load, organization?.organization_id]);

  if (myRole !== "OWNER" && myRole !== "ADMIN") {
    return <section className="vie-panel w-full max-w-5xl p-4" role="alert"><h1 className="t-page">{t.body.settings.teamTitle}</h1>
      <p className="t-body mt-2 text-muted">{t.body.settings.teamOnly.replace("{a}", organization?.organization_name ?? t.body.settings.teamOrgFallback)}</p></section>;
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
    } catch (x) { setError(msgOf(t, x)); } finally { setBusy(null); }
  }

  async function act(key: string, run: () => Promise<unknown>) {
    setBusy(key); setError(null);
    try { const r = await run(); if (r && typeof r === "object" && "members" in r) setTeam(r as Team); else load(); }
    catch (x) { setError(msgOf(t, x)); load(); } finally { setBusy(null); setConfirmRemove(null); }
  }

  const link = created ? inviteLink(created.token) : "";
  const mail = created ? `mailto:${encodeURIComponent(created.invitation.email)}?subject=${encodeURIComponent(t.body.settings.mailSubject.replace("{a}", organization?.organization_name ?? "us"))}&body=${encodeURIComponent(
    t.body.settings.mailBody.replace("{a}", organization?.organization_name ?? "our organization").replace("{b}", roleLabel(t, created.invitation.role)).replace("{c}", link))}` : "";

  return (
    <div className="w-full max-w-5xl space-y-4" data-team-settings>
      <header>
        <h1 className="t-page">{t.body.settings.teamTitle}</h1>
        <p className="t-body mt-1 text-muted">{t.body.settings.teamSubtitle.replace("{a}", organization?.organization_name ?? "")}</p>
      </header>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}

      <section className="vie-panel" aria-labelledby="invite-h">
        <div className="vie-ph"><h2 id="invite-h" className="t-section">{t.body.settings.inviteTitle}</h2></div>
        <div className="p-4">
        <form onSubmit={invite} className="flex flex-wrap items-end gap-3" data-invite-create>
          <label className="flex min-w-[16rem] flex-1 flex-col"><span className="t-label">{t.body.settings.emailLabel}</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={`mt-1 ${ctl}`} placeholder={t.body.settings.emailPlaceholder} />
          </label>
          <label className="flex flex-col"><span className="t-label">{t.body.settings.roleLabel}</span>
            <select value={role} onChange={(e) => setRole(e.target.value as RoleName)} className={`mt-1 ${ctl}`} data-invite-role>
              {grantable.map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
            </select>
          </label>
          <button type="submit" disabled={busy === "invite"} className="vie-btn vie-btn-pri">
            {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t.body.settings.createInvite}
          </button>
        </form>
        <p className="t-small mt-2">{t.body.settings.roleSummaryLine.replace("{a}", roleLabel(t, role)).replace("{b}", ROLE_SUMMARY[role])}</p>
        {created && (
          <div className="mt-4 rounded-ctl border border-primary/50 bg-primary/10 p-3" data-invite-link>
            <p className="t-panel">{t.body.settings.sendLink.replace("{a}", created.invitation.email)}</p>
            <p className="mt-1 text-xs text-muted">{t.body.settings.linkOnce.replace("{a}", day(created.invitation.expires_at))}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <input readOnly value={link} aria-label={t.body.settings.inviteLinkAria} className={`min-w-[16rem] flex-1 font-mono text-xs ${ctl}`} onFocus={(e) => e.currentTarget.select()} />
              <button type="button" data-invite-copy onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}
                className="vie-btn vie-btn-sm">
                {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? t.body.settings.copied : t.body.settings.copyLink}
              </button>
              <a href={mail} className="vie-btn vie-btn-sm"><Mail className="h-4 w-4" /> {t.body.settings.openEmail}</a>
            </div>
          </div>
        )}
        </div>
      </section>

      <section className="vie-panel" aria-labelledby="members-h">
        <div className="vie-ph"><h2 id="members-h" className="t-section">{team ? t.body.settings.membersCount.replace("{a}", String(team.members.length)) : t.body.settings.members}</h2></div>
        <div className="p-4">
        {!team ? <p className="t-body text-muted" role="status">{t.body.settings.loading}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full" data-members>
              <thead className="t-th text-left">
                <tr><th className="py-2 pr-3">{t.body.settings.colName}</th><th className="py-2 pr-3">{t.body.settings.colEmail}</th><th className="py-2 pr-3">{t.body.settings.roleLabel}</th><th className="py-2 pr-3">{t.body.settings.colTwoStep}</th><th className="py-2" /></tr>
              </thead>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.user_id} className="border-t border-line" data-member={m.email}>
                    <td className="py-2 pr-3 font-normal">{m.display_name}{m.is_you && <span className="ml-2 text-xs text-muted">{t.body.settings.you}</span>}</td>
                    <td className="py-2 pr-3 text-muted">{m.email}</td>
                    <td className="py-2 pr-3">
                      {canManage(m) ? (
                        <select aria-label={t.body.settings.roleOfAria.replace("{a}", m.display_name)} value={m.role} disabled={busy === m.user_id} className={ctl} data-member-role
                          onChange={(e) => void act(m.user_id, () => api<Team>(`/v1/team/members/${m.user_id}`, { method: "PATCH", json: { role: e.target.value } }))}>
                          {grantable.map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
                        </select>
                      ) : roleLabel(t, m.role)}
                    </td>
                    <td className="py-2 pr-3">{m.two_step ? <span className="inline-flex items-center gap-1 text-ok"><ShieldCheck className="h-4 w-4" /> {t.body.settings.twoStepOn}</span> : <span className="text-muted">{t.body.settings.twoStepOff}</span>}</td>
                    <td className="py-2 text-right">
                      {canManage(m) && (confirmRemove === m.user_id ? (
                        <span className="inline-flex gap-2">
                          <button type="button" data-member-remove-confirm disabled={busy === m.user_id} className="t-button inline-flex items-center gap-2 rounded-ctl bg-danger px-3 py-1.5 text-white disabled:opacity-50"
                            onClick={() => void act(m.user_id, () => api<Team>(`/v1/team/members/${m.user_id}`, { method: "DELETE" }))}>{t.body.settings.removeConfirm.replace("{a}", m.display_name.split(" ")[0] ?? "")}</button>
                          <button type="button" className="text-xs text-muted underline" onClick={() => setConfirmRemove(null)}>{t.body.settings.keep}</button>
                        </span>
                      ) : (
                        <button type="button" data-member-remove onClick={() => setConfirmRemove(m.user_id)} aria-label={t.body.settings.removeAria.replace("{a}", m.display_name)}
                          className="vie-btn vie-btn-sm hover:border-danger hover:text-danger">
                          <Trash2 className="h-3.5 w-3.5" /> {t.body.settings.remove}
                        </button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </section>

      {team && team.invitations.length > 0 && (
        <section className="vie-panel" aria-labelledby="pending-h">
          <div className="vie-ph"><h2 id="pending-h" className="t-section">{t.body.settings.pending}</h2></div>
          <div className="p-4">
          <ul className="divide-y divide-line" data-invitations>
            {team.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-2" data-invitation={i.email}>
                <span className="flex-1 font-normal">{i.email}</span>
                <span>{roleLabel(t, i.role)}</span>
                <span className="text-xs text-muted">{t.body.settings.invitedBy.replace("{a}", i.invited_by).replace("{b}", i.state === "EXPIRED" ? t.body.settings.expired.replace("{a}", day(i.expires_at)) : t.body.settings.until.replace("{a}", day(i.expires_at)))}</span>
                {(i.role !== "OWNER" || myRole === "OWNER") && (
                  <button type="button" data-invitation-revoke disabled={busy === i.id} onClick={() => void act(i.id, () => api(`/v1/team/invitations/${i.id}`, { method: "DELETE" }))}
                    className="vie-btn vie-btn-sm hover:border-danger hover:text-danger">{i.state === "EXPIRED" ? t.body.settings.clear : t.body.settings.withdraw}</button>
                )}
              </li>
            ))}
          </ul>
          </div>
        </section>
      )}

      <section className="vie-panel" aria-labelledby="roles-h">
        <div className="vie-ph"><h2 id="roles-h" className="t-section">{t.body.settings.rolesTitle}</h2></div>
        <div className="p-4">
        <dl className="grid gap-2 sm:grid-cols-2">
          {ROLES.map((r) => <div key={r}><dt className="font-normal">{roleLabel(t, r)}</dt><dd className="text-muted">{ROLE_SUMMARY[r]}</dd></div>)}
        </dl>
        </div>
      </section>
    </div>
  );
}
