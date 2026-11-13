/** Player reports: [ / ] move between the SOT's tabs, only while the page is open and never while typing */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/reports", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { ReportStage } from "@/components/playerreport/ReportStage";

const id = "0190a000-0000-7000-8000-000000000002";

function mockApi() {
  api.mockImplementation((url: string) => {
    if (url === `/v1/players/${id}`) return Promise.resolve({ player_id: id, display_name: "Test Player", canonical_otsi_id: null, canonical_state: "PROVISIONAL", identity_label: "Test Player" });
    if (url === `/v1/players/${id}/measures`) return Promise.resolve({ tracks: 0, seen_s: 0, measured_s: 0, videos: 0, distance_m: null, top_speed_kmh: null, sprint_m: null, sprints: 0, high_speed_m: 0, dropped_steps: 0, events: null, halves: { confirmed: 0, proposed: 0 }, heat: null });
    if (url === `/v1/players/${id}/profile`) return Promise.resolve({ latest_team: null, preferred_foot: null, position: null, nationality: null, age: null });
    if (url === `/v1/players/${id}/assessment`) return Promise.resolve({ published: null, draft: null, published_by_name: null, published_at: null, unpublished_changes: false, can_write: true, version: 1 });
    if (url === `/v1/players/${id}/events`) return Promise.resolve({ items: [], videos: 0, length_m: 105, width_m: 68 });
    if (url === "/v1/reels") return Promise.resolve([]);
    if (url === `/v1/players/${id}/ai-analysis/status`) return Promise.resolve({ configured: false });
    if (url === `/v1/players/${id}/ai-analysis`) return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); push.mockReset(); });

async function open() {
  mockApi();
  render(<ReportStage playerRef={id} />);
  await waitFor(() => expect(screen.getByRole("heading", { name: "Test Player" })).toBeInTheDocument());
}

describe("Player reports section keys", () => {
  it("] moves to the next tab and [ back to the previous one", async () => {
    await open();
    fireEvent.keyDown(window, { key: "]" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Attacking" })).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(window, { key: "[" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true"));
  });

  it("does nothing at the first tab, and nothing while typing in a field", async () => {
    await open();
    fireEvent.keyDown(window, { key: "[" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByLabelText("Add a note about this player"), { key: "]" });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(push).not.toHaveBeenCalled();
  });
});
