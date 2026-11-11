"use client";
/** In the Guided interface the Advanced screens (Tactical, Clip Studio, Admin) are hidden; opening one by its address shows this notice
 *  instead of the page. Nothing is locked: both modes are free, and one click switches to Advanced. */
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useLocale } from "@/lib/i18n";
import { isAdvancedRoute, useInterfaceMode } from "@/lib/interfaceMode";

export function AdvancedGuard({ children }: { children: ReactNode }) {
  const path = usePathname() ?? "/";
  const { mode, setMode } = useInterfaceMode();
  const { t } = useLocale();
  if (mode === "advanced" || !isAdvancedRoute(path)) return <>{children}</>;
  return (
    <div className="vie-page grid place-items-center" data-advanced-only>
      <div className="vie-panel max-w-[520px] p-6 text-center">
        <h1 className="t-section">{t.desktop.advancedOnlyTitle}</h1>
        <p className="t-body mt-2 text-muted">{t.desktop.advancedOnlyBody}</p>
        <button type="button" className="vie-btn vie-btn-pri mt-4" onClick={() => setMode("advanced")}>{t.desktop.switchToAdvanced}</button>
      </div>
    </div>
  );
}
