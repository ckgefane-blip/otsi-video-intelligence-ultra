/** Player Report SOT (Page 17 of 31): the header, ten tabs, stat tiles, Heatmap / Events panels and the AI Analyst brief / Clips / Notes & tags sidebar */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/reports", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ organization: { role: "OWNER" } }) }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error {} }));

import { ReportStage } from "@/components/playerreport/ReportStage";

const id = "0190a000-0000-7000-8000-000000000002";
const PIN = "OTSI-NGA-2026-000001";

function mockApi() {
  api.mockImplementation((url: string) => {
    if (url === `/v1/players/${id}`) return Promise.resolve({ player_id: id, display_name: "Chinazom Godwin", canonical_otsi_id: PIN, canonical_state: "REGISTERED", identity_label: "Chinazom Godwin" });
    if (url === `/v1/players/${id}/measures`) return Promise.resolve({
      player_id: id, tracks: 57, videos: 2, seen_s: 540, measured_s: 373, distance_m: 811, top_speed_kmh: 19.1, dropped_steps: 0,
      high_speed_m: null, sprint_m: null, sprints: 0, mean_confidence: 0.9, heat: null,
      events: { passes: 6, key_passes: 0, passes_received: 4, balls_won: 8, pressures: 6, shots: 0, videos: 2 },
      halves: { confirmed: 0, proposed: 0, unknown: 2 },
    });
    if (url === `/v1/players/${id}/profile`) return Promise.resolve({
      latest_team: { jersey_number: 4, position: "DM", team: "FC Ercakhu" }, preferred_foot: "RIGHT", position: "DM",
      nationality: { name: "Nigeria", code: "NGA" }, age: 20, birth_date: "2006-06-17",
      details: { height_cm: 182, weight_kg: 73, club_name: "FC Ercakhu", league: null, summary: null, strengths: [], international_country_code: null, international_country_name: null, international_caps: null, international_goals: null, photo_url: null },
    });
    if (url === `/v1/players/${id}/assessment`) return Promise.resolve({ published: null, draft: null, published_by_name: null, published_at: null, unpublished_changes: false, can_write: true, version: 1 });
    if (url === `/v1/players/${id}/events`) return Promise.resolve({
      items: [
        { id: "e1", kind: "PASS", start_us: 10000000, end_us: 12000000, video_id: "v1", video_title: "Nart v Ercakhu – round 2", evidence: "DETECTED", key: false, partner_name: null, length_m: 12, from_m: [-20, 5], to_m: [-8, 10] },
        { id: "e2", kind: "BALL_WON", start_us: 20000000, end_us: 21000000, video_id: "v1", video_title: "Nart v Ercakhu – round 2", evidence: "DETECTED", how: "TACKLE" },
      ], videos: 1, length_m: 105, width_m: 68,
    });
    if (url === "/v1/reels") return Promise.resolve([{ id: "r1", player: { player_id: id, display_name: "Chinazom Godwin", canonical_otsi_id: PIN }, name: "Chinazom Godwin — highlights" }]);
    if (url === `/v1/players/${id}/ai-analysis/status`) return Promise.resolve({ configured: true });
    if (url === `/v1/players/${id}/ai-analysis`) return Promise.reject(Object.assign(new Error("not found"), { status: 404 }));
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); push.mockReset(); });

describe("Player Report SOT", () => {
  it("renders the SOT header, tabs, stat tiles, Heatmap / Events and the sidebar", async () => {
    mockApi();
    render(<ReportStage playerRef={id} />);
    await waitFor(() => expect(screen.getByRole("heading", { name: "Chinazom Godwin" })).toBeInTheDocument());
    // header: PIN chip + identity chip + sub
    expect(screen.getByText(PIN)).toBeInTheDocument();
    expect(screen.getByText("Identity confirmed")).toBeInTheDocument();
    expect(screen.getByText("#4 · DM · FC Ercakhu · Nigeria · 2 videos analysed")).toBeInTheDocument();
    // header actions
    expect(screen.getByRole("link", { name: "Edit profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to dossier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Share link" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create report · 10 tokens" })).toBeInTheDocument();
    // ten tabs
    for (const t of ["Overview", "Attacking", "Passing", "Defensive", "Heatmaps", "Events", "Compare", "Scouting", "Clips", "Notes & tags"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    // stat tiles
    expect(screen.getByText("On camera")).toBeInTheDocument();
    expect(screen.getByText("9 min")).toBeInTheDocument();
    expect(screen.getByText("Confirmed tracks")).toBeInTheDocument();
    expect(screen.getByText("57")).toBeInTheDocument();
    expect(screen.getByText("Evidence coverage")).toBeInTheDocument();
    expect(screen.getByText("69%")).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByText("Assists")).toBeInTheDocument();
    // Assists is not measured by the engine — it says so, it does not invent a number
    expect(screen.getAllByText("Not measured").length).toBeGreaterThan(0);
    // Heatmap + Events panels
    expect(screen.getByRole("tab", { name: "Match" })).toBeInTheDocument();
    expect(screen.getByText("2 events recorded")).toBeInTheDocument();
    expect(screen.getByText("Review events in Analysis.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in Analysis" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build reel from best moments" })).toBeInTheDocument();
    // sidebar: AI Analyst brief + Clips + Notes & tags
    expect(screen.getByText("AI Analyst brief")).toBeInTheDocument();
    expect(screen.getByText("Not generated")).toBeInTheDocument();
    expect(screen.getByText("1 Draft")).toBeInTheDocument();
    expect(screen.getByText("2 Reviewed")).toBeInTheDocument();
    expect(screen.getByText("3 Published")).toBeInTheDocument();
    expect(screen.getByText("Uses measured data only.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate brief" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish brief" })).toBeInTheDocument();
    expect(screen.getByText("1 reel generated")).toBeInTheDocument();
    expect(screen.getByText("Open in Reel Builder.")).toBeInTheDocument();
    expect(screen.getByText("Private to your organisation")).toBeInTheDocument();
    expect(screen.getByLabelText("Add a note about this player")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ Add tag" })).toBeInTheDocument();
  });
});
