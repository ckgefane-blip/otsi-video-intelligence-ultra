"use client";
/**
 * The status bar (SOT rebuild 2026-11-13): one 28 px line at the foot of every app page (the SOT's `.statusbar`, min-height 28px).
 * Everything on it is read from the API; nothing is assumed. Licence from GET /v1/licence ("Not verified" when the server cannot give
 * one), engine accuracy from the accuracy gates (ADR-063: "Not measured" until G05–G07 pass), the upload tier and its included
 * allowance ("Free tier · 2 GB included"), the token balance from GET /v1/wallet, and the interface, which the SOT always names
 * "Advanced interface" — there is no live-activity line in the SOT's status bar.
 */
import type { LicenceSnapshot, WalletBalance } from "@otsi-vie/contracts";
import { accuracyMeasured } from "@otsi-vie/contracts";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fill } from "@/lib/fill";
import { useLocale } from "@/lib/i18n";
import { formatGB, useTierLimit } from "@/lib/uploadTier";

export function StatusBar() {
  const { t } = useLocale();
  const d = t.desktop;
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
    <footer data-status-bar className="flex min-h-[28px] shrink-0 items-center gap-4 border-t border-line bg-p0 px-3 text-[11px] leading-4 text-muted">
      <Item label={d.licence} value={licence} tone={lic === null ? "amber" : undefined} dot />
      <Item label={d.accuracy} value={measured ? d.accuracyMeasured : d.accuracyNotMeasured} tone={measured ? "ok" : "amber"} dot />
      {tierName && lim?.maxBytes ? <span>{fill(d.tierLine, { a: tierName, b: formatGB(lim.maxBytes) })}</span> : null}
      <Item label={d.tokens} value={wallet === undefined ? "…" : wallet === null ? "—" : String(wallet.spendable_balance)} />
      <span className="ml-auto">{d.modeAdvanced}</span>
    </footer>
  );
}

function Item({ label, value, tone, dot }: { label: string; value: string; tone?: "amber" | "ok" | undefined; dot?: boolean }) {
  return (
    <span className="flex items-center gap-1.5">
      {dot && <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${tone === "amber" ? "bg-amber" : tone === "ok" ? "bg-ok" : "bg-muted"}`} />}
      <span>{label}</span>
      <span className={tone === "amber" ? "text-amber" : tone === "ok" ? "text-ok" : "text-ink2"}>{value}</span>
    </span>
  );
}
