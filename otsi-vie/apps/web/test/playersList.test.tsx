/**
 * v3 Phase E.8 (ADR-122): Player roles confirmed by a person UI tests.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlayersList } from "@/components/players/PlayersList";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: Error }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: vi.fn(() => null) }),
}));

describe("PlayersList role confirmation (ADR-122)", () => {
  it("renders players with confirmed/provisional role badges and filters by confirmed role", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/countries") return Promise.resolve([]);
      if (url === "/v1/player-list") {
        return Promise.resolve([
          {
            player_id: "0193132e-5034-7bc3-9565-df048bb01001",
            display_name: "Luka Modric",
            canonical_otsi_id: "OTSI-HRV-2026-000001",
            profile: {
              birth_date: "1985-09-09",
              age: 41,
              preferred_foot: "BOTH",
              nationality: { code: "HRV", name: "Croatia" },
              position: "CM",
              role_confirmed: true,
              role_confirmation_state: "ROLE_CONFIRMED",
              role_confirmed_by: "0193132e-user-1",
              role_confirmed_at: "2026-11-09T00:00:00.000Z",
              role_confirmed_by_name: "Lead Analyst",
              latest_team: null,
              editable: true,
            },
          },
          {
            player_id: "0193132e-5034-7bc3-9565-df048bb01002",
            display_name: "Toni Kroos",
            canonical_otsi_id: "OTSI-DEU-2026-000002",
            profile: {
              birth_date: "1990-01-04",
              age: 36,
              preferred_foot: "BOTH",
              nationality: { code: "DEU", name: "Germany" },
              position: "CM",
              role_confirmed: false,
              role_confirmation_state: "ROLE_PROVISIONAL",
              role_confirmed_by: null,
              role_confirmed_at: null,
              latest_team: null,
              editable: true,
            },
          },
        ]);
      }
      return Promise.resolve(null);
    });

    render(<PlayersList />);

    // Wait for list to render
    const modric = await screen.findByText("Luka Modric");
    expect(modric).toBeDefined();
    expect(screen.getByText("Toni Kroos")).toBeDefined();

    // Check confirmed badge on Modric and provisional badge on Kroos
    expect(screen.getByText("✓ Confirmed")).toBeDefined();
    expect(screen.getByText("Provisional")).toBeDefined();

    // Filter by position: CM with confirmedOnly active (default)
    const positionSelect = screen.getByLabelText("Filter by position");
    fireEvent.change(positionSelect, { target: { value: "CM" } });

    // Modric (confirmed CM) should remain, Kroos (provisional CM) should be filtered out
    expect(screen.queryByText("Luka Modric")).not.toBeNull();
    expect(screen.queryByText("Toni Kroos")).toBeNull();

    // Uncheck confirmed only
    const confirmedCheckbox = screen.getByLabelText("Confirmed roles only");
    fireEvent.click(confirmedCheckbox);

    // Both should now be shown
    expect(screen.queryByText("Luka Modric")).not.toBeNull();
    expect(screen.queryByText("Toni Kroos")).not.toBeNull();
  });
});
