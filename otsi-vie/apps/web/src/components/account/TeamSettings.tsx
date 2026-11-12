"use client";
/**
 * Team (SOT, Team.dc.html): invite a person by e-mail with a role, copy the one-time link, change a member's
 * role, remove a member, withdraw an invitation. Everything shown comes from GET /v1/team; every rule is
 * enforced by the API (the screen only hides what the API would refuse). There is no mail service: the link is
 * copied, or handed to the person's own e-mail app with a ready message. The owner row can never be removed.
 */
import { ROLE_SUMMARY, type CreatedInvitation, type Team, type TeamMember } from "@otsi-vie/contracts";
import { Check, Link2, Loader2, Mail, Trash2, User, UserPlus } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

const ROLES = ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT", "VIEWER"] as const;
type RoleName = (typeof ROLES)[number];
const roleLabel = (t: { body: { settings: Record<string, string> } }, r: string) => ({ OWNER: t.body.settings.roleOwner, ADMIN: t.body.settings.roleAdmin, ANALYST: t.body.settings.roleAnalyst, EDITOR: t.body.settings.roleEditor, SCOUT: t.body.settings.roleScout, VIEWER: t.body.settings.roleViewer } as Record<string, string>)[r] ?? (r.charAt(0) + r.slice(1).toLowerCase());
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const msgOf = (t: { body: { settings: { unreachable: string } } }, x: unknown) => (x instanceof ApiProblem ? x.message : t.body.settings.unreachable);

export function inviteLink(token: string): string {
  return `${window.location.origin}/invite#${token}`;
}

const grid = "grid grid-cols-[minmax(220px,2fr)_minmax(200px,1.5fr)_150px_110px] gap-3 items-center";

export function TeamSettings() {
  const { t } = useLocale();
  const s = t.body.settings;
  const { organization } = useAuth();
  const myRole = organization?.role as RoleName | undefined;
  const [team, setTeam] = useState<Team | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleName>("ANALYST");
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const load = useCallback(() => {
    void api<Team>("/v1/team").then((tm) => { setTeam(tm); setError(null); }, (x) => setError(msgOf(t, x)));
  }, []);
  useEffect(load, [load, organization?.organization_id]);

  if (myRole !== "OWNER" && myRole !== "ADMIN") {
    return <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-page="settings-team">
      <div className="flex flex-col gap-1.5"><span className="eb">{t.desktop.navSettings}</span><h1 className="h1">{s.stTeamTitle}</h1></div>
      <section className="panel p-4" role="alert"><p className="t-body text-muted">{s.teamOnly.replace("{a}", organization?.organization_name ?? s.teamOrgFallback)}</p></section>
    </main>;
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
  const mail = created ? `mailto:${encodeURIComponent(created.invitation.email)}?subject=${encodeURIComponent(s.mailSubject.replace("{a}", organization?.organization_name ?? "us"))}&body=${encodeURIComponent(
    s.mailBody.replace("{a}", organization?.organization_name ?? "our organization").replace("{b}", roleLabel(t, created.invitation.role)).replace("{c}", link))}` : "";

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-page="settings-team">
      <div className="flex flex-col gap-1.5"><span className="eb">{t.desktop.navSettings}</span><h1 className="h1">{s.stTeamTitle}</h1></div>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}

      <section className="panel" aria-labelledby="iv">
        <div className="ph"><h2 id="iv" className="h3">{s.stTeamInvite}</h2></div>
        <div className="pb">
          <form onSubmit={invite} className="flex flex-wrap items-end gap-2.5" data-invite-create>
            <div className="field" style={{ flex: "2 1 260px" }}>
              <label className="lab" htmlFor="team-email">{s.stTeamEmail}</label>
              <input id="team-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="in" placeholder={s.emailPlaceholder} />
            </div>
            <div className="field" style={{ flex: "1 1 160px" }}>
              <label className="lab" htmlFor="team-role">{s.roleLabel}</label>
              <select id="team-role" value={role} onChange={(e) => setRole(e.target.value as RoleName)} className="in" data-invite-role>
                {grantable.map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
              </select>
            </div>
            <button type="submit" disabled={busy === "invite"} className="btn pri">
              {busy === "invite" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {s.stTeamSendInvite}
            </button>
            <button type="button" disabled={!created || busy === "invite"} className="btn"
              onClick={() => void navigator.clipboard.writeText(link).then(() => setCopied(true), () => setCopied(false))}>
              {copied ? <Check className="h-4 w-4 text-ok" /> : <Link2 className="h-4 w-4" />} {copied ? s.copied : s.stTeamCopyInviteLink}
            </button>
          </form>
          <p className="t-small mt-2">{s.roleSummaryLine.replace("{a}", roleLabel(t, role)).replace("{b}", ROLE_SUMMARY[role])}</p>
          {created && (
            <div className="mt-4 rounded-ctl border border-primary/50 bg-primary/10 p-3" data-invite-link>
              <p className="t-panel">{s.sendLink.replace("{a}", created.invitation.email)}</p>
              <p className="mt-1 text-xs text-muted">{s.linkOnce.replace("{a}", day(created.invitation.expires_at))}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input readOnly value={link} aria-label={s.inviteLinkAria} className="in mono flex-1" style={{ fontSize: 12, minWidth: "16rem" }} onFocus={(e) => e.currentTarget.select()} />
                <a href={mail} className="btn sm"><Mail className="h-4 w-4" /> {s.openEmail}</a>
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel" aria-labelledby="mb">
        <div className="ph"><h2 id="mb" className="h3">{s.members}</h2><span className="mu xs mono">{team ? team.members.length : "…"}</span></div>
        <div className={`eb ${grid} px-3.5 h-[34px] border-b border-line`}><span>{s.colName}</span><span>{s.stTeamEmail}</span><span>{s.roleLabel}</span><span /></div>
        {!team ? <p className="t-body p-4 text-muted" role="status">{s.loading}</p> : (
          <>
            {team.members.map((m) => (
              <div key={m.user_id} className={`lr ${grid} px-3.5`} style={{ minHeight: 52 }} data-member={m.email}>
                <span className="flex items-center gap-2.5">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-raised text-muted">
                    <User className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="font-normal">{m.display_name}</span>
                  {m.is_you && <span className="tag">{s.stTeamYou}</span>}
                </span>
                <span className="text-muted">{m.email}</span>
                <span>
                  {canManage(m) ? (
                    <select aria-label={s.roleOfAria.replace("{a}", m.display_name)} value={m.role} disabled={busy === m.user_id} className="in" style={{ height: 30 }} data-member-role
                      onChange={(e) => void act(m.user_id, () => api<Team>(`/v1/team/members/${m.user_id}`, { method: "PATCH", json: { role: e.target.value } }))}>
                      {grantable.map((r) => <option key={r} value={r}>{roleLabel(t, r)}</option>)}
                    </select>
                  ) : <span className="chip" style={{ color: "rgb(var(--primary))", borderColor: "rgba(43,212,176,.4)" }}>{roleLabel(t, m.role)}</span>}
                </span>
                <span className="text-right">
                  {canManage(m) && (confirmRemove === m.user_id ? (
                    <span className="inline-flex gap-2">
                      <button type="button" data-member-remove-confirm disabled={busy === m.user_id}
                        className="t-button inline-flex items-center gap-2 rounded-ctl bg-danger px-3 py-1.5 text-white disabled:opacity-50"
                        onClick={() => void act(m.user_id, () => api<Team>(`/v1/team/members/${m.user_id}`, { method: "DELETE" }))}>{s.removeConfirm.replace("{a}", m.display_name.split(" ")[0] ?? "")}</button>
                      <button type="button" className="text-xs text-muted underline" onClick={() => setConfirmRemove(null)}>{s.keep}</button>
                    </span>
                  ) : (
                    <button type="button" data-member-remove onClick={() => setConfirmRemove(m.user_id)} aria-label={s.removeAria.replace("{a}", m.display_name)}
                      className="btn sm hover:border-danger hover:text-danger">
                      <Trash2 className="h-3.5 w-3.5" /> {s.remove}
                    </button>
                  ))}
                  {!canManage(m) && <span className="mu sm">{s.stTeamCantRemove}</span>}
                </span>
              </div>
            ))}
            {team.members.length <= 1 && (
              <div className="lr px-3.5" style={{ minHeight: 44 }}><span className="mu sm">{s.stTeamInvitedHere}</span></div>
            )}
          </>
        )}
      </section>

      <section className="panel flex flex-1 flex-col" aria-labelledby="pi">
        <div className="ph"><h2 id="pi" className="h3">{s.stTeamPending}</h2><span className="mu xs mono">{team ? team.invitations.length : "…"}</span></div>
        {!team ? <p className="t-body p-4 text-muted" role="status">{s.loading}</p> : team.invitations.length === 0 ? (
          <div className="empty flex-1">
            <span className="ei"><Mail className="i" aria-hidden /></span>
            <h3>{s.stTeamNoPending}</h3>
            <p>{s.stTeamPendingHint}</p>
          </div>
        ) : (
          <ul className="divide-y divide-line" data-invitations>
            {team.invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-3.5 py-2" data-invitation={i.email}>
                <span className="flex-1 font-normal">{i.email}</span>
                <span>{roleLabel(t, i.role)}</span>
                <span className="text-xs text-muted">{s.invitedBy.replace("{a}", i.invited_by).replace("{b}", i.state === "EXPIRED" ? s.expired.replace("{a}", day(i.expires_at)) : s.until.replace("{a}", day(i.expires_at)))}</span>
                {(i.role !== "OWNER" || myRole === "OWNER") && (
                  <button type="button" data-invitation-revoke disabled={busy === i.id} onClick={() => void act(i.id, () => api(`/v1/team/invitations/${i.id}`, { method: "DELETE" }))}
                    className="btn sm hover:border-danger hover:text-danger">{i.state === "EXPIRED" ? s.clear : s.withdraw}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
