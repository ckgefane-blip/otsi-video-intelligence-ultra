import { describe, expect, it } from "vitest";
import { safeNext } from "@/lib/safe-next";

describe("return address after sign-in", () => {
  it("keeps same-app paths", () => {
    expect(safeNext("/library?tab=reels")).toBe("/library?tab=reels");
    expect(safeNext("/reports/players/OTSI-NGA-2026-000001")).toBe("/reports/players/OTSI-NGA-2026-000001");
  });

  it("refuses anything that could leave the app", () => {
    for (const bad of [null, "", "https://evil.example", "//evil.example/x", "/\\evil.example", "javascript:alert(1)", "dashboard"]) {
      expect(safeNext(bad), String(bad)).toBe("/dashboard");
    }
  });
});
