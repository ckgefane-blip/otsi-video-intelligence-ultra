"use client";
/**
 * Locale for the OTSI VIE web app (ADR-139).
 *
 * The person's language, kept in this browser (localStorage) and applied to
 * the whole app. English is the default; on first visit the browser's
 * language is used when the app supports it. The choice is the person's
 * own — it is not sent to the API and it does not change any data, only
 * the words around it.
 *
 * First paint is English, then the stored / detected locale applies in an
 * effect — the same pattern as `lib/uiMode.tsx`. That avoids a hydration
 * mismatch (the server cannot know this browser's stored choice) at the
 * cost of one re-render when the stored language is not English.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_STORAGE_KEY,
  isLocale,
  localeFromLanguageTag,
  type Locale,
} from "./locales";
import { getDictionary, type Dictionary } from "./dictionaries";

export interface LocaleState {
  locale: Locale;
  /** the complete dictionary for the current locale (missing keys are English) */
  t: Dictionary;
  setLocale(locale: Locale): void;
}

const FALLBACK: LocaleState = {
  locale: DEFAULT_LOCALE,
  t: getDictionary(DEFAULT_LOCALE),
  setLocale: () => {},
};

const Ctx = createContext<LocaleState | null>(null);

/** The current locale and dictionary; English with a no-op setter outside the provider. */
export const useLocale = () => useContext(Ctx) ?? FALLBACK;

function readStored(): Locale | null {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    return stored && isLocale(stored) ? stored : null;
  } catch {
    return null; // private window: the default still applies
  }
}

function writeStored(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // private window: the choice lasts for this visit
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  useEffect(() => {
    setLocaleState(readStored() ?? localeFromLanguageTag(navigator.language));
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeStored(next);
  }, []);
  const value = useMemo<LocaleState>(
    () => ({ locale, t: getDictionary(locale), setLocale }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
