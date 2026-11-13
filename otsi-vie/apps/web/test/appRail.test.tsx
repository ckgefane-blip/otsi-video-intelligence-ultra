/** The rail (SOT rebuild 2026-11-13): the SOT's labels and order, fixed 240 / 64 px widths, the per-page collapsed default,
 *  Settings to Preferences, Admin always shown. */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const path = { value: "/dashboard" };
vi.mock("next/navigation", () => ({ usePathname: () => path.value }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { AppRail, RAIL_STORAGE_KEY } from "@/components/shell/AppRail";

beforeEach(() => { localStorage.clear(); path.value = "/dashboard"; });

const navLabels = () => within(screen.getByRole("navigation")).getAllByRole("link").map((l) => l.textContent);

describe("rail (SOT)", () => {
  it("shows the SOT's eleven destinations in the SOT's order", () => {
    render(<AppRail />);
    expect(navLabels()).toEqual(["Home", "Media", "Processing", "Analysis", "Tactical", "Players", "Reports", "Reels", "Clip Studio", "Library", "Export"]);
  });

  it("is 240 px expanded by default on Home, and the footer links Settings to Preferences with Admin always shown", () => {
    render(<AppRail />);
    const rail = screen.getByRole("complementary", { name: "Main" });
    expect(rail).toHaveAttribute("data-rail", "expanded");
    expect(rail.getAttribute("style")).toContain("width: 240px");
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute("href", "/settings/preferences");
    expect(screen.getByRole("link", { name: "Admin" })).toHaveAttribute("href", "/settings/admin");
  });

  it("is open (240 px, labels) on every page by default, including the five work pages (owner 2026-11-13)", () => {
    for (const p of ["/dashboard", "/analysis", "/tactics", "/reels", "/studio", "/library", "/export"]) {
      path.value = p;
      const { unmount } = render(<AppRail />);
      const rail = screen.getByRole("complementary", { name: "Main" });
      expect(rail, p).toHaveAttribute("data-rail", "expanded");
      expect(rail.getAttribute("style"), p).toContain("width: 240px");
      unmount();
    }
  });

  it("the Collapse toggle switches between 240 and 64 and remembers the choice", () => {
    render(<AppRail />);
    const rail = screen.getByRole("complementary", { name: "Main" });
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    expect(rail).toHaveAttribute("data-rail", "collapsed");
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("64");
    fireEvent.click(screen.getByRole("button", { name: "Expand navigation" }));
    expect(rail).toHaveAttribute("data-rail", "expanded");
    expect(localStorage.getItem(RAIL_STORAGE_KEY)).toBe("240");
  });

  it("one choice holds on every page: no page collapses or expands it by itself", () => {
    const home = render(<AppRail />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    home.unmount();
    for (const p of ["/analysis", "/players", "/library"]) {
      path.value = p;
      const { unmount } = render(<AppRail />);
      expect(screen.getByRole("complementary", { name: "Main" }), p).toHaveAttribute("data-rail", "collapsed");
      unmount();
    }
    localStorage.setItem(RAIL_STORAGE_KEY, "240");
    path.value = "/studio";
    render(<AppRail />);
    expect(screen.getByRole("complementary", { name: "Main" })).toHaveAttribute("data-rail", "expanded");
  });

  it("has no resize handle", () => {
    render(<AppRail />);
    expect(document.querySelector('[role="separator"]')).toBeNull();
  });
});
