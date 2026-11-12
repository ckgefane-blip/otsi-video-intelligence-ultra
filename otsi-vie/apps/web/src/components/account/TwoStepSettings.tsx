"use client";
/**
 * Settings > Security — two-step authentication (SOT, Security.dc.html): switch on a code from a free
 * authenticator app for the signed-in person's own account, see the ten recovery codes once, or switch it off
 * with the password and a code. The state shown is GET /v1/me/two-step. The recovery codes box shows
 * placeholders until the codes are generated; once shown, Copy and Download work on the real codes.
 */
import type { RecoveryCodes, TwoStepSetup, TwoStepStatus } from "@otsi-vie/contracts";
import { Check, Copy, Download, Loader2, ShieldCheck, ShieldOff } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useLocale } from "@/lib/i18n";
import { api, ApiProblem } from "@/lib/api";

const ctl = "in mt-1 w-full";
const msgOf = (t: { body: { settings: { unreachable: string } } }, x: unknown) => (x instanceof ApiProblem ? x.message : t.body.settings.unreachable);
const acct = { organization: false } as const;

export function TwoStepSettings() {
  const { t } = useLocale();
  const s = t.body.settings;
  const { me } = useAuth();
  const [status, setStatus] = useState<TwoStepStatus | null>(null);
  const [setup, setSetup] = useState<TwoStepSetup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [starting, setStarting] = useState(false);

  const load = useCallback(() => { void api<TwoStepStatus>("/v1/me/two-step", acct).then(setStatus, (x) => setError(msgOf(t, x))); }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null);
    try { await fn(); } catch (x) { setError(msgOf(t, x)); setCode(""); } finally { setBusy(false); }
  }

  const start = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    setSetup(await api<TwoStepSetup>("/v1/me/two-step/setup", { ...acct, method: "POST", json: { password } }));
    setPassword(""); setCode(""); setStarting(false);
  }); };
  const confirm = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    const r = await api<RecoveryCodes>("/v1/me/two-step/confirm", { ...acct, method: "POST", json: { code } });
    setCodes(r.recovery_codes); setSetup(null); setCode(""); load();
  }); };
  const disable = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    setStatus(await api<TwoStepStatus>("/v1/me/two-step/disable", { ...acct, method: "POST", json: { password, code } }));
    setPassword(""); setCode("");
  }); };

  const codesText = codes ? s.twoStepCodesFile.replace("{a}", me?.user.email ?? s.twoStepYourAccount).replace("{b}", codes.join("\n")) : "";
  const enabled = status?.enabled === true;

  return (
    <section className="panel flex flex-col" data-two-step-settings aria-labelledby="tf">
      <div className="ph"><h2 id="tf" className="h3">{s.stSecTwoStep}</h2><span className="chip">{enabled ? s.twoStepOnState : s.twoStepOff}</span></div>
      <div className="pb flex flex-1 flex-col gap-3.5">
        <p className="sm mu">{s.stSecTwoStepDesc}</p>
        {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}

        {codes && (
          <section className="rounded-ctl border border-primary/60 bg-primary/10 p-4" data-recovery-codes>
            <h3 className="flex items-center gap-2 t-section"><ShieldCheck className="h-5 w-5 text-ok" /> {s.twoStepOnTitle}</h3>
            <p className="mt-1 t-body">{s.twoStepCodesKeep}</p>
            <ol className="mt-3 grid grid-cols-2 gap-2 t-tc">{codes.map((c) => <li key={c} className="rounded-ctl border border-line bg-canvas px-3 py-1.5">{c}</li>)}</ol>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={() => void navigator.clipboard.writeText(codesText).then(() => setCopied(true))} className="btn sm">
                {copied ? <Check className="h-4 w-4 text-ok" /> : <Copy className="h-4 w-4" />} {copied ? s.twoStepCopied : s.twoStepCopy}</button>
              <a download="otsi-vie-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(codesText)}`}
                className="btn sm"><Download className="h-4 w-4" /> {s.twoStepSaveFile}</a>
              <button type="button" onClick={() => setCodes(null)} className="btn sm pri">{s.twoStepSaved}</button>
            </div>
          </section>
        )}

        {!status ? <p className="t-body text-muted" role="status">{s.loading}</p> : !codes && (enabled ? (
          <section data-two-step-on>
            <p className="t-small">{s.twoStepCodesLeft.replace("{a}", String(status.recovery_codes_left))}{status.recovery_codes_left <= 3 && " " + s.twoStepCodesLow}</p>
            <form onSubmit={disable} className="mt-4 border-t border-line pt-4">
              <h3 className="t-panel">{s.twoStepSwitchOff}</h3>
              <label className="mt-2 block t-label" htmlFor="pw-off">{s.twoStepYourPassword}</label>
              <input id="pw-off" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ctl} />
              <label className="mt-3 block t-label" htmlFor="code-off">{s.twoStepCodeOrRecovery}</label>
              <input id="code-off" required inputMode="numeric" autoComplete="one-time-code" maxLength={9} value={code} onChange={(e) => setCode(e.target.value.replace(/\s/g, ""))} className={`${ctl} font-mono`} />
              <button type="submit" disabled={busy} className="mt-4 t-button flex w-full items-center justify-center gap-2 rounded-ctl bg-danger px-4 py-2.5 text-white disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff className="h-4 w-4" />} {s.twoStepSwitchOff}</button>
            </form>
          </section>
        ) : setup ? (
          <form onSubmit={confirm} data-two-step-scan>
            <h3 className="t-section">{s.twoStepScan}</h3>
            <ol className="mt-2 list-decimal space-y-1 pl-5 t-body">
              <li>{s.twoStepStep1}</li>
              <li>{s.twoStepStep2}</li>
              <li>{s.twoStepStep3}</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr_data_url} alt={s.twoStepQrAlt} width={240} height={240} className="mx-auto mt-4 rounded-ctl bg-white p-2" />
            <p className="mt-2 text-center text-xs text-muted">{s.twoStepKeyLabel} <span className="select-all font-mono text-ink" data-two-step-key>{setup.secret}</span></p>
            <label className="mt-4 block t-label" htmlFor="code-on">{s.twoStepCodeFromApp}</label>
            <input id="code-on" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${ctl} text-center t-tc tracking-[0.3em]`} />
            <div className="flex gap-3">
              <button type="submit" disabled={busy || code.length !== 6} className="btn pri mt-4 w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {s.twoStepSwitchOn}</button>
              <button type="button" onClick={() => { setSetup(null); setCode(""); }} className="mt-4 t-small underline">{s.twoStepCancel}</button>
            </div>
          </form>
        ) : (
          <>
            <ol className="flex flex-col gap-3">
              {[s.stSecStep1, s.stSecStep2, s.stSecStep3].map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mono xs grid h-[22px] w-[22px] flex-none place-items-center rounded-full border border-line2">{i + 1}</span>
                  <span className="sm">{step}</span>
                </li>
              ))}
            </ol>
            {starting ? (
              <form onSubmit={start} data-two-step-off>
                <label className="mt-3 block t-label" htmlFor="pw-on">{s.twoStepYourPassword}</label>
                <input id="pw-on" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className={ctl} />
                <div className="flex gap-3">
                  <button type="submit" disabled={busy} className="btn pri mt-4 w-full">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {s.twoStepSetup}</button>
                  <button type="button" onClick={() => { setStarting(false); setPassword(""); }} className="mt-4 t-small underline">{s.twoStepCancel}</button>
                </div>
              </form>
            ) : (
              <button className="btn pri self-start" type="button" onClick={() => setStarting(true)}>{s.stSecEnable}</button>
            )}
          </>
        ))}

        <div className="mt-auto flex flex-col gap-2.5 rounded-lg border border-dashed border-line2 p-3.5">
          <div className="flex items-center justify-between"><span className="eb">{s.stSecRecovery}</span><span className="mu sm">{s.stSecRecoveryOnce}</span></div>
          {codes ? (
            <div className="mono sm mu grid grid-cols-2 gap-1.5">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          ) : (
            <div className="mono sm mu grid grid-cols-2 gap-1.5"><span>•••• ••••</span><span>•••• ••••</span><span>•••• ••••</span><span>•••• ••••</span></div>
          )}
          <div className="flex gap-2">
            <button className="btn sm" type="button" disabled={!codes}
              onClick={() => codes && void navigator.clipboard.writeText(codesText).then(() => setCopied(true))}>{s.twoStepCopy}</button>
            <a download="otsi-vie-recovery-codes.txt" href={codes ? `data:text/plain;charset=utf-8,${encodeURIComponent(codesText)}` : undefined}
              className={`btn sm ${codes ? "" : "pointer-events-none opacity-45"}`} aria-disabled={!codes}>{s.stSecDownload}</a>
          </div>
        </div>
      </div>
    </section>
  );
}
