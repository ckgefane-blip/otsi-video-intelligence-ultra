/** Page 07: clips sit back to back in timeline order, and a reel time maps to the right clip and source timestamp. */
import type { Reel } from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";
import { locate, place } from "@/components/studio/useStudio";

const clip = (id: string, seq: number, a: number, b: number) =>
  ({ id: `00000000-0000-4000-8000-00000000000${id}`, sequence_index: seq, in_pts_us: a, out_pts_us: b, origin: "MANUAL" as const, label: null });
const reel = { clips: [clip("2", 2, 50_000_000, 53_000_000), clip("1", 1, 10_000_000, 15_000_000)] } as unknown as Reel;

describe("studio timeline", () => {
  it("places clips in sequence order, back to back", () => {
    const { items, total } = place(reel);
    expect(items.map((p) => [p.start, p.dur, p.index])).toEqual([[0, 5_000_000, 0], [5_000_000, 3_000_000, 1]]);
    expect(total).toBe(8_000_000);
    expect(place(null)).toEqual({ items: [], total: 0 });
  });

  it("maps reel time to the clip under it and its source time; the end maps to the last out point", () => {
    const { items } = place(reel);
    expect(locate(items, 1_000_000)).toMatchObject({ src: 11_000_000, p: { index: 0 } });
    expect(locate(items, 5_000_000)).toMatchObject({ src: 50_000_000, p: { index: 1 } });
    expect(locate(items, 8_000_000)).toMatchObject({ src: 53_000_000, p: { index: 1 } });
    expect(locate([], 0)).toBeNull();
  });
});
