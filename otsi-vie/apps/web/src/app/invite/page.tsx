"use client";
/**
 * Opening an invitation link (/invite#<token>). The token travels after "#", so it never reaches a server log, the tunnel or the
 * proxy; the page reads it, shows who invited whom to which organization with which role, and then:
 *  - a new person chooses their name and a password and is signed in;
 *  - a person whose address already has an account signs in (the token is kept for this tab only) and accepts with one click.
 */
import type { InvitationPreview } from "@otsi-vie/contracts";
import { ROLE_SUMMARY } from "@otsi-vie/contracts";
import { Check, Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { acceptInvitation, api, ApiProblem, invitationPreview, session } from "@/lib/api";
import type { Me } from "@otsi-vie/contracts";

const KEEP = "otsi-vie-invite";
/** the role's name as the person reads it (ADR-139); the summary next to it stays English (contracts) */
const roleLabel = (t: { body: { settings: Record<string, string> } }, r: string) => ({ OWNER: t.body.settings.roleOwner, ADMIN: t.body.settings.roleAdmin, ANALYST: t.body.settings.roleAnalyst, EDITOR: t.body.settings.roleEditor, SCOUT: t.body.settings.roleScout, VIEWER: t.body.settings.roleViewer } as Record<string, string>)[r] ?? (r.charAt(0) + r.slice(1).toLowerCase());

/** render the invite line with the email and role in bold, keeping the locale's word order */
const inviteLine = (t: { body: { auth: { inviteLine: string } } }, inviter: string, email: string, role: string) =>
  t.body.auth.inviteLine.split(/(\{[abc]\})/g).map((part, i) => {
    if (part === "{a}") return <span key={i}>{inviter}</span>;
    if (part === "{b}") return <strong key={i} className="font-semibold text-ink">{email}</strong>;
    if (part === "{c}") return <strong key={i} className="font-semibold text-ink">{role}</strong>;
    return <span key={i}>{part}</span>;
  });

function readToken(): string | null {
  const h = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? window.location.hash.slice(1);
  if (h && /^[A-Za-z0-9_-]{20,128}$/.test(h)) {
    try { sessionStorage.setItem(KEEP, h); } catch { /* storage unavailable */ }
    return h;
  }
  try { return sessionStorage.getItem(KEEP); } catch { return null; }
}
const forget = () => { try { sessionStorage.removeItem(KEEP); } catch { /* storage unavailable */ } };

const field = "mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 t-body outline-none focus:border-primary";
/** Drop 1 card: the shared vie-panel, centred by the invite layout. */
const card = "w-full max-w-md vie-panel p-6";
const alert = "mt-3 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger";

export default function InvitePage() {
  const { t } = useLocale();
  const { status, me, adoptSession, signOut } = useAuth();
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [inv, setInv] = useState<InvitationPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tok = readToken();
    setToken(tok);
    if (!tok) { setProblem(t.body.auth.inviteNeedsLink); return; }
    void invitationPreview(tok).then(setInv, (e) => { setProblem(e instanceof ApiProblem ? e.message : t.body.auth.inviteUnreachable); forget(); });
  }, []);

  /** open the organization just joined (the choice is remembered before the session is taken over) */
  function choose(orgName: string, m: Me) {
    forget();
    const joined = m.memberships.find((x) => x.organization_name === orgName);
    if (joined) session.organizationId = joined.organization_id;
  }

  async function createAccount(e: FormEvent) {
    e.preventDefault();
    if (!token || !inv) return;
    if (password !== again) { setError(t.body.auth.passwordsDiffer); return; }
    setBusy(true); setError(null);
    try {
      const s = await acceptInvitation({ token, display_name: name.trim(), password });
      choose(inv.organization_name, s.me);
      adoptSession(s);
      router.replace("/dashboard");
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : t.body.auth.inviteUnreachable);
    } finally { setBusy(false); }
  }

  async function join() {
    if (!token || !inv) return;
    setBusy(true); setError(null);
    try {
      const m = await api<Me>("/v1/invitations/join", { method: "POST", json: { token }, organization: false });
      choose(inv.organization_name, m);
      window.location.assign("/dashboard");                          // a fresh start reads the new membership
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : t.body.auth.inviteUnreachable);
    } finally { setBusy(false); }
  }

  if (problem) {
    return <div className={card} role="alert"><h1 className="t-page">{t.body.auth.inviteTitle}</h1><p className="t-small mt-2">{problem}</p></div>;
  }
  if (!inv || status === "loading") return <p className="text-center t-small" role="status">{t.body.auth.inviteOpening}</p>;

  const signedInAs = status === "signed-in" ? me?.user.email.toLowerCase() : null;
  return (
    <div className={card} data-invite>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/otsi-logo.png" alt="OTSI VIE" className="h-[22px] w-auto" draggable={false} />
      <h1 className="t-page mt-4">{t.body.auth.join.replace("{a}", inv.organization_name)}</h1>
      <p className="t-small mt-2">{inviteLine(t, inv.invited_by, inv.email, roleLabel(t, inv.role))}</p>
      <p className="t-small mt-1">{ROLE_SUMMARY[inv.role]} {t.body.auth.inviteLinkUntil.replace("{a}", new Date(inv.expires_at).toLocaleDateString())}</p>

      {inv.has_account ? (
        signedInAs === inv.email ? (
          <button type="button" onClick={() => void join()} disabled={busy} data-invite-join
            className="vie-btn vie-btn-pri vie-btn-lg mt-5 w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t.body.auth.acceptOpen.replace("{a}", inv.organization_name)}
          </button>
        ) : (
          <div className="mt-5">
            <p className="t-body">{t.body.auth.alreadyAccount}</p>
            {signedInAs && <p className="t-small mt-1">{t.body.auth.signedInAs.replace("{a}", signedInAs)}</p>}
            <button type="button" data-invite-signin onClick={() => void (signedInAs ? signOut() : Promise.resolve()).then(() => router.push("/login?next=/invite"))}
              className="vie-btn vie-btn-pri vie-btn-lg mt-3 w-full">
              {signedInAs ? t.body.auth.signOutSignIn.replace("{a}", inv.email) : t.body.auth.signInAccept}
            </button>
          </div>
        )
      ) : (
        <form onSubmit={createAccount} className="mt-5" data-invite-form>
          <label className="t-label block" htmlFor="name">{t.body.auth.yourName}</label>
          <input id="name" required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          <label className="t-label mt-3 block" htmlFor="email">{t.body.auth.email}</label>
          <input id="email" type="email" autoComplete="username" value={inv.email} readOnly className={`${field} text-muted`} />
          <label className="t-label mt-3 block" htmlFor="password">{t.body.auth.choosePassword} <span className="text-muted">{t.body.auth.passwordMin}</span></label>
          <input id="password" type="password" required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
          <label className="t-label mt-3 block" htmlFor="again">{t.body.auth.typeAgain}</label>
          <input id="again" type="password" required minLength={12} autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={field} />
          <button type="submit" disabled={busy} className="vie-btn vie-btn-pri vie-btn-lg mt-4 w-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t.body.auth.createJoin}
          </button>
        </form>
      )}
      {error && <p role="alert" className={alert}>{error}</p>}
    </div>
  );
}
