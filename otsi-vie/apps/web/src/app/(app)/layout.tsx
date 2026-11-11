import type { ReactNode } from "react";
import { RequireSession } from "@/components/auth/RequireSession";
import { AccuracyBanner } from "@/components/evidence/AccuracyBanner";
import { AdvancedGuard } from "@/components/shell/AdvancedGuard";
import { AppMain } from "@/components/shell/AppMain";
import { AppRail } from "@/components/shell/AppRail";
import { AppTopBar } from "@/components/shell/AppTopBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { LocaleProvider } from "@/lib/i18n";
import { InterfaceModeProvider } from "@/lib/interfaceMode";
import { UiModeProvider } from "@/lib/uiMode";

/** Every app page, Desktop UI shell (owner, 2026-11-11): the collapsible left rail, then a column of the top bar (work context, search,
 *  notifications, Jobs Center, shortcuts, account), the accuracy banner while the gates are open (ADR-063), the page for a signed-in
 *  member only, and the status bar. The locale (ADR-139) wraps it all; the per-page Guided/Advanced setting (ADR-072, UiModeProvider)
 *  is unchanged, and the browser-wide interface mode (InterfaceModeProvider) hides the Advanced screens in Guided. AppHeader stays in
 *  the repo, unused here. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <InterfaceModeProvider>
        <UiModeProvider>
          <div className="vie-shell">
            <AppRail />
            <div className="vie-main">
              <AppTopBar />
              <AccuracyBanner />
              <AppMain>
                <RequireSession><AdvancedGuard>{children}</AdvancedGuard></RequireSession>
              </AppMain>
              <StatusBar />
            </div>
          </div>
        </UiModeProvider>
      </InterfaceModeProvider>
    </LocaleProvider>
  );
}
