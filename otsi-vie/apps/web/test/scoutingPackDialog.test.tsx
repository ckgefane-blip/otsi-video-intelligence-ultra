/**
 * Scouting Pack dialog (ADR-142): the Export page's Pack builder — the reel and its source, the 10-token cost,
 * the manifest of what is inside, and the download once built. The API is mocked; the manifest logic itself is
 * unit-tested in scoutingPack.test.ts, and the HTTP build in apps/api/test/scoutingPack.api.test.ts (host only).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildScoutingPackManifest, ScoutingPack, type Reel } from "@otsi-vie/contracts";

const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error { constructor(readonly status: number, code: string, message: string) { super(message); } } }));

import { ScoutingPackDialog } from "@/components/exportstage/ScoutingPackDialog";

const PLAYER = "44444444-4444-4444-8444-444444444444";
const REEL = "55555555-5555-4555-8555-555555555555";

const reel = {
  id: REEL,
  name: "Test Player — Nart v Ercakhu",
  source: "MATCH",
  best_moments_rule_version: "2.1",
  last_good_render: { id: "66666666-6666-4666-8666-666666666666", has_output: true },
  player: { player_id: PLAYER, display_name: "Test Player", canonical_otsi_id: "OTSI-NGA-2026-000001" },
} as unknown as Reel;

const pack: ScoutingPack = ScoutingPack.parse({
  id: "77777777-7777-4777-8777-777777777777",
  player_id: PLAYER,
  reel_id: REEL,
  reel_source: "SINGLE_MATCH",
  state: "READY",
  manifest: buildScoutingPackManifest({
    player_id: PLAYER, display_name: "Test Player", otsi_pin: "OTSI-NGA-2026-000001",
    reel_id: REEL, reel_name: reel.name, reel_source: "SINGLE_MATCH", match_titles: ["Nart v Ercakhu"],
    reel_rendered: true, include_report: true, report: { state: "INCLUDED", reason: null },
    include_analyst_brief: true,
    analyst_assessment: { status: "DRAFT", scout_brief: null, published_by_name: null, published_at: null },
  }),
  cost_tokens: 10,
  requested_by_name: "Owner",
  created_at: "2026-11-11T06:00:00.000Z",
  completed_at: "2026-11-11T06:00:00.000Z",
  zip: { bytes: 12_000_000, download_url: "/api/v1/media/zip?download=1" },
});

beforeEach(() => { api.mockReset(); });

describe("ScoutingPackDialog", () => {
  it("shows the Single Match Spotlight, the 10-token cost, and the manifest with the draft brief excluded", async () => {
    api.mockResolvedValueOnce([]);
    render(<ScoutingPackDialog reel={reel} canWrite open onOpenChange={() => undefined} />);
    await waitFor(() => expect(screen.getByText("No Scouting Pack yet for this player.")).toBeTruthy());
    expect(screen.getByText("Scouting Pack — Single Match Spotlight")).toBeTruthy();
    expect(screen.getByText(/10 tokens for the whole Pack/)).toBeTruthy();
    expect(screen.queryByText(/Render the reel first/)).toBeNull(); // the reel has a finished render, so building is allowed
  });

  it("builds the Pack and lists it with its manifest and download", async () => {
    api.mockResolvedValueOnce([]).mockResolvedValueOnce(pack);
    render(<ScoutingPackDialog reel={reel} canWrite open onOpenChange={() => undefined} />);
    await waitFor(() => expect(screen.getByText("No Scouting Pack yet for this player.")).toBeTruthy());
    fireEvent.click(screen.getByText(/Build the Scouting Pack/));
    await waitFor(() => expect(screen.getByText("Scouting Pack built — 10 tokens.")).toBeTruthy());
    expect(api).toHaveBeenCalledWith(`/v1/players/${PLAYER}/scouting-packs`, expect.objectContaining({ method: "POST" }));
    const row = screen.getByText(/Scouting Pack — Test Player/);
    expect(row).toBeTruthy();
    expect(document.querySelector("[data-scouting-pack]")?.textContent).toContain("Best Moment Rule v2.1");
    expect(screen.getByText(/Download the Pack/)).toBeTruthy();
    expect(document.querySelector('[data-pack-item="AI_ANALYST_BRIEF"]')?.textContent).toContain("not included (draft, not published)");
  });

  it("names the failure when the build is refused", async () => {
    const { ApiProblem } = await import("@/lib/api");
    api.mockResolvedValueOnce([]).mockRejectedValueOnce(new ApiProblem(409, "NOT_RENDERED", "Render the reel first: the Scouting Pack holds the finished reel file."));
    render(<ScoutingPackDialog reel={reel} canWrite open onOpenChange={() => undefined} />);
    await waitFor(() => expect(screen.getByText("No Scouting Pack yet for this player.")).toBeTruthy());
    fireEvent.click(screen.getByText(/Build the Scouting Pack/));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toContain("Render the reel first");
  });
});
