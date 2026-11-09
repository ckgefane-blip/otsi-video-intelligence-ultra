/** B.19 (ADR-094): a spacer before a clip: its length (the worker counts the same frames, test_render_reel.py), its place on the timeline */
import { describe, expect, it } from "vitest";
import { ClipFx, gapUs, slotUs, type Reel } from "@otsi-vie/contracts";
import { locate, place } from "@/components/studio/useStudio";

const clip = (id: string, i: number, a: number, b: number, gap_ms = 0) => ({ id, sequence_index: i, in_pts_us: a, out_pts_us: b, origin: "MANUAL", label: null,
  effect: { kind: "NONE" as const, at_us: null, speed: 1, hold_ms: 0 }, fx: ClipFx.parse({ gap_ms }) });

describe("spacer", () => {
  it("is black time before its clip, counted in the reel's length", () => {
    expect(ClipFx.parse({}).gap_ms).toBe(0);
    expect(() => ClipFx.parse({ gap_ms: 10_001 })).toThrow();
    const c = clip("b", 1, 3e6, 5e6, 1000);
    expect(gapUs(c)).toBe(1e6);
    expect(slotUs(c)).toBe(3e6);
  });
  it("places the clip after its gap; the playhead in the gap is on that clip, showing black", () => {
    const reel = { clips: [clip("a", 0, 0, 2e6), clip("b", 1, 3e6, 5e6, 1000)] } as unknown as Reel;
    const { items, total } = place(reel);
    expect(items.map((p) => [p.start, p.dur, p.gap])).toEqual([[0, 2e6, 0], [3e6, 2e6, 1e6]]);
    expect(total).toBe(5e6);
    expect(locate(items, 2.5e6)).toMatchObject({ p: { index: 1 }, src: 3e6, gap: true });
    expect(locate(items, 3.5e6)).toMatchObject({ p: { index: 1 }, src: 3.5e6 });
    expect(locate(items, 3.5e6)?.gap).toBeUndefined();
  });
});

describe("rendered state", () => {
  it("a new spacer makes the clip differ from the last file", async () => {
    const { renderedState } = await import("@/components/studio/spotlight");
    const c = { id: "a", sequence_index: 0, in_pts_us: 0, out_pts_us: 2e6, fx: { zoom: [], drawings: [], gap_ms: 0 } };
    const reel = (gap_ms: number) => ({ clips: [{ ...c, fx: { ...c.fx, gap_ms } }], aspect: "16:9", settings: {}, stale: false,
      last_good_render: { config: { clips: [{ id: "a", in_pts_us: 0, out_pts_us: 2e6, fx: { zoom: [], drawings: [] } }], aspect: "16:9", settings: {} } } });
    expect(renderedState(reel(0)).clip("a")).toBe("RENDERED");
    expect(renderedState(reel(1000)).clip("a")).toBe("CHANGED");
  });
});
