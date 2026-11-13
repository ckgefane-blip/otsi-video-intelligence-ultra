/**
 * The page registry must reproduce the approved specifications exactly: ten pages, every section placed once in a rectangular grid area,
 * no area naming a section that does not exist, and navigation as in the approved header.
 */
import { describe, expect, it } from "vitest";
import { navItems, PAGE_SPECS, PAGES, sectionState, type PageId } from "@/lib/pages";

const ids = Object.keys(PAGES).map(Number) as PageId[];

describe("page registry", () => {
  it("has the ten approved pages and their 102 sections", () => {
    expect(ids).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(PAGE_SPECS.map((p) => p.title)).toEqual([
      "Home / Overview", "Upload & Ingest", "AI Processing Pipeline", "Analysis Workspace", "Tactical Intelligence",
      "Reel Builder / Spotlight Composer", "Clip Studio / Timeline Editor", "Player Report", "Library / Project Center", "Export & Delivery",
    ]);
    expect(PAGE_SPECS.reduce((n, p) => n + p.sections.length, 0)).toBe(102);
  });

  it.each(ids)("page %i places every section exactly once, in a rectangle, and nothing else", (id) => {
    const def = PAGES[id];
    const spec = PAGE_SPECS.find((p) => p.page === id)!;
    const rows = def.areas.map((r) => r.trim().split(/\s+/));
    const width = def.columns.match(/minmax\([^)]*\)|[^\s]+/g)!.length;
    for (const r of rows) expect(r).toHaveLength(width);
    const names = new Set(rows.flat());
    const inGrid = spec.sections.filter((s) => sectionState(id, s.n).kind !== "shell").map((s) => `s${s.n}`);
    expect([...names].filter((n) => n !== "rail").sort()).toEqual([...inGrid].sort());
    for (const name of names) {                                 // CSS grid areas must be rectangles
      const cells = rows.flatMap((r, y) => r.map((c, x) => (c === name ? [x, y] : null)).filter(Boolean)) as [number, number][];
      const xs = cells.map((c) => c[0]), ys = cells.map((c) => c[1]);
      const area = (Math.max(...xs) - Math.min(...xs) + 1) * (Math.max(...ys) - Math.min(...ys) + 1);
      expect(cells.length, `${name} on page ${id}`).toBe(area);
    }
  });

  it("never presents sample data: every section is connected, static product copy, an owner asset, or explicitly not connected", () => {
    for (const id of ids) {
      for (const s of PAGE_SPECS.find((p) => p.page === id)!.sections) {
        expect(["planned", "static", "owner", "shell", "live"]).toContain(sectionState(id, s.n).kind);
      }
    }
  });
});

describe("navigation", () => {
  it("shows the eleven approved destinations in the approved order and marks the current one", () => {
    const items = navItems("/dashboard");
    expect(items.map((i) => i.label)).toEqual(["Home", "Media", "Processing", "Analysis", "Tactical", "Players", "Reports", "Reels", "Clip Studio", "Library", "Export"]);
    expect(items.filter((i) => i.active).map((i) => i.label)).toEqual(["Home"]);
  });

  it.each([
    ["/upload", "Media"], ["/processing", "Processing"], ["/videos/0190c6a0-0000-7000-8000-000000000000/processing", "Processing"],
    ["/analysis", "Analysis"], ["/videos/0190c6a0-0000-7000-8000-000000000000/analyze", "Analysis"],
    ["/tactics", "Tactical"], ["/videos/0190c6a0-0000-7000-8000-000000000000/tactics", "Tactical"],
    ["/players", "Players"],
    ["/reels", "Reels"], ["/reels/0190c6a0-0000-7000-8000-000000000000", "Reels"], ["/studio", "Clip Studio"],
    ["/reports", "Reports"], ["/reports/players/OTSI-NGA-2026-000001", "Reports"],
    ["/library", "Library"], ["/matches", "Library"], ["/exports", "Export"],
  ])("marks exactly one current destination for %s", (path, label) => {
    const items = navItems(path);
    expect(items).toHaveLength(11);
    expect(items.filter((i) => i.active).map((i) => i.label)).toEqual([label]);
  });
});
