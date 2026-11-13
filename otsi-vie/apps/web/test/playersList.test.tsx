/**
 * Players — profile editor (SOT Page 18 of 31): the table, the identity filter, the intro preview and the inspector form.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayersList } from "@/components/players/PlayersList";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: Error }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

const modric = {
  player_id: "0193132e-5034-7bc3-9565-df048bb01001",
  display_name: "Luka Modric",
  canonical_otsi_id: "OTSI-HRV-2026-000001",
  profile: {
    birth_date: "1985-09-09", age: 41, preferred_foot: "BOTH", nationality: { code: "HRV", name: "Croatia" },
    position: "CM", role_confirmed: true, role_confirmation_state: "ROLE_CONFIRMED", role_confirmed_by: "0193132e-user-1",
    role_confirmed_at: "2026-11-09T00:00:00.000Z", role_confirmed_by_name: "Lead Analyst", latest_team: null, editable: true,
    details: null,
  },
};
const kroos = {
  player_id: "0193132e-5034-7bc3-9565-df048bb01002",
  display_name: "Toni Kroos",
  canonical_otsi_id: null,
  profile: {
    birth_date: "1990-01-04", age: 36, preferred_foot: "BOTH", nationality: { code: "DEU", name: "Germany" },
    position: "CM", role_confirmed: false, role_confirmation_state: "ROLE_PROVISIONAL", role_confirmed_by: null,
    role_confirmed_at: null, latest_team: null, editable: true, details: null,
  },
};

function mockApi() {
  api.mockImplementation((url: string) => {
    if (url === "/v1/countries") return Promise.resolve([{ code: "HRV", name: "Croatia" }, { code: "DEU", name: "Germany" }]);
    if (url === "/v1/player-list") return Promise.resolve([modric, kroos]);
    if (url === `/v1/players/${modric.player_id}/measures`) return Promise.resolve({ tracks: 10, videos: 1, seen_s: 600, measured_s: 540, distance_m: 1000, top_speed_kmh: 25, dropped_steps: 0, high_speed_m: null, sprint_m: null, sprints: 0, mean_confidence: 0.9, heat: null, events: null, halves: { confirmed: 0, proposed: 0, unknown: 1 } });
    if (url === `/v1/players/${kroos.player_id}/measures`) return Promise.resolve({ tracks: 0, videos: 0, seen_s: 0, measured_s: 0, distance_m: null, top_speed_kmh: null, dropped_steps: 0, high_speed_m: null, sprint_m: null, sprints: 0, mean_confidence: null, heat: null, events: null, halves: { confirmed: 0, proposed: 0, unknown: 0 } });
    if (url === `/v1/players/${modric.player_id}/profile-intro`) return Promise.resolve({
      player: { display_name: "Luka Modric", canonical_otsi_id: "OTSI-HRV-2026-000001", player_id: modric.player_id },
      profile: modric.profile, verified: true, verified_rule: "", stats: { games_analysed: 1, minutes_seen: 10, goals: 0, assists: null, basis: "", assists_reason: "Assists are not measured." },
      heat: null, recent_form: { ratings: null, reason: "Not measured" },
    });
    if (url === `/v1/players/${kroos.player_id}/profile-intro`) return Promise.resolve({
      player: { display_name: "Toni Kroos", canonical_otsi_id: null, player_id: kroos.player_id },
      profile: kroos.profile, verified: false, verified_rule: "", stats: { games_analysed: 0, minutes_seen: 0, goals: 0, assists: null, basis: "", assists_reason: "Assists are not measured." },
      heat: null, recent_form: { ratings: null, reason: "Not measured" },
    });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

describe("PlayersList SOT (Page 18)", () => {
  it("renders the table with PIN, tracks and coverage, the identity filter, the intro preview and the inspector", async () => {
    mockApi();
    render(<PlayersList />);
    expect(await screen.findAllByText("Luka Modric")).toBeTruthy();
    // table headers + rows
    expect(screen.getByText("OTSI PIN")).toBeInTheDocument();
    expect(screen.getByText("OTSI-HRV-2026-000001")).toBeInTheDocument();
    expect(await screen.findByText("10 in 1 videos")).toBeInTheDocument();
    expect(await screen.findByText("90%")).toBeInTheDocument();
    expect(screen.getAllByText("Confirmed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unconfirmed").length).toBeGreaterThan(0);
    expect(screen.getByText("An OTSI PIN is issued when identity is confirmed in Analysis.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review identities" })).toBeInTheDocument();
    // identity filter seg
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    // intro preview for the selected player (Modric, first row)
    await waitFor(() => expect(screen.getByText("Profile intro preview")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open full 16:9 intro" })).toBeInTheDocument();
    // inspector: the selected player's form
    expect(screen.getByLabelText("Position")).toBeInTheDocument();
    expect(screen.getByLabelText("Nationality")).toBeInTheDocument();
    expect(screen.getByText("Save profile")).toBeInTheDocument();
    expect(screen.getByText("Discard")).toBeInTheDocument();
    expect(screen.getByText("Empty fields stay empty.")).toBeInTheDocument();
  });

  it("filters the table by identity (Confirmed / Unconfirmed)", async () => {
    mockApi();
    render(<PlayersList />);
    await screen.findAllByText("Luka Modric");
    fireEvent.click(screen.getByRole("button", { name: "Confirmed" }));
    expect(screen.getAllByText("Luka Modric").length).toBeGreaterThan(0);
    expect(screen.queryByText("Toni Kroos")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unconfirmed" }));
    expect(screen.queryByText("Luka Modric")).toBeNull();
    expect(screen.getAllByText("Toni Kroos").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getAllByText("Luka Modric").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Toni Kroos").length).toBeGreaterThan(0);
  });

  it("selecting a row switches the inspector to that player", async () => {
    mockApi();
    render(<PlayersList />);
    await screen.findAllByText("Luka Modric");
    fireEvent.click(screen.getByRole("button", { name: /Toni Kroos/ }));
    await waitFor(() => expect(screen.getByLabelText("Nationality")).toHaveValue("DEU"));
  });

  it("position is the SOT's five options, and the intro link opens the Player profile intro page", async () => {
    mockApi();
    render(<PlayersList />);
    await screen.findAllByText("Luka Modric");
    // the selected player (Modric) is saved as CM, which is not one of the five: it stays as an extra option
    const pos = screen.getByLabelText("Position") as HTMLSelectElement;
    const options = Array.from(pos.options).map((o) => o.textContent);
    expect(options).toEqual(["Not recorded", "DM", "Goalkeeper", "Defender", "Midfielder", "Forward", "Central midfielder (CM)"]);
    expect(pos.value).toBe("CM");
    // "Open full 16:9 intro" goes to the intro view, not the report
    const intro = screen.getByRole("link", { name: "Open full 16:9 intro" });
    expect(intro).toHaveAttribute("href", `/players/${modric.player_id}/intro`);
  });

  it("keeps the inspector column when nothing is selected (the SOT keeps the column)", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/countries") return Promise.resolve([]);
      if (url === "/v1/player-list") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<PlayersList />);
    await waitFor(() => expect(screen.getByText(/No players yet/)).toBeInTheDocument());
    // the inspector column is still there (an empty state), not missing — and it has no form
    expect(screen.getByRole("complementary", { name: "Save profile" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).toBeNull();
    expect(screen.queryByLabelText("Position")).toBeNull();
  });
});
