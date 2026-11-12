"use client";
/**
 * Settings > Security — passkeys (SOT, Security.dc.html): biometric sign-in (ADR-143), one switch, like a bank
 * app. On = sign in with Windows Hello (fingerprint, face or PIN) instead of typing your password. Off = it
 * doesn't. Turning it on enrols a passkey on this device (the browser's create() call); turning it off removes
 * every passkey on this account. The password still works everywhere — a passkey is an extra way in, not a
 * replacement. The state shown is GET /v1/auth/webauthn/credentials. The switch IS the SOT's "Register this
 * device" action: turning it on registers the device.
 */
import type { WebAuthnCredential } from "@otsi-vie/contracts";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ApiProblem, webauthnCredentials, webauthnDeleteCredential, webauthnRegisterOptions, webauthnRegisterVerify } from "@/lib/api";
import { useLocale } from "@/lib/i18n/LocaleProvider";

const msgOf = (x: unknown) => (x instanceof ApiProblem ? x.message : "Could not reach OTSI VIE. Try again.");

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function PasskeySettings() {
  const { t } = useLocale();
  const s = t.body.settings;
  const w = t.webauthn;
  const [list, setList] = useState<WebAuthnCredential[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** null until the browser has been asked: the switch shows only when passkeys work here. */
  const [supported, setSupported] = useState<boolean | null>(null);

  const load = useCallback(() => { void webauthnCredentials().then((r) => setList(r.credentials), (x) => setError(msgOf(x))); }, []);
  useEffect(load, [load]);
  useEffect(() => { setSupported(browserSupportsWebAuthn()); }, []);

  const on = (list?.length ?? 0) > 0;

  async function turnOn() {
    setBusy(true); setError(null); setNotice(null);
    try {
      const options = await webauthnRegisterOptions();
      const attestation = await startRegistration({ optionsJSON: options });
      await webauthnRegisterVerify(attestation);
      setNotice(w.passkeyAdded);
      load();
    } catch (err) {
      // closing the Windows Hello prompt is not an error: nothing to say
      if (err instanceof Error && err.name === "NotAllowedError") return;
      // Show the real reason (e.g. a browser WebAuthn error) instead of only the generic line: the generic
      // line hides whether the browser, Windows Hello or the server refused the registration.
      if (err instanceof ApiProblem) setError(err.message);
      else if (err instanceof Error) setError(`${w.passkeyAddFailed} (${err.name}: ${err.message})`);
      else setError(w.passkeyAddFailed);
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!list?.length) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      for (const c of list) await webauthnDeleteCredential(c.id);
      setNotice(w.passkeyRemoved);
      load();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : w.passkeyRemoveFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel flex flex-col" data-passkey-settings aria-labelledby="pk">
      <div className="ph"><h2 id="pk" className="h3">{s.stSecPasskeys}</h2><span className="mu sm">{s.stSecWindowsHello}</span></div>
      <div className="pb flex flex-1 flex-col gap-4">
        <p className="t-body text-muted">{w.biometricHint}</p>
        {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
        {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}
        {supported === false && <p className="t-body text-muted">{w.passkeyUnavailable}</p>}

        <div className="flex min-h-8 items-center justify-between gap-3 rounded-ctl border border-line bg-raised p-4">
          <span className="flex min-w-0 items-center gap-2 t-body">
            <Fingerprint className="h-5 w-5 shrink-0 text-muted" aria-hidden />
            <span className="min-w-0">
              <span className="block truncate">{w.biometricToggle}</span>
              <span className="block t-small text-muted">{on ? w.biometricOn : w.biometricOff}</span>
            </span>
          </span>
          <button type="button" role="switch" aria-checked={on} aria-label={w.biometricToggle}
            disabled={supported === false || busy || list === null}
            className="vie-sw shrink-0 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void (on ? turnOff() : turnOn())}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          </button>
        </div>

        {list && list.length === 0 && (
          <div className="empty flex-1">
            <span className="ei"><KeyRound className="i" aria-hidden /></span>
            <h3>{s.stSecNoPasskeys}</h3>
            <p>{s.stSecPasskeyHint}</p>
          </div>
        )}

        {list && list.length > 0 && (
          <ul className="divide-y divide-line rounded-ctl border border-line bg-raised px-4">
            {list.map((c) => (
              <li key={c.id} className="flex items-center gap-3 py-3 first:pt-3 last:pb-3">
                <Fingerprint className="h-5 w-5 shrink-0 text-muted" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate t-panel">{c.device_name ?? w.passkeyUnnamed}</p>
                  <p className="text-xs text-muted">
                    {w.passkeyAddedOn.replace("{a}", fmtDate(c.created_at) ?? c.created_at)}
                    {" · "}
                    {c.last_used_at ? w.passkeyLastUsed.replace("{a}", fmtDate(c.last_used_at) ?? c.last_used_at) : w.passkeyNeverUsed}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
