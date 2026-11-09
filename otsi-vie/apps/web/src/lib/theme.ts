export type Theme = "dark" | "light";
export const THEME_STORAGE_KEY = "otsi-vie-theme";

export function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

/** Apply and remember the theme (the preference is per browser until user preferences exist: Block 02, PATCH /me/preferences). */
export function applyTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, t);
  } catch {
    /* storage unavailable (private mode): the choice lasts for this page only */
  }
}
