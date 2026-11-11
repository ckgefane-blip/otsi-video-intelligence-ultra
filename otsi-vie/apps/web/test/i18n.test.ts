/**
 * i18n dictionaries and locale detection (ADR-139).
 * Every locale must resolve to a complete dictionary (no missing or empty
 * string), and a missing translation must fall back to English — never to
 * a blank. Locale detection maps a browser language tag to the nearest
 * supported locale, and anything unknown is English.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  SUPPORTED_LOCALES,
  getDictionary,
  isLocale,
  localeFromLanguageTag,
  mergeDictionary,
  en,
  type Dictionary,
} from "@/lib/i18n";

/** Every leaf path (dot-separated) and value in a nested string object. */
function leaves(obj: Record<string, unknown>, prefix = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") out.push(...leaves(v as Record<string, unknown>, path));
    else out.push([path, String(v)]);
  }
  return out;
}

function leafAt(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, part) => (cur !== null && typeof cur === "object" ? (cur as Record<string, unknown>)[part] : undefined), obj);
}

describe("dictionaries (ADR-139)", () => {
  it("English is the complete source of truth: every leaf is a non-empty string", () => {
    for (const [path, value] of leaves(en as unknown as Record<string, unknown>)) {
      expect(value.trim().length, path).toBeGreaterThan(0);
    }
  });

  it("every supported locale resolves to a complete dictionary (no missing or empty string)", () => {
    const keys = leaves(en as unknown as Record<string, unknown>).map(([p]) => p);
    expect(keys.length).toBeGreaterThan(30);
    for (const locale of SUPPORTED_LOCALES) {
      const dict = getDictionary(locale);
      for (const path of keys) {
        const value = leafAt(dict as unknown as Record<string, unknown>, path);
        expect(typeof value, `${locale}:${path}`).toBe("string");
        expect((value as string).trim().length, `${locale}:${path}`).toBeGreaterThan(0);
      }
    }
  });

  it("a locale that does not translate a key falls back to the English string", () => {
    const merged = mergeDictionary(en, { nav: { home: "Главная" } });
    expect(merged.nav.home).toBe("Главная");
    expect(merged.nav.upload).toBe("Upload");
    expect(merged.pages.home.subtitle).toBe(en.pages.home.subtitle);
  });

  it("every supported locale has a native name for the switcher", () => {
    for (const locale of SUPPORTED_LOCALES) {
      expect(LOCALE_NAMES[locale].trim().length).toBeGreaterThan(0);
    }
    expect(LOCALE_NAMES.en).toBe("English");
    expect(LOCALE_NAMES.ru).toBe("Русский");
    expect(LOCALE_NAMES.es).toBe("Español");
    expect(LOCALE_NAMES.de).toBe("Deutsch");
    expect(LOCALE_NAMES.fr).toBe("Français");
  });

  it("the four translations actually differ from English (they are translations, not copies)", () => {
    for (const locale of ["ru", "es", "de", "fr"] as const) {
      const dict = getDictionary(locale);
      const same = leaves(en as unknown as Record<string, unknown>).filter(
        ([path, value]) => leafAt(dict as unknown as Record<string, unknown>, path) === value,
      );
      // Proper nouns and brand terms legitimately stay English ("OTSI VIE",
      // "Spotlight Composer", "Reels" as the product term in ES/DE/FR, "Ctrl+K").
      // The large majority must still differ.
      expect(same.length, locale).toBeLessThan(10);
      expect(dict.nav.home).not.toBe(en.nav.home);
      expect(dict.common.language).not.toBe(en.common.language);
    }
  });
});

describe("locale detection", () => {
  it("maps a BCP 47 tag to the nearest supported locale", () => {
    expect(localeFromLanguageTag("ru-RU")).toBe("ru");
    expect(localeFromLanguageTag("ru")).toBe("ru");
    expect(localeFromLanguageTag("es-MX")).toBe("es");
    expect(localeFromLanguageTag("es")).toBe("es");
    expect(localeFromLanguageTag("de-DE")).toBe("de");
    expect(localeFromLanguageTag("fr-FR")).toBe("fr");
    expect(localeFromLanguageTag("en-US")).toBe("en");
    expect(localeFromLanguageTag("en")).toBe("en");
  });

  it("an unsupported or missing tag is English, never an error", () => {
    expect(localeFromLanguageTag("pt-BR")).toBe("en");
    expect(localeFromLanguageTag("zh-CN")).toBe("en");
    expect(localeFromLanguageTag("")).toBe("en");
    expect(localeFromLanguageTag(null)).toBe("en");
    expect(localeFromLanguageTag(undefined)).toBe("en");
  });

  it("isLocale accepts only the five supported codes", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ru")).toBe(true);
    expect(isLocale("es")).toBe(true);
    expect(isLocale("de")).toBe(true);
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("xx")).toBe(false);
    expect(isLocale("")).toBe(false);
    expect(isLocale("EN")).toBe(false);
  });

  it("the default locale is English", () => {
    expect(DEFAULT_LOCALE).toBe("en");
    expect(getDictionary("en")).toBe(en);
  });
});
