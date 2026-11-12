"use client";
/** Settings > Security content (SOT, Security.dc.html): the two-step panel and the passkeys panel, side by side. */
import { PasskeySettings } from "@/components/account/PasskeySettings";
import { TwoStepSettings } from "@/components/account/TwoStepSettings";
import { useLocale } from "@/lib/i18n";

export function SecurityView() {
  const { t } = useLocale();
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-3 px-7 py-[18px]" data-page="settings-security">
      <div className="flex flex-col gap-1.5"><span className="eb">{t.desktop.navSettings}</span><h1 className="h1">{t.body.settings.stSecTitle}</h1></div>
      <div className="grid flex-1 items-stretch gap-4 [grid-template-columns:repeat(auto-fit,minmax(380px,1fr))]">
        <TwoStepSettings />
        <PasskeySettings />
      </div>
    </main>
  );
}
