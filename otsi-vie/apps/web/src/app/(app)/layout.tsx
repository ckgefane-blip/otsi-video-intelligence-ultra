import { Suspense, type ReactNode } from "react";
import { RequireSession } from "@/components/auth/RequireSession";
import { AppHeader } from "@/components/shell/AppHeader";
import { AppMain } from "@/components/shell/AppMain";
import { ContextBar } from "@/components/shell/ContextBar";
import { AccuracyBanner } from "@/components/evidence/AccuracyBanner";
import { LocaleProvider } from "@/lib/i18n";
import { UiModeProvider } from "@/lib/uiMode";

/** Every app page: the approved header, the work context bar on the work pages (ADR-069), the accuracy banner while the accuracy gates are open (ADR-063), then the page, for a signed-in
 *  member of an organization only. Guided / Pro per page (ADR-072) wraps it all. The locale (ADR-139) wraps that: the whole app, header
 *  included, reads its language from one provider. */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider>
      <UiModeProvider>
        <AppHeader />
        <Suspense fallback={null}><ContextBar /></Suspense>
        <AccuracyBanner />
        <AppMain>
          <RequireSession>{children}</RequireSession>
        </AppMain>
      </UiModeProvider>
    </LocaleProvider>
  );
}
