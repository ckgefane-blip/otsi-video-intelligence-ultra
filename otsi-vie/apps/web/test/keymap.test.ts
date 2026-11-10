import { describe, expect, it } from "vitest";
import { ANALYSIS_KEYS, EVERYWHERE_KEYS, jkl, KEYMAP, keymapFor, scopeOf, STUDIO_KEYS } from "../src/lib/keymap";

/** v3 Phase A.9 (S14, ADR-071): the app's one keyboard map */
describe("keyboard map", () => {
  it("has the keys the spec names, each listed once per page", () => {
    for (const list of [EVERYWHERE_KEYS, STUDIO_KEYS, ANALYSIS_KEYS]) expect(new Set(list.map((s) => s.keys)).size).toBe(list.length);
    const has = (list: { keys: string }[], k: string) => list.some((s) => s.keys === k);
    for (const k of ["J", "K", "L", "I / O", "S", "C", "M"]) expect(has(STUDIO_KEYS, k)).toBe(true);
    // dual timeline snapshot-and-swap (Blueprint §2.3): B snapshots Cut B, Shift+B applies it
    for (const k of ["B", "Shift + B"]) expect(has(STUDIO_KEYS, k)).toBe(true);
    for (const k of ["J", "K", "L", "N", "Space"]) expect(has(ANALYSIS_KEYS, k)).toBe(true);
    for (const k of ["Ctrl + K", "?"]) expect(has(EVERYWHERE_KEYS, k)).toBe(true);
    // L is play now; no single key does two things on one page
    const single = (list: { keys: string }[]) => list.flatMap((s) => s.keys.split(" / ")).filter((k) => /^[A-Z]$/.test(k));
    for (const list of [STUDIO_KEYS, ANALYSIS_KEYS]) expect(new Set(single(list)).size).toBe(single(list).length);
  });

  it("lists this page's keys first, then everywhere, then the other pages", () => {
    expect(scopeOf("/studio")).toBe("studio");
    expect(scopeOf("/analysis")).toBe("analysis");
    expect(scopeOf("/dashboard")).toBeNull();
    expect(keymapFor("/studio").map((g) => [g.scope, g.here])).toEqual([["studio", true], ["everywhere", false], ["analysis", false]]);
    expect(keymapFor("/analysis").map((g) => g.scope)).toEqual(["analysis", "everywhere", "studio"]);
    expect(keymapFor("/library").map((g) => g.scope)).toEqual(["everywhere", "studio", "analysis"]);
    expect(keymapFor("/x").flatMap((g) => g.rows)).toHaveLength(KEYMAP.length);
  });

  it("finds a key by its letter and a command by words", () => {
    const keys = (q: string) => keymapFor("/studio", q).flatMap((g) => g.rows.map((r) => `${g.scope}:${r.keys}`));
    expect(keys("s")).toEqual(["studio:S"]);
    expect(keys("n")).toEqual(["analysis:N"]);
    expect(keys("i")).toEqual(["studio:I / O"]);
    expect(keys("?")).toEqual(["everywhere:?"]);
    expect(keys("split")).toEqual(["studio:S"]);
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
