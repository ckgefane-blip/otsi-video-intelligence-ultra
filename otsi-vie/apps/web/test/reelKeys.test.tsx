/** Reel Builder: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y undo and redo the reel, only while the page is open and never while typing */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }), usePathname: () => "/reels/abc", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { SpotlightSettings, type Reel, type ReelHistory } from "@otsi-vie/contracts";
import { ReelStage } from "@/components/reelstage/ReelStage";

// jsdom has no scrollIntoView; the stage jumps to the remembered step 300 ms after opening a reel
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

const id = "0190a000-0000-7000-8000-000000000001";
const reel = {
  id, name: "Test reel", video_id: "vid-1", version: 3, aspect: "16:9", duration_us: 0, clips: [],
  settings: SpotlightSettings.parse({}), player: null, targets: [], stale: false,
  latest_render: null, last_good_render: null, player_roster: null, match: null,
} as unknown as Reel;
const history = { entries: [], can_undo: true, can_redo: true, undo_label: "Trimmed a clip", redo_label: "Frame 4:5" } as unknown as ReelHistory;

function mockApi(hist: ReelHistory = history) {
  api.mockImplementation((url: string) => {
    if (url.endsWith("/history/undo") || url.endsWith("/history/redo")) return Promise.resolve(reel);
    if (url.endsWith("/history")) return Promise.resolve(hist);
    if (url.endsWith("/moments")) return Promise.resolve([]);
    if (url === `/v1/reels/${id}`) return Promise.resolve(reel);
    if (url === "/v1/videos/vid-1") return Promise.resolve({ id: "vid-1", match_id: null });
    if (url === "/v1/videos/vid-1/playback") return Promise.resolve({ url: "https://example.com/v.mp4" });
    if (url === `/v1/reels/${id}/path`) return Promise.resolve({ points: [] });
    if (url.startsWith("/v1/brand-assets")) return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { localStorage.clear(); api.mockReset(); replace.mockReset(); });

async function open() {
  mockApi();
  render(<ReelStage reelId={id} />);
  await waitFor(() => expect(screen.getByLabelText("Undo: Trimmed a clip")).not.toBeDisabled());
}

describe("Reel Builder undo / redo keys", () => {
  it("Ctrl+Z undoes, Ctrl+Shift+Z and Ctrl+Y redo", async () => {
    await open();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/reels/${id}/history/undo`, expect.objectContaining({ method: "POST" })));
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/reels/${id}/history/redo`, expect.objectContaining({ method: "POST" })));
    fireEvent.keyDown(window, { key: "y", ctrlKey: true });
    await waitFor(() => expect(api.mock.calls.filter(([u]) => String(u).endsWith("/history/redo"))).toHaveLength(2));   // each redo is followed by a reload of reel, moments, history
  });

  it("does nothing while typing in a field", async () => {
    await open();
    api.mockClear();
    // the player's speed select is a field: Ctrl+Z there must not undo the reel
    fireEvent.keyDown(screen.getByLabelText("Playback speed"), { key: "z", ctrlKey: true });
    fireEvent.keyDown(screen.getByLabelText("Playback speed"), { key: "Z", ctrlKey: true, shiftKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(api).not.toHaveBeenCalled();
  });

  it("does nothing when there is nothing to undo or redo", async () => {
    mockApi({ entries: [], can_undo: false, can_redo: false, undo_label: null, redo_label: null } as unknown as ReelHistory);
    render(<ReelStage reelId={id} />);
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/reels/${id}/history`));
    api.mockClear();
    fireEvent.keyDown(window, { key: "z", ctrlKey: true });
    fireEvent.keyDown(window, { key: "Z", ctrlKey: true, shiftKey: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(api).not.toHaveBeenCalled();
  });
});
