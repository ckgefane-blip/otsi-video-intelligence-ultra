/**
 * Cross-match highlight reel (ADR-131 Build B): the Reel Builder UI — the source choice + length picker (a NEW reel, the
 * original untouched), the best-moments selection view (tiers, chain sequence labels, left-out reasons), the preview
 * switching source video per clip, and the Profile Intro dialog opening for a cross-match reel.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace }), usePathname: () => "/reels/abc", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { SpotlightSettings, type CrossMatchSelection, type Reel, type ReelHistory } from "@otsi-vie/contracts";
import { ReelStage } from "@/components/reelstage/ReelStage";
import { ReelBuilder, ReelSourceChoice } from "@/components/reels/ReelBuilder";

// jsdom has no scrollIntoView; the stage jumps to the remembered step 300 ms after opening a reel
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = vi.fn();

const PLAYER_ID = "0193132e-5034-7bc3-9565-df048bb01001";
const SINGLE_ID = "0190a000-0000-7000-8000-000000000001";
const CROSS_ID = "0190a000-0000-7000-8000-000000000002";
const NEW_ID = "0190a000-0000-7000-8000-000000000003";
const player = { player_id: PLAYER_ID, display_name: "Sugh", canonical_otsi_id: "OTSI-FRA-2026-000123" };
const history = { entries: [], can_undo: true, can_redo: true, undo_label: "Trimmed a clip", redo_label: "Frame 4:5" } as unknown as ReelHistory;

const baseReel = (over: Record<string, unknown> = {}): Reel => ({
  id: SINGLE_ID, name: "Sugh — Dynamo", video_id: "vid-1", source: "MATCH", version: 3, aspect: "16:9", duration_us: 0, clips: [],
  settings: SpotlightSettings.parse({}), player, targets: [], stale: false,
  latest_render: null, last_good_render: null, player_roster: null, match: null, ...over,
} as unknown as Reel);

const crossClip = {
  id: "clip-1", source_video_id: "vid-2", in_pts_us: 5_000_000, out_pts_us: 18_000_000,
  label: "[Tier S] Goal · 67' vs Ercakhu", origin: "SUGGESTED", sequence_index: 0, effect_kind: "NONE",
};
const crossReel = (over: Record<string, unknown> = {}): Reel => baseReel({
  id: CROSS_ID, name: "Sugh — all matches", video_id: null, source: "ALL_MATCHES",
  cross_match_length_s: 300, best_moments_rule_version: "2.1", clips: [crossClip], duration_us: 13_000_000, ...over,
});

/** a chain's reason IS its sequence label (contracts selectCrossMatchMoments); a left-out moment carries its reason */
const selection = {
  rule_version: "2.1", length_s: 300, total_s: 13,
  selected: [
    { video_id: "vid-2", label: "[Tier S] Goal · 67' vs Ercakhu", in_pts_us: 5_000_000, out_pts_us: 18_000_000, key_at_us: 8_000_000,
      events: ["GOAL"], is_chain: true, sequence_label: "Tackle (possible) → Key pass → Goal",
      home: "Dynamo", away: "Ercakhu", competition: "Abkhazia Premier League", match_minute: 67, video_title: "Dynamo v Ercakhu",
      tier: "S", reason: "Tackle (possible) → Key pass → Goal", in_reel: true },
    { video_id: "vid-3", label: "[Tier B] Dribble past opponent · 41' vs Nart", in_pts_us: 38_000_000, out_pts_us: 46_500_000, key_at_us: 41_000_000,
      events: ["DRIBBLE"], is_chain: false, sequence_label: null,
      home: "Nart", away: "Ercakhu", competition: "Abkhazia Premier League", match_minute: 41, video_title: "Nart v Ercakhu",
      tier: "B", reason: "Dribble past opponent", in_reel: false },
  ],
  not_selected: [
    { candidate: { video_id: "vid-2", label: "[Tier B] Shot on target · 21' vs Ercakhu", in_pts_us: 20_000_000, out_pts_us: 26_500_000, key_at_us: 21_000_000,
        events: ["SHOT"], is_chain: false, sequence_label: null,
        home: "Dynamo", away: "Ercakhu", competition: "Abkhazia Premier League", match_minute: 21, video_title: "Dynamo v Ercakhu" },
      reason: "per-match cap reached" },
    { candidate: { video_id: "vid-3", label: "[Tier C] Duel won · 12' vs Nart", in_pts_us: 10_000_000, out_pts_us: 14_000_000, key_at_us: 12_000_000,
        events: ["DUEL_WON"], is_chain: false, sequence_label: null,
        home: "Nart", away: "Ercakhu", competition: "Abkhazia Premier League", match_minute: 12, video_title: "Nart v Ercakhu" },
      reason: "rejected for this reel" },
  ],
} as unknown as CrossMatchSelection;

const intro = () => ({
  player: { ...player, own_canonical_otsi_id: "OTSI-FRA-2026-000123", canonical_state: "REGISTERED",
    resolved_player_id: PLAYER_ID, identity_label: "REGISTERED_PLAYER" },
  profile: {
    birth_date: "2002-06-24", age: 24, preferred_foot: "RIGHT", nationality: { code: "FRA", name: "France" }, position: "CM",
    role_confirmed: true, role_confirmation_state: "ROLE_CONFIRMED", role_confirmed_by: "u1", role_confirmed_at: "2026-11-09T00:00:00.000Z",
    role_confirmed_by_name: "Ana", latest_team: { team: "Real Madrid", jersey_number: 15, position: "CM" },
    details: { height_cm: 182, weight_kg: 73, photo_asset_id: null, photo_url: null, strengths: ["Excellent Ball Control"],
      summary: "Dynamic midfielder.", club_name: "Rayo Vallecano", league: "La Liga",
      international_country_code: "FRA", international_country_name: "France", international_caps: 32, international_goals: 7,
      updated_by_name: "Ana", updated_at: "2026-11-10T00:00:00.000Z" },
    editable: true,
  },
  verified: true, verified_rule: "Player Identity Verified means: registered, a person confirmed a track, targets current.", reel_id: null,
  stats: { games_analysed: 8, minutes_seen: 712, goals: 2, assists: null, basis: "Measured from his confirmed tracks.", assists_reason: "The engine does not link a pass to a goal." },
  heat: null, recent_form: { ratings: null, reason: "No per-match rating model yet." },
});

function mockApi(reel: Reel, moments: unknown) {
  api.mockImplementation((url: string, init?: { method?: string; json?: unknown }) => {
    if (url === `/v1/reels/${reel.id}`) return Promise.resolve(reel);
    if (url === `/v1/reels/${reel.id}/moments`) return Promise.resolve(moments);
    if (url === `/v1/reels/${reel.id}/history`) return Promise.resolve(history);
    if (url === `/v1/reels/${reel.id}/history/undo` || url === `/v1/reels/${reel.id}/history/redo`) return Promise.resolve(reel);
    if (url === "/v1/reels" && init?.method === "POST") return Promise.resolve({ id: NEW_ID });
    if (url === "/v1/videos/vid-1") return Promise.resolve({ id: "vid-1", match_id: null });
    if (url === "/v1/videos/vid-1/playback") return Promise.resolve({ url: "" });
    if (url === "/v1/videos/vid-2") return Promise.resolve({ id: "vid-2", match_id: "match-1" });
    if (url === "/v1/videos/vid-2/playback") return Promise.resolve({ url: "" });
    if (url === "/v1/videos/vid-3") return Promise.resolve({ id: "vid-3", match_id: "match-2" });
    if (url === "/v1/videos/vid-3/playback") return Promise.resolve({ url: "" });
    if (url === "/v1/matches/match-1") return Promise.resolve({ id: "match-1", home: { name: "FC Dynamo", short_name: "DYN" }, away: { name: "FC Ercakhu", short_name: "ERC" }, home_score: 2, away_score: 1 });
    if (url === "/v1/matches/match-2") return Promise.resolve({ id: "match-2", home: { name: "FC Nart", short_name: "NAR" }, away: { name: "FC Ercakhu", short_name: "ERC" }, home_score: 0, away_score: 0 });
    if (url === "/v1/renders/render-1/playback") return Promise.resolve({ url: "" });
    if (url.startsWith(`/v1/reels/${reel.id}/path`)) return Promise.resolve({ points: [] });
    if (url.startsWith("/v1/brand-assets")) return Promise.resolve([]);
    if (url.startsWith("/v1/players/") && url.includes("/profile-intro")) return Promise.resolve(intro());
    if (url.startsWith(`/v1/reels/${reel.id}/clips`)) return Promise.resolve(reel);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api.mockReset(); push.mockReset(); replace.mockReset(); });

async function openCross(reel: Reel = crossReel()) {
  mockApi(reel, selection);
  render(<ReelStage reelId={reel.id} />);
  await waitFor(() => expect(screen.getByLabelText("Undo: Trimmed a clip")).not.toBeDisabled());
}

describe("Cross-match source choice", () => {
  it("creates a new all-matches reel at 5 minutes and opens it, leaving the original reel alone", async () => {
    const single = baseReel();
    mockApi(single, []);
    render(<ReelStage reelId={SINGLE_ID} />);
    await waitFor(() => expect(screen.getByLabelText("Undo: Trimmed a clip")).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Which matches"), { target: { value: "300" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/reels", expect.objectContaining({
      method: "POST", json: { source: "ALL_MATCHES", length_s: 300, player_id: PLAYER_ID },
    })));
    expect(push).toHaveBeenCalledWith(`/reels/${NEW_ID}`);
    expect(api.mock.calls.filter(([u, init]) => String(u) === `/v1/reels/${SINGLE_ID}` && (init as { method?: string } | undefined)?.method === "PATCH")).toHaveLength(0);
  });

  it("the full source choice offers the fixed lengths, default 3 min", async () => {
    const single = baseReel();
    mockApi(single, []);
    render(<ReelBuilder reelId={SINGLE_ID}><ReelSourceChoice /></ReelBuilder>);
    await waitFor(() => expect(screen.getByText("Which matches?")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: "All matches" }));
    expect(screen.getByRole("radio", { name: "3 min" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "90 s" }));
    fireEvent.click(screen.getByRole("button", { name: "Create all-matches reel" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/reels", expect.objectContaining({
      method: "POST", json: { source: "ALL_MATCHES", length_s: 90, player_id: PLAYER_ID },
    })));
    expect(push).toHaveBeenCalledWith(`/reels/${NEW_ID}`);
  });

  it("a cross-match reel shows its length and rule as a read-only summary", async () => {
    await openCross();
    expect(screen.getByText("All matches · 5 min · best moments rule v2.1")).toBeTruthy();
  });
});

describe("Cross-match moments view", () => {
  it("shows tiers, the chain's sequence label, match + minute, and the left-out reasons", async () => {
    await openCross();
    await waitFor(() => expect(screen.getByText("Best Moments — All Matches (4)")).toBeTruthy());
    expect(screen.getByText("Tier S")).toBeTruthy();
    expect(screen.getByText("Tier B")).toBeTruthy();
    expect(screen.getByText("Tackle (possible) → Key pass → Goal")).toBeTruthy();
    expect(screen.getByText("Dynamo vs Ercakhu · Abkhazia Premier League · 67'")).toBeTruthy();
    expect(screen.getByText("Nart vs Ercakhu · Abkhazia Premier League · 41'")).toBeTruthy();
    expect(screen.getByText("per-match cap reached")).toBeTruthy();
    expect(screen.getByText("rejected for this reel")).toBeTruthy();
  });

  it("hides Build a draft and Is this him?, and Add all counts only the selected moments not yet in the reel", async () => {
    await openCross();
    await waitFor(() => expect(screen.getByText("Best Moments — All Matches (4)")).toBeTruthy());
    expect(screen.queryByText("✦ Build a draft")).toBeNull();
    expect(screen.queryByText("More moments of him: Is this him? ›")).toBeNull();
    expect(screen.getByText("+ Add all (1)")).toBeTruthy();
  });

  it("pins a selected moment by hand through addClip with its source video", async () => {
    await openCross();
    await waitFor(() => expect(screen.getByText("Best Moments — All Matches (4)")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Add moment 2 to the reel" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/reels/${CROSS_ID}/clips`, expect.objectContaining({
      method: "POST",
      json: { in_pts_us: 38_000_000, out_pts_us: 46_500_000, origin: "SUGGESTED", label: "[Tier B] Dribble past opponent · 41' vs Nart", source_video_id: "vid-3" },
    })));
  });

  it("never reads a single video for a cross-match reel", async () => {
    await openCross();
    await waitFor(() => expect(screen.getByText("Best Moments — All Matches (4)")).toBeTruthy());
    expect(api.mock.calls.some(([u]) => String(u).includes("/videos/null"))).toBe(false);
    expect(api.mock.calls.some(([u]) => String(u).includes("undefined"))).toBe(false);
  });
});

describe("Cross-match preview", () => {
  it("switches source video per clip: the clip's video, playback and path — and shows the clip's match scoreboard", async () => {
    await openCross();
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/videos/vid-2"));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/videos/vid-2/playback"));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/reels/${CROSS_ID}/path?video_id=vid-2`));
    const preview = screen.getByRole("region", { name: "Cinematic spotlight preview" });
    await waitFor(() => expect(within(preview).getByText("DYN")).toBeTruthy());
    await waitFor(() => expect(within(preview).getByText("ERC")).toBeTruthy());
  });

  it("in render mode shows an All matches note instead of a single match's scoreboard", async () => {
    const rendered = crossReel({
      latest_render: { id: "render-1", state: "SUCCEEDED" },
      last_good_render: { id: "render-1", has_output: true },
    });
    await openCross(rendered);
    await waitFor(() => expect(screen.getByText("Best Moments — All Matches (4)")).toBeTruthy());
    fireEvent.click(screen.getByLabelText("Preview Render"));
    const preview = screen.getByRole("region", { name: "Cinematic spotlight preview" });
    await waitFor(() => expect(within(preview).getByText("All matches")).toBeTruthy());
    expect(within(preview).queryByText("DYN")).toBeNull();
  });
});

describe("Cross-match Profile Intro", () => {
  it("opens for a cross-match reel exactly as for a single-match reel, from the player's data", async () => {
    await openCross();
    await waitFor(() => expect(screen.getByRole("dialog", { name: "Player Profile Intro" })).toBeTruthy());
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/players/${PLAYER_ID}/profile-intro?reel_id=${CROSS_ID}`));
    const dialog = screen.getByRole("dialog", { name: "Player Profile Intro" });
    await waitFor(() => expect(within(dialog).getByText("Player Identity Verified")).toBeTruthy());
    expect(within(dialog).getByText("Continue to Reel")).toBeTruthy();
  });
});
