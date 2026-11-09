/** Shell components in jsdom: theme toggle persistence, the page palette, section cards that never show sample data. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/dashboard", useSearchParams: () => new URLSearchParams() }));
const role = { value: "VIEWER" };
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: role.value } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a) }));

import { CommandPalette } from "@/components/shell/CommandPalette";
import { KeyboardMap } from "@/components/shell/KeyboardMap";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { SectionCard } from "@/components/page/SectionCard";
import { THEME_STORAGE_KEY } from "@/lib/theme";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.dataset.theme = "dark";
  push.mockReset();
  api.mockReset();
  role.value = "VIEWER";
});

describe("theme toggle", () => {
  it("switches theme and remembers it", () => {
    render(<ThemeToggle />);
    const sw = screen.getByRole("switch", { name: "Dark theme" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    fireEvent.click(sw);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(sw).toHaveAttribute("aria-checked", "false");
  });
});

describe("command palette", () => {
  it("opens with Ctrl+K: the role's commands and the pages; filters them and navigates with Enter", () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Search" });
    expect(screen.getAllByRole("option")).toHaveLength(4 + 10);          // a Viewer: Players, Matches, Keyboard shortcuts, Security (no Upload, no Team) + 10 pages
    expect(screen.queryByText("Upload a video")).toBeNull();
    fireEvent.change(input, { target: { value: "clip" } });
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([expect.stringContaining("Clip Studio"), expect.stringContaining("Search the Library for")]);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/studio");
  });

  it("asks the API from 2 letters and opens a hit on its page", async () => {
    role.value = "OWNER";
    const id = "01a199aa-08fd-740d-93a3-a27fec2d7a8b";
    api.mockResolvedValue({ q: "ada", hits: [{ kind: "PLAYER", id, title: "Ada Obi", detail: "OTSI-NGA-2026-000001", ref: "OTSI-NGA-2026-000001" }] });
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "a" } });
    expect(screen.getByText(/Type 2 or more letters/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "ada" } });
    expect(await screen.findByText("Ada Obi")).toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api).toHaveBeenCalledWith("/v1/search?q=ada");
    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText(/1 recorded item match/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Ada Obi"));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/reports/players/OTSI-NGA-2026-000001"));
  });

  it("says when the search cannot be reached; pages still work", async () => {
    api.mockRejectedValue(new Error("down"));
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "home" } });
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toContainEqual(expect.stringContaining("Home"));
  });
});

describe("keyboard map (A.9)", () => {
  it("opens with ?, not while typing; finds a key; the palette's command opens it too", () => {
    render(<><KeyboardMap /><input aria-label="field" /></>);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "?" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "?" });
    const d = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect([...d.querySelectorAll("[data-keymap-scope]")].map((x) => x.getAttribute("data-keymap-scope"))).toEqual(["everywhere", "studio", "analysis"]);
    fireEvent.change(screen.getByLabelText("Find a shortcut"), { target: { value: "n" } });
    expect([...d.querySelectorAll("kbd")].map((x) => x.textContent)).toEqual(["N"]);
    fireEvent.keyDown(d, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the palette's Keyboard shortcuts command opens the map", () => {
    render(<><CommandPalette /><KeyboardMap /></>);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "keyboard" } });
    fireEvent.click(screen.getByText("Keyboard shortcuts"));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

describe("section card", () => {
  it("states that an unconnected section has no data yet and shows its contract", () => {
    render(
      <SectionCard pageId={4} area="s3" state={{ kind: "planned", block: 4 }}
        section={{ n: 3, title: "Video player and score HUD", summary: "Large match footage.", contract: "GET /media/:id/playback; GET /matches/:id/clock-map" }} />,
    );
    const card = screen.getByRole("region", { name: "Video player and score HUD" });
    expect(card).toHaveAttribute("data-state", "planned");
    expect(card).toHaveTextContent("Not connected · Block 04");
    expect(card).toHaveTextContent("No sample values are shown");
    expect(screen.getAllByRole("listitem").map((l) => l.textContent)).toEqual(["GET /media/:id/playback", "GET /matches/:id/clock-map"]);
  });
});
