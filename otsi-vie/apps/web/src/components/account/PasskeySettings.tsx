"use client";
/**
 * Passkeys (ADR-143): sign in with Windows Hello (fingerprint, face or PIN) instead of typing email + password.
 * The person adds a passkey here (the browser's create() call), sees their passkeys, and removes one. The password
 * still works everywhere — a passkey is an extra way in, not a replacement. The state shown is
 * GET /v1/auth/webauthn/credentials.
 */
import type { WebAuthnCredential } from "@otsi-vie/contracts";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Fingerprint, Loader2, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiProblem, webauthnCredentials, webauthnDeleteCredential, webauthnRegisterOptions, webauthnRegisterVerify } from "@/lib/api";
import { useLocale } from "@/lib/i18n/LocaleProvider";

const ctl = "mt-1 w-full rounded-ctl border border-line bg-canvas px-3 py-2 outline-none focus:border-primary";
const msgOf = (x: unknown) => (x instanceof ApiProblem ? x.message : "Could not reach OTSI VIE. Try again.");

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function PasskeySettings() {
  const { t } = useLocale();
  const w = t.webauthn;
  const [list, setList] = useState<WebAuthnCredential[] | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** null until the browser has been asked: the add form shows only when passkeys work here. */
  const [supported, setSupported] = useState<boolean | null>(null);

  const load = useCallback(() => { void webauthnCredentials().then((r) => setList(r.credentials), (x) => setError(msgOf(x))); }, []);
  useEffect(load, [load]);
  useEffect(() => { setSupported(browserSupportsWebAuthn()); }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setNotice(null);
    try {
      const options = await webauthnRegisterOptions();
      const attestation = await startRegistration({ optionsJSON: options });
      await webauthnRegisterVerify(attestation, deviceName.trim() || undefined);
      setDeviceName("");
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

  async function remove(id: string) {
    setRemoving(id); setError(null); setNotice(null);
    try {
      await webauthnDeleteCredential(id);
      setNotice(w.passkeyRemoved);
      load();
    } catch (err) {
      setError(err instanceof ApiProblem ? err.message : w.passkeyRemoveFailed);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="vie-panel min-w-0" data-passkey-settings>
      <div className="vie-ph"><h1 className="t-section">{w.passkeysTitle}</h1></div>
      <div className="space-y-4 p-4">
      <p className="t-body text-muted">{w.passkeysIntro}</p>
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}
      {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}
      {supported === false && <p className="t-body text-muted">{w.passkeyUnavailable}</p>}

      {!list ? <p className="t-body text-muted" role="status">Loading...</p> : (
        <section className="rounded-ctl border border-line bg-raised p-4">
          {list.length === 0 ? (
            <p className="t-body text-muted">{w.passkeyNone}</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Fingerprint className="h-5 w-5 shrink-0 text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate t-panel">{c.device_name ?? w.passkeyUnnamed}</p>
                    <p className="text-xs text-muted">
                      {w.passkeyAddedOn.replace("{a}", fmtDate(c.created_at) ?? c.created_at)}
                      {" · "}
                      {c.last_used_at ? w.passkeyLastUsed.replace("{a}", fmtDate(c.last_used_at) ?? c.last_used_at) : w.passkeyNeverUsed}
                    </p>
                  </div>
                  <button type="button" onClick={() => void remove(c.id)} disabled={removing === c.id}
                    className="vie-btn vie-btn-sm shrink-0 hover:border-danger/60">
                    {removing === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} {w.passkeyRemove}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {supported !== false && (
        <form onSubmit={add} className="rounded-ctl border border-line bg-raised p-4">
          <h2 className="t-section">{w.addPasskey}</h2>
          <label className="mt-3 block t-label" htmlFor="passkey-name">{w.deviceName}</label>
          <input id="passkey-name" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} maxLength={80}
            placeholder={w.deviceNamePlaceholder} className={ctl} />
          <button type="submit" disabled={busy} className="mt-4 vie-btn vie-btn-pri">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} {busy ? w.passkeyWaiting : w.addPasskey}
          </button>
        </form>
      )}
      </div>
    </section>
  );
}
