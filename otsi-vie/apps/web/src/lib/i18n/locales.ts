/**
 * Locales for the OTSI VIE web app (ADR-139).
 *
 * English is the default and the fallback: every string has an English value,
 * and a translation is only used when it exists. A locale the app does not
 * know is treated as English, never as an error.
 */
export type Locale = "en" | "ru" | "es" | "de" | "fr";

export const DEFAULT_LOCALE: Locale = "en";

export const SUPPORTED_LOCALES: readonly Locale[] = ["en", "ru", "es", "de", "fr"];

/** How each locale names itself, in its own language (shown in the switcher). */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
};

/** Where the person's choice lives in this browser (per person, per browser). */
export const LOCALE_STORAGE_KEY = "otsi-vie.locale";

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * The locale for a BCP 47 language tag ("ru-RU" -> "ru", "es-MX" -> "es").
 * Anything the app does not support — or a missing / empty tag — is English.
 */
export function localeFromLanguageTag(tag: string | null | undefined): Locale {
  if (!tag) return DEFAULT_LOCALE;
  const primary = tag.split(/[-_]/)[0]?.toLowerCase() ?? "";
  return isLocale(primary) ? primary : DEFAULT_LOCALE;
}
