"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";

/** Light / dark switch (page 01 section 1: "theme respects saved preference"). */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => setTheme(readTheme()), []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={theme === "dark"}
      aria-label="Dark theme"
      title={`Switch to the ${next} theme`}
      onClick={() => { applyTheme(next); setTheme(next); }}
      className="flex items-center gap-2 rounded-full px-1 py-1 text-ink/80 hover:text-ink"
    >
      {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
      <span className={`relative h-5 w-9 rounded-full transition-colors ${theme === "dark" ? "bg-primary" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${theme === "dark" ? "left-[18px]" : "left-0.5"}`} />
      </span>
    </button>
  );
}
