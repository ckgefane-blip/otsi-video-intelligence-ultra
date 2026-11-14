/** Home — Page 1 of 31 (ui-ux-spec §6.1): hero → NextActionBar → Featured reel → KPI row → trust strip →
 * Continue Work + Jobs Center → Review inbox + Recent Activity → sample reels (collapsed), from real endpoints */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api, ApiProblem, tier } = vi.hoisted(() => {
  class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  }
  return { api: vi.fn(), ApiProblem, tier: { value: undefined as unknown } };
});
vi.mock("@/lib/api", () => ({ api, ApiProblem }));
vi.mock("@/lib/uploadTier", async (orig) => ({ ...(await orig<typeof import("@/lib/uploadTier")>()), useTierLimit: () => tier.value }));
vi.mock("@/components/home/HeroLive", () => ({ HeroLive: () => <div data-testid="hero-live">Live picture</div> }));
vi.mock("@/components/home/RecentMatches", () => ({ RecentMatches: () => <section aria-label="Recent matches"><h2>Recent matches</h2></section> }));
vi.mock("@/components/media/VideoPlayer", () => ({
  VideoPlayer: ({ src, empty }: { src: string | null | undefined; empty?: { title: string; body: string } }) =>
    <div data-testid="player" data-src={String(src)}>{src === null && empty ? <><p>{empty.title}</p><p>{empty.body}</p></> : null}</div>,
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { HomeStage } from "@/components/home/HomeStage";
import { reloadRenderedReels } from "@/components/home/renderedReels";

const REEL = {
  id: "55555555-5555-4555-8555-555555555555", name: "Chinazom Godwin — highlights", source: "MATCH", aspect: "16:9", version: 3,
  clips: new Array(58).fill({}), duration_us: 559_000_000,
  last_good_render: { id: "66666666-6666-4666-8666-666666666666", has_output: true, state: "SUCCEEDED", completed_at: "2026-11-10T19:08:00Z", result: { height: 480, duration_s: 559 }, config: { codec: "h264" } },
  latest_render: null, settings: {}, player: { player_id: "44444444-4444-4444-8444-444444444444", display_name: "Chinazom Godwin", canonical_otsi_id: null },
};
const PICK = { reel_id: REEL.id, render_id: REEL.last_good_render.id, rendered_not_cleared: 0 };
const stats = {
  matches_analyzed: 2, players_tracked: 1, reels_generated: 1, reports_created: 0,
  weekly: { matches_analyzed: [0, 0, 0, 0, 1], players_tracked: [0, 0, 0, 0, 0], reels_generated: [0, 0, 0, 0, 0], reports_created: [0, 0, 0, 0, 0] },
};
const row = (i: number) => ({ id: `TEAM_SHEET:${i}`, kind: "TEAM_SHEET", title: "Approve 1 team sheet", detail: `Match ${i}`, count: 1, href: "/analysis", video_id: null, player_name: null });
const inbox = {
  next: { kind: "REVIEW", label: "Is this Ada? 3 moments to check", detail: "Ada highlights", href: "/analysis?video=v1" },
  items: [{ id: "IDENTITY:r1", kind: "IDENTITY", title: "Is this Ada? 3 moments to check", detail: "Ada highlights", count: 3, href: "/analysis?video=v1", video_id: "v1", player_name: "Ada" }],
  completed_match: true,
};
const RUNNING = { id: "j1", kind: "ANALYSIS", kind_label: "Analysis", state: "RUNNING", progress: 40, subject_title: "Nart v Ercakhu", stage: null, error: null, href: null };
const DONE = { ...RUNNING, id: "j0", state: "SUCCEEDED", subject_title: "Old match" };
const FINISHED = {
  ...RUNNING, id: "j2", state: "SUCCEEDED", progress: 100, subject_title: "Nart v Ercakhu",
  created_at: "2026-11-10T11:00:00Z", started_at: "2026-11-10T11:05:00Z", finished_at: "2026-11-10T19:08:00Z",
};
const DECIDED = {
  item_id: "TEAM_SHEET:1", kind: "TEAM_SHEET", decision: "APPROVE", applied: 1, failures: [],
  inbox: { next: null, items: [], completed_match: true },
};

function mockApi(o: Record<string, unknown> = {}) {
  const v: Record<string, unknown> = { stats, inbox, jobs: { jobs: [], active: 0, running: 0, failed_recent: 0 }, reels: [REEL], pick: PICK, decision: DECIDED, ...o };
  api.mockImplementation((url: string, init?: { method?: string; json?: unknown }) => {
    const r = (x: unknown) => (x instanceof Error ? Promise.reject(x) : Promise.resolve(typeof x === "function" ? (x as () => unknown)() : x));
    if (url === "/v1/overview/stats") return r(v.stats);
    if (url === "/v1/overview/inbox") return r(v.inbox);
    if (url === "/v1/jobs") return r(v.jobs);
    if (url === "/v1/reels") return r(v.reels);
    if (url === "/v1/overview/featured-reel") return r(v.pick);
    if (url === "/v1/overview/inbox/decisions" && init?.method === "POST") return r(v.decision);
    if (url === `/v1/renders/${PICK.render_id}/share-links` && init?.method === "POST") return r(v.share);
    if (url.startsWith("/v1/renders/")) return Promise.resolve({ url: "https://example.com/reel.mp4", download_url: "https://example.com/reel.mp4" });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); reloadRenderedReels(); tier.value = undefined; });

describe("Home (Page 1 of 31)", () => {
  it("shows the hero, the next-action bar, the featured reel, the KPIs, the trust strip, Continue Work + Jobs Center, the review inbox + recent activity, and the collapsed sample reels", async () => {
    mockApi();
    render(<HomeStage />);
    // hero: start + live picture
    expect(screen.getByRole("heading", { name: "Football video intelligence" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upload video/ })).toHaveAttribute("href", "/upload?mode=file");
    expect(screen.getByRole("link", { name: /Paste link/ })).toHaveAttribute("href", "/upload?mode=url");
    expect(screen.getByTestId("hero-live")).toBeInTheDocument();
    // next-action bar: the single next action + the button that opens the inbox
    await waitFor(() => expect(document.querySelector("[data-next-action-bar]")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open review inbox" })).toHaveAttribute("href", "#review-inbox");
    // featured reel, full width, playing here, with its rendered state
    await waitFor(() => expect(screen.getByTestId("player")).toHaveAttribute("data-src", "https://example.com/reel.mp4"));
    expect(screen.getAllByText("Chinazom Godwin — highlights").length).toBeGreaterThan(0);
    expect(screen.getByText("58 clips · 16:9 · H.264 · SD · 09:19 · Rendered")).toBeInTheDocument();
    expect(screen.queryByLabelText("Video quality")).toBeNull();                       // the dead quality select is gone
    expect(screen.getByRole("link", { name: "Open in Reel Builder" })).toHaveAttribute("href", `/reels/${REEL.id}`);
    // KPI row: the spec's four labels, each opening its list
    await waitFor(() => expect(screen.getByText("Matches analysed")).toBeInTheDocument());
    expect(screen.getByText("Players tracked")).toBeInTheDocument();
    expect(screen.getByText(/\+1 this week/)).toBeInTheDocument();
    expect(screen.queryByText(/\+0/)).toBeNull();                                      // no "+0" noise
    expect(screen.getByRole("link", { name: "Matches analysed: open the list" })).toHaveAttribute("href", "/matches");
    expect(screen.getByRole("link", { name: "Players tracked: open the list" })).toHaveAttribute("href", "/players");
    expect(screen.getByRole("link", { name: "Reels generated: open the list" })).toHaveAttribute("href", "/reels");
    expect(screen.getByRole("link", { name: "Reports created: open the list" })).toHaveAttribute("href", "/reports");
    // trust strip: the Evidence Integrity legend, no counts
    expect(screen.getByRole("region", { name: "Evidence Integrity" })).toBeInTheDocument();
    expect(screen.getByText("Unknown beats wrong.")).toBeInTheDocument();
    expect(screen.getByText("Verified by strong evidence, or by a human")).toBeInTheDocument();
    expect(screen.getByText("Automatically detected from the available footage")).toBeInTheDocument();
    expect(screen.getByText("Provisional interpretation requiring verification")).toBeInTheDocument();
    expect(screen.getByText("Insufficient data for a defensible result")).toBeInTheDocument();
    // Continue Work + Jobs Center
    expect(screen.getByRole("heading", { name: "Continue work" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View all matches" })).toHaveAttribute("href", "/matches");
    expect(screen.getByRole("heading", { name: "Jobs Center" })).toBeInTheDocument();
    expect(screen.getByText("No active jobs")).toBeInTheDocument();
    expect(screen.getByText("Upload footage to start an analysis.")).toBeInTheDocument();
    // review inbox + recent activity
    await waitFor(() => expect(screen.getAllByText("Is this Ada? Moments to check: 3").length).toBe(2));   // the next-action bar and the inbox row
    expect(screen.getByRole("heading", { name: "Review inbox (1)" })).toBeInTheDocument();
    expect(screen.getByText("No recent activity yet.")).toBeInTheDocument();
    expect(screen.getByText("Finished jobs and renders will appear here.")).toBeInTheDocument();
    // sample reels: collapsed, labelled sample
    const samples = screen.getByRole("button", { name: /Sample reels/ });
    expect(samples).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Sample content — examples, not your data.")).toBeNull();
    fireEvent.click(samples);
    expect(samples).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Sample content — examples, not your data.")).toBeInTheDocument();
    expect(screen.getByText("Track every player")).toBeInTheDocument();
    expect(screen.getByText("Tactical intelligence")).toBeInTheDocument();
    expect(screen.getByText("Reels and reports")).toBeInTheDocument();
  });

  it("Continue Work's Recent Sessions tab shows the empty state, not invented rows", async () => {
    mockApi();
    render(<HomeStage />);
    fireEvent.click(screen.getByRole("tab", { name: "Recent sessions" }));
    expect(screen.getByText("No sessions yet.")).toBeInTheDocument();
    expect(screen.getByText("Your recent work sessions will appear here.")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recent sessions" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: "Recent matches" }));
    expect(screen.queryByText("No sessions yet.")).toBeNull();
  });

  it("Recent Activity shows the finished jobs, newest first, with absolute dates", async () => {
    const older = { ...FINISHED, id: "j3", kind_label: "Lineups", subject_title: "Nart v Ercakhu", finished_at: "2026-11-10T11:25:00Z" };
    mockApi({ jobs: { jobs: [older, FINISHED], active: 0, running: 0, failed_recent: 0 } });
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByText("Analysis · Nart v Ercakhu")).toBeInTheDocument());
    expect(screen.getByText("Lineups · Nart v Ercakhu")).toBeInTheDocument();
    const rows = document.querySelectorAll("[data-recent-activity] li");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("2026");                                        // absolute date, not a relative time
    expect(rows[1]).toHaveTextContent("2026");
    expect(screen.queryByText(/ago|just now/)).toBeNull();
    expect(screen.getByRole("link", { name: "View all activity" })).toHaveAttribute("href", "/processing");
  });

  it("a team sheet is approved from the inbox, and the row leaves at once", async () => {
    mockApi({ inbox: { next: null, items: [row(1)], completed_match: true } });
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/overview/inbox/decisions",
      { method: "POST", json: { item_id: "TEAM_SHEET:1", decision: "APPROVE", reason: null } }));
    await waitFor(() => expect(screen.queryByText("Team sheets to approve: 1")).toBeNull());
    expect(screen.getByText("All clear")).toBeInTheDocument();
  });

  it("a failed approval says why, next to its button, and the row stays", async () => {
    mockApi({
      inbox: { next: null, items: [row(1)], completed_match: true },
      decision: new ApiProblem(422, "DECISION_FAILED", "The team sheet could not be approved."),
    });
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("The team sheet could not be approved."));
    expect(screen.getByText("Team sheets to approve: 1")).toBeInTheDocument();
  });

  it("Share makes a real view-only share link once and copies it", async () => {
    const share = vi.fn(() => ({ id: "l1", url: "/s/abc", render_id: PICK.render_id }));
    mockApi({ share });
    const write = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    render(<HomeStage />);
    await waitFor(() => screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Share link copied: view only, valid for 7 days"));
    expect(api).toHaveBeenCalledWith(`/v1/renders/${PICK.render_id}/share-links`, { method: "POST", json: {} });
    expect(write).toHaveBeenCalledWith(`${location.origin}/s/abc`);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(share).toHaveBeenCalledTimes(1);                                            // the second click reuses the link
  });

  it("Share says why when sharing is not allowed", async () => {
    mockApi({ share: new ApiProblem(409, "SHARING_NOT_ALLOWED", "This video's rights do not allow sharing.") });
    render(<HomeStage />);
    await waitFor(() => screen.getByRole("button", { name: "Share" }));
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("This video's rights do not allow sharing."));
  });

  it("features no reel until one is cleared for sharing, and says how many wait", async () => {
    mockApi({ pick: { reel_id: null, render_id: null, rendered_not_cleared: 2 } });
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByText("No reel is cleared for sharing yet")).toBeInTheDocument());
    expect(screen.getByText("Rendered reels waiting for rights or a refresh: 2. Set the rights in Export.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("names a failed stats read, a failed inbox read and a failed jobs read", async () => {
    mockApi({ stats: new Error("down"), inbox: new Error("down"), jobs: new Error("down") });
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByText("Headline KPI strip: totals could not be read")).toBeInTheDocument());
    expect(await screen.findByText("The review inbox could not be read")).toBeInTheDocument();
    expect(screen.getAllByText("The jobs could not be read")).toHaveLength(2);        // Jobs Center and Recent Activity
  });

  it("names the job that is actually running, not a finished one", async () => {
    mockApi({ jobs: { jobs: [DONE, RUNNING], active: 1, running: 1, failed_recent: 0 } });
    render(<HomeStage />);
    await waitFor(() => expect(document.querySelector("[data-current-job]")).toHaveTextContent("Analysis · Nart v Ercakhu"));
  });

  it("shows five inbox rows and the rest on See all", async () => {
    mockApi({ inbox: { next: null, items: [1, 2, 3, 4, 5, 6, 7].map(row), completed_match: true } });
    render(<HomeStage />);
    await waitFor(() => expect(document.querySelectorAll("[data-inbox]")).toHaveLength(5));
    fireEvent.click(screen.getByRole("button", { name: "See all (7)" }));
    expect(document.querySelectorAll("[data-inbox]")).toHaveLength(7);
    expect(screen.getAllByText("Team sheets to approve: 1")).toHaveLength(7);
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(7);        // team sheets approve here
  });

  it("the upload note names the real plan and the per-video limit, never an invented tier or link sources", async () => {
    tier.value = { tier: null, plan: "CLUB", maxBytes: 64 * 1024 ** 3 };
    mockApi();
    render(<HomeStage />);
    expect(document.querySelector("[data-upload-note]")).toHaveTextContent("MP4 or MOV · up to 64 GB per video on the Club plan · or paste a link");
    expect(screen.queryByText(/tier/)).toBeNull();
    expect(screen.queryByText(/YouTube/)).toBeNull();
    tier.value = { tier: "Free", plan: "FREE", maxBytes: 2 * 1024 ** 3 };
    render(<HomeStage />);
    expect(screen.getByText("MP4 or MOV · up to 2 GB per video on the Free plan · or paste a link")).toBeInTheDocument();
  });
});
