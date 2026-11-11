"use client";
/**
 * The status bar (Desktop UI, owner 2026-11-11): one 26 px line at the foot of every app page. Everything on it is read from the API;
 * nothing is assumed. Licence from GET /v1/licence ("Not verified" when the server cannot give one), engine accuracy from the accuracy
 * gates (ADR-063: "Not measured" until G05–G07 pass), the upload tier and its per-video limit, the token balance from GET /v1/wallet,
 * and the interface mode of this browser.
 */
import type { LicenceSnapshot, WalletBalance } from "@otsi-vie/contracts";
import { accuracyMeasured } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fill } from "@/lib/fill";
import { useLocale } from "@/lib/i18n";
import { useInterfaceMode } from "@/lib/interfaceMode";
import { formatGB, useTierLimit } from "@/lib/uploadTier";

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
    <footer data-status-bar className="flex h-[26px] shrink-0 items-center gap-4 border-t border-line bg-p0 px-3 text-[11px] leading-4 text-muted">
      <Item label={d.licence} value={licence} tone={lic === null ? "amber" : undefined} />
      <Item label={d.accuracy} value={measured ? d.accuracyMeasured : d.accuracyNotMeasured} tone={measured ? "ok" : "amber"} />
      {tierName && lim?.maxBytes ? <span>{fill(d.tierLine, { a: tierName, b: formatGB(lim.maxBytes) })}</span> : null}
      <Item label={d.tokens} value={wallet === undefined ? "…" : wallet === null ? "—" : String(wallet.spendable_balance)} />
      <span className="ml-auto">{mode === "advanced" ? d.modeAdvanced : d.modeGuided}</span>
    </footer>
  );
}

function Item({ label, value, tone }: { label: string; value: string; tone?: "amber" | "ok" | undefined }) {
  return (
    <span className="flex items-center gap-1.5">
      <span>{label}</span>
      <span className={tone === "amber" ? "text-amber" : tone === "ok" ? "text-ok" : "text-ink2"}>{value}</span>
    </span>
  );
}
