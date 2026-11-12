/** Reel Builder (SOT, Page 20): the settings sidebar, the summary + budget bar, the Sequence with the Profile Intro fixed first,
 *  and the Clip inspector */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/reels/abc", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { SpotlightSettings, type Reel, type ReelHistory } from "@otsi-vie/contracts";
import { ReelStage } from "@/components/reelstage/ReelStage";

if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

const PLAYER_ID = "0193132e-5034-7bc3-9565-df048bb01001";
const ID = "0190a000-0000-7000-8000-000000000001";
const player = { player_id: PLAYER_ID, display_name: "Chinazom Godwin", canonical_otsi_id: "OTSI-NGA-2026-000001" };
const history = { entries: [], can_undo: true, can_redo: true, undo_label: "Trimmed a clip", redo_label: "Frame 4:5" } as unknown as ReelHistory;
const clip = {
  id: "clip-1", source_video_id: "vid-1", in_pts_us: 5_000_000, out_pts_us: 13_000_000,
  label: "Goal", origin: "SUGGESTED", sequence_index: 0, effect_kind: "NONE",
};
const reel = {
  id: ID, name: "Chinazom Godwin — highlights", video_id: "vid-1", source: "MATCH", version: 3, aspect: "16:9",
  duration_us: 8_000_000, clips: [clip], settings: SpotlightSettings.parse({}), player, targets: [], stale: false,
  latest_render: null, last_good_render: null, player_roster: null, match: null,
} as unknown as Reel;

function mockApi(r: Reel = reel, moments: unknown = []) {
  api.mockImplementation((url: string, init?: { method?: string; json?: unknown }) => {
    if (url === `/v1/reels/${r.id}`) return Promise.resolve(r);
    if (url === `/v1/reels/${r.id}/moments`) return Promise.resolve(moments);
    if (url === `/v1/reels/${r.id}/history`) return Promise.resolve(history);
    if (url === `/v1/reels/${r.id}/history/undo` || url === `/v1/reels/${r.id}/history/redo`) return Promise.resolve(r);
    if (url === "/v1/reels") return Promise.resolve([r]);
    if (url === "/v1/videos/vid-1") return Promise.resolve({ id: "vid-1", match_id: null });
    if (url === "/v1/videos/vid-1/playback") return Promise.resolve({ url: "" });
    if (url === `/v1/reels/${r.id}/path`) return Promise.resolve({ points: [] });
    if (url.startsWith("/v1/brand-assets")) return Promise.resolve([]);
    if (url.startsWith(`/v1/reels/${r.id}/clips`)) return Promise.resolve(r);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api.mockReset(); push.mockReset(); replace.mockReset(); });

async function open(r: Reel = reel, moments: unknown = []) {
  mockApi(r, moments);
  render(<ReelStage reelId={r.id} />);
  await waitFor(() => expect(screen.getByLabelText("Undo: Trimmed a clip")).not.toBeDisabled());
}

describe("Reel Builder (SOT)", () => {
  it("shows the settings sidebar, the header, the summary and the budget bar", async () => {
    await open();
    expect(screen.getByText("Reel settings")).toBeInTheDocument();
    expect(screen.getByText("Best Moment Rule v2.1")).toBeInTheDocument();
    expect(screen.getByText("Moments from")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "This match" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Length")).toBeInTheDocument();
    expect(screen.getByText("Never over 5 min")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3 minutes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("cap 4 / match")).toBeInTheDocument();
    expect(screen.getByText("Clips per match, by length. Tier S is exempt.")).toBeInTheDocument();
    expect(screen.getByText("Tier legend")).toBeInTheDocument();
    expect(screen.getByText("Goal/Assist")).toBeInTheDocument();
    expect(screen.getByText("Shot on target/Key pass/Penalty won/Goal-saving tackle/Save")).toBeInTheDocument();
    expect(screen.getByText("Higher tiers first. Nearby actions merge into one clip.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Build reel/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Reel Builder" })).toBeInTheDocument();
    expect(screen.getByText("Chinazom Godwin · 1 reel generated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Export reel" })).toHaveAttribute("href", "/exports?reel=" + ID);
    expect(screen.getByText("Chinazom Godwin — highlights")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play in Library" })).toHaveAttribute("href", "/library");
    expect(screen.getByRole("link", { name: "Open in Clip Studio" })).toHaveAttribute("href", "/studio?reel=" + ID);
    expect(screen.getByText("Budget")).toBeInTheDocument();
    expect(screen.getByText("0:08")).toBeInTheDocument();
    expect(screen.getByText("3:00 target")).toBeInTheDocument();
    expect(screen.getByText("5:00 cap — never exceeded")).toBeInTheDocument();
  });

  it("the length seg switches the per-match cap and the budget target", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "90 seconds" }));
    expect(screen.getByText("1:30 target")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "5 minutes" }));
    expect(screen.getByText("5:00 target")).toBeInTheDocument();
  });

  it("the Sequence shows the Profile Intro fixed first and the clip, and selecting it fills the Clip inspector", async () => {
    await open();
    const seq = screen.getByLabelText("Sequence");
    expect(within(seq).getByText("Profile Intro")).toBeInTheDocument();
    expect(within(seq).getByText("16:9 · always first")).toBeInTheDocument();
    expect(within(seq).getByText("Goal")).toBeInTheDocument();
    expect(screen.getByText("No clip selected")).toBeInTheDocument();
    expect(screen.getByText("Trim it or open it in Clip Studio.")).toBeInTheDocument();
    fireEvent.click(within(seq).getByRole("button", { name: /1\. Goal/ }));
    const insp = screen.getByLabelText("Clip");
    expect(within(insp).getByText("1. Goal")).toBeInTheDocument();
    expect(within(insp).getByLabelText("Clip 1 in (s)")).toHaveValue("5.0");
    expect(within(insp).getByLabelText("Clip 1 out (s)")).toHaveValue("13.0");
    expect(within(insp).getByRole("button", { name: "Trim" })).toBeInTheDocument();
    expect(within(insp).getByRole("button", { name: "Remove clip" })).toBeInTheDocument();
  });

  it("with no clips the Sequence shows the ranked-moments empty state", async () => {
    const empty = { ...reel, clips: [], duration_us: 0 } as unknown as Reel;
    await open(empty, []);
    const seq = screen.getByLabelText("Sequence");
    expect(within(seq).getByText("No ranked moments in this view")).toBeInTheDocument();
    expect(within(seq).getByText("Tier S empty (0 goals, 0 assists). Build to rank 0 events.")).toBeInTheDocument();
  });

  it("Build reel opens the render confirmation", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: /Build reel/ }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Render this reel?" })).toBeInTheDocument());
  });

  it("without a reel the same page shows the full builder with the empty state, not a bare list", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/reels") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<ReelStage />);
    // the SOT's three columns are there even with nothing loaded (like Filmora/DaVinci): the settings sidebar,
    // the preview, and the Clip inspector — with the empty state inside the preview (title + the line below it),
    // not a bare "No reels yet" page
    expect(await screen.findByText("Reel settings")).toBeInTheDocument();
    expect(screen.getByText("No clip selected")).toBeInTheDocument();
    expect(screen.getAllByText(/No reel yet/)).toHaveLength(2);
    expect(screen.queryByText("No reels yet.")).toBeNull();
  });

  it("without a reel id it opens the first reel on its own", async () => {
    mockApi();
    render(<ReelStage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith(`/reels/${reel.id}`));
  });
});
