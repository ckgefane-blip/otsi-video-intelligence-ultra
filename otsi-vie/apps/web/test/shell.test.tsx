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
  const player = {
    player_id: "01a199aa-08fd-740d-93a3-a27fec2d7a8b", display_name: "Chinazom Godwin", canonical_otsi_id: "OTSI-NGA-2026-000001",
    profile: {
      birth_date: null, age: 20, preferred_foot: "RIGHT", nationality: { code: "NGA", name: "Nigeria" }, position: "DM",
      role_confirmed: true, role_confirmation_state: "ROLE_CONFIRMED", role_confirmed_by: null, role_confirmed_at: null,
      latest_team: { team: "FC Ercakhu", jersey_number: 4, position: "DM" }, details: null, editable: true,
    },
  };
  const video = {
    id: "02b199aa-08fd-740d-93a3-a27fec2d7a8c", title: "Nart v Ercakhu – round 2", original_filename: "nart.mp4",
    analysis: { run_id: "03c199aa-08fd-740d-93a3-a27fec2d7a8d", status: "SUCCEEDED", progress: 100, stage_message: null },
  };
  // 13 passes + 8 ball won + 6 pressures + 51 set pieces = 78 events
  const events78 = {
    state: "READY", passes: Array(13).fill({}), changes: Array(8).fill({}), shots: [],
    pressures: Array(6).fill({}), set_pieces: Array(51).fill({}), goals: [],
  };
  const mockLists = () => api.mockImplementation((url: unknown) => {
    if (url === "/v1/player-list") return Promise.resolve([player]);
    if (url === "/v1/videos") return Promise.resolve([video]);
    if (typeof url === "string" && url.endsWith("/events")) return Promise.resolve(events78);
    return Promise.reject(new Error(`unexpected ${String(url)}`));
  });
  const openPalette = async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    return screen.getByRole("combobox", { name: "Search" });
  };

  it("opens with Ctrl+K: the players, matches and actions (SOT, Page 8)", async () => {
    mockLists();
    const input = await openPalette();
    expect(await screen.findByText("Chinazom Godwin")).toBeInTheDocument();
    expect(screen.getByText("#4 · DM · FC Ercakhu")).toBeInTheDocument();
    expect(screen.getByText("Nart v Ercakhu – round 2")).toBeInTheDocument();
    expect(await screen.findByText("78 events")).toBeInTheDocument();
    // "Players" and "Matches" each appear twice: the section heading and the action row of the same name
    expect(screen.getAllByText("Players")).toHaveLength(2);
    expect(screen.getAllByText("Matches")).toHaveLength(2);
    expect(screen.getByText("Actions")).toBeInTheDocument();
    // a Viewer: Players, Matches, Token Wallet, Show keyboard shortcuts, Security, Open Jobs Center (no Upload, no Team)
    expect(screen.queryByText("Upload a match video")).toBeNull();
    expect(screen.getByText("Open Jobs Center · pause or resume jobs")).toBeInTheDocument();
    expect(screen.getByText("Show keyboard shortcuts")).toBeInTheDocument();
    // the SOT's palette has no Pages group
    expect(screen.queryByText("Home")).toBeNull();
    expect(input).toHaveAttribute("placeholder", "Search a player, a match or an action");
  });

  it("filters players, matches and actions as you type; Enter opens the first", async () => {
    mockLists();
    const input = await openPalette();
    await screen.findByText("Chinazom Godwin");
    fireEvent.change(input, { target: { value: "jobs" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Open Jobs Center · pause or resume jobs")).toBeInTheDocument();
    expect(screen.queryByText("Chinazom Godwin")).toBeNull();
    fireEvent.change(input, { target: { value: "chinazom" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByText("Chinazom Godwin")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(push).toHaveBeenCalledWith("/reports/players/OTSI-NGA-2026-000001");
  });

  it("says when the lists cannot be reached; actions still work", async () => {
    api.mockRejectedValue(new Error("down"));
    await openPalette();
    expect(await screen.findByText(/could not be reached/)).toBeInTheDocument();
    expect(screen.getByText("Open Jobs Center · pause or resume jobs")).toBeInTheDocument();
  });

  it("Tab switches to the Assistant", async () => {
    mockLists();
    const input = await openPalette();
    await screen.findByText("Chinazom Godwin");
    fireEvent.keyDown(input, { key: "Tab" });
    expect(screen.getByText("Assistant")).toBeInTheDocument();
  });
});

describe("keyboard map (A.9, SOT)", () => {
  it("opens with ?, not while typing; shows the SOT's four groups and only real shortcuts; the palette's command opens it too", () => {
    render(<><KeyboardMap /><input aria-label="field" /></>);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "?" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(window, { key: "?" });
    const d = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    for (const g of ["General", "Analysis", "Video players", "Clip Studio"]) expect(d).toHaveTextContent(g);
    expect(d).toHaveTextContent("Command palette");
    expect(d).toHaveTextContent("Ctrl/Cmd K");
    expect(d).toHaveTextContent("Collapse or expand the rail");
    expect(d).toHaveTextContent("Ctrl/Cmd B");
    expect(d).toHaveTextContent("Jobs Center");
    expect(d).toHaveTextContent("Ctrl/Cmd J");
    expect(d).toHaveTextContent("Close dialog or panel");
    expect(d).toHaveTextContent("Add marker");
    expect(d).toHaveTextContent("Play / pause");
    expect(d).toHaveTextContent("Back / forward 1 second");
    expect(d).toHaveTextContent("Fullscreen");
    expect(d).toHaveTextContent("Mark in / out");
    // the SOT's rows that are not wired in the engine are left out, not shown as working keys
    expect(d).not.toHaveTextContent("Confirm identity");
    expect(d).not.toHaveTextContent("Correct identity");
    expect(d).not.toHaveTextContent("Reject identity");
    expect(d).not.toHaveTextContent("Back / forward 1 frame");
    expect(d).not.toHaveTextContent("Slower / faster");
    expect(d).not.toHaveTextContent("Open local footage");
    expect(d).not.toHaveTextContent("Blade tool");
    expect(d).not.toHaveTextContent("Select tool");
    fireEvent.keyDown(d, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the palette's Show keyboard shortcuts command opens the map", () => {
    api.mockImplementation(() => Promise.resolve([]));
    render(<><CommandPalette /><KeyboardMap /></>);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), { target: { value: "keyboard" } });
    fireEvent.click(screen.getByText("Show keyboard shortcuts"));
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
