"use client";
/** Guided / Advanced for this browser (Desktop UI). Guided hides Tactical, Clip Studio and Admin; nothing is locked and both are free —
 *  "Pro" is only the paid tier's name, never this switch. Separate from the per-page Guided / Advanced setting (ADR-072). */
import { useLocale } from "@/lib/i18n";
import { useInterfaceMode, type InterfaceMode } from "@/lib/interfaceMode";

export function InterfaceModeSwitch() {
  const { t } = useLocale();
  const { mode, setMode } = useInterfaceMode();
  const opts: [InterfaceMode, string][] = [["guided", t.desktop.modeGuidedShort], ["advanced", t.desktop.modeAdvancedShort]];
  return (
    <fieldset className="mt-3" data-interface-switch>
      <legend className="t-th">{mode === "advanced" ? t.desktop.modeAdvanced : t.desktop.modeGuided}</legend>
      <div role="radiogroup" aria-label={t.desktop.modeAdvanced} className="mt-1 inline-flex rounded-md border border-line2 bg-p0 p-0.5">
        {opts.map(([v, label]) => (
          <button key={v} type="button" role="radio" aria-checked={mode === v} onClick={() => setMode(v)}
            className={`t-button rounded px-3 py-1 ${mode === v ? "bg-raised text-ink" : "text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      <p className="t-small mt-1 text-muted">{t.desktop.modesFree}</p>
    </fieldset>
  );
}
