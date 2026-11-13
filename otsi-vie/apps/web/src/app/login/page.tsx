"use client";
/**
 * Sign in (SOT Page 27): the brand panel on the left; on the right the sign-in form, top-aligned, with the
 * "next step" panel for two-step sign-in BELOW the form (the SOT's layout — the card is not beside the form).
 * The panel is the SOT's preview until a challenge arrives: the 6 boxes and Verify are disabled until the
 * password is accepted and two-step asks for a code, then they become the code entry. "Use a recovery code
 * instead" swaps the boxes for one recovery-code field; the code and the recovery code both go through
 * signInWithCode. There is no self-service forgot-password flow (ADR-143): "Forgot password?" says so plainly.
 * The buttons carry no icons (the SOT has none); a spinner shows only while a press is busy.
 */
import type { MfaChallenge } from "@otsi-vie/contracts";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { PitchDiagram } from "@/components/auth/PitchDiagram";
import { ApiProblem } from "@/lib/api";
import { useLocale } from "@/lib/i18n/LocaleProvider";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { safeNext } from "@/lib/safe-next";

const field = "mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 t-body outline-none focus:border-primary";
const alert = "mt-3 rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger";

function Brand() {
  return (
    // the same brand mark the shell rail uses — a real asset, not a drawn wordmark
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/otsi-logo.png" alt="OTSI" className="h-[36px] w-auto" draggable={false} />
  );
}

/** the six one-digit boxes for the two-step code: typing advances, backspace goes back, pasting fills them */
function CodeBoxes({ value, onChange, disabled, autoFocus }: { value: string[]; onChange: (d: string[]) => void; disabled: boolean; autoFocus: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const set = (i: number, ch: string) => {
    const next = [...value];
    next[i] = ch.replace(/\D/g, "").slice(-1);
    onChange(next);
    if (next[i] && i < 5) refs.current[i + 1]?.focus();
  };
  const onKey = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace" && !value[i] && i > 0) { e.preventDefault(); const next = [...value]; next[i - 1] = ""; onChange(next); refs.current[i - 1]?.focus(); }
  };
  const onPaste = (e: React.ClipboardEvent) => {
    const digits = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6).split("");
    if (!digits.length) return;
    e.preventDefault();
    const next = ["", "", "", "", "", ""];
    digits.forEach((d, i) => { next[i] = d; });
    onChange(next);
    refs.current[Math.min(digits.length, 5)]?.focus();
  };
  return (
    <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="6-digit code" onPaste={onPaste}>
      {value.map((d, i) => (
        <input key={i} ref={(el) => { refs.current[i] = el; }} className="in mono h-12 p-0 text-center text-sm font-semibold"
          aria-label={`Digit ${i + 1}`} inputMode="numeric" autoComplete="one-time-code" maxLength={1}
          value={d} disabled={disabled} autoFocus={autoFocus && i === 0}
          onChange={(e) => set(i, e.target.value)} onKeyDown={(e) => onKey(i, e)} />
      ))}
    </div>
  );
}

function LoginForm() {
  const { status, signIn, signInWithCode, signInWithPasskey } = useAuth();
  const { t } = useLocale();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showForgot, setShowForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  /** null until the browser has been asked: the button shows only when passkeys work here. */
  const [passkeySupported, setPasskeySupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<MfaChallenge | null>(null);
  const [digits, setDigits] = useState<string[]>(["", "", "", "", "", ""]);
  const [recovery, setRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  useEffect(() => { if (status === "signed-in") router.replace(next); }, [status, next, router]);
  useEffect(() => { setPasskeySupported(browserSupportsWebAuthn()); }, []);

  const code = recovery ? recoveryCode.replace(/\s/g, "") : digits.join("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (challenge) return;
    setBusy(true);
    setError(null);
    try {
      const c = await signIn(email, password);
      if (c) { setChallenge(c); setDigits(["", "", "", "", "", ""]); setRecovery(false); setRecoveryCode(""); }
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : t.body.auth.unreachable);
      setPassword("");
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!challenge) return;
    setCodeBusy(true);
    setCodeError(null);
    try {
      await signInWithCode(challenge.mfa_token, code);
    } catch (err) {
      setCodeError(err instanceof ApiProblem ? err.message : t.body.auth.unreachable);
      if (err instanceof ApiProblem && err.code === "TWO_STEP_EXPIRED") setChallenge(null);
      setDigits(["", "", "", "", "", ""]); setRecoveryCode("");
    } finally {
      setCodeBusy(false);
    }
  }

  async function passkeySignIn() {
    // the SOT shows the button unconditionally: on a machine where passkeys do not work (Windows Hello
    // unavailable) the button is still there and says so when pressed, instead of hiding
    if (passkeySupported === false) { setError(t.webauthn.passkeyUnavailable); return; }
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

  const startAgain = () => { setChallenge(null); setCodeError(null); setPassword(""); setDigits(["", "", "", "", "", ""]); setRecovery(false); setRecoveryCode(""); };
  const codeReady = recovery ? code.length > 0 : digits.every(Boolean);

  return (
    <div className="flex min-h-screen flex-row flex-wrap" data-stage="sign-in">
      <div className="relative flex min-h-[360px] grow-0 flex-col justify-between gap-10 overflow-hidden border-r border-line bg-p0 px-12 py-10 basis-[520px]">
        <div className="relative flex flex-col gap-10">
          <div className="flex items-center gap-4">
            <Brand />
            <span className="h-[26px] w-px bg-line2" aria-hidden />
            <span className="eb" style={{ letterSpacing: ".18em" }}>Video Intelligence Engine</span>
          </div>
          <div className="flex max-w-[420px] flex-col gap-1.5">
            <h1 className="h1">{t.body.auth.inviteHeroTitle}</h1>
            <p className="sub">{t.body.auth.inviteHeroSub}</p>
          </div>
        </div>
        <PitchDiagram />
        <div className="relative flex flex-wrap gap-[22px] sm mu">
          <span className="inline-flex items-center gap-2"><span className="led ok" aria-hidden />{t.body.auth.inviteVideoLocal}</span>
          <span className="mono">v[—]</span>
        </div>
      </div>

      <main className="flex min-w-0 flex-1 basis-[560px] flex-col items-center justify-start gap-7 px-8 py-10">
        <form onSubmit={submit} className="flex w-full max-w-[380px] flex-col gap-[18px]" aria-labelledby="si">
          <div className="flex flex-col gap-1.5"><span className="eb">{t.body.auth.signInWelcome}</span><h2 id="si" className="h1">{t.body.auth.signIn}</h2></div>
          <div className="field">
            <label className="lab" htmlFor="e">{t.body.auth.email}</label>
            <input id="e" className="in" type="email" autoComplete="email" placeholder="you@club.com" style={{ height: 40 }}
              required value={email} disabled={!!challenge} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <div className="flex justify-between">
              <label className="lab" htmlFor="p">{t.body.auth.password}</label>
              {/* SOT: a link, not a button. There is no self-service reset (ADR-143, user decision pending):
                  the link explains that instead of starting a reset flow. */}
              <a href="#" className="sm text-primary hover:underline" onClick={(e) => { e.preventDefault(); setShowForgot((v) => !v); }}>{t.body.auth.signInForgot}</a>
            </div>
            <div className="relative">
              <input id="p" className="in" type={showPassword ? "text" : "password"} autoComplete="current-password" style={{ height: 40, paddingRight: 64 }}
                required value={password} disabled={!!challenge} onChange={(e) => setPassword(e.target.value)} />
              <button type="button" className="btn sm gh absolute right-1 top-[5px] h-[30px]" aria-label={showPassword ? t.body.auth.hidePassword : t.body.auth.showPassword}
                aria-pressed={showPassword} onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? (t.body.auth.hideShort ?? t.body.auth.hidePassword) : (t.body.auth.showShort ?? t.body.auth.showPassword)}
              </button>
            </div>
            {showForgot && <p className="hint mt-1.5">{t.body.auth.signInForgotNote}</p>}
          </div>
          {error && <p role="alert" className={alert}>{error}</p>}
          <button className="btn pri lg w" type="submit" disabled={busy || !!challenge}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{t.body.auth.signIn}
          </button>
          {/* SOT: the passkey button is always shown. Where passkeys do not work (Windows Hello unavailable)
              the press itself says so (passkeySignIn), instead of the button hiding. */}
          <div className="flex items-center gap-3 sm mu" aria-hidden="true"><span className="div flex-1" />{t.webauthn.passkeyOr}<span className="div flex-1" /></div>
          <button type="button" onClick={passkeySignIn} disabled={busy || passkeyBusy || !!challenge} className="btn lg w">
            {passkeyBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {passkeyBusy ? t.webauthn.passkeyWaiting : t.webauthn.signInWithPasskeyShort}
            <span className="mu sm ml-1">{t.webauthn.windowsHello}</span>
          </button>
          <p className="sm mu text-center">{t.body.auth.signInInvitedBy} <Link href="/invite" className="text-primary hover:underline">{t.body.auth.signInAcceptInvite}</Link></p>
          {challenge && (
            <button type="button" onClick={startAgain} className="t-small w-full text-center underline">{t.body.auth.startAgain}</button>
          )}
        </form>

        {/* the two-step card sits BELOW the form (SOT), as a flat open section, not a boxed panel beside it */}
        <section className="flex min-w-0 w-full max-w-[340px] flex-col gap-4 border-t border-line bg-transparent p-[22px]" aria-labelledby="ts" data-two-step-panel>
          <span className="eb">{t.body.auth.signInNextStep}</span>
          <h2 id="ts" className="h2">{t.body.auth.signInVerifyCode}</h2>
          <p className="sm sub">{t.body.auth.signInCodeDesc}</p>
          <form onSubmit={verify} className="flex flex-col gap-4">
            {recovery ? (
              <div className="field">
                <label className="lab" htmlFor="rc">{t.body.auth.code}</label>
                <input id="rc" className="in mono text-center" inputMode="text" autoComplete="one-time-code" maxLength={9}
                  value={recoveryCode} disabled={!challenge} autoFocus={!!challenge}
                  onChange={(e) => setRecoveryCode(e.target.value.replace(/\s/g, ""))} />
              </div>
            ) : (
              <CodeBoxes value={digits} onChange={setDigits} disabled={!challenge} autoFocus={!!challenge} />
            )}
            {codeError && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{codeError}</p>}
            <button className="btn pri w" type="submit" disabled={!challenge || codeBusy || !codeReady}>
              {codeBusy && <Loader2 className="h-4 w-4 animate-spin" />}{t.body.auth.signInVerify}
            </button>
          </form>
          <button type="button" className="sm text-center text-primary hover:underline"
            onClick={() => { setRecovery((v) => !v); setDigits(["", "", "", "", "", ""]); setRecoveryCode(""); setCodeError(null); }}>
            {recovery ? t.body.auth.signInUseCode : t.body.auth.signInUseRecovery}
          </button>
        </section>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense fallback={null}><LoginForm /></Suspense>;
}
