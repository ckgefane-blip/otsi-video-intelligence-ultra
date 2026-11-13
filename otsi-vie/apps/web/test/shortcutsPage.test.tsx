/** Keyboard shortcuts page (SOT, Shortcuts.dc.html): the table the "?" modal shows, as a page — the top bar's "?" links here. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShortcutsPage } from "@/components/shell/ShortcutsPage";

describe("Shortcuts page", () => {
  it("renders the SOT's shortcut table: General, Analysis, Video players, Clip Studio", () => {
    render(<ShortcutsPage />);
    expect(screen.getByRole("heading", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Command palette")).toBeInTheDocument();
    expect(screen.getByText("Ctrl/Cmd K")).toBeInTheDocument();
    expect(screen.getByText("Jobs Center")).toBeInTheDocument();
    expect(screen.getByText("Close dialog or panel")).toBeInTheDocument();
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.getByText("Add marker")).toBeInTheDocument();
    expect(screen.getByText("Video players")).toBeInTheDocument();
    expect(screen.getByText("Play / pause")).toBeInTheDocument();
    expect(screen.getByText("Back / forward 1 second")).toBeInTheDocument();
    expect(screen.getByText("Fullscreen")).toBeInTheDocument();
    expect(screen.getByText("Clip Studio")).toBeInTheDocument();
    expect(screen.getByText("Mark in / out")).toBeInTheDocument();
    // Mark in / out is I and P (the SOT's keys; the Studio and Analysis use them).
    // "O" is only the Open local footage key now, so it appears once; "P" appears once
    expect(screen.getByText("I")).toBeInTheDocument();
    expect(screen.getAllByText("O")).toHaveLength(1);
    expect(screen.getAllByText("P")).toHaveLength(1);
  });
});
