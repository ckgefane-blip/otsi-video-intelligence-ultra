/** Page 05: team counts come only from kit groups a person assigned to a match team; unassigned or "not a team" groups count for none. */
import type { Match, RunTeams } from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";
import { groupsOf, teamCounts } from "@/components/tactics/teams";

const H = "00000000-0000-4000-8000-0000000000a1", A = "00000000-0000-4000-8000-0000000000a2";
const match = { home: { id: H, name: "Home FC", short_name: null, shared: false }, away: { id: A, name: "Away United", short_name: null, shared: false } } as unknown as Match;
const kits = { groups: [
  { kit_group: 0, kit_rgb: "#fff", tracks: 9, assignment: { assignment_id: "x", club_id: H, club_name: "Home FC" } },
  { kit_group: 1, kit_rgb: "#f00", tracks: 4, assignment: { assignment_id: "y", club_id: H, club_name: "Home FC" } },
  { kit_group: 2, kit_rgb: "#00f", tracks: 7, assignment: null },
  { kit_group: 3, kit_rgb: "#000", tracks: 2, assignment: { assignment_id: "z", club_id: null, club_name: null } },
] } as unknown as RunTeams;

describe("tactics teams", () => {
  it("count only person-assigned groups per match team", () => {
    expect(teamCounts(kits, match)).toEqual([{ club_id: H, name: "Home FC", tracks: 13 }, { club_id: A, name: "Away United", tracks: 0 }]);
    expect(teamCounts(null, null)).toEqual([null, null]);
  });
  it("give the kit groups of the chosen team, or none for all players", () => {
    expect([...groupsOf(kits, H)!]).toEqual([0, 1]);
    expect(groupsOf(kits, "all")).toBeNull();
    expect(groupsOf(kits, A)!.size).toBe(0);
  });
});
