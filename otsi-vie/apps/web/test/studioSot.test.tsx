/**
 * Page 07 Clip Studio (SOT, Studio.dc.html) — the rebuild items from the user's audit (A17, A27, A28):
 * the ruler always reads 00:00…03:00 (even with no reel), V1 shows "No clips on the timeline yet" beside
 * the Intro segment, the bin's empty state reads "No clips loaded / Open a reel from the Reel Builder."
 * with no "Choose a reel to edit" button, A1's text is left-aligned with "Upload music" at the right end,
 * the inspector's Transition Out defaults to Fade, the lane labels are present and unclipped, and the
 * inspector tabs stay in one row.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Inspector } from "../src/components/studio/Inspector";
import { MediaBin } from "../src/components/studio/MediaBin";
import { Timeline } from "../src/components/studio/Timeline";
import type { Ui } from "../src/components/studio/kit";
import type { Studio } from "../src/components/studio/useStudio";

function stubStudio() {
  const st = {
    reel: null,
    items: [],
    total: 0,
    playhead: 0,
    setPlayhead: vi.fn(),
    notes: [],
    brand: null,
    orgTemplates: null,
    templates: null,
    setDrawTool: vi.fn(),
    split: vi.fn(),
    addNote: vi.fn(),
    remove: vi.fn(),
    trim: vi.fn(),
    reorder: vi.fn(),
    setSettings: vi.fn(),
    setTransition: vi.fn(),
  } as unknown as Studio;
  const ui = { say: vi.fn(), pick: vi.fn() } as Ui;
  return { st, ui };
}

describe("clip studio (SOT)", () => {
  it("the ruler always reads 00:00…03:00, even with no reel loaded", () => {
    const { st, ui } = stubStudio();
    render(<Timeline r={null} st={st} ui={ui} />);
    for (const tick of ["00:00", "00:30", "01:00", "01:30", "02:00", "02:30", "03:00"]) {
      expect(screen.getByText(tick)).toBeInTheDocument();
    }
  });

  it("V1 shows 'No clips on the timeline yet' beside the Intro, with unclipped lane labels", () => {
    const { st, ui } = stubStudio();
    render(<Timeline r={null} st={st} ui={ui} />);
    expect(screen.getByText("No clips on the timeline yet")).toBeInTheDocument();
    for (const label of ["V2 · Draw", "V1 · Video", "A1 · Music", "Beats"]) {
      const el = screen.getByText(label);
      expect(el.className).toContain("whitespace-nowrap");
      expect(el.className).toContain("pl-3");
    }
  });

  it("A1's text is left-aligned and takes the row, with 'Upload music' at the right end", () => {
    const { st, ui } = stubStudio();
    render(<Timeline r={null} st={st} ui={ui} />);
    const text = screen.getByText("No music. Upload a track.");
    expect(text.className).toContain("flex-1");
    expect(screen.getByRole("button", { name: "Upload music" })).toBeInTheDocument();
  });

  it("the bin's empty state reads 'No clips loaded / Open a reel from the Reel Builder.', with no reel-picker button", () => {
    const { st, ui } = stubStudio();
    render(<MediaBin r={null} st={st} say={ui.say} binTab={0} setBinTab={vi.fn()} />);
    expect(screen.getByText("No clips loaded")).toBeInTheDocument();
    expect(screen.getByText("Open a reel from the Reel Builder.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose a reel to edit" })).toBeNull();
    // the Profile intro line is "— · 16:9" with no reel (its parts are separate JSX text nodes)
    expect(screen.getByText((_c, el) => el?.textContent === "— · 16:9")).toBeInTheDocument();
  });

  it("the inspector's Transition Out defaults to Fade, and its tabs stay in one row", () => {
    const { st, ui } = stubStudio();
    render(<Inspector r={null} st={st} ui={ui} />);
    const out = screen.getByLabelText("Out") as HTMLSelectElement;
    expect(out.value).toBe("FADE");
    expect(out.options[0]?.textContent).toBe("Fade");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(tabs[0]?.closest("[role='tablist']")).toHaveStyle({ flexWrap: "nowrap" });
  });
});
