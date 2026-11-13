import type { ReactNode } from "react";
import { RequireSession } from "@/components/auth/RequireSession";
import { WelcomeTour } from "@/components/auth/Onboarding";
import { AdvancedGuard } from "@/components/shell/AdvancedGuard";
import { AppMain } from "@/components/shell/AppMain";
import { AppRail } from "@/components/shell/AppRail";
import { AppTopBar } from "@/components/shell/AppTopBar";
import { StatusBar } from "@/components/shell/StatusBar";
import { LocaleProvider } from "@/lib/i18n";
import { InterfaceModeProvider } from "@/lib/interfaceMode";
import { InterfaceScaleProvider } from "@/lib/interfaceScale";
import { UiModeProvider } from "@/lib/uiMode";

/** Every app page, Desktop UI shell (owner, 2026-11-11; SOT rebuild 2026-11-13): the left rail (fixed 240 / 64 px), then a column of
 *  the top bar (work context on every shelled page, search, token counter, theme, Jobs Center, bell, shortcuts, account), the
 *  page for a signed-in member only, and the status bar. (The SOT's slim accuracy line lives on the Home page only —
 *  AccuracyBanner, rendered by HomeStage — not here: the SOT has no accuracy line on Analysis, Tactical, Reels,
 *  Clip Studio or Library.) The locale
 *  (ADR-139) wraps it all; the per-page Guided/Advanced setting (ADR-072, UiModeProvider) is unchanged, and the browser-wide
 *  interface mode (InterfaceModeProvider) hides the Advanced screens in Guided. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <InterfaceModeProvider>
        <InterfaceScaleProvider>
        <UiModeProvider>
          <div className="vie-shell">
            <AppRail />
            <div className="vie-main">
              <AppTopBar />
              <AppMain>
                <RequireSession><AdvancedGuard>{children}</AdvancedGuard></RequireSession>
              </AppMain>
              <StatusBar />
              <WelcomeTour />
            </div>
          </div>
        </UiModeProvider>
        </InterfaceScaleProvider>
      </InterfaceModeProvider>
    </LocaleProvider>
  );
}
