/** The desktop app's title bar with its menus (DesktopTitleBar; owner 2026-11-13). */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { DesktopTitleBar, runDesktopCommand, type DesktopMessage } from "@/components/shell/DesktopTitleBar";

afterEach(() => {
  delete (window as unknown as { otsiDesktop?: unknown }).otsiDesktop;
  document.documentElement.classList.remove("vie-desktop");
  push.mockReset();
});

function desktop() {
  let listener: ((c: DesktopMessage) => void) | null = null;
  const api = {
    openMenu: vi.fn(),
    setTitleBarColors: vi.fn(),
    onCommand: vi.fn((cb: (c: DesktopMessage) => void) => { listener = cb; return () => { listener = null; }; }),
  };
  (window as unknown as { otsiDesktop: typeof api }).otsiDesktop = api;
  return { api, send: (c: DesktopMessage) => act(() => listener?.(c)) };
}

describe("DesktopTitleBar", () => {
  it("shows nothing in a browser (no desktop bridge)", () => {
    const { container } = render(<DesktopTitleBar />);
    expect(container.innerHTML).toBe("");
    expect(document.documentElement.classList.contains("vie-desktop")).toBe(false);
  });

  it("in the desktop app: OTSI VIE and File, Edit, View, Go to, Help; a name opens its menu under it", () => {
    const { api } = desktop();
    render(<DesktopTitleBar />);
    expect(screen.getByText("OTSI VIE")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["File", "Edit", "View", "Go to", "Help"]);
    expect(document.documentElement.classList.contains("vie-desktop")).toBe(true);
    expect(api.setTitleBarColors).toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("menuitem", { name: "Go to" }));
    expect(api.openMenu).toHaveBeenCalledWith("go", expect.any(Number), expect.any(Number));
    expect(screen.getByRole("menuitem", { name: "Go to" })).toHaveAttribute("aria-expanded", "true");
  });

  it("carries out the menus' commands: go to a page without reloading, and the app's own shortcuts", () => {
    const { send } = desktop();
    render(<DesktopTitleBar />);
    send({ type: "navigate", route: "/library" });
    expect(push).toHaveBeenCalledWith("/library");
    const keys: string[] = [];
    const onKey = (e: KeyboardEvent) => { if (e.ctrlKey) keys.push(e.key); };
    window.addEventListener("keydown", onKey);
    send({ type: "shortcut", key: "k" });
    send({ type: "shortcut", key: "b" });
    window.removeEventListener("keydown", onKey);
    expect(keys).toEqual(["k", "b"]);
  });

  it("ignores a route that is not a page of this app", () => {
    runDesktopCommand({ type: "navigate", route: "https://example.com" }, push);
    expect(push).not.toHaveBeenCalled();
  });
});
