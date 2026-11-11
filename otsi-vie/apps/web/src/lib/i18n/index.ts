/** i18n for the OTSI VIE web app (ADR-139): locales, dictionaries, provider. */
export { DEFAULT_LOCALE, LOCALE_NAMES, LOCALE_STORAGE_KEY, SUPPORTED_LOCALES, isLocale, localeFromLanguageTag } from "./locales";
export type { Locale } from "./locales";
export { en, de, es, fr, getDictionary, mergeDictionary, ru } from "./dictionaries";
export type { DeepPartial, Dictionary } from "./dictionaries";
export { LocaleProvider, useLocale } from "./LocaleProvider";
export type { LocaleState } from "./LocaleProvider";
