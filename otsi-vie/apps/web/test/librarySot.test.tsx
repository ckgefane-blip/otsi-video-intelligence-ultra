/** SOT rebuild page 14 (alphabetical), Library: the three-column SOT layout — the left panel (Match + overlays + team + time),
 * the centre (header, the selected video, search and the items table) and the right inspector (Collections + Folders + Smart bins). */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LibraryStage } from "@/components/library/LibraryStage";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api, ApiProblem: class ApiProblem extends Error { constructor(public code: string, msg: string) { super(msg); } } }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: vi.fn() }), usePathname: () => "/library" }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { organization_id: "org-1", role: "OWNER" }, me: { user: { id: "u1" } } }) }));
vi.mock("@/lib/currentVideo", () => ({ recallVideo: () => null }));
vi.mock("@/components/media/VideoPlayer", () => ({ VideoPlayer: ({ empty }: { empty?: { title: string; body: string } }) => <div data-testid="player">{empty?.title ?? ""}</div> }));

const MATCH = {
  id: "11111111-1111-4111-8111-111111111111", competition: "Abkhazia Premier League", season: null, kickoff_at: null, venue: null,
  home: { id: "h1", name: "Nart", short_name: "Nart" }, away: { id: "a1", name: "Ercakhu", short_name: "Ercakhu" },
  home_score: null, away_score: null, version: 1, video_ids: ["22222222-2222-4222-8222-222222222222"], roster: [],
};
const REEL = {
  id: "55555555-5555-4555-8555-555555555555", name: "Chinazom Godwin — highlights", video_id: "22222222-2222-4222-8222-222222222222",
  player: { display_name: "Chinazom Godwin" }, clips: new Array(58).fill({}), duration_us: 597200000, created_at: "2026-11-10T00:00:00Z",
  updated_at: "2026-11-10T00:00:00Z", last_good_render: { id: "r1", has_output: true }, latest_render: null, created_by: null,
  aspect: "16:9", formats: [],
};
const PLAYER = {
  player_id: "44444444-4444-4444-8444-444444444444", display_name: "Chinazom Godwin", canonical_otsi_id: "OTSI-NGA-2026-000001",
  profile: { position: "DM", latest_team: { jersey_number: 4, position: "DM", team: "FC Ercakhu" } },
};
const EVENTS = { video_id: "22222222-2222-4222-8222-222222222222", state: "READY", ball_track_id: null, match_time: true, counted_s: 0, possession_known_s: 0,
  teams: [], passes: [{ from_player_id: "44444444-4444-4444-8444-444444444444", to_player_id: null }, ...new Array(12).fill({})], changes: new Array(8).fill({}), shots: [], pressures: new Array(6).fill({}), set_pieces: new Array(51).fill({}), goals: [], rejected_events_count: 0 };

api.mockImplementation((path: string) => {
  if (path === "/v1/reels") return Promise.resolve([REEL]);
  if (path === "/v1/matches") return Promise.resolve([MATCH]);
  if (path === "/v1/projects") return Promise.resolve([]);
  if (path === "/v1/videos") return Promise.resolve([]);
  if (path === "/v1/library/folders") return Promise.resolve([]);
  if (path === "/v1/library/folder-items") return Promise.resolve([]);
  if (path === "/v1/templates") return Promise.resolve([]);
  if (path === "/v1/library/facts") return Promise.resolve({ videos: [] });
  if (path === "/v1/player-list") return Promise.resolve([PLAYER]);
  if (path === "/v1/smart-bins") return Promise.resolve([]);
  if (path === "/v1/saved-searches") return Promise.resolve([]);
  if (path.startsWith("/v1/videos/") && path.endsWith("/events")) return Promise.resolve(EVENTS);
  if (path.startsWith("/v1/videos/") && path.endsWith("/match-periods")) return Promise.resolve({ state: "CONFIRMED", first: null, second: null });
  if (path.startsWith("/v1/videos/") && path.endsWith("/playback")) return Promise.reject(new Error("no footage"));
  return Promise.reject(new Error(`unexpected ${path}`));
});

describe("Library (SOT)", () => {
  it("shows the SOT's three columns and the real items", async () => {
    render(<LibraryStage />);
    await waitFor(() => expect(screen.getAllByText("Nart vs Ercakhu").length).toBeGreaterThan(0));
    // left panel: match + overlays + team + time
    expect(screen.getByText("Visual overlays")).toBeInTheDocument();
    expect(screen.getByText("Player Boxes")).toBeInTheDocument();
    expect(screen.getByText("Ball Tracking")).toBeInTheDocument();
    expect(screen.getByText("All Players")).toBeInTheDocument();
    expect(screen.getByText("Full Match")).toBeInTheDocument();
    // centre: header + player + search + table
    expect(screen.getByRole("heading", { name: "Library" })).toBeInTheDocument();
    expect(screen.getByText("Upload a match video")).toBeInTheDocument();
    expect(screen.getByTestId("player")).toHaveTextContent("No playable footage");
    expect(screen.getByPlaceholderText("Search videos, players, reels and reports")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Chinazom Godwin")).toBeInTheDocument();
    expect(screen.getByText("Chinazom Godwin — highlights")).toBeInTheDocument();
    // the events load after the list: wait for them rather than reading them in the same tick
    expect((await screen.findAllByText("1 confirmed player · 78 events")).length).toBeGreaterThan(0);
    expect(screen.getByText("#4 · DM · FC Ercakhu")).toBeInTheDocument();
    expect(screen.getByText("1 reel generated")).toBeInTheDocument();
    // right inspector: collections + folders + smart bins
    expect(screen.getByText("Collections")).toBeInTheDocument();
    expect(screen.getByText("All items")).toBeInTheDocument();
    expect(screen.getByText("No folders yet.")).toBeInTheDocument();
    expect(screen.getByText("Unconfirmed players")).toBeInTheDocument();
    expect(screen.getByText("Players without a report")).toBeInTheDocument();
    expect(screen.getByText("Save a search to reuse it.")).toBeInTheDocument();
  });

  it("All items stays the total when a collection is picked, and the Access filter is present", async () => {
    render(<LibraryStage />);
    await waitFor(() => expect(screen.getAllByText("Nart vs Ercakhu").length).toBeGreaterThan(0));
    // 1 match + 1 reel + 1 player = 3 items; "All items" is the total, not the filtered list
    const allRow = screen.getByText("All items").closest("button")!;
    expect(allRow).toHaveTextContent("3");
    // pick the Reels collection: the table narrows to the reel, but "All items" still reads 3
    fireEvent.click(screen.getByRole("button", { name: /Reels/ }));
    await waitFor(() => expect(screen.getByText("All items").closest("button")).toHaveTextContent("3"));
    // the table narrowed: the player row (a Player kind, not the reel) is gone
    expect(screen.queryByText("#4 · DM · FC Ercakhu")).not.toBeInTheDocument();
    // SOT: the search row has Type / Match / Access filters
    expect(screen.getByLabelText("Access")).toBeInTheDocument();
  });

  it("the bulk bar is disabled with nothing checked", async () => {
    render(<LibraryStage />);
    await waitFor(() => expect(screen.getAllByText("Nart vs Ercakhu").length).toBeGreaterThan(0));
    expect(screen.getByText("0 selected")).toBeInTheDocument();
    for (const label of ["Move", "Tag", "Access", "Export", "Delete"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });

  it("the Match block is a title button (not a select), with no Open in Analysis, Home/Away team filters and a working Custom Range", async () => {
    render(<LibraryStage />);
    await waitFor(() => expect(screen.getAllByText("Nart vs Ercakhu").length).toBeGreaterThan(0));
    // the SOT's title button with a chevron, opening the match menu — the left panel has no <select>
    expect(screen.getByRole("button", { name: "Nart vs Ercakhu" })).toBeInTheDocument();
    const left = screen.getByRole("complementary", { name: "Match context of the selected asset" });
    expect(within(left).queryByRole("combobox")).toBeNull();
    // the SOT has no "Open in Analysis" link and no linked chip
    expect(screen.queryByText("Open in Analysis")).toBeNull();
    expect(screen.queryByText("Linked to a match")).toBeNull();
    // team filter is Home team / Away team, never the team names
    expect(screen.getByRole("radio", { name: "Home team" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Away team" })).toBeInTheDocument();
    // Custom Range is selectable (a video is selected) and shows the start / end inputs
    const custom = screen.getByRole("radio", { name: "Custom Range" });
    expect(custom).not.toHaveAttribute("aria-disabled");
    fireEvent.click(custom);
    expect(custom).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByPlaceholderText("00:00")).toHaveLength(2);
    // "Match time: confirmed" is plain text with a dot (SOT §B), not a pill chip — and no chip at all in the left column
    const matchTime = screen.getByText(/Match time: confirmed/);
    expect(matchTime.className).not.toContain("chip");
    expect(left.querySelector(".chip")).toBeNull();
  });
});
