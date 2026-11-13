/** v3 Phase A.15 (ADR-075), SOT rebuild 2026-11-13: the header's notifications bell is the SOT's plain button — aria
 *  "Notifications", the bell glyph, no badge, no menu, no dialog. */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const auth = { value: { status: "signed-in", organization: { organization_id: "o1", role: "VIEWER" } } as Record<string, unknown> };
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.value }));

import { NotificationBell } from "@/components/shell/NotificationBell";

const styles = { abs: "abs", bell: "bell", jobsCount: "count" };

beforeEach(() => {
  auth.value = { status: "signed-in", organization: { organization_id: "o1", role: "VIEWER" } };
});

describe("notifications bell (SOT)", () => {
  it("is a plain button with no badge and no menu", () => {
    render(<NotificationBell styles={styles} />);
    const bell = screen.getByRole("button", { name: "Notifications" });
    expect(bell).toHaveAttribute("data-notification-bell");
    expect(document.querySelector("[data-notification-count]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders nothing when signed out", () => {
    auth.value = { status: "signed-out", organization: null };
    const { container } = render(<NotificationBell styles={styles} />);
    expect(container).toBeEmptyDOMElement();
  });
});
