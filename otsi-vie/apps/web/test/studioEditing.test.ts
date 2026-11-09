/** B.19 (ADR-093): Clip Studio slip, snap, lane heights and the project panel rows */
import { describe, expect, it } from "vitest";
import { laneGeometry, LANE_Y, slipWindow, snapTo } from "@/components/studio/editing";
import { projectRows } from "@/components/studio/ProjectInfo";
import type { Reel } from "@otsi-vie/contracts";
import { SpotlightSettings } from "@otsi-vie/contracts";

describe("slip", () => {
  it("keeps the length, never before 0, never past the video's end", () => {
    expect(slipWindow({ in_pts_us: 5e6, out_pts_us: 8e6 }, 1e6)).toEqual({ in_pts_us: 6e6, out_pts_us: 9e6 });
    expect(slipWindow({ in_pts_us: 5e6, out_pts_us: 8e6 }, -9e6)).toEqual({ in_pts_us: 0, out_pts_us: 3e6 });
    expect(slipWindow({ in_pts_us: 5e6, out_pts_us: 8e6 }, 9e6, 10e6)).toEqual({ in_pts_us: 7e6, out_pts_us: 10e6 });
  });
});

describe("snap", () => {
  it("takes the nearest target inside the threshold, else leaves the value", () => {
    expect(snapTo(100, [90, 105, 300], 10)).toEqual({ v: 105, hit: 105 });
    expect(snapTo(100, [50, 300], 10)).toEqual({ v: 100, hit: null });
    expect(snapTo(100, [], 10).hit).toBeNull();
  });
});

describe("lane heights", () => {
  it("normal is the approved layout; tall makes Video Clips tall and the rest compact, without overlap", () => {
    expect(laneGeometry("normal").map((g) => g.y)).toEqual([...LANE_Y]);
    const t = laneGeometry("tall");
    expect(t[0]!.h).toBe(92);
    expect(t.slice(1).every((g) => g.h === 30)).toBe(true);
    for (let i = 1; i < t.length; i++) expect(t[i]!.y - t[i]!.h / 2).toBeGreaterThanOrEqual(t[i - 1]!.y + t[i - 1]!.h / 2);
    expect(t.at(-1)!.y + t.at(-1)!.h / 2).toBeLessThanOrEqual(LANE_Y.at(-1)! + 20);   // stays inside the panel
  });
});

describe("project panel", () => {
  const reel = {
    id: "00000000-0000-7000-8000-000000000001", name: "R", status: "DRAFT", version: 1, video_id: "00000000-0000-7000-8000-000000000002", run_id: null,
    player: { player_id: "00000000-0000-7000-8000-000000000003", display_name: "Test Player", canonical_otsi_id: "OTSI-NGA-2026-000001" },
    aspect: "9:16", settings: SpotlightSettings.parse({}), targets: [], stale: false, clips: [], transitions: [], duration_us: 0,
    latest_render: null, last_good_render: null, formats: [], match: null, created_at: "", updated_at: "",
  } as unknown as Reel;
  it("names the confirmed player with his ID, the frame, the look and says it was never rendered", () => {
    const rows = Object.fromEntries(projectRows(reel, null, 0));
    expect(rows.Player).toBe("Test Player · OTSI-NGA-2026-000001");
    expect(rows.Match).toBe("Video not linked to a match");
    expect(rows.Frame).toBe("Vertical 9:16");
    expect(rows.Spotlight).toBe("Standard");
    expect(rows.Music).toBe("Match sound only");
    expect(rows.File).toBe("Not rendered yet");
  });
  it("says no confirmed player when there is none", () => {
    expect(Object.fromEntries(projectRows({ ...reel, player: null }, null, 0)).Player).toBe("No confirmed player");
  });
});
