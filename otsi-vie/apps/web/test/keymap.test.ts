import { describe, expect, it } from "vitest";
import { ANALYSIS_KEYS, EVERYWHERE_KEYS, jkl, KEYMAP, keymapFor, REELS_KEYS, REPORTS_KEYS, scopeOf, STUDIO_KEYS } from "../src/lib/keymap";

/** v3 Phase A.9 (S14, ADR-071): the app's one keyboard map */
describe("keyboard map", () => {
  it("has the keys the spec names, each listed once per page", () => {
    for (const list of [EVERYWHERE_KEYS, STUDIO_KEYS, ANALYSIS_KEYS, REELS_KEYS, REPORTS_KEYS]) expect(new Set(list.map((s) => s.keys)).size).toBe(list.length);
    const has = (list: { keys: string }[], k: string) => list.some((s) => s.keys === k);
    for (const k of ["J", "K", "L", "I / P", "S", "C", "M"]) expect(has(STUDIO_KEYS, k)).toBe(true);
    // SOT rebuild 2026-11-13: B is the Blade tool (split where you click) and V is the Select tool. The dual
    // timeline's B (snapshot Cut B) and Shift + B (apply Cut B) are gone — that panel is never mounted.
    for (const k of ["B", "V"]) expect(has(STUDIO_KEYS, k)).toBe(true);
    expect(has(STUDIO_KEYS, "Shift + B")).toBe(false);
    for (const k of ["J", "K", "L", "N", "Space"]) expect(has(ANALYSIS_KEYS, k)).toBe(true);
    // the SOT's missing rows, now wired: frame step, speed, Confirm / Correct / Reject identity
    for (const k of [", / .", "[ / ]", "C", "E", "X"]) expect(has(ANALYSIS_KEYS, k)).toBe(true);
    for (const k of ["Ctrl + K", "?", "Ctrl + ,"]) expect(has(EVERYWHERE_KEYS, k)).toBe(true);
    // Reel Builder: the same undo / redo keys as Clip Studio, for the reel's own History
    for (const k of ["Ctrl + Z", "Ctrl + Shift + Z or Ctrl + Y"]) expect(has(REELS_KEYS, k)).toBe(true);
    // Player reports: [ / ] move between the rail's sections
    for (const k of ["[ / ]"]) expect(has(REPORTS_KEYS, k)).toBe(true);
    // L is play now; no single key does two things on one page
    const single = (list: { keys: string }[]) => list.flatMap((s) => s.keys.split(" / ")).filter((k) => /^[A-Z]$/.test(k));
    for (const list of [STUDIO_KEYS, ANALYSIS_KEYS]) expect(new Set(single(list)).size).toBe(single(list).length);
  });

  it("lists this page's keys first, then everywhere, then the other pages", () => {
    expect(scopeOf("/studio")).toBe("studio");
    expect(scopeOf("/analysis")).toBe("analysis");
    expect(scopeOf("/reels")).toBe("reels");
    expect(scopeOf("/reports")).toBe("reports");
    expect(scopeOf("/reports/players/abc")).toBe("reports");
    expect(scopeOf("/library")).toBe("library");
    expect(scopeOf("/dashboard")).toBeNull();
    expect(keymapFor("/studio").map((g) => [g.scope, g.here])).toEqual([["studio", true], ["everywhere", false], ["analysis", false], ["reels", false], ["reports", false], ["library", false], ["exports", false]]);
    expect(keymapFor("/analysis").map((g) => g.scope)).toEqual(["analysis", "everywhere", "studio", "reels", "reports", "library", "exports"]);
    expect(keymapFor("/reels").map((g) => g.scope)).toEqual(["reels", "everywhere", "studio", "analysis", "reports", "library", "exports"]);
    expect(keymapFor("/reports").map((g) => g.scope)).toEqual(["reports", "everywhere", "studio", "analysis", "reels", "library", "exports"]);
    expect(keymapFor("/library").map((g) => g.scope)).toEqual(["library", "everywhere", "studio", "analysis", "reels", "reports", "exports"]);
    expect(scopeOf("/exports")).toBe("exports");
    expect(keymapFor("/exports").map((g) => g.scope)).toEqual(["exports", "everywhere", "studio", "analysis", "reels", "reports", "library"]);
    expect(keymapFor("/x").flatMap((g) => g.rows)).toHaveLength(KEYMAP.length);
  });

  it("finds a key by its letter and a command by words", () => {
    const keys = (q: string) => keymapFor("/studio", q).flatMap((g) => g.rows.map((r) => `${g.scope}:${r.keys}`));
    expect(keys("s")).toEqual(["studio:S"]);
    expect(keys("n")).toEqual(["analysis:N"]);
    expect(keys("i")).toEqual(["studio:I / P"]);
    expect(keys("?")).toEqual(["everywhere:?"]);
    expect(keys("split")).toEqual(["studio:S", "studio:B"]);
    expect(keys("blade")).toEqual(["studio:B"]);
    expect(keys("marker")).toEqual(["studio:M"]);
    expect(keys("zzz")).toEqual([]);
  });

  it("J K L: back a second, pause, play and speed up", () => {
    expect(jkl("k", { playing: true, rate: 2 })).toEqual({ play: false, rate: 1, backUs: 0 });
    expect(jkl("j", { playing: true, rate: 1 })).toEqual({ play: false, rate: 1, backUs: 1_000_000 });
    expect(jkl("l", { playing: false, rate: 2 })).toEqual({ play: true, rate: 1, backUs: 0 });
    expect(jkl("l", { playing: true, rate: 1 }).rate).toBe(1.5);
    expect(jkl("l", { playing: true, rate: 1.5 }).rate).toBe(2);
    expect(jkl("l", { playing: true, rate: 2 }).rate).toBe(2);
    expect(jkl("l", { playing: true, rate: 0.5 }).rate).toBe(1);
  });
});
