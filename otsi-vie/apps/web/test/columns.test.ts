import { describe, expect, it } from "vitest";
import { clamp } from "@/components/workspace/ResizableColumns";

describe("Page 04 column widths (more room, not a zoom)", () => {
  it("keeps the approved widths as they are", () => {
    expect(clamp({ l: 404, r: 556 })).toEqual({ l: 404, r: 556 });
  });
  it("lets a side panel grow up to 400 design px, never narrower than approved", () => {
    expect(clamp({ l: 600, r: 556 }).l).toBe(600);
    expect(clamp({ l: 900, r: 556 }).l).toBe(804);                         // never more than 400 wider
    expect(clamp({ l: 320, r: 556 }).l).toBe(404);                         // a little inside: held at the approved width
  });
  it("collapses a side panel dragged well below its minimum", () => {
    expect(clamp({ l: 150, r: 556 }).l).toBe(0);
    expect(clamp({ l: 404, r: 200 }).r).toBe(0);
  });
  it("never squeezes the video column below 780", () => {
    const w = clamp({ l: 804, r: 956 });
    expect(2560 - w.l - w.r).toBeGreaterThanOrEqual(780);
  });
});
