"use client";
/**
 * Language switcher (ADR-139): the person's language, as a fieldset in the
 * account menu — the same shape as the Guided / Pro fieldset beside it
 * (ProfileChip), because it is the same kind of thing: a per-person
 * preference, remembered in this browser. The header itself has no free
 * pixel for a button (the approved 2560-px design is full), so the switcher
 * lives here rather than in the bar.
 *
 * Each option shows the language's own name (English, Русский, Español,
 * Deutsch, Français). Choosing one applies it at once to the whole app and
 * remembers it; English is the fallback for any string not yet translated.
 */
import { LOCALE_NAMES, SUPPORTED_LOCALES, useLocale, type Locale } from "@/lib/i18n";

export function LanguageSwitcher() {
  const { locale, setLocale, t } = useLocale();
  return (
    <fieldset className="mt-3" data-language-switch={locale}>
      <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{t.shell.language}</legend>
      <div role="radiogroup" aria-label={t.shell.language} className="mt-1 grid grid-cols-2 gap-1">
        {SUPPORTED_LOCALES.map((code: Locale) => (
          <button
            key={code}
            type="button"
            role="radio"
            aria-checked={locale === code}
            data-language-option={code}
            onClick={() => setLocale(code)}
            className={`rounded-ctl border px-2 py-1.5 text-left text-sm ${
              locale === code ? "border-primary bg-primary/15" : "border-line hover:border-primary/60"
            }`}
          >
            <span className="block font-medium">{LOCALE_NAMES[code]}</span>
            <span className="block text-[11px] text-muted">{code.toUpperCase()}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}
