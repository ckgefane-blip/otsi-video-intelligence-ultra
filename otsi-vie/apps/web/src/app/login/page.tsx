"use client";
import type { MfaChallenge } from "@otsi-vie/contracts";
import { Eye, EyeOff, Fingerprint, KeyRound, Loader2, LogIn } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { safeNext } from "@/lib/safe-next";

function LoginForm() {
  const { status, signIn, signInWithCode, signInWithPasskey } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  /** null until the browser has been asked: the button shows only when passkeys work here. */
  const [passkeySupported, setPasskeySupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => { if (status === "signed-in") router.replace(next); }, [status, next, router]);
  useEffect(() => { setPasskeySupported(browserSupportsWebAuthn()); }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (challenge) {
        await signInWithCode(challenge.mfa_token, code);
      } else {
        const c = await signIn(email, password);
        if (c) { setChallenge(c); setCode(""); }
      }
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.auth.unreachable);
      if (err instanceof ApiProblem && err.code === "TWO_STEP_EXPIRED") setChallenge(null);
      if (challenge) setCode(""); else setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function passkeySignIn() {
    if (!email.trim()) { setError(t.webauthn.passkeyNeedEmail); return; }
    setPasskeyBusy(true);
    setError(null);
    try {
      await signInWithPasskey(email.trim());
    } catch (err) {
      // closing the Windows Hello prompt is not an error: nothing to say
      if (err instanceof Error && err.name === "NotAllowedError") return;
      setError(err instanceof ApiProblem ? err.message : t.webauthn.passkeyFailed);
    } finally {
      setPasskeyBusy(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={submit} className="mx-auto mt-16 w-full max-w-sm rounded-card border border-line bg-panel p-6" aria-labelledby="login-title" data-two-step-form>
        <p className="text-[22px] font-extrabold tracking-wide">OTSI <span className="text-primary">VIE</span></p>
        <h1 id="login-title" className="mt-4 text-xl font-bold">{t.body.auth.enterCode}</h1>
        <p className="mt-2 text-sm text-muted">{t.body.auth.codeDesc}</p>
        <label className="mt-4 block text-sm" htmlFor="code">{t.body.auth.code}</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={9} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
          className="mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-primary" />
        {error && <p role="alert" className="mt-3 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || code.length < 6} className="mt-4 flex w-full items-center justify-center gap-2 rounded-ctl bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {t.body.auth.signIn}
        </button>
        <button type="button" onClick={() => { setChallenge(null); setError(null); setPassword(""); }} className="mt-3 w-full text-center text-xs text-muted underline">
          {t.body.auth.startAgain}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 w-full max-w-sm rounded-card border border-line bg-panel p-6" aria-labelledby="login-title">
      <p className="text-[22px] font-extrabold tracking-wide">OTSI <span className="text-primary">VIE</span></p>
      <h1 id="login-title" className="mt-4 text-xl font-bold">{t.body.auth.signIn}</h1>
      <label className="mt-4 block text-sm" htmlFor="email">{t.body.auth.email}</label>
      <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary" />
      <label className="mt-3 block text-sm" htmlFor="password">{t.body.auth.password}</label>
      <div className="relative mt-1">
        <input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-ctl border border-line bg-canvas px-3 py-2 pr-10 text-sm outline-none focus:border-primary" />
        <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? t.body.auth.hidePassword : t.body.auth.showPassword} aria-pressed={showPassword}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <p role="alert" className="mt-3 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-ctl bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} {t.body.auth.signIn}
      </button>
      {passkeySupported === true && (
        <>
          <div className="mt-4 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" /><span>{t.webauthn.passkeyOr}</span><span className="h-px flex-1 bg-line" />
          </div>
          <button type="button" onClick={passkeySignIn} disabled={busy || passkeyBusy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-ctl border border-line bg-canvas px-4 py-2.5 font-semibold disabled:opacity-60">
            {passkeyBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
            {passkeyBusy ? t.webauthn.passkeyWaiting : t.webauthn.signInWithPasskey}
          </button>
        </>
      )}
      {passkeySupported === false && (
        <p className="mt-4 text-xs text-muted">{t.webauthn.passkeyUnavailable}</p>
      )}
      <p className="mt-4 text-xs text-muted">
        {t.body.auth.invited}
      </p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
