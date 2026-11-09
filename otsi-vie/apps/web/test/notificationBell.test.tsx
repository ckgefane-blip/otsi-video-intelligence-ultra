/** v3 Phase A.15 (ADR-075): the header's notifications bell */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const auth = { value: { status: "signed-in", organization: { organization_id: "o1", role: "VIEWER" } } as Record<string, unknown> };
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.value }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => { const v = api(...a); return v === "fail" ? Promise.reject(new Error("down")) : v; } }));

import { bellBadge, NotificationBell } from "@/components/shell/NotificationBell";

const styles = { abs: "abs", bell: "bell", jobsCount: "count" };
const now = new Date().toISOString();
const LIST = {
  window_days: 14, seen_at: null, unread: 2, items: [
    { id: "comment:1", kind: "COMMENT", title: "Coach Ana commented through a share link", detail: "Bell Reel: “Nice”", at: now, href: "/exports", unread: true },
    { id: "run:1", kind: "JOB_DONE", title: "Analysis finished", detail: "Bell Match", at: now, href: "/processing?video=v1", unread: true },
    { id: "rights:1:ending", kind: "RIGHTS", title: "Rights end in 5 days", detail: "Bell Match · until 2026-11-11", at: now, href: "/exports", unread: false },
  ],
};

beforeEach(() => {
  api.mockReset();
  auth.value = { status: "signed-in", organization: { organization_id: "o1", role: "VIEWER" } };
});

describe("notifications bell", () => {
  it("badge: nothing when nothing is new, at most 9+", () => {
    expect([bellBadge(0), bellBadge(3), bellBadge(10)]).toEqual([null, "3", "9+"]);
  });

  it("shows the new count; opening lists them with their pages and marks them read", async () => {
    api.mockImplementation((url: string) => (url === "/v1/notifications/read" ? Promise.resolve({ seen_at: now }) : Promise.resolve(LIST)));
    render(<NotificationBell styles={styles} />);
    await waitFor(() => expect(document.querySelector("[data-notification-count]")).toHaveTextContent("2"));
    fireEvent.click(screen.getByRole("button", { name: "Notifications: 2 new" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/notifications/read", { method: "POST", json: {} }));
    const rows = [...document.querySelectorAll("[data-notification]")];
    expect(rows.map((r) => [r.getAttribute("data-notification"), r.getAttribute("href"), r.getAttribute("data-unread")])).toEqual([
      ["COMMENT", "/exports", "1"], ["JOB_DONE", "/processing?video=v1", "1"], ["RIGHTS", "/exports", "0"]]);
    expect(screen.getByText("Rights end in 5 days")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[data-notification-count]")).toBeNull());   // read: the number goes
  });

  it("says when there is nothing, and when the list cannot be read; nothing when signed out", async () => {
    api.mockReturnValue(Promise.resolve({ ...LIST, unread: 0, items: [] }));
    const { unmount } = render(<NotificationBell styles={styles} />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications: 0 new" }));
    expect(await screen.findByText("Nothing in the last 14 days.")).toBeInTheDocument();
    unmount();
    api.mockReset();
    api.mockReturnValue("fail");
    const r2 = render(<NotificationBell styles={styles} />);
    fireEvent.click(await screen.findByRole("button", { name: "Notifications: could not be read" }));
    expect(await screen.findByText(/could not be read\. Try again/)).toBeInTheDocument();
    r2.unmount();
    auth.value = { status: "signed-out", organization: null };
    const { container } = render(<NotificationBell styles={styles} />);
    expect(container).toBeEmptyDOMElement();
  });
});
