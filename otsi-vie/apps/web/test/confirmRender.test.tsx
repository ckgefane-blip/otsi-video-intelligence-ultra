/** v3 Phase B.13 (ADR-089): the confirmation before Generate Reel (summary, measured estimate) and its rules */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { estimateFrom, estimateLine, renderSummary, SpotlightSettings, type Reel, type RenderEstimate } from "@otsi-vie/contracts";

let reply: unknown = null;
const api = vi.fn(async (path: string) => (path.startsWith("/v1/brand-assets") ? [{ id: "0190a000-0000-7000-8000-0000000000aa", name: "Anthem" }] : reply));
vi.mock("@/lib/api", () => ({ api: (path: string) => api(path) }));

import { ConfirmRender } from "@/components/reelstage/ConfirmRender";

const settings = SpotlightSettings.parse({});
const reel = { id: "0190a000-0000-7000-8000-000000000001", version: 3, aspect: "9:16", duration_us: 75_000_000, clips: [{}, {}, {}],
  player: { player_id: "0190a000-0000-7000-8000-000000000002", display_name: "Ada Obi", canonical_otsi_id: "OTSI-NGA-2026-000001" } } as unknown as Reel;

describe("render estimate rules", () => {
  it("is unknown without a finished render, and uses the same Auto Track setting first", () => {
    expect(estimateFrom([], 60e6, true).seconds).toBeNull();
    const e = estimateFrom([{ elapsed_s: 60, output_s: 6, auto_track: true }, { elapsed_s: 6, output_s: 6, auto_track: false }, { elapsed_s: 180, output_s: 6, auto_track: true }], 12e6, true, 2);
    expect(e).toEqual({ basis: 2, same_tracking: true, per_second: 20, seconds: 240, low_seconds: 120, high_seconds: 360, waiting: 2 });
    expect(estimateLine(e)).toBe("About 4 min (2 min–6 min), from 2 finished renders. 2 renders are ahead of it.");
    expect(estimateFrom([{ elapsed_s: 6, output_s: 6, auto_track: false }], 30e6, true)).toMatchObject({ basis: 1, same_tracking: false, seconds: 30 });
    expect(estimateLine(estimateFrom([], 1, true))).toMatch(/^No estimate yet/);
  });
  it("summarises what the render holds", () => {
    const rows = Object.fromEntries(renderSummary(reel, { ...settings, score_bug: true, watermark: true }, "av1", null));
    expect(rows).toMatchObject({ Player: "Ada Obi · OTSI-NGA-2026-000001 (confirmed by a person)", Clips: "3 clips, 1 min 15 s", Frame: "9:16",
      Overlays: "player card, score & time", Branding: "watermark", Music: "None (match sound)", File: "AV1 MP4" });
  });
});

describe("ConfirmRender", () => {
  it("shows the summary and the measured estimate; nothing starts until Start render", async () => {
    reply = { basis: 1, same_tracking: true, per_second: 2, seconds: 150, low_seconds: 150, high_seconds: 150, waiting: 0 } satisfies RenderEstimate;
    const start = vi.fn(), close = vi.fn();
    render(<ConfirmRender reel={reel} settings={{ ...settings, music_id: "0190a000-0000-7000-8000-0000000000aa" }} codec="h264" dirty open onOpenChange={close} onStart={start} />);
    await waitFor(() => expect(document.querySelector("[data-estimate]")!.textContent).toBe("About 3 min, from 1 finished render."));
    expect(api).toHaveBeenCalledWith(`/v1/reels/${reel.id}/render-estimate`);
    await waitFor(() => expect(document.querySelector('[data-summary-row="Music"]')!.textContent).toBe("MusicAnthem"));
    expect(document.querySelector("[data-unsaved]")).not.toBeNull();
    expect(start).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Start render"));
    expect(start).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(false);
  });
});
