/**
 * v3 Phase E.7 (ADR-121): Pressing metrics from existing pressing events.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PressingAnalysis } from "@otsi-vie/contracts";

const videoId = "0190a000-0000-7000-8000-000000000001";

const mockAnalysis: PressingAnalysis = {
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
    },
    {
      kit_group: 1,
      team_name: "FC Dynamo",
      total_pressures: 8,
      total_regains: 3,
      overall_success_pct: 37.5,
      high_pressures: 2,
      high_press_regains: 1,
      high_press_success_pct: 50.0,
      final_third_pressures: 1,
      final_third_regains: 1,
      avg_press_height_m: 44.2,
      avg_press_height_pct: 42.1,
      measured_pressures: 8,
    },
  ],
  pressures: [
    {
      id: "0190a000-0000-7000-8000-000000000010",
      start_us: 60_000_000,
      end_us: 62_000_000,
      kit_group: 0,
      presser_track_id: "0190a000-0000-7000-8000-000000000020",
      presser_player_id: null,
      presser_name: "John Doe",
      pressed_track_id: "0190a000-0000-7000-8000-000000000021",
      pressed_player_id: null,
      pressed_name: "Jane Smith",
      regain: true,
      pitch_x: 21.0,
      pitch_y: 5.0,
      press_height_m: 73.5,
      press_height_pct: 70.0,
      is_high_press: true,
      is_final_third: true,
    },
  ],
  not_measured_reason: null,
};

vi.mock("@/lib/api", () => ({
  api: vi.fn(async (url: string) => {
    if (url.includes("/pressing")) return mockAnalysis;
    return null;
  }),
}));

import { PressingPanel } from "@/components/tactics/PressingPanel";

describe("PressingPanel (v3 Phase E.7, ADR-121)", () => {
  it("renders live pressing metrics, pitch points, and triggers seek on click", async () => {
    const onSeek = vi.fn();
    await act(async () => {
      render(
        <PressingPanel
          videoId={videoId}
          focus={true}
          match={null}
          onSeek={onSeek}
        />,
      );
    });

    expect(screen.getByText("Pressing map")).toBeTruthy();
    expect(screen.getByText("High press success")).toBeTruthy();
    expect(screen.getByText("Final third regains")).toBeTruthy();
    expect(screen.getByText("Avg press height")).toBeTruthy();

    // Check aggregated values across both teams
    // High press: 3+1 = 4 regains out of 4+2 = 6 high pressures -> 66.7% (4/6)
    expect(screen.getByText("66.7% (4/6)")).toBeTruthy();
    // Final third regains: 2 + 1 = 3
    expect(screen.getByText("3")).toBeTruthy();

    // Click pitch button to seek
    const dot = screen.getByTitle("John Doe pressed Jane Smith (Regained) · 73.5m");
    expect(dot).toBeTruthy();
    fireEvent.click(dot);
    expect(onSeek).toHaveBeenCalledWith(60_000_000);
  });
});
