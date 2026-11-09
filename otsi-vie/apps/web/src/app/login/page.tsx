"use client";
import type { MfaChallenge } from "@otsi-vie/contracts";
import { KeyRound, Loader2, LogIn } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { ApiProblem } from "@/lib/api";
import { safeNext } from "@/lib/safe-next";

function LoginForm() {
  const { status, signIn, signInWithCode } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [code, setCode] = useState("");

  useEffect(() => { if (status === "signed-in") router.replace(next); }, [status, next, router]);

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
      setError(err instanceof ApiProblem ? err.message : "Could not reach OTSI VIE. Check that the server is running.");
      if (err instanceof ApiProblem && err.code === "TWO_STEP_EXPIRED") setChallenge(null);
      if (challenge) setCode(""); else setPassword("");
    } finally {
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <form onSubmit={submit} className="mx-auto mt-16 w-full max-w-sm rounded-card border border-line bg-panel p-6" aria-labelledby="login-title" data-two-step-form>
        <p className="text-[22px] font-extrabold tracking-wide">OTSI <span className="text-primary">VIE</span></p>
        <h1 id="login-title" className="mt-4 text-xl font-bold">Enter your code</h1>
        <p className="mt-2 text-sm text-muted">Open your authenticator app and type the 6-digit code for OTSI VIE. Lost your phone? Type one of your recovery codes.</p>
        <label className="mt-4 block text-sm" htmlFor="code">Code</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={9} value={code}
          onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))}
          className="mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-center font-mono text-lg tracking-[0.3em] outline-none focus:border-primary" />
        {error && <p role="alert" className="mt-3 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy || code.length < 6} className="mt-4 flex w-full items-center justify-center gap-2 rounded-ctl bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-60">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Sign in
        </button>
        <button type="button" onClick={() => { setChallenge(null); setError(null); setPassword(""); }} className="mt-3 w-full text-center text-xs text-muted underline">
          Start again
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={submit} className="mx-auto mt-16 w-full max-w-sm rounded-card border border-line bg-panel p-6" aria-labelledby="login-title">
      <p className="text-[22px] font-extrabold tracking-wide">OTSI <span className="text-primary">VIE</span></p>
      <h1 id="login-title" className="mt-4 text-xl font-bold">Sign in</h1>
      <label className="mt-4 block text-sm" htmlFor="email">Email</label>
      <input id="email" name="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}
        className="mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary" />
      <label className="mt-3 block text-sm" htmlFor="password">Password</label>
      <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}
        className="mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary" />
      {error && <p role="alert" className="mt-3 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
      <button type="submit" disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-ctl bg-primary px-4 py-2.5 font-semibold text-white disabled:opacity-60">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} Sign in
      </button>
      <p className="mt-4 text-xs text-muted">
        Invited by your club? Open the invitation link you were sent to choose your password.
      </p>
    </form>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
