"use client";
/**
 * Settings / Admin Console side navigation (SOT, AdminModels.dc.html).
 * The 248px side nav shared by the Settings and Admin Console pages:
 * Settings (Preferences, Team, Security, Token Wallet), Admin Console
 * (Platform Health, Models & AI, Release Control, Organization,
 * Security & Compliance, Billing & Usage), and the Interface mode
 * switch (Guided / Advanced) at the bottom. Both modes are free.
 */
import Link from "next/link";
import { useAuth } from "@/components/auth/AuthProvider";
import { useInterfaceMode } from "@/lib/interfaceMode";
import { useLocale } from "@/lib/i18n";

export type SettingsSideNavCurrent =
  | "preferences"
  | "team"
  | "security"
  | "wallet"
  | "plans"
  | "admin"
  | "models"
  | "release"
  | "organization"
  | "compliance"
  | "billing";

const item =
  "flex min-h-[34px] items-center rounded-md border-0 px-3 t-body text-ink2 transition-colors hover:bg-raised hover:text-ink";
const itemCurrent = "bg-raised text-ink shadow-[inset_2px_0_0_rgb(var(--primary))]";
const eyebrow = "px-3 pb-2 pt-1.5 t-th";

export function SettingsSideNav({ current }: { current: SettingsSideNavCurrent }) {
  const { t } = useLocale();
  const { mode, setMode } = useInterfaceMode();
  const { organization } = useAuth();
  // Admin › Billing is the company organisation's screen (OTSI): a customer admin never sees the link.
  const isCompanyOrg = organization?.is_company_org === true;
  const link = (id: SettingsSideNavCurrent, href: string, label: string) => (
    <Link key={id} href={href} aria-current={current === id ? "page" : undefined}
      className={`${item} ${current === id ? itemCurrent : ""}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label={t.desktop.navSettings} data-settings-side-nav
      className="flex w-[248px] shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-p0 px-2.5 py-3.5">
      <span className={eyebrow}>{t.desktop.navSettings}</span>
      {link("preferences", "/settings/preferences", t.body.admin.navPreferences)}
      {link("team", "/settings/team", t.body.shell.teamRoles)}
      {link("security", "/settings/security", t.body.shell.twoStep)}
      {link("wallet", "/settings/wallet", t.body.shell.tokenWallet)}
      {link("plans", "/settings/billing", t.body.wallet.wlBillingNav)}
      <span className={`${eyebrow} pt-[18px]`}>{t.body.shell.adminConsole}</span>
      {link("admin", "/settings/admin", t.body.admin.navPlatformHealth)}
      {link("models", "/settings/admin/models", t.body.admin.navModelsAi)}
      {link("release", "/settings/admin/release", t.body.admin.navReleaseControl)}
      {link("organization", "/settings/team", t.body.admin.navOrganization)}
      {link("compliance", "/settings/admin/compliance", t.body.admin.navCompliance)}
      {isCompanyOrg && link("billing", "/settings/admin/billing", t.body.admin.navBillingUsage)}
      <div className="mt-auto flex flex-col gap-2 px-2.5 pb-1 pt-3">
        <span className="t-th">{t.body.admin.navInterface}</span>
        <div className="seg f" role="group" aria-label={t.body.admin.navInterface}>
          <button type="button" className={mode === "guided" ? "on" : ""} onClick={() => setMode("guided")}>
            {t.desktop.modeGuidedShort}
          </button>
          <button type="button" className={mode === "advanced" ? "on" : ""} onClick={() => setMode("advanced")}>
            {t.desktop.modeAdvancedShort}
          </button>
        </div>
        <span className="t-small">{t.body.admin.navBothFree}</span>
      </div>
    </nav>
  );
}
