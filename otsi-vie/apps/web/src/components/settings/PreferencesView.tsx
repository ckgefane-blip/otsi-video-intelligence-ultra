"use client";
/**
 * Settings > Preferences (SOT, Preferences.dc.html): appearance & language, notifications, licence & updates,
 * and storage on this computer. The language, interface scale and interface mode all work here (language is the
 * app-wide locale, scale zooms the whole shell, mode hides the advanced screens in Guided); the notification
 * switches are stored in this browser and the bell filters by them; the licence is read live from
 * GET /v1/licence and "Check for updates" refreshes it (POST /v1/licence/refresh). The library and cache
 * folders are on this computer: the server reports them from GET /v1/settings/storage (StorageFolders:
 * library_folder / cache_folder, either null when not configured — the page says so rather than showing a path
 * that is not real). The storage endpoint is READ-ONLY by design (the API's settings.ts: changing a folder is
 * a launcher/desktop concern, not an API write), so Change… is enabled when a path is present and says plainly
 * that the folder is set by the launcher; there is no save to wire until a write path exists. Clear cache
 * clears the browser's own cache storage for this app. Language stays the SOT's <select> (Preferences.dc.html
 * line 79) — the "6 buttons" note in the brief does not match the SOT file; see the rebuild report.
 */
import type { LicenceRefreshResponse, LicenceSnapshot, StorageFolders } from "@otsi-vie/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, ApiProblem } from "@/lib/api";
import { LOCALE_NAMES, SUPPORTED_LOCALES, useLocale, type Locale } from "@/lib/i18n";
import { useInterfaceMode } from "@/lib/interfaceMode";
import { INTERFACE_SCALES, useInterfaceScale } from "@/lib/interfaceScale";
import { useNotificationPrefs, type NotificationPrefs } from "@/lib/notificationPrefs";

const graceDays = (lic: LicenceSnapshot | null): string | null => {
  if (!lic?.valid_until || !lic?.grace_until) return null;
  const d = Math.round((new Date(lic.grace_until).getTime() - new Date(lic.valid_until).getTime()) / 86_400_000);
  return Number.isFinite(d) && d > 0 ? String(d) : null;
};

/** GET /v1/settings/storage: the storage folders on this computer (StorageFolders from the contracts) */
export function PreferencesView() {
  const { t, locale, setLocale } = useLocale();
  const router = useRouter();
  const s = t.body.settings;
  const { mode, setMode } = useInterfaceMode();
  const { scale, setScale } = useInterfaceScale();
  const { prefs, setPref } = useNotificationPrefs();
  const [lic, setLic] = useState<LicenceSnapshot | null | undefined>(undefined);
  const [paths, setPaths] = useState<StorageFolders | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadLicence = useCallback(() => {
    void api<LicenceSnapshot>("/v1/licence").then(setLic, () => setLic(null));
  }, []);
  useEffect(loadLicence, [loadLicence]);
  const loadPaths = useCallback(() => {
    void api<StorageFolders>("/v1/settings/storage").then(setPaths, () => setPaths(null));
  }, []);
  useEffect(loadPaths, [loadPaths]);

  /** Change… has no API write behind it (the storage endpoint is read-only): say where the folder is set */
  function changeLibraryPath() {
    setError(null);
    setNotice(s.stPrefFolderLauncher);
  }

  async function checkUpdates() {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api<LicenceRefreshResponse>("/v1/licence/refresh", { method: "POST" });
      loadLicence();
      setNotice(s.stPrefLicenceRefreshed);
    } catch (x) {
      setError(x instanceof ApiProblem ? x.message : s.unreachable);
    } finally { setBusy(false); }
  }

  async function clearCache() {
    setBusy(true); setError(null); setNotice(null);
    try {
      if ("caches" in window) {
        for (const name of await window.caches.keys()) await window.caches.delete(name);
      }
      setNotice(s.stPrefCacheCleared);
    } catch {
      setError(s.unreachable);
    } finally { setBusy(false); }
  }

  const verified = lic !== null && lic !== undefined;
  const grace = graceDays(lic ?? null);
  const licenceLine = !verified
    ? t.desktop.licenceNotVerified
    : lic.valid_until
      ? `${lic.plan} · ${t.desktop.licenceValidUntil.replace("{a}", lic.valid_until.slice(0, 10))}`
      : t.desktop.licenceFree;
  const rows: { key: keyof NotificationPrefs; title: string; desc: string }[] = [
    { key: "jobs", title: s.stPrefNotifJobs, desc: s.stPrefNotifJobsDesc },
    { key: "review", title: s.stPrefNotifReview, desc: s.stPrefNotifReviewDesc },
    { key: "comment", title: s.stPrefNotifComment, desc: s.stPrefNotifCommentDesc },
    { key: "wallet", title: s.stPrefNotifWallet, desc: s.stPrefNotifWalletDesc },
    { key: "team", title: s.stPrefNotifTeam, desc: s.stPrefNotifTeamDesc },
  ];

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-7 py-[18px]" data-page="settings-preferences">
      <div className="flex flex-col gap-1.5"><span className="eb">{t.desktop.navSettings}</span><h1 className="h1">{t.body.admin.navPreferences}</h1></div>
      {notice && <p role="status" className="rounded-ctl border border-ok/50 bg-ok/10 px-3 py-2 t-body text-ok">{notice}</p>}
      {error && <p role="alert" className="rounded-ctl border border-danger/50 bg-danger/10 px-3 py-2 t-body text-danger">{error}</p>}

      <div className="grid items-start gap-4 [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]">
        <section className="flex min-w-0 flex-col border-t border-line bg-transparent" aria-labelledby="ap">
          <div className="ph"><h2 id="ap" className="h3">{s.stPrefAppearance}</h2></div>
          <div className="pb flex flex-col gap-4">
            <div className="field">
              <label className="lab" htmlFor="pref-lang">{t.common.language}</label>
              <select id="pref-lang" className="in" value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {SUPPORTED_LOCALES.map((l) => <option key={l} value={l}>{LOCALE_NAMES[l]}</option>)}
              </select>
              <span className="hint">{s.stPrefNamesNotTranslated}</span>
            </div>
            <div className="field">
              <span className="lab" id="pref-scale">{s.stPrefScale}</span>
              <div className="seg f" role="group" aria-labelledby="pref-scale">
                {INTERFACE_SCALES.map((v) => (
                  <button key={v} type="button" className={scale === v ? "on" : ""} aria-pressed={scale === v} onClick={() => setScale(v)}>{v}%</button>
                ))}
              </div>
            </div>
            <div className="field">
              <span className="lab" id="pref-mode">{s.stPrefMode}</span>
              <div className="grid grid-cols-2 gap-2" role="group" aria-labelledby="pref-mode">
                <button className={`radio ${mode === "guided" ? "on" : ""}`} type="button" aria-pressed={mode === "guided"} onClick={() => setMode("guided")}>
                  <span className="o" /><span><span className="block font-semibold">{t.desktop.modeGuidedShort}</span><span className="mu sm block">{s.stPrefGuidedDesc}</span></span>
                </button>
                <button className={`radio ${mode === "advanced" ? "on" : ""}`} type="button" aria-pressed={mode === "advanced"} onClick={() => setMode("advanced")}>
                  <span className="o" /><span><span className="block font-semibold">{t.desktop.modeAdvancedShort}</span><span className="mu sm block">{s.stPrefAdvancedDesc}</span></span>
                </button>
              </div>
              <span className="hint">{t.body.admin.navBothFree}</span>
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col border-t border-line bg-transparent" aria-labelledby="nt">
          <div className="ph"><h2 id="nt" className="h3">{s.stPrefNotifications}</h2><span className="mu sm">{s.stPrefInAppBell}</span></div>
          <ul>
            {rows.map((r) => (
              <li key={r.key} className="lr" style={{ minHeight: 52 }}>
                <span style={{ flex: 1 }}><span className="block font-medium">{r.title}</span><span className="mu sm">{r.desc}</span></span>
                <button className="sw" type="button" role="switch" aria-checked={prefs[r.key]} aria-label={r.title}
                  onClick={() => setPref(r.key, !prefs[r.key])} />
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid flex-1 gap-4 [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]">
        <section className="flex min-w-0 flex-col border-t border-line bg-transparent" aria-labelledby="lc">
          <div className="ph"><h2 id="lc" className="h3">{s.stPrefLicence}</h2>
            <span className="t-small text-muted">• {licenceLine}</span>
          </div>
          <div className="pb flex flex-1 flex-col gap-3.5">
            <dl className="kv">
              <dt>{s.stPrefLicenceStatus}</dt><dd>{licenceLine}</dd>
              <dt>{s.stPrefLicenceIssuedBy}</dt><dd>{s.stPrefLicenceIssuer}</dd>
              <dt>{s.stPrefLicenceChecked}</dt><dd>{s.stPrefLicenceCheckedWhen}</dd>
              <dt>{s.stPrefLicenceGrace}</dt><dd>{grace ? s.stPrefLicenceGraceDays.replace("{a}", grace) : s.stPrefLicenceGraceDays.replace("{a}", "[n]")}</dd>
              <dt>{s.stPrefLicenceVersion}</dt><dd className="mono">v[—]</dd>
            </dl>
            <p className="hint">{s.stPrefLicenceOffline}</p>
            <div className="mt-auto flex gap-2">
              <button className="btn sm" type="button" disabled={busy} onClick={() => void checkUpdates()}>{s.stPrefCheckUpdates}</button>
              <button className="btn sm gh" type="button" onClick={() => router.push("/settings/admin/release")}>{s.stPrefReleaseNotes}</button>
            </div>
          </div>
        </section>

        <section className="flex min-w-0 flex-col border-t border-line bg-transparent" aria-labelledby="st">
          <div className="ph"><h2 id="st" className="h3">{s.stPrefStorage}</h2></div>
          <div className="pb flex flex-1 flex-col gap-3.5">
            <div className="field">
              <label className="lab" htmlFor="pref-lib">{s.stPrefLibraryFolder}</label>
              <div className="flex gap-2">
                <input id="pref-lib" className="in mono" style={{ fontSize: 12 }} value={paths?.library_folder ?? "—"} readOnly />
                <button className="btn" type="button" disabled={!paths?.library_folder || busy} title={s.stPrefChangeFolderTitle}
                  onClick={changeLibraryPath}>{s.stPrefChange}</button>
              </div>
            </div>
            <div className="field">
              <label className="lab" htmlFor="pref-cache">{s.stPrefCacheFolder}</label>
              <div className="flex gap-2">
                <input id="pref-cache" className="in mono" style={{ fontSize: 12 }} value={paths?.cache_folder ?? "—"} readOnly />
                <button className="btn" type="button" disabled={busy} onClick={() => void clearCache()}>{s.stPrefClearCache}</button>
              </div>
            </div>
            <p className="hint mt-auto">{s.stPrefStorageHint}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
