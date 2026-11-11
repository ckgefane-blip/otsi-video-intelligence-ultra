/**
 * Language switcher (ADR-139): the five languages are offered by their own
 * names, choosing one applies it at once and remembers it in this browser.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LOCALE_STORAGE_KEY, LocaleProvider } from "@/lib/i18n";
import { LanguageSwitcher } from "@/components/shell/LanguageSwitcher";

function renderSwitcher() {
  return render(
    <LocaleProvider>
      <LanguageSwitcher />
    </LocaleProvider>,
  );
}

describe("LanguageSwitcher (ADR-139)", () => {
  it("offers all five languages by their own names", () => {
    renderSwitcher();
    for (const name of ["English", "Русский", "Español", "Deutsch", "Français"]) {
      expect(screen.getByText(name)).toBeDefined();
    }
    expect(screen.getByRole("radiogroup", { name: "Language" })).toBeDefined();
  });

  it("choosing Russian applies it at once and remembers it", () => {
    localStorage.removeItem(LOCALE_STORAGE_KEY);
    renderSwitcher();
    expect(screen.getByRole("radio", { name: /Русский/ }).getAttribute("aria-checked")).toBe("false");
    fireEvent.click(screen.getByRole("radio", { name: /Русский/ }));
    expect(screen.getByRole("radio", { name: /Русский/ }).getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("ru");
    expect(document.documentElement.lang).toBe("ru");
    // The switcher itself is translated: its legend is now the Russian word.
    expect(screen.getByRole("radiogroup", { name: "Язык" })).toBeDefined();
  });

  it("choosing English again restores the English labels", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "de");
    renderSwitcher();
    expect(document.documentElement.lang).toBe("de");
    fireEvent.click(screen.getByRole("radio", { name: /English/ }));
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
    expect(document.documentElement.lang).toBe("en");
  });
});
