"use client";
/**
 * First run — owner setup, SOT rebuild (page 10, alphabetical).
 * Two-column split from the SOT design (Setup.dc.html): a brand panel on the
 * left (logo, "Prove what a player did on the pitch.", pitch diagram, "Video
 * work stays on this computer") and the owner form on the right (Full name,
 * Email, Password with a Show button and a 4-segment strength meter, "Create
 * owner account"). The same split as the Accept invite page (page 1); the
 * pitch diagram is shared with it.
 *
 * The form creates the owner account through POST /v1/auth/setup and signs
 * them in; they land on the welcome tour. The SOT's form has no organization
 * field, so the organization takes the owner's name (the owner can rename it
 * in Settings › Team). An installation that already has an owner gets a 409
 * (ALREADY_SET_UP) and a link to sign in instead. A person who is already
 * signed in is sent to the dashboard.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PitchDiagram } from "@/components/auth/PitchDiagram";
import { useLocale } from "@/lib/i18n";
import { ApiProblem, setupOwner } from "@/lib/api";
import Link from "next/link";

const field = "mt-1.5 h-10 w-full rounded-ctl border border-line2 bg-canvas px-3 t-body text-ink outline-none focus:border-primary";

/** the 4-segment strength meter (SOT): length, mixed case, a digit, a symbol */
function strength(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw)) s++;
  return s;
}

export default function SetupPage() {
  const { t } = useLocale();
  const { status, adoptSession } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [already, setAlready] = useState(false);
  const score = useMemo(() => strength(password), [password]);

  useEffect(() => { if (status === "signed-in") router.replace("/dashboard"); }, [status, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) { setError(t.body.auth.nameTooShort); return; }
    if (password.length < 12) { setError(t.body.auth.setupPasswordHint); return; }
    setBusy(true); setError(null); setAlready(false);
    try {
      const s = await setupOwner({ email: email.trim(), display_name: name.trim(), password });
      adoptSession(s);
      router.replace("/welcome");
    } catch (x) {
      if (x instanceof ApiProblem && x.code === "ALREADY_SET_UP") { setAlready(true); setError(t.body.auth.setupAlready); }
      else setError(x instanceof ApiProblem ? x.message : t.body.auth.setupUnreachable);
    } finally { setBusy(false); }
  }

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

      {/* right: the owner form (SOT) */}
      <main className="flex min-w-0 flex-[1_1_560px] items-center justify-center px-8 py-10">
        <form onSubmit={submit} aria-labelledby="setup-title" className="flex w-full max-w-[420px] flex-col gap-[18px]">
          <div className="flex flex-col gap-2">
            <span className="vie-chip self-start" style={{ color: "rgb(var(--primary))", borderColor: "rgba(43,212,176,.38)" }}>{t.body.auth.setupFirstRun}</span>
            <h2 id="setup-title" className="t-page">{t.body.auth.setupTitle}</h2>
            <p className="t-body text-ink2">{t.body.auth.setupSub}</p>
          </div>
          <div>
            <label htmlFor="setup-name" className="t-body text-ink2">{t.body.auth.setupFullName}</label>
            <input id="setup-name" name="display_name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="setup-email" className="t-body text-ink2">{t.body.auth.setupEmail}</label>
            <input id="setup-email" name="email" type="email" autoComplete="email" placeholder={t.body.auth.setupEmailPh} value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
          </div>
          <div>
            <label htmlFor="setup-password" className="t-body text-ink2">{t.body.auth.setupPassword}</label>
            <div className="relative mt-1.5">
              <input id="setup-password" name="password" type={showPassword ? "text" : "password"} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className="h-10 w-full rounded-ctl border border-line2 bg-canvas px-3 pr-16 t-body text-ink outline-none focus:border-primary" />
              <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t.body.auth.hidePassword : t.body.auth.showPassword}
                className="absolute right-1 top-[5px] h-[30px] rounded-ctl bg-raised px-3 t-body text-ink2 hover:text-ink">
                {showPassword ? t.body.auth.hidePassword : t.body.auth.showPassword}
              </button>
            </div>
            <div className="mt-1 grid grid-cols-4 gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className={`h-[3px] rounded-sm ${i < score ? "bg-primary" : "bg-line2"}`} />
              ))}
            </div>
            <span className="t-small text-muted">{t.body.auth.setupPasswordHint}</span>
          </div>
          {error && (
            <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">
              {error}{" "}
              {already && <Link href="/login" className="underline">{t.body.auth.signIn}</Link>}
            </p>
          )}
          <button type="submit" disabled={busy} className="h-11 w-full rounded-ctl bg-primary t-body font-medium text-primary-ink hover:brightness-110 disabled:opacity-70">
            {busy ? t.body.auth.saving : t.body.auth.setupSubmit}
          </button>
          <p className="t-small text-muted">{t.body.auth.setupNote}</p>
        </form>
      </main>
    </div>
  );
}
