/**
 * v3 Phase E.3 (ADR-123): Formations by name web UI tests.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ShapePanels } from "@/components/tactics/Panels";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: Error }));

describe("ShapePanels Formation display & confirmation (ADR-123)", () => {
  it("renders inferred formation, stability, defensive line height, and confirms formation", async () => {
    api.mockImplementation((url: string) => {
      if (url.includes("/team-shape")) {
        return Promise.resolve({
          kit_groups: [0],
          moments: 10,
          seen_moments: 10,
          min_players: 8,
          players_per_moment: 9.5,
          width_m: { mean: 45, p10: 40, p90: 50 },
          length_m: { mean: 42, p10: 38, p90: 46 },
          compactness_m2: { mean: 1200, p10: 1000, p90: 1400 },
          variability: 0.15,
          density: new Array(560).fill(1),
          not_measured: {},
        });
      }
      if (url.includes("/formations")) {
        return Promise.resolve({
          video_id: "0193132e-5034-7bc3-9565-df048bb01001",
          teams: [
            {
              kit_group: 0,
              period: "FULL",
              formation: "4-3-3",
              formation_display: "4-3-3",
              state: "INFERRED",
              confidence: 0.85,
              stability_pct: 82,
              defensive_line_height_m: 41.5,
              defensive_line_height_pct: 40,
              buildup_shape: "3-2-4-1",
              defensive_shape: "4-5-1",
              evaluated_moments: 50,
              lines: { defenders: 4, midfielders: 3, forwards: 3 },
              decided_by: null,
              decided_by_name: null,
              decided_at: null,
              is_calibrated: true,
              not_measured_reason: null,
            },
          ],
        });
      }
      return Promise.resolve(null);
    });

    render(
      <ShapePanels
        focus={false}
        runId="run-1"
        videoId="0193132e-5034-7bc3-9565-df048bb01001"
        kits={{
          run_id: "run-1",
          match_id: "m-1",
          teams: [
            { id: "club-1", name: "Home FC", short_name: "HOM", shared: false },
            { id: "club-2", name: "Away FC", short_name: "AWY", shared: false },
          ],
          roster_verified: false,
          groups: [
            {
              kit_group: 0,
              tracks: 11,
              kit_rgb: "#1580ff",
              assignment: { club_id: "club-1", club_name: "Home FC", assignment_id: "0193132e-5034-7bc3-9565-df048bb01002" },
              sample_track_ids: [],
            },
          ],
        }}
        match={{
          id: "m-1",
          home: { id: "club-1", name: "Home FC" },
          away: { id: "club-2", name: "Away FC" },
          roster: [],
        } as any}
      />,
    );

    // Verify Inferred formation name "4-3-3" and button
    const formationText = await screen.findByText("4-3-3");
    expect(formationText).toBeDefined();

    const confirmBtn = screen.getByRole("button", { name: "Inferred (confirm?)" });
    expect(confirmBtn).toBeDefined();

    // Verify Formation stability 82 %
    expect(screen.getByText("82 %")).toBeDefined();

    // Verify Def. Line Height 41.5 m
    expect(screen.getByText("41.5 m")).toBeDefined();

    // Verify Build-up shape & Defensive shape
    expect(screen.getByText("3-2-4-1")).toBeDefined();
    expect(screen.getByText("4-5-1")).toBeDefined();

    // Click confirm formation
    api.mockResolvedValueOnce({
      kit_group: 0,
      period: "FULL",
      formation: "4-3-3",
      state: "CONFIRMED",
    });

    fireEvent.click(confirmBtn);
    expect(api).toHaveBeenCalledWith(
      "/v1/videos/0193132e-5034-7bc3-9565-df048bb01001/formations/confirm",
      expect.objectContaining({
        method: "POST",
        json: { kit_group: 0, period: "FULL", formation: "4-3-3" },
      }),
    );
  });
});
