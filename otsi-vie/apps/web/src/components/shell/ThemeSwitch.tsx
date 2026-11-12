"use client";
/**
 * The light/dark mode switch in the top bar (Desktop UI prototype, owner 2026-11-12): the same layout in either theme, only the
 * surfaces change. Two small buttons — moon for dark, sun for light — like the prototype's data-theme-set buttons. The choice is
 * kept in this browser (localStorage "otsi.theme") and restored on load; dark is the default. It sets data-theme on the document
 * element, which is what globals.css reads ([data-theme="dark"] / [data-theme="light"]).
 */
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const KEY = "otsi.theme";
type Theme = "dark" | "light";

function read(): Theme {
  try { return window.localStorage.getItem(KEY) === "light" ? "light" : "dark"; } catch { return "dark"; }
}

export function ThemeSwitch() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    const t = read();
    setTheme(t);
    document.documentElement.dataset.theme = t;
  }, []);
  const set = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { window.localStorage.setItem(KEY, t); } catch { /* private mode */ }
  };
  const btn = "grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-raised hover:text-ink";
  const on = "bg-raised text-ink";
  return (
    <div role="group" aria-label="Appearance" className="flex shrink-0 items-center rounded-md border border-line">
      <button type="button" onClick={() => set("dark")} aria-label="Dark mode" aria-pressed={theme !== "light"} data-theme-set="dark" className={`${btn} ${theme !== "light" ? on : ""}`}>
        <Moon className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" onClick={() => set("light")} aria-label="Light mode" aria-pressed={theme === "light"} data-theme-set="light" className={`${btn} ${theme === "light" ? on : ""}`}>
        <Sun className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
