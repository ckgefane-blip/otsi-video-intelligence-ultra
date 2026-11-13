/**
 * Blueprint §2.3: dual timeline snapshot-and-swap keyboard control — B snapshots the active cut as
 * Cut B, Shift+B applies Cut B to the active reel. The keys only live while the panel is open.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DualTimeline } from "../src/components/studio/DualTimeline";
import type { Ui } from "../src/components/studio/kit";
import type { Studio } from "../src/components/studio/useStudio";

const clip = (id: string, inUs: number, outUs: number) => ({
  id, in_pts_us: inUs, out_pts_us: outUs, label: `Clip ${id}`, fx: { gap_ms: 0 },
});

function stub(items: ReturnType<typeof clip>[] = [clip("c1", 0, 10_000_000)]) {
  const trim = vi.fn();
  const reorder = vi.fn();
  const say = vi.fn();
  const st = {
    items: items.map((c, i) => ({ clip: c, start: 0, dur: c.out_pts_us - c.in_pts_us, index: i, gap: 0 })),
    playhead: 0,
    reel: { id: "reel-1" },
    trim,
    reorder,
  } as unknown as Studio;
  const ui = { say, pick: vi.fn() } as Ui;
  return { st, ui, trim, reorder, say };
}

describe("dual timeline keyboard control", () => {
  it("starts from a baseline reference, and B snapshots the active cut", () => {
    const { st, ui } = stub();
    render(<DualTimeline st={st} ui={ui} onClose={() => {}} />);
    expect(screen.getByText(/Baseline reference/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "b" });
    expect(screen.getByText(/Current snapshot/)).toBeTruthy();
    expect(ui.say).toHaveBeenCalledWith("Captured current timeline as reference Cut B");
  });

  it("Shift+B applies Cut B: the trimmed clip is restored to its reference in/out", () => {
    const { st, ui } = stub();
    const { rerender } = render(<DualTimeline st={st} ui={ui} onClose={() => {}} />);
    expect(screen.getByText(/Baseline reference/)).toBeTruthy();

    // the active cut is trimmed after the snapshot was taken
    const trimmed = stub([clip("c1", 0, 5_000_000)]);
    rerender(<DualTimeline st={trimmed.st} ui={ui} onClose={() => {}} />);

    fireEvent.keyDown(window, { key: "B", shiftKey: true });
    expect(trimmed.trim).toHaveBeenCalledWith(trimmed.st.items[0]!.clip, 0, 10_000_000);
    expect(trimmed.reorder).toHaveBeenCalledWith(["c1"]);
  });

  it("does nothing while typing in a field", () => {
    const { st, ui, say } = stub();
    render(<><input data-testid="field" /><DualTimeline st={st} ui={ui} onClose={() => {}} /></>);
    fireEvent.keyDown(screen.getByTestId("field"), { key: "b" });
    expect(screen.getByText(/Baseline reference/)).toBeTruthy();
    expect(say).not.toHaveBeenCalled();
  });
});
