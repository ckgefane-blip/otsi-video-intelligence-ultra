/** v3 Phase B.6 (ADR-084): the selected track's Properties card */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const U = "0190a000-0000-7000-8000-00000000000";
const now = new Date().toISOString();
const player = { player_id: `${U}5`, canonical_otsi_id: "OTSI-NGA-2026-000007", own_canonical_otsi_id: "OTSI-NGA-2026-000007", canonical_state: "ACTIVE", resolved_player_id: `${U}5`, display_name: "Ada Obi" };
const replies: Record<string, unknown> = {
  identity: { track_id: `${U}1`, decision_id: `${U}2`, state: "CONFIRMED", player, display: { kind: "IDENTIFIED", label: "Ada Obi · OTSI-NGA-2026-000007" } },
  "identity-history": [
    { decision_id: `${U}2`, state: "CONFIRMED", player: { player_id: `${U}5`, display_name: "Ada Obi", canonical_otsi_id: "OTSI-NGA-2026-000007" }, basis: "HUMAN", decided_by: { user_id: `${U}8`, name: "Kemi" }, decided_at: now, reason: "Shirt 9 seen", current: true, supersedes_id: `${U}3` },
    { decision_id: `${U}3`, state: "CONFIRMED", player: { player_id: `${U}6`, display_name: "Wrong Guy", canonical_otsi_id: null }, basis: "HUMAN", decided_by: null, decided_at: now, reason: null, current: false, supersedes_id: null },
  ],
  jersey: { track_id: `${U}1`, state: "READ", number: "9", confidence: 0.91, side: "BACK", candidate_frames: 4, frames: [{ pts_us: 1, number: "9", confidence: 0.9, texts: [] }], alternatives: [], decision: null },
  candidates: { track_id: `${U}1`, match_id: null, team: null, shirt_number: null, candidates: [{ player_id: `${U}5`, display_name: "Ada Obi", canonical_otsi_id: null, strength: 0.8, signals: [], conflicts: [] }] },
  links: [{ link_id: `${U}a`, direction: "after", other: { track_id: `${U}b`, track_number: 12, first_pts_us: 60_000_000, last_pts_us: 70_000_000, label: "x", identity_state: "UNRESOLVED", confirmed_player: null }, score: 0.7, crosses_cut: true, gap_us: 1, state: "SUGGESTED", decision_id: null }],
  "look-alikes": { track_id: `${U}1`, player: null, seeds: 1, items: [] },
};
vi.mock("@/lib/api", () => ({ api: vi.fn(async (path: string) => replies[path.split("/").pop()!] ?? null) }));
vi.mock("@/components/evidence/Evidence", () => ({ Evidence: () => null }));

import { identityLine, PropertiesDialog } from "@/components/workspace/PropertiesCard";
import type { Shared } from "@/components/workspace/shared";

const track = { track_id: `${U}1`, track_number: 4, class_name: "PLAYER", first_pts_us: 5_000_000, last_pts_us: 25_000_000, observation_count: 40, mean_confidence: 0.83, kit_group: 0, label: "x" };

describe("Properties card", () => {
  it("names the player only for a confirmed identity", () => {
    expect(identityLine({ state: "CANDIDATE", player: null } as never, null)).toEqual({ title: "Suggested", detail: "A suggestion only: nobody has confirmed who this is" });
    expect(identityLine(null, null).title).toBe("Reading…");
  });

  it("shows the track, the identity with who confirmed it and why, replaced decisions, evidence and links; a link selects that track", async () => {
    const seek = vi.fn(), select = vi.fn(), close = vi.fn();
    const s = { ws: { seek, select }, kits: null } as unknown as Shared;
    await act(async () => { render(<PropertiesDialog s={s} track={track as never} open onOpenChange={close} />); });
    expect(screen.getByText("Properties · track 4")).toBeTruthy();
    expect(document.querySelector("[data-props-who]")!.textContent).toBe("Ada Obi · OTSI-NGA-2026-000007");
    expect(screen.getByText(/Confirmed by a person \(Kemi\)/)).toBeTruthy();
    expect(screen.getByText("Why: Shirt 9 seen")).toBeTruthy();
    expect(document.querySelectorAll("[data-props-history] li")).toHaveLength(1);
    expect(screen.getByText(/Wrong Guy/)).toBeTruthy();
    expect(screen.getByText(/Suggestions \(ranked, not a decision\)/)).toBeTruthy();
    expect(document.querySelector("[data-props-looks]")!.getAttribute("data-props-looks")).toBe("0");
    fireEvent.click(screen.getByText("Track 12"));
    expect(select).toHaveBeenCalledWith(`${U}b`);
    expect(seek).toHaveBeenCalledWith(60_000_000);
    expect(close).toHaveBeenCalledWith(false);
  });
});
