"use client";
/**
 * 2-step sign-in (account menu): switch on a code from a free authenticator app for the signed-in person's own account, see the ten
 * recovery codes once, or switch it off with the password and a code. The state shown is GET /v1/me/two-step.
 */
import type { RecoveryCodes, TwoStepSetup, TwoStepStatus } from "@otsi-vie/contracts";
import { Check, Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { api, ApiProblem } from "@/lib/api";

const ctl = "mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary";
const base = "mt-4 flex items-center justify-center gap-2 rounded-ctl px-4 py-2.5 font-semibold text-white disabled:opacity-60";
const btn = `${base} bg-primary`;
const msgOf = (x: unknown) => (x instanceof ApiProblem ? x.message : "Could not reach OTSI VIE. Try again.");
const acct = { organization: false } as const;

export function TwoStepSettings() {
  const { me } = useAuth();
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => { void api<TwoStepStatus>("/v1/me/two-step", acct).then(setStatus, (x) => setError(msgOf(x))); }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (x) { setError(msgOf(x)); setCode(""); } finally { setBusy(false); }
  }

  const start = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    setSetup(await api<TwoStepSetup>("/v1/me/two-step/setup", { ...acct, method: "POST", json: { password } }));
    setPassword(""); setCode("");
  }); };
  const confirm = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await api<RecoveryCodes>("/v1/me/two-step/confirm", { ...acct, method: "POST", json: { code } });
    setCodes(r.recovery_codes); setSetup(null); setCode(""); load();
  }); };
  const disable = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    setStatus(await api<TwoStepStatus>("/v1/me/two-step/disable", { ...acct, method: "POST", json: { password, code } }));
    setPassword(""); setCode("");
  }); };

  const codesText = codes ? `OTSI VIE recovery codes for ${me?.user.email ?? "your account"}\nEach works once if you lose your phone.\n\n${codes.join("\n")}\n` : "";
  const panel = "rounded-card border border-line bg-panel p-5";

  return (
    <div className="mx-auto max-w-2xl space-y-5" data-two-step-settings>
      <header>
        <h1 className="text-2xl font-bold">2-step sign-in</h1>
        <p className="mt-1 text-sm text-muted">After your password, OTSI VIE also asks for a 6-digit code from an app on your phone. Someone who learns your password still cannot sign in.
          Use any free authenticator app: Google Authenticator, Microsoft Authenticator, Aegis or 2FAS.</p>
      </header>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {codes && (
        <section className={`${panel} border-primary/60`} data-recovery-codes>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-ok" /> 2-step sign-in is on</h2>
          <p className="mt-1 text-sm">Keep these recovery codes somewhere safe (print them or save the file). If you lose your phone, each code lets you sign in once. They are shown only now.</p>
          <ol className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">{codes.map((c) => <li key={c} className="rounded-ctl border border-line bg-canvas px-3 py-1.5">{c}</li>)}</ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void navigator.clipboard.writeText(codesText).then(() => setCopied(true))} className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
              {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? "Copied" : "Copy"}</button>
            <a download="otsi-vie-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(codesText)}`}
              className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60"><Download className="h-4 w-4" /> Save as a file</a>
            <button type="button" onClick={() => setCodes(null)} className="rounded-ctl bg-primary px-3 py-2 text-sm font-semibold text-white">I have saved them</button>
          </div>
        </section>
      )}

      {!status ? <p className="text-sm text-muted" role="status">Loading...</p> : !codes && (status.enabled ? (
        <section className={panel} data-two-step-on>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-ok" /> On</h2>
          <p className="mt-1 text-sm text-muted">{status.recovery_codes_left} of 10 recovery codes left.{status.recovery_codes_left <= 3 && " Switch off and on again to get new ones."}</p>
          <form onSubmit={disable} className="mt-4 border-t border-line pt-4">
            <h3 className="font-semibold">Switch off</h3>
            <label className="mt-2 block text-sm" htmlFor="pw-off">Your password</label>
            <input id="pw-off" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ctl} />
            <label className="mt-3 block text-sm" htmlFor="code-off">Code from the app (or a recovery code)</label>
            <input id="code-off" required inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))} className={`${ctl} font-mono`} />
            <button type="submit" disabled={busy} className={`${base} bg-danger`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />} Switch off</button>
          </form>
        </section>
      ) : setup ? (
        <form onSubmit={confirm} className={panel} data-two-step-scan>
          <h2 className="text-lg font-semibold">Scan with your authenticator app</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>Open the app and add an account (often a + button).</li>
            <li>Scan this picture. Or choose to enter a key and type the key below it.</li>
            <li>Type the 6-digit code the app now shows for OTSI VIE.</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr_data_url} alt="QR code for your authenticator app" width={240} height={240} className="mx-auto mt-4 rounded-ctl bg-white p-2" />
          <p className="mt-2 text-center text-xs text-muted">Key: <span className="select-all font-mono text-ink" data-two-step-key>{setup.secret}</span></p>
          <label className="mt-4 block text-sm" htmlFor="code-on">Code from the app</label>
          <input id="code-on" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${ctl} text-center font-mono text-lg tracking-[0.3em]`} />
          <div className="flex gap-3">
            <button type="submit" disabled={busy || code.length !== 6} className={btn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Switch on</button>
            <button type="button" onClick={() => { setSetup(null); setCode(""); }} className="mt-4 text-sm text-muted underline">Cancel</button>
          </div>
        </form>
      ) : (
        <form onSubmit={start} className={panel} data-two-step-off>
          <h2 className="text-lg font-semibold">Off</h2>
          <p className="mt-1 text-sm text-muted">Enter your password to start. Have your phone with the authenticator app ready.</p>
          <label className="mt-3 block text-sm" htmlFor="pw-on">Your password</label>
          <input id="pw-on" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ctl} />
          <button type="submit" disabled={busy} className={btn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Set up 2-step sign-in</button>
        </form>
      ))}
    </div>
  );
}
