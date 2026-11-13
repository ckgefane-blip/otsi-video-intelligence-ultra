"use client";
/**
 * Settings / Admin Console side navigation (SOT, AdminModels.dc.html): the 248px side nav, with the
 * Interface mode switch (Guided / Advanced) at the bottom. Both modes are free.
 *
 * Settings and Admin are two separate places (owner, 2026-11-13: "Admin and Settings open on same page"):
 * a Settings page lists only Settings (Preferences, Team, 2-step sign-in, Token Wallet, Plans & billing);
 * an Admin page lists only the Admin Console (Platform health, Models & AI, Release control, Organization,
 * Security & compliance, and Billing for the company organisation). The rail's Settings and Admin buttons
 * open one each, so the two never look like the same page.
 */
import { SidePanel } from "@/components/shell/SidePanel";
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
const ADMIN_PAGES: readonly SettingsSideNavCurrent[] = ["admin", "models", "release", "organization", "compliance", "billing"];

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
  const admin = ADMIN_PAGES.includes(current);
  return (
    <SidePanel as="nav" panel="settings-nav" def={248} edge="right" min={180} max={420}
      aria-label={admin ? t.body.shell.adminConsole : t.desktop.navSettings} data-settings-side-nav={admin ? "admin" : "settings"}
      className="flex flex-col gap-0.5 overflow-y-auto border-r border-line bg-p0 px-2.5 py-3.5">
      {admin ? (
        <>
          <span className={eyebrow}>{t.body.shell.adminConsole}</span>
          {link("admin", "/settings/admin", t.body.admin.navPlatformHealth)}
          {link("models", "/settings/admin/models", t.body.admin.navModelsAi)}
          {link("release", "/settings/admin/release", t.body.admin.navReleaseControl)}
          {link("organization", "/settings/admin/organization", t.body.admin.navOrganization)}
          {link("compliance", "/settings/admin/compliance", t.body.admin.navCompliance)}
          {isCompanyOrg && link("billing", "/settings/admin/billing", t.body.admin.navBillingUsage)}
        </>
      ) : (
        <>
          <span className={eyebrow}>{t.desktop.navSettings}</span>
          {link("preferences", "/settings/preferences", t.body.admin.navPreferences)}
          {link("team", "/settings/team", t.body.shell.teamRoles)}
          {link("security", "/settings/security", t.body.shell.twoStep)}
          {link("wallet", "/settings/wallet", t.body.shell.tokenWallet)}
          {link("plans", "/settings/billing", t.body.wallet.wlBillingNav)}
        </>
      )}
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
    </SidePanel>
  );
}
