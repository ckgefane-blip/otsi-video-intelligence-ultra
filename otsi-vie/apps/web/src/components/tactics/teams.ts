/** Page 05: the linked match's teams with the run's tracks a PERSON assigned to each (kit colour groups), and a team's kit groups. */
import type { Match, RunTeams } from "@otsi-vie/contracts";
import type { TeamCount } from "./TacticsHeader";

export function teamCounts(kits: RunTeams | null, match: Match | null): [TeamCount | null, TeamCount | null] {
  const count = (club: Match["home"]): TeamCount | null => club ? {
    club_id: club.id, name: club.name,
    tracks: (kits?.groups ?? []).filter((g) => g.assignment?.club_id === club.id).reduce((n, g) => n + g.tracks, 0),
  } : null;
  return [count(match?.home ?? null), count(match?.away ?? null)];
}

/** the kit groups assigned to `team` (null = all players) */
export const groupsOf = (kits: RunTeams | null, team: string): Set<number> | null =>
  team === "all" ? null : new Set((kits?.groups ?? []).filter((g) => g.assignment?.club_id === team).map((g) => g.kit_group));
