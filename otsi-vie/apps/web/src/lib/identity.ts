/**
 * How the web app names players (ADR-016). Three values are never interchangeable on screen:
 *   jersey number   clothing, observed per match ("#17")
 *   track number    a temporary tracking reference inside one processing run ("track 4")
 *   OTSI Player ID  the permanent public identity, OTSI-CCC-YYYY-NNNNNN, only for REGISTERED (or RETIRED) players
 * Unknown stays unknown: a track without a confirmed decision is "Unidentified Player · track N", never a guessed name or ID.
 */
import { CANONICAL_OTSI_ID_PATTERN, type PlayerIdentity } from "@otsi-vie/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PlayerRef = { kind: "canonical"; id: string } | { kind: "player"; id: string };

/** A player route parameter: a canonical OTSI Player ID (preferred, case-sensitive) or an internal player UUID (provisional players). */
export function parsePlayerRef(raw: string): PlayerRef | null {
  const v = decodeURIComponent(raw);
  if (CANONICAL_OTSI_ID_PATTERN.test(v)) return { kind: "canonical", id: v };
  if (UUID.test(v)) return { kind: "player", id: v.toLowerCase() };
  return null;
}

export const isUuid = (v: string): boolean => UUID.test(v);

export const jerseyLabel = (n: number): string => `#${n}`;
export const trackLabel = (n: number): string => `track ${n}`;
export const unidentifiedLabel = (trackNumber: number): string => `Unidentified Player · ${trackLabel(trackNumber)}`;

/** The identity line for a player record, as the API resolved it. A provisional record never shows an ID. */
export function identityLine(p: Pick<PlayerIdentity, "display_name" | "canonical_otsi_id" | "identity_label">): string {
  switch (p.identity_label) {
    case "REGISTERED_PLAYER":
    case "RETIRED_PLAYER":
      return `${p.display_name} · ${p.canonical_otsi_id}`;
    case "MERGED_DUPLICATE":
      return `${p.display_name} · merged into ${p.canonical_otsi_id}`;
    default:
      return `${p.display_name} (provisional, no OTSI Player ID yet)`;
  }
}
