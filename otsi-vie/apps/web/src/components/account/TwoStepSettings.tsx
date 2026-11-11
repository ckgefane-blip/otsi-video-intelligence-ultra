"use client";
/**
 * 2-step sign-in (account menu): switch on a code from a free authenticator app for the signed-in person's own account, see the ten
 * recovery codes once, or switch it off with the password and a code. The state shown is GET /v1/me/two-step.
 */
import type { RecoveryCodes, TwoStepSetup, TwoStepStatus } from "@otsi-vie/contracts";
import { Check, Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

const ctl = "mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary";
const base = "mt-4 flex items-center justify-center gap-2 rounded-ctl px-4 py-2.5 font-semibold text-white disabled:opacity-60";
const btn = `${base} bg-primary`;
const msgOf = (t: { body: { settings: { unreachable: string } } }, x: unknown) => (x instanceof ApiProblem ? x.message : t.body.settings.unreachable);
const acct = { organization: false } as const;

export function TwoStepSettings() {
  const { t } = useLocale();
  const { me } = useAuth();
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => { void api<TwoStepStatus>("/v1/me/two-step", acct).then(setStatus, (x) => setError(msgOf(t, x))); }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (x) { setError(msgOf(t, x)); setCode(""); } finally { setBusy(false); }
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

  const codesText = codes ? t.body.settings.twoStepCodesFile.replace("{a}", me?.user.email ?? t.body.settings.twoStepYourAccount).replace("{b}", codes.join("\n")) : "";
  const panel = "rounded-card border border-line bg-panel p-5";

  return (
    <div className="mx-auto max-w-2xl space-y-5" data-two-step-settings>
      <header>
        <h1 className="text-2xl font-bold">{t.body.settings.twoStepTitle}</h1>
        <p className="mt-1 text-sm text-muted">{t.body.settings.twoStepSubtitle}</p>
      </header>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {codes && (
        <section className={`${panel} border-primary/60`} data-recovery-codes>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-ok" /> {t.body.settings.twoStepOnTitle}</h2>
          <p className="mt-1 text-sm">{t.body.settings.twoStepCodesKeep}</p>
          <ol className="mt-3 grid grid-cols-2 gap-2 font-mono text-sm">{codes.map((c) => <li key={c} className="rounded-ctl border border-line bg-canvas px-3 py-1.5">{c}</li>)}</ol>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => void navigator.clipboard.writeText(codesText).then(() => setCopied(true))} className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60">
              {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? t.body.settings.twoStepCopied : t.body.settings.twoStepCopy}</button>
            <a download="otsi-vie-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(codesText)}`}
              className="flex items-center gap-2 rounded-ctl border border-line px-3 py-2 text-sm hover:border-primary/60"><Download className="h-4 w-4" /> {t.body.settings.twoStepSaveFile}</a>
            <button type="button" onClick={() => setCodes(null)} className="rounded-ctl bg-primary px-3 py-2 text-sm font-semibold text-white">{t.body.settings.twoStepSaved}</button>
          </div>
        </section>
      )}

      {!status ? <p className="text-sm text-muted" role="status">{t.body.settings.loading}</p> : !codes && (status.enabled ? (
        <section className={panel} data-two-step-on>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck className="h-5 w-5 text-ok" /> {t.body.settings.twoStepOnState}</h2>
          <p className="mt-1 text-sm text-muted">{t.body.settings.twoStepCodesLeft.replace("{a}", String(status.recovery_codes_left))}{status.recovery_codes_left <= 3 && " " + t.body.settings.twoStepCodesLow}</p>
          <form onSubmit={disable} className="mt-4 border-t border-line pt-4">
            <h3 className="font-semibold">{t.body.settings.twoStepSwitchOff}</h3>
            <label className="mt-2 block text-sm" htmlFor="pw-off">{t.body.settings.twoStepYourPassword}</label>
            <input id="pw-off" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ctl} />
            <label className="mt-3 block text-sm" htmlFor="code-off">{t.body.settings.twoStepCodeOrRecovery}</label>
            <input id="code-off" required inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))} className={`${ctl} font-mono`} />
            <button type="submit" disabled={busy} className={`${base} bg-danger`}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />} {t.body.settings.twoStepSwitchOff}</button>
          </form>
        </section>
      ) : setup ? (
        <form onSubmit={confirm} className={panel} data-two-step-scan>
          <h2 className="text-lg font-semibold">{t.body.settings.twoStepScan}</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
            <li>{t.body.settings.twoStepStep1}</li>
            <li>{t.body.settings.twoStepStep2}</li>
            <li>{t.body.settings.twoStepStep3}</li>
          </ol>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={setup.qr_data_url} alt={t.body.settings.twoStepQrAlt} width={240} height={240} className="mx-auto mt-4 rounded-ctl bg-white p-2" />
          <p className="mt-2 text-center text-xs text-muted">{t.body.settings.twoStepKeyLabel} <span className="select-all font-mono text-ink" data-two-step-key>{setup.secret}</span></p>
          <label className="mt-4 block text-sm" htmlFor="code-on">{t.body.settings.twoStepCodeFromApp}</label>
          <input id="code-on" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className={`${ctl} text-center font-mono text-lg tracking-[0.3em]`} />
          <div className="flex gap-3">
            <button type="submit" disabled={busy || code.length !== 6} className={btn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {t.body.settings.twoStepSwitchOn}</button>
            <button type="button" onClick={() => { setSetup(null); setCode(""); }} className="mt-4 text-sm text-muted underline">{t.body.settings.twoStepCancel}</button>
          </div>
        </form>
      ) : (
        <form onSubmit={start} className={panel} data-two-step-off>
          <h2 className="text-lg font-semibold">{t.body.settings.twoStepOffTitle}</h2>
          <p className="mt-1 text-sm text-muted">{t.body.settings.twoStepOffDesc}</p>
          <label className="mt-3 block text-sm" htmlFor="pw-on">{t.body.settings.twoStepYourPassword}</label>
          <input id="pw-on" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ctl} />
          <button type="submit" disabled={busy} className={btn}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {t.body.settings.twoStepSetup}</button>
        </form>
      ))}
    </div>
  );
}
