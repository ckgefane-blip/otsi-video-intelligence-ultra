/** Portuguese (owner, 2026-11-12) must be complete: every English key present, every value a non-empty string, placeholders kept,
 *  and no value left in English except words that are the same in Portuguese, units, product names and code (the list below). */
import { describe, expect, it } from "vitest";
import { en, pt } from "@/lib/i18n";
import { SUPPORTED_LOCALES, LOCALE_NAMES } from "@/lib/i18n/locales";

type Tree = { [k: string]: string | Tree };
const leaves = (o: Tree, p = ""): [string, string][] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[p + k, v] as [string, string]] : leaves(v, `${p}${k}.`)));

/** same in both languages: Portuguese words, loanwords used in Brazilian Portuguese, units, names, code */
const SAME = new Set(["Clip Studio", "Reels", "Reel", "reel", "Reel Builder", "Intro", "Passes", "passes", "Spotlight", "Status", "Normal", "normal", "Zoom", "Linear",
  "Vertical", "Design", "Editor", "Detector", "EXPERIMENTAL", "Tokens", "tokens", "Pro", "E-mail", "Instagram", "YouTube, Web", "Reels, Shorts",
  "OTSI Player ID", "CPU / DirectML", "Naira (₦)", "Full HD (1920 × 1080)", "1 item", "· 1 item", "1 reel", "{a} reels", "search event:goal type:moment", "Interface",
  "Codec", "[player]-[match]-reel.mp4", "name@club.com", "you@club.com", "{a} tokens", "xA", "SD 480p", "HD 720p", "Full HD 1080p", "4K 2160p"]);
const plain = (s: string) => /[A-Za-z]{3,}/.test(s.replace(/\{\w+\}/g, "")) && !/^[\s·]*(Reel|Best Moment Rule|OpenTimelineIO|\.otsi-reel|Passes \(p90\)|Vertical \d)/.test(s)
  && !/\b(min|fps|Mbps|LUFS|Ctrl)\b/.test(s);

describe("Portuguese dictionary", () => {
  const E = new Map(leaves(en as unknown as Tree));
  const P = new Map(leaves(pt as unknown as Tree));
  it("is one of exactly six languages", () => {
    expect([...SUPPORTED_LOCALES]).toEqual(["en", "ru", "es", "de", "fr", "pt"]);
    expect(LOCALE_NAMES.pt).toBe("Português");
  });
  it("has every English key, and nothing else", () => {
    expect([...E.keys()].filter((k) => !P.has(k))).toEqual([]);
    expect([...P.keys()].filter((k) => !E.has(k))).toEqual([]);
  });
  it("keeps every placeholder", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    expect([...E].filter(([k, v]) => ph(v) !== ph(P.get(k) ?? "")).map(([k]) => k)).toEqual([]);
  });
  it("leaves no value in English", () => {
    expect([...E].filter(([k, v]) => v !== "" && P.get(k) === v && plain(v) && !SAME.has(v)).map(([k, v]) => `${k}: ${v}`)).toEqual([]);
  });
});
