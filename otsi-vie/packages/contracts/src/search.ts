/**
 * v3 Phase A.8 (S03, ADR-070): global search. What the organization has recorded whose name matches: matches (videos), players,
 * reels and projects; the caller's organization and project access only.
 *
 * v3 Phase B.10 (ADR-086): Smart Search over a search index. It also finds moments (the engine's goals, shots, passes, tackles,
 * interceptions, pressures and set pieces, with the player when a person confirmed him) and the markers people wrote on videos.
 * Every word must match the start of a word of the item (any order, accents and case ignored). Filters may be typed in the field:
 *   type:match|player|reel|project|moment|marker   only that kind (several allowed)
 *   event:goal|shot|pass|tackle|interception|pressure|set_piece   only moments of that event (implies type:moment)
 *   is:analysed | is:not_analysed                 matches with or without a finished analysis
 *   is:confirmed | is:provisional                 players with or without an OTSI Player ID; moments of a confirmed player
 * The rules are pure functions here, shared by the API (which indexes and queries with them) and the page (which shows the filters).
 */
import { z } from "zod";

export const SearchKind = z.enum(["MATCH", "PLAYER", "REEL", "PROJECT", "MOMENT", "MARKER"]);
export type SearchKind = z.infer<typeof SearchKind>;
export const SearchHit = z.object({
  kind: SearchKind,
  id: z.string().uuid(),
  title: z.string(),
  /** one line of recorded facts (match: its video title and whether analysed; player: OTSI Player ID or provisional; reel: its player) */
  detail: z.string().nullable(),
  /** players: the OTSI Player ID (the report's address when there is one) */
  ref: z.string().nullable(),
  /** moments and markers: the video and the time they are at */
  video_id: z.string().uuid().nullable().optional(),
  at_us: z.number().int().nonnegative().nullable().optional(),
  period: z.enum(["H1", "H2"]).nullable().optional(),
});
export type SearchHit = z.infer<typeof SearchHit>;
export const SearchResponse = z.object({ q: z.string(), hits: z.array(SearchHit) });
export type SearchResponse = z.infer<typeof SearchResponse>;
export const SearchQuery = z.object({ q: z.string().trim().min(2).max(80) });

/** where a hit opens */
export function hitHref(h: SearchHit): string {
  switch (h.kind) {
    case "MATCH": return `/analysis?video=${h.id}`;
    case "PLAYER": return `/reports/players/${encodeURIComponent(h.ref ?? h.id)}`;
    case "REEL": return `/reels/${h.id}`;
    case "PROJECT": return `/library?q=${encodeURIComponent(h.title)}`;
    case "MOMENT":
    case "MARKER": {
      const t = h.at_us ? `&t=${Math.round(h.at_us / 100_000) / 10}` : "";
      return h.video_id ? `/analysis?video=${h.video_id}${t}` : "/analysis";
    }
  }
}

/** the event types a moment can be, and the words that name them */
export const SEARCH_EVENTS = ["GOAL", "SHOT", "PASS", "TACKLE", "INTERCEPTION", "PRESSURE", "SET_PIECE"] as const;
export type SearchEvent = (typeof SEARCH_EVENTS)[number];
export const SEARCH_EVENT_LABEL: Record<SearchEvent, string> = {
  GOAL: "Goal", SHOT: "Shot", PASS: "Pass", TACKLE: "Tackle", INTERCEPTION: "Interception", PRESSURE: "Pressure", SET_PIECE: "Set piece",
};

/** the words of a text as the index keeps them: lower case, accents removed, split at anything not a letter or digit, at most 64 long */
export function searchTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const w of text.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w) out.add(w.slice(0, 64));
  return [...out];
}

export interface SmartQuery {
  /** the words, as index terms; each must start a word of the item */
  words: string[];
  /** only these kinds (empty: all) */
  kinds: SearchKind[];
  /** only moments of these events (empty: all) */
  events: SearchEvent[];
  /** only moments and markers in this match period (H1, H2) */
  period: "H1" | "H2" | null;
  /** player filter: name or identifier */
  player: string | null;
  /** role/position filter: confirmed position (ADR-122) */
  role: string | null;
  /** filter by role confirmation: true = only confirmed roles (default for role filters) */
  role_confirmed_only: boolean | null;
  analysed: boolean | null;
  confirmed: boolean | null;
  /** filters typed but not understood, said back to the person, never guessed */
  unknown: string[];
}

const KIND_WORD: Record<string, SearchKind> = {
  match: "MATCH", matches: "MATCH", video: "MATCH", videos: "MATCH", player: "PLAYER", players: "PLAYER", reel: "REEL", reels: "REEL",
  project: "PROJECT", projects: "PROJECT", moment: "MOMENT", moments: "MOMENT", event: "MOMENT", events: "MOMENT", marker: "MARKER",
  markers: "MARKER", note: "MARKER", notes: "MARKER",
};

/** a typed query split into words and filters (`type:`, `event:`, `period:`, `half:`, `player:`, `role:`, `is:`) */
export function parseSmartQuery(q: string): SmartQuery {
  const out: SmartQuery = { words: [], kinds: [], events: [], period: null, player: null, role: null, role_confirmed_only: null, analysed: null, confirmed: null, unknown: [] };
  const words: string[] = [];
  const tokens = q.trim().match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
  for (let tok of tokens) {
    if (tok.startsWith('"') && tok.endsWith('"') && tok.length >= 2) {
      tok = tok.slice(1, -1);
    }
    const m = /^(type|event|is|period|half|player|role|position):(.*)$/i.exec(tok);
    if (!m) { words.push(tok); continue; }
    const key = m[1]!.toLowerCase();
    let v = m[2]!.toLowerCase().replace(/-/g, "_");
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1);
    if (key === "type" && KIND_WORD[v]) { if (!out.kinds.includes(KIND_WORD[v]!)) out.kinds.push(KIND_WORD[v]!); continue; }
    if (key === "event") {
      const e = SEARCH_EVENTS.find((x) => x.toLowerCase() === v || `${x.toLowerCase()}s` === v || (x === "SET_PIECE" && (v === "setpiece" || v === "set_pieces")));
      if (e) { if (!out.events.includes(e)) out.events.push(e); if (!out.kinds.includes("MOMENT")) out.kinds.push("MOMENT"); continue; }
    }
    if (key === "is") {
      if (v === "analysed" || v === "analyzed") { out.analysed = true; continue; }
      if (v === "not_analysed" || v === "not_analyzed" || v === "unanalysed") { out.analysed = false; continue; }
      if (v === "confirmed_role" || v === "confirmed_position") { out.role_confirmed_only = true; continue; }
      if (v === "provisional_role" || v === "provisional_position") { out.role_confirmed_only = false; continue; }
      if (v === "confirmed") { out.confirmed = true; continue; }
      if (v === "provisional" || v === "unconfirmed") { out.confirmed = false; continue; }
    }
    if (key === "period" || key === "half") {
      if (v === "h1" || v === "1" || v === "first_half" || v === "firsthalf") { out.period = "H1"; if (!out.kinds.includes("MOMENT")) out.kinds.push("MOMENT"); continue; }
      if (v === "h2" || v === "2" || v === "second_half" || v === "secondhalf") { out.period = "H2"; if (!out.kinds.includes("MOMENT")) out.kinds.push("MOMENT"); continue; }
    }
    if (key === "player") {
      const rawVal = m[2]!.trim().replace(/^"|"$/g, "");
      if (rawVal) {
        out.player = rawVal;
        const pTerms = searchTerms(rawVal);
        for (const pt of pTerms) words.push(pt);
        continue;
      }
    }
    if (key === "role" || key === "position") {
      const rawVal = m[2]!.trim().replace(/^"|"$/g, "").toUpperCase();
      if (rawVal) {
        out.role = rawVal;
        out.role_confirmed_only = true;
        if (!out.kinds.includes("PLAYER")) out.kinds.push("PLAYER");
        continue;
      }
    }
    out.unknown.push(tok);
  }
  out.words = searchTerms(words.join(" "));
  return out;
}

/** true when the query asks for something: a word or a filter */
export const hasCriteria = (s: SmartQuery) => s.words.length > 0 || s.kinds.length > 0 || s.events.length > 0 || s.period !== null || s.player !== null || s.role !== null || s.role_confirmed_only !== null || s.analysed !== null || s.confirmed !== null;

/** the filter help shown under the search field */
export const SMART_HINT = "Filters: type:moment, event:goal, role:am, period:h1|h2, player:name, is:analysed, is:confirmed, is:confirmed_role";

/**
 * v3 Phase B.11 (ADR-087): Smart Bins. A bin is a person's saved Smart Search; it fills itself, so what it holds is whatever the search
 * finds now (a new goal, a new marker, a newly confirmed player). Kept in the person's saved searches as `{ "smart": "<query>" }`.
 */
export const SmartBin = z.object({
  id: z.string().uuid(),
  name: z.string(),
  q: z.string(),
  /** what it holds now (capped at BIN_CAP per kind; `more` when a kind reached it) */
  count: z.number().int().nonnegative(),
  more: z.boolean(),
  created_at: z.string(),
});
export type SmartBin = z.infer<typeof SmartBin>;
export const BIN_CAP = 200;
export const CreateSmartBinRequest = z.object({ name: z.string().trim().min(1).max(80), q: z.string().trim().min(2).max(80) });
export type CreateSmartBinRequest = z.infer<typeof CreateSmartBinRequest>;
export const SmartBinItems = z.object({ bin: SmartBin, hits: z.array(SearchHit) });
export type SmartBinItems = z.infer<typeof SmartBinItems>;

/** the reel's suggested moments that hold one of a bin's moments or markers on that video (time inside the moment) */
export function binMoments<M extends { in_pts_us: number; out_pts_us: number }>(moments: M[], hits: SearchHit[], videoId: string): M[] {
  const at = hits.filter((h) => (h.kind === "MOMENT" || h.kind === "MARKER") && h.video_id === videoId && h.at_us !== null && h.at_us !== undefined).map((h) => h.at_us!);
  return moments.filter((m) => at.some((t) => t >= m.in_pts_us && t <= m.out_pts_us));
}
