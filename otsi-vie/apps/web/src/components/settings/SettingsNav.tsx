"use client";
/**
 * Settings sub-navigation (Desktop UI Drop 1 re-layout): the five Settings pages are separate routes with no index
 * page, so the strip at the top of each one names where you are and where the others live. Labels are the account
 * menu's own names for these destinations (ProfileChip): "2-step sign-in" is the menu name for the Security page,
 * which also holds passkeys — there is no "Security" key in the dictionary. Admin Console and Billing are
 * Advanced screens (lib/interfaceMode), so in Guided mode they are not offered here, exactly as in the rail.
 */
import Link from "next/link";
import { useInterfaceMode } from "@/lib/interfaceMode";
import { useLocale } from "@/lib/i18n";

export type SettingsNavCurrent = "team" | "security" | "wallet" | "admin" | "billing";

export function SettingsNav({ current }: { current: SettingsNavCurrent }) {
  const { t } = useLocale();
  const { mode } = useInterfaceMode();
  const entries = [
    { id: "team" as const, href: "/settings/team", label: t.body.shell.teamRoles },
    { id: "security" as const, href: "/settings/security", label: t.body.shell.twoStep },
    { id: "wallet" as const, href: "/settings/wallet", label: t.body.shell.tokenWallet },
    ...(mode === "advanced"
      ? [
          { id: "admin" as const, href: "/settings/admin", label: t.body.shell.adminConsole },
          { id: "billing" as const, href: "/settings/admin/billing", label: t.body.wallet.billingTitle },
        ]
      : []),
  ];
  return (
    <nav aria-label={t.desktop.navSettings} data-settings-nav className="flex gap-1 overflow-x-auto border-b border-line">
      {entries.map((e) => (
        <Link key={e.id} href={e.href} aria-current={current === e.id ? "page" : undefined}
          className={`whitespace-nowrap border-b-2 px-3 py-2 font-normal transition-colors ${
            current === e.id ? "border-primary text-primary" : "border-transparent text-muted hover:border-line hover:text-ink"
          }`}>
          {e.label}
        </Link>
      ))}
    </nav>
  );
}
