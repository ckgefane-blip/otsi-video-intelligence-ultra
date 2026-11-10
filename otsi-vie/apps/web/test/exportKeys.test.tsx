/** Export: [ / ] move between the export tabs, and a failed reels read is named (never shown as empty) with a retry */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/exports", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { ExportStage } from "@/components/exportstage/ExportStage";

// jsdom has no scrollIntoView; the tab jump calls it on the section it scrolls to
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

function mockApi(reels: unknown, fail = false) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/reels") return fail ? Promise.reject(new Error("down")) : Promise.resolve(reels);
    if (url === "/v1/exports/presets") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); push.mockReset(); });

async function open(reels: unknown = [], fail = false) {
  mockApi(reels, fail);
  render(<ExportStage />);
  await waitFor(() => expect(screen.getByRole("heading", { name: /Export Queue/ })).toBeInTheDocument());
}

describe("Export tab keys", () => {
  it("] moves to the next tab and [ back to the previous one", async () => {
    await open();
    fireEvent.keyDown(window, { key: "]" });
    await waitFor(() => expect(screen.getByLabelText("Branding")).toHaveAttribute("aria-pressed", "true"));
    fireEvent.keyDown(window, { key: "[" });
    await waitFor(() => expect(screen.getByLabelText("Export")).toHaveAttribute("aria-pressed", "true"));
  });

  it("does nothing at the first tab, and nothing while typing in a field", async () => {
    await open();
    fireEvent.keyDown(window, { key: "[" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText("Export")).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByLabelText("Message for recipients"), { key: "]" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText("Export")).toHaveAttribute("aria-pressed", "true");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("Export failed reels read", () => {
  it("names the failed queue read and retries it, instead of showing no jobs", async () => {
    await open([], true);
    await waitFor(() => expect(screen.getByText("The render queue could not be loaded.")).toBeInTheDocument());
    expect(screen.queryByText("No render jobs queued")).toBeNull();
    const reads = () => api.mock.calls.filter(([u]) => u === "/v1/reels").length;
    expect(reads()).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("names the failed picker read and retries it, instead of showing no reels", async () => {
    await open([], true);
    fireEvent.click(screen.getByRole("button", { name: "Open a reel to export" }));
    await waitFor(() => expect(screen.getByText("Reels could not be loaded.")).toBeInTheDocument());
    expect(screen.queryByText("No reels yet.")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(api.mock.calls.filter(([u]) => u === "/v1/reels").length).toBe(2));
  });

  it("still says there are no reels when the read succeeds with an empty list", async () => {
    await open([]);
    await waitFor(() => expect(screen.getByText("No render jobs queued")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open a reel to export" }));
    await waitFor(() => expect(screen.getByText("No reels yet.")).toBeInTheDocument());
  });
});
