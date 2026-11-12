import type { Config } from "tailwindcss";

/**
 * Design tokens from the approved page specifications (01_HOME_OVERVIEW.md "Design tokens (proposed)"): canvas #06111F, panel #0C1D30,
 * raised #10243A, border #1B3C56, primary #079BFF, cyan #17D1F8, amber #F1A824, text #F4F8FF, secondary #9CB1C5; 8px spacing scale,
 * 8-12px radii, tabular numerals. Colours are CSS variables (src/app/globals.css) so the light theme swaps them without new classes.
 * The production palette still needs owner approval (LICENSE_REGISTER.md section 6).
 */
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: v("canvas"),
        panel: v("panel"),
        raised: v("raised"),
        line2: v("line2"),
        ink2: v("ink2"),
        p0: v("p0"),
        line: v("line"),
        primary: v("primary"),
        cyan: v("cyan"),
        amber: v("amber"),
        ink: v("ink"),
        muted: v("muted"),
        ok: v("ok"),
        danger: v("danger"),
      },
      fontFamily: { sans: ['"Segoe UI Variable Text"', '"Segoe UI"', "system-ui", "-apple-system", '"Inter Variable"', "Inter", "sans-serif"] },
      borderRadius: { card: "12px", ctl: "8px" },
      boxShadow: { glow: "0 0 0 1px rgb(var(--primary) / 0.35), 0 0 24px rgb(var(--primary) / 0.25)" },
    },
  },
  plugins: [],
} satisfies Config;
