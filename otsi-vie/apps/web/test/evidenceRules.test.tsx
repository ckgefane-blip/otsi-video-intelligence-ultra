/**
 * v3 Phase E.6 (ADR-124): Event evidence rules Web Tests.
 * Ensures that tiles and panels across Analysis Workspace and Tactics Stage
 * honestly mark unmeasured metrics with clear explanations and never fabricate values.
 */
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PressingAnalysis } from "@otsi-vie/contracts";

const videoId = "0190a000-0000-7000-8000-000000000001";

const mockUnmeasuredPPDA: PressingAnalysis = {
  video_id: videoId,
  ball_track_id: "0190a000-0000-7000-8000-000000000002",
  is_calibrated: true,
  pitch_length_m: 105,
  pitch_width_m: 68,
  teams: [
    {
      kit_group: 0,
      team_name: "FC Ercakhu",
      total_pressures: 10,
      total_regains: 6,
      overall_success_pct: 60.0,
      high_pressures: 4,
      high_press_regains: 3,
      high_press_success_pct: 75.0,
      final_third_pressures: 2,
      final_third_regains: 2,
      avg_press_height_m: 58.4,
      avg_press_height_pct: 55.6,
      measured_pressures: 10,
      ppda: null,
      ppda_status: "NOT_MEASURED",
      ppda_reason: "Not measured: insufficient sample in defensive 60% (requires >= 10 passes and >= 3 actions).",
    },
  ],
  pressures: [],
  not_measured_reason: null,
};

vi.mock("@/lib/api", () => ({
  api: vi.fn(async (url: string) => {
    if (url.includes("/pressing")) return mockUnmeasuredPPDA;
    return null;
  }),
}));

import { PressingPanel } from "@/components/tactics/PressingPanel";
import { AnalysisPanels } from "@/components/tactics/Panels";

describe("Event Evidence Rules UI (v3 Phase E.6, ADR-124)", () => {
  it("PressingPanel displays honest unmeasured reason for PPDA without fabricating a number", async () => {
    await act(async () => {
      render(<PressingPanel videoId={videoId} focus={false} match={null} />);
    });

    const ppdaMetric = screen.getByTitle(/Not measured: insufficient sample in defensive 60%/);
    expect(ppdaMetric).toBeInTheDocument();
    expect(ppdaMetric).toHaveAttribute("data-metric", "PPDA");
    expect(ppdaMetric.textContent).toContain("PPDA");
    expect(ppdaMetric.textContent).toContain("—");
  });

  it("AnalysisPanels renders Off-Ball Runs with honest evidence explanation tooltips", () => {
    render(
      <AnalysisPanels
        focus="p05-s08"
        match={null}
        runId={null}
        kits={null}
        calKey={0}
        videoId={videoId}
      />,
    );

    const totalRuns = screen.getByTitle(/requires pitch-plane player tracking and sustained velocity >= 18 km\/h without the ball/);
    expect(totalRuns).toBeInTheDocument();
    expect(totalRuns.textContent).toContain("Total Off-Ball Runs");
    expect(totalRuns.textContent).toContain("—");

    const progRuns = screen.getByTitle(/requires calibrated pitch positions and forward run progress towards opponent goal line/);
    expect(progRuns).toBeInTheDocument();
    expect(progRuns.textContent).toContain("Progressive Runs");

    const boxRuns = screen.getByTitle(/requires calibrated penalty box boundary intersection tracking/);
    expect(boxRuns).toBeInTheDocument();
    expect(boxRuns.textContent).toContain("Runs Into Box");

    const avgDist = screen.getByTitle(/requires calibrated pitch-plane coordinates for run start and end points/);
    expect(avgDist).toBeInTheDocument();
    expect(avgDist.textContent).toContain("Avg Run Distance");
  });
});
