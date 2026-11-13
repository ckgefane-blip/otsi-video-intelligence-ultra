/** Home (SOT, Page 11): the three-column row, the KPI row and the three panels, from real endpoints */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: class ApiProblem extends Error {} }));
vi.mock("@/components/home/HeroLive", () => ({ HeroLive: () => <div data-testid="hero-live">Live picture</div> }));
vi.mock("@/components/home/RecentMatches", () => ({ RecentMatches: () => <section aria-label="Recent matches"><h2>Recent matches</h2></section> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { HomeStage } from "@/components/home/HomeStage";
import { reloadRenderedReels } from "@/components/home/renderedReels";

const REEL = {
  id: "55555555-5555-4555-8555-555555555555", name: "Chinazom Godwin — highlights", source: "MATCH", aspect: "16:9", version: 3,
  clips: new Array(58).fill({}), duration_us: 559_000_000,
  last_good_render: { id: "66666666-6666-4666-8666-666666666666", has_output: true, state: "SUCCEEDED", completed_at: "2026-11-10T19:08:00Z", result: { height: 480, duration_s: 559 }, config: { codec: "h264" } },
  latest_render: null, settings: {}, player: { player_id: "44444444-4444-4444-8444-444444444444", display_name: "Chinazom Godwin", canonical_otsi_id: null },
};
const stats = {
  matches_analyzed: 2, players_tracked: 1, reels_generated: 1, reports_created: 0,
  weekly: { matches_analyzed: [0, 0, 0, 0, 1], players_tracked: [0, 0, 0, 0, 0], reels_generated: [0, 0, 0, 0, 0], reports_created: [0, 0, 0, 0, 0] },
};
const inbox = {
  next: { kind: "REVIEW", label: "Approve 1 team sheet", detail: "Nart v Ercakhu – round 2", href: "/analysis" },
  items: [{ kind: "TEAM_SHEET", title: "Approve 1 team sheet", detail: "Nart v Ercakhu – round 2", count: 1, href: "/analysis" }],
  completed_match: true,
};
const jobs = { jobs: [], active: 0, running: 0, failed_recent: 0 };

function mockApi(reels: unknown = [REEL]) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/overview/stats") return Promise.resolve(stats);
    if (url === "/v1/overview/inbox") return Promise.resolve(inbox);
    if (url === "/v1/jobs") return Promise.resolve(jobs);
    if (url === "/v1/reels") return Promise.resolve(reels);
    if (url.startsWith("/v1/renders/")) return Promise.resolve({ url: "https://example.com/reel.mp4", download_url: "https://example.com/reel.mp4" });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); reloadRenderedReels(); });   // the reels loader caches its promise: clear it so each test reads its own mock

describe("Home (SOT)", () => {
  it("shows the start, the live picture, the featured reel, the KPIs and the three panels", async () => {
    mockApi();
    render(<HomeStage />);
    expect(screen.getByRole("heading", { name: "Football video intelligence" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Upload video/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Paste link/ })).toBeInTheDocument();
    expect(screen.getByTestId("hero-live")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Chinazom Godwin — highlights")).toBeInTheDocument());
    expect(screen.getByText("58 clips · 16:9 · H.264 · SD")).toBeInTheDocument();
    expect(screen.getByText("Playing the SD file. Other sizes are rendered from Export.")).toBeInTheDocument();
    expect(screen.getByText("Matches analysed")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Players tracked")).toBeInTheDocument();
    expect(screen.getByText("Reports created")).toBeInTheDocument();
    expect(screen.getByText("Recent matches")).toBeInTheDocument();
    expect(screen.getByText("Review inbox")).toBeInTheDocument();
    expect(screen.getAllByText("Approve 1 team sheet").length).toBe(2);   // the Start next action and the Review inbox row
    expect(screen.getByText("Active jobs")).toBeInTheDocument();
    expect(screen.getByText("0 running · 0 waiting or paused")).toBeInTheDocument();
    expect(screen.getByText("No engine job in the last day.")).toBeInTheDocument();
  });

  it("switching the featured quality to one not rendered says so", async () => {
    mockApi();
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByText("Chinazom Godwin — highlights")).toBeInTheDocument());
    const select = screen.getByLabelText("Video quality") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "hd" } });
    expect(screen.getAllByText(/HD 720p · not rendered/).length).toBe(2);   // the option and the note below the thumbnail
    expect(screen.getByRole("link", { name: "Export" })).toBeInTheDocument();
  });

  it("names a failed stats read instead of showing empty KPIs", async () => {
    mockApi();
    api.mockImplementation((url: string) => {
      if (url === "/v1/overview/stats") return Promise.reject(new Error("down"));
      if (url === "/v1/overview/inbox") return Promise.resolve(inbox);
      if (url === "/v1/jobs") return Promise.resolve(jobs);
      if (url === "/v1/reels") return Promise.resolve([REEL]);
      if (url.startsWith("/v1/renders/")) return Promise.resolve({ url: "https://example.com/reel.mp4", download_url: "https://example.com/reel.mp4" });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByText("Headline KPI strip: totals could not be read")).toBeInTheDocument());
  });

  it("names the Free tier and its 2 GB limit in the upload note, never '— tier includes 64 GB'", async () => {
    mockApi();
    render(<HomeStage />);
    // the licence / limits reads fail in this test (unmocked) — the note still names the Free tier, as the SOT does
    await waitFor(() => expect(screen.getByText(/Free tier includes 2 GB of video in total/)).toBeInTheDocument());
    expect(screen.queryByText(/— tier includes/)).toBeNull();
  });

  it("shows an empty 16:9 frame for the featured reel when there is no rendered reel", async () => {
    mockApi([]);
    render(<HomeStage />);
    await waitFor(() => expect(screen.getByText("No featured reel")).toBeInTheDocument());
    expect(document.querySelector("[data-featured-empty]")).not.toBeNull();
    expect(screen.getByText("Published reels appear here")).toBeInTheDocument();
  });
});
