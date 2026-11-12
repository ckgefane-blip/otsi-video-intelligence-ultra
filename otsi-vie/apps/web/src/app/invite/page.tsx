"use client";
/**
 * Accept invite — SOT rebuild (page 1, alphabetical).
 * Two-column split from the SOT design (Invite.dc.html): a brand panel on the
 * left (logo, "Prove what a player did on the pitch.", pitch diagram, "Video
 * work stays on this computer") and the accept form on the right.
 *
 * The token travels after "#", so it never reaches a server log, the tunnel or
 * the proxy; the page reads it, shows who invited whom to which organization
 * with which role, and then:
 *  - a new person chooses their name and a password and is signed in;
 *  - a person whose address already has an account signs in (the token is kept
 *    for this tab only) and accepts with one click.
 */
import type { InvitationPreview } from "@otsi-vie/contracts";
import { Check, Loader2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { acceptInvitation, api, ApiProblem, invitationPreview, session } from "@/lib/api";
import type { Me } from "@otsi-vie/contracts";

const KEEP = "otsi-vie-invite";
/** the role's name as the person reads it (ADR-139) */
const roleLabel = (t: { body: { settings: Record<string, string> } }, r: string) => ({ OWNER: t.body.settings.roleOwner, ADMIN: t.body.settings.roleAdmin, ANALYST: t.body.settings.roleAnalyst, EDITOR: t.body.settings.roleEditor, SCOUT: t.body.settings.roleScout, VIEWER: t.body.settings.roleViewer } as Record<string, string>)[r] ?? (r.charAt(0) + r.slice(1).toLowerCase());

function readToken(): string | null {
  const h = new URLSearchParams(window.location.hash.slice(1)).get("t") ?? window.location.hash.slice(1);
  if (h && /^[A-Za-z0-9_-]{20,128}$/.test(h)) {
    try { sessionStorage.setItem(KEEP, h); } catch { /* storage unavailable */ }
    return h;
  }
  try { return sessionStorage.getItem(KEEP); } catch { return null; }
}
const forget = () => { try { sessionStorage.removeItem(KEEP); } catch { /* storage unavailable */ } };

/** the SOT's pitch diagram (Invite.dc.html), decorative */
function PitchDiagram() {
  return (
    <svg viewBox="0 0 680 440" aria-hidden="true" className="block h-auto w-full max-w-[560px] opacity-70">
      <g fill="none" stroke="#1F2A25" strokeWidth="1.5"><rect x="10" y="10" width="660" height="420" rx="4"></rect><path d="M340 10v420"></path><circle cx="340" cy="220" r="62"></circle><rect x="10" y="118" width="108" height="204"></rect><rect x="562" y="118" width="108" height="204"></rect><rect x="10" y="168" width="38" height="104"></rect><rect x="632" y="168" width="38" height="104"></rect></g>
      <g fill="none" stroke="#2BD4B0" strokeWidth="1.5" opacity=".55"><rect x="252" y="150" width="26" height="54" rx="2"></rect><rect x="392" y="236" width="26" height="54" rx="2"></rect><rect x="470" y="128" width="24" height="50" rx="2" strokeDasharray="4 3"></rect></g>
    </svg>
  );
}

const field = "mt-1.5 h-10 w-full rounded-ctl border border-line2 bg-canvas px-3 t-body text-ink outline-none focus:border-primary";
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
  const [showPassword, setShowPassword] = useState(false);
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

  const signedInAs = status === "signed-in" ? me?.user.email.toLowerCase() : null;

  return (
    <div className="flex min-h-screen w-full flex-row flex-wrap bg-canvas">
      {/* left: brand panel (SOT) */}
      <div className="relative flex min-h-[360px] flex-[1_1_520px] flex-col justify-between overflow-hidden border-r border-line bg-p0 px-12 py-10">
        <div className="flex flex-col gap-10">
          <div className="relative flex items-center gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/otsi-logo.png" alt="OTSI" className="block h-9 w-auto" draggable={false} />
            <span className="h-[26px] w-px bg-line2" aria-hidden="true" />
            <span className="t-small">Video Intelligence Engine</span>
          </div>
          <div className="relative flex max-w-[420px] flex-col gap-1.5">
            <h1 className="t-page">{t.body.auth.inviteHeroTitle}</h1>
            <p className="t-body text-ink2">{t.body.auth.inviteHeroSub}</p>
          </div>
        </div>
        <PitchDiagram />
        <div className="relative flex flex-wrap gap-[22px] t-small">
          <span className="inline-flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />{t.body.auth.inviteVideoLocal}</span>
          <span className="tabular-nums">v[—]</span>
        </div>
      </div>

      {/* right: the accept form (SOT) */}
      <main className="flex min-w-0 flex-[1_1_560px] items-center justify-center px-8 py-10">
        {problem ? (
          <div className="flex w-full max-w-[420px] flex-col gap-[18px]" role="alert">
            <h2 className="t-page">{t.body.auth.inviteTitle}</h2>
            <p className="t-body text-ink2">{problem}</p>
          </div>
        ) : !inv || status === "loading" ? (
          <p className="t-body text-center text-muted" role="status">{t.body.auth.inviteOpening}</p>
        ) : (
          <div className="flex w-full max-w-[420px] flex-col gap-[18px]">
            <div className="flex flex-col gap-2">
              <span className="t-small self-start">{t.body.auth.inviteYouAreInvited}</span>
              <h2 className="t-page">{t.body.auth.join.replace("{a}", inv.organization_name)}</h2>
              <p className="t-body text-ink2">
                {t.body.auth.inviteIntro.replace("{a}", inv.invited_by).replace("{b}", roleLabel(t, inv.role))}
              </p>
            </div>

            {inv.has_account ? (
              signedInAs === inv.email ? (
                <button type="button" onClick={() => void join()} disabled={busy} data-invite-join
                  className="vie-btn vie-btn-pri vie-btn-lg w-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {t.body.auth.acceptOpen.replace("{a}", inv.organization_name)}
                </button>
              ) : (
                <div>
                  <p className="t-body">{t.body.auth.alreadyAccount}</p>
                  {signedInAs && <p className="t-small mt-1">{t.body.auth.signedInAs.replace("{a}", signedInAs)}</p>}
                  <button type="button" data-invite-signin onClick={() => void (signedInAs ? signOut() : Promise.resolve()).then(() => router.push("/login?next=/invite"))}
                    className="vie-btn vie-btn-pri vie-btn-lg mt-3 w-full">
                    {signedInAs ? t.body.auth.signOutSignIn.replace("{a}", inv.email) : t.body.auth.signInAccept}
                  </button>
                </div>
              )
            ) : (
              <form onSubmit={createAccount} className="flex flex-col gap-[18px]" data-invite-form>
                <div className="flex flex-col gap-1.5">
                  <label className="t-label" htmlFor="email">{t.body.auth.email}</label>
                  <input id="email" type="email" autoComplete="username" value={inv.email} readOnly className={`${field} text-ink2`} />
                  <span className="t-small">{t.body.auth.inviteEmailHint}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="t-label" htmlFor="name">{t.body.auth.yourName}</label>
                  <input id="name" required minLength={2} maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="t-label" htmlFor="password">{t.body.auth.choosePassword}</label>
                  <div className="relative">
                    <input id="password" type={showPassword ? "text" : "password"} required minLength={12} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={`${field} pr-16`} />
                    <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t.body.auth.hidePassword : t.body.auth.showPassword}
                      className="vie-btn vie-btn-sm absolute right-1 top-[5px] h-[30px] border-transparent bg-transparent text-ink2 hover:bg-raised">
                      {showPassword ? t.body.auth.hidePassword : t.body.auth.showPassword}
                    </button>
                  </div>
                  <span className="t-small">{t.body.auth.invitePasswordHint}</span>
                </div>
                <button type="submit" disabled={busy} className="vie-btn vie-btn-pri vie-btn-lg w-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} {t.body.auth.inviteAcceptCreate}
                </button>
              </form>
            )}
            {error && <p role="alert" className={alert}>{error}</p>}
            <p className="text-center t-small">{t.body.auth.inviteAlreadyAccount} <a href="/login" className="text-primary hover:underline">{t.body.auth.signIn}</a></p>
          </div>
        )}
      </main>
    </div>
  );
}
