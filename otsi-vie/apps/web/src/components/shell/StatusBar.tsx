"use client";
/**
 * The status bar (SOT shell, owner 2026-11-12): one 28 px line at the foot of every app page, laid out as the SOT draws it —
 * left: "● Licence: Not verified", "● Engine accuracy: Not measured"; right: "Free tier · 2 GB included", "Tokens 10",
 * "Advanced interface". Everything on it is read from the API; nothing is assumed. Licence from GET /v1/licence ("Not verified"
 * when the server cannot give one), engine accuracy from the accuracy gates (ADR-063: "Not measured" until G05–G07 pass), the
 * upload tier and its limit, the token balance from GET /v1/wallet, and the interface mode of this browser.
 */
import type { LicenceSnapshot, WalletBalance } from "@otsi-vie/contracts";
import { accuracyMeasured } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fill } from "@/lib/fill";
import { useLocale } from "@/lib/i18n";
import { useInterfaceMode } from "@/lib/interfaceMode";
import { formatGB, useTierLimit } from "@/lib/uploadTier";
import { ActivityLine } from "./ActivityLine";

export function StatusBar() {
  const { t } = useLocale();
  const d = t.desktop;
  const { mode } = useInterfaceMode();
  const lim = useTierLimit();
  const [lic, setLic] = useState<LicenceSnapshot | null | undefined>(undefined);
  const [wallet, setWallet] = useState<WalletBalance | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api<LicenceSnapshot>("/v1/licence").then((x) => live && setLic(x), () => live && setLic(null));
    api<WalletBalance>("/v1/wallet").then((x) => live && setWallet(x), () => live && setWallet(null));
    return () => { live = false; };
  }, []);

  const licence = lic === undefined ? "…" : lic === null ? d.licenceNotVerified
    : lic.valid_until ? `${lic.plan} · ${fill(d.licenceValidUntil, { a: lic.valid_until.slice(0, 10) })}` : d.licenceFree;
  const measured = accuracyMeasured();
  const tierName = lim?.tier === "Free" ? d.tierFree : lim?.tier === "Pro" ? d.tierPro : lim?.tier === "Enterprise" ? d.tierEnterprise : lim?.plan ?? null;

  return (
    <footer data-status-bar className="flex min-h-[28px] shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line bg-p0 px-3.5 text-muted">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-[18px] gap-y-1">
        <Item led={lic === null ? "warn" : lic ? "ok" : undefined} label={d.licence} value={licence} />
        <Item led={measured ? "ok" : "warn"} label={d.accuracy} value={measured ? d.accuracyMeasured : d.accuracyNotMeasured} />
        <ActivityLine />
      </div>
      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1">
        {tierName && lim?.maxBytes ? (
          <span>{fill(d.tierLine, { a: tierName, b: "\u0000" }).split("\u0000").flatMap((part, i) => (i === 0 ? [part] : [<b key={i} className="text-ink2">{formatGB(lim.maxBytes!)}</b>, part]))}</span>
        ) : null}
        <span>{d.tokens} <b className="text-ink2">{wallet === undefined ? "…" : wallet === null ? "—" : String(wallet.spendable_balance)}</b></span>
        <span>{mode === "advanced" ? d.modeAdvanced : d.modeGuided}</span>
      </div>
    </footer>
  );
}

function Item({ led, label, value }: { led?: "ok" | "warn" | undefined; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`led${led === "ok" ? " ok" : ""}`} style={led === "warn" ? { background: "rgb(var(--amber))" } : undefined} aria-hidden />
      <span>{label}: <b className="text-ink2">{value}</b></span>
    </span>
  );
}
