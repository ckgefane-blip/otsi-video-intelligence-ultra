/**
 * v3 Phase B.10 (ADR-086): the search index (read model) behind Smart Search.
 *
 * One `search_documents` row per findable item of an organization, its words in `search_terms` (the shared `searchTerms()` rules):
 *   MATCH    a video (with its linked match: clubs, competition, kick-off), analysed or not
 *   PLAYER   a player the organization created or confirmed on one of its videos (name, aliases, OTSI Player ID)
 *   REEL     a reel (name, its player)
 *   PROJECT  a project (name, description)
 *   MOMENT   an engine event of the video's latest finished ball track: goal, shot, pass, tackle, interception, pressure, set piece; the
 *            player's name only when a person confirmed his identity, otherwise his track number. Events a person rejected are left out.
 *   MARKER   a marker a person wrote on a video
 *
 * How it stays current:
 *   events   the outbox subscriber `search.index` re-indexes the aggregate an event is about, in the delivery transaction
 *   catch-up before every search, `catchUp()` re-indexes whatever changed in the canonical tables since the organization's watermark
 *            (minus a 3 s overlap for transactions that committed late), so audited changes without an event, and anything written by
 *            the workers, are found too. The first catch-up (or a new rules version) rebuilds the organization.
 * All writes for an organization first lock its `search_index_state` row, so two writers never interleave.
 *
 * The index never decides access: SearchService re-checks the canonical rows on every query.
 */
import { SEARCH_EVENTS, SEARCH_EVENT_LABEL, searchTerms, type SearchEvent, type SearchKind } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import type { Executor } from "../../core/db";
import { matchLabel } from "../overview/context";

/** the indexing rules' version: raising it rebuilds every organization at its next search */
export const INDEX_VERSION = 3;
const OVERLAP_S = 3;

interface Doc {
  kind: SearchKind; entity_id: string; video_id?: string | null; at_us?: number | null; period?: "H1" | "H2" | null;
  title: string; detail: string | null; ref?: string | null;
  event_type?: string | null; analysed?: boolean | null; confirmed?: boolean | null; sort_at: string;
  /** words of the title (ranked higher) and of everything else */
  titleText: string; otherText: string;
}

const rows = async (ex: Executor, sql: string, params: unknown[]) => (await ex.query<RowDataPacket[]>(sql, params))[0];
const cut = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
export function clock(us: number): string {
  const s = Math.max(0, Math.floor(us / 1e6)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** delete the documents in scope, then write `docs` and their words */
async function replace(ex: Executor, org: string, scope: { sql: string; params: unknown[] }, docs: Doc[]): Promise<void> {
  await ex.query(`DELETE FROM search_documents WHERE organization_id = ? AND ${scope.sql}`, [org, ...scope.params]);
  for (let i = 0; i < docs.length; i += 200) {
    const part = docs.slice(i, i + 200);
    await ex.query(
      `INSERT INTO search_documents (organization_id, kind, entity_id, video_id, at_us, period, title, detail, ref, event_type, analysed, confirmed, sort_at) VALUES ${part.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`,
      part.flatMap((d) => [org, d.kind, d.entity_id, d.video_id ?? null, d.at_us ?? null, d.period ?? null, cut(d.title), d.detail === null ? null : cut(d.detail), d.ref ?? null,
        d.event_type ?? null, d.analysed === undefined || d.analysed === null ? null : d.analysed ? 1 : 0, d.confirmed === undefined || d.confirmed === null ? null : d.confirmed ? 1 : 0, d.sort_at]));
    const ids = await rows(ex, `SELECT id, kind, entity_id FROM search_documents WHERE organization_id = ? AND (kind, entity_id) IN (${part.map(() => "(?, ?)").join(", ")})`,
      [org, ...part.flatMap((d) => [d.kind, d.entity_id])]);
    const idOf = new Map(ids.map((r) => [`${r.kind}:${r.entity_id}`, r.id as number]));
    const terms: [number, string, number][] = [];
    for (const d of part) {
      const id = idOf.get(`${d.kind}:${d.entity_id}`);
      if (id === undefined) continue;
      const t = searchTerms(d.titleText).slice(0, 60), o = searchTerms(d.otherText).filter((w) => !t.includes(w)).slice(0, 140);
      for (const w of t) terms.push([id, w, 1]);
      for (const w of o) terms.push([id, w, 0]);
    }
    for (let j = 0; j < terms.length; j += 1000) {
      const tp = terms.slice(j, j + 1000);
      await ex.query(`INSERT IGNORE INTO search_terms (doc_id, organization_id, term, field) VALUES ${tp.map(() => "(?, ?, ?, ?)").join(", ")}`, tp.flatMap(([id, w, f]) => [id, org, w, f]));
    }
  }
}

/** a video: its MATCH document, its moments and its markers */
export async function indexVideo(ex: Executor, org: string, videoId: string): Promise<void> {
  const [v] = await rows(ex,
    `SELECT v.id, COALESCE(v.title, v.original_filename, 'Untitled video') AS title, v.title AS own_title, v.original_filename, v.created_at, v.removed_at,
            COALESCE(hc.short_name, hc.canonical_name) AS home, COALESCE(ac.short_name, ac.canonical_name) AS away, hc.canonical_name AS home_full, ac.canonical_name AS away_full,
            m.competition, m.kickoff_at,
            EXISTS (SELECT 1 FROM pipeline_runs r WHERE r.video_id = v.id AND r.organization_id = v.organization_id AND r.status = 'SUCCEEDED') AS analysed
       FROM video_sources v LEFT JOIN matches m ON m.id = v.match_id AND m.organization_id = v.organization_id AND m.removed_at IS NULL
       LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
      WHERE v.id = ? AND v.organization_id = ?`, [videoId, org]);
  const scope = { sql: "video_id = ? AND kind IN ('MATCH', 'MOMENT', 'MARKER')", params: [videoId] };
  if (!v || v.removed_at) { await replace(ex, org, scope, []); return; }
  const label = matchLabel(v), name = label ?? (v.title as string);
  const matchWords = [v.title, v.original_filename, v.home, v.away, v.home_full, v.away_full, v.competition].filter(Boolean).join(" ");
  const docs: Doc[] = [{
    kind: "MATCH", entity_id: videoId, video_id: videoId, title: name, detail: `${label ? `${v.title} · ` : ""}${Number(v.analysed) ? "analysed" : "not analysed yet"}`,
    analysed: !!Number(v.analysed), sort_at: v.created_at, titleText: `${name} ${v.title}`, otherText: matchWords,
  }];
  const [mp] = await rows(ex, "SELECT first_start_us, first_end_us, second_start_us, second_end_us FROM match_periods WHERE video_id = ? AND organization_id = ?", [videoId, org]);
  const periodOf = (at: number): "H1" | "H2" | null => {
    if (!mp) return null;
    const t = Number(at);
    if (t >= Number(mp.first_start_us) && t <= Number(mp.first_end_us)) return "H1";
    if (mp.second_start_us !== null && mp.second_end_us !== null && t >= Number(mp.second_start_us) && t <= Number(mp.second_end_us)) return "H2";
    return null;
  };
  const [bt] = await rows(ex, "SELECT id FROM ball_tracks WHERE video_id = ? AND organization_id = ? AND status = 'SUCCEEDED' ORDER BY created_at DESC LIMIT 1", [videoId, org]);
  if (bt) {
    const ev = await rows(ex,
      `SELECT e.id, e.event_type, e.start_pts_us, ta.internal_track_number AS a_no, tb.internal_track_number AS b_no, pa.display_name AS a_name, pb.display_name AS b_name
         FROM event_candidates e
         LEFT JOIN tracks ta ON ta.id = e.primary_track_id LEFT JOIN tracks tb ON tb.id = e.secondary_track_id
         LEFT JOIN v_track_current_identity ia ON ia.track_id = e.primary_track_id AND ia.state = 'CONFIRMED' LEFT JOIN players pa ON pa.id = ia.player_id
         LEFT JOIN v_track_current_identity ib ON ib.track_id = e.secondary_track_id AND ib.state = 'CONFIRMED' LEFT JOIN players pb ON pb.id = ib.player_id
        WHERE e.ball_track_id = ? AND e.video_id = ? AND e.event_type IN (${SEARCH_EVENTS.map(() => "?").join(", ")})
          AND NOT EXISTS (SELECT 1 FROM event_decisions d WHERE d.event_id = e.id AND d.decision = 'REJECT'
                          AND d.decided_at = (SELECT MAX(d2.decided_at) FROM event_decisions d2 WHERE d2.event_id = e.id))
        ORDER BY e.start_pts_us LIMIT 5000`, [bt.id, videoId, ...SEARCH_EVENTS]);
    for (const e of ev) {
      const kind = SEARCH_EVENT_LABEL[e.event_type as SearchEvent];
      const who = (n: string | null, no: number | null) => n ?? (no ? `track ${no}` : null);
      const a = who(e.a_name, e.a_no), b = who(e.b_name, e.b_no);
      const people = e.event_type === "PASS" && a && b ? `${a} → ${b}` : a ?? "player not identified";
      const atUs = Number(e.start_pts_us);
      docs.push({
        kind: "MOMENT", entity_id: e.id, video_id: videoId, at_us: atUs, period: periodOf(atUs), event_type: e.event_type, confirmed: !!e.a_name,
        title: `${kind} · ${clock(atUs)}`, detail: `${people} · ${name}`, sort_at: v.created_at,
        titleText: `${kind} ${e.a_name ?? ""}`, otherText: `${e.b_name ?? ""} ${matchWords}`,
      });
    }
  }
  const mk = await rows(ex, "SELECT id, at_pts_us, body, created_at FROM video_markers WHERE video_id = ? AND organization_id = ? AND removed_at IS NULL ORDER BY at_pts_us LIMIT 2000", [videoId, org]);
  for (const m of mk) {
    const atUs = Number(m.at_pts_us);
    docs.push({ kind: "MARKER", entity_id: m.id, video_id: videoId, at_us: atUs, period: periodOf(atUs), title: m.body, detail: `Marker · ${clock(atUs)} · ${name}`,
      sort_at: m.created_at, titleText: m.body, otherText: matchWords });
  }
  await replace(ex, org, scope, docs);
}

/** a player, if the organization created him or a person confirmed him on one of its videos (merged records are left out) */
export async function indexPlayer(ex: Executor, org: string, playerId: string): Promise<void> {
  const [pl] = await rows(ex,
    `SELECT pl.id, pl.display_name, pl.canonical_otsi_id, pl.primary_position, pl.role_confirmation_state, pl.created_at, pl.updated_at,
            (SELECT GROUP_CONCAT(a.alias SEPARATOR ' ') FROM player_aliases a WHERE a.player_id = pl.id) AS aliases
       FROM players pl
      WHERE pl.id = ? AND pl.merged_into_player_id IS NULL
        AND (pl.created_by_organization_id = ? OR EXISTS (SELECT 1 FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
              WHERE ci.player_id = pl.id AND ci.state = 'CONFIRMED' AND v.organization_id = ? AND v.removed_at IS NULL))`, [playerId, org, org]);
  const scope = { sql: "kind = 'PLAYER' AND entity_id = ?", params: [playerId] };
  if (!pl) { await replace(ex, org, scope, []); return; }
  const isConfirmedRole = pl.role_confirmation_state === "ROLE_CONFIRMED" && pl.primary_position;
  const roleDetail = isConfirmedRole ? ` · ${pl.primary_position} (confirmed)` : "";
  const roleText = isConfirmedRole ? ` ${pl.primary_position}` : "";
  await replace(ex, org, scope, [{
    kind: "PLAYER", entity_id: pl.id, title: pl.display_name, detail: `${pl.canonical_otsi_id ?? "provisional (no OTSI Player ID yet)"}${roleDetail}`, ref: pl.canonical_otsi_id ?? null,
    confirmed: !!pl.canonical_otsi_id, sort_at: pl.updated_at ?? pl.created_at, titleText: `${pl.display_name} ${pl.aliases ?? ""}`, otherText: `${pl.canonical_otsi_id ?? ""}${roleText}`,
  }]);
}

export async function indexReel(ex: Executor, org: string, reelId: string): Promise<void> {
  const [r] = await rows(ex, `SELECT r.id, r.name, r.updated_at, r.removed_at, pl.display_name FROM reel_projects r LEFT JOIN players pl ON pl.id = r.player_id
    WHERE r.id = ? AND r.organization_id = ?`, [reelId, org]);
  const scope = { sql: "kind = 'REEL' AND entity_id = ?", params: [reelId] };
  if (!r || r.removed_at) { await replace(ex, org, scope, []); return; }
  await replace(ex, org, scope, [{ kind: "REEL", entity_id: r.id, title: r.name ?? "Untitled reel", detail: r.display_name ? `Reel of ${r.display_name}` : "Reel",
    sort_at: r.updated_at, titleText: r.name ?? "", otherText: r.display_name ?? "" }]);
}

export async function indexProject(ex: Executor, org: string, projectId: string): Promise<void> {
  const [r] = await rows(ex, "SELECT id, name, description, updated_at, removed_at FROM projects WHERE id = ? AND organization_id = ?", [projectId, org]);
  const scope = { sql: "kind = 'PROJECT' AND entity_id = ?", params: [projectId] };
  if (!r || r.removed_at) { await replace(ex, org, scope, []); return; }
  await replace(ex, org, scope, [{ kind: "PROJECT", entity_id: r.id, title: r.name, detail: "Project: open it in the Library", sort_at: r.updated_at,
    titleText: r.name, otherText: r.description ?? "" }]);
}

/** lock the organization's index state (creating it); returns it, or null when it has never been built */
async function lockState(ex: Executor, org: string): Promise<{ version: number; watermark: string } | null> {
  const [s] = await rows(ex, "SELECT version, watermark FROM search_index_state WHERE organization_id = ? FOR UPDATE", [org]);
  return s ? { version: Number(s.version), watermark: s.watermark } : null;
}

/** bring the organization's index up to date with the canonical tables (in the caller's transaction) */
export async function catchUp(ex: Executor, org: string): Promise<{ rebuilt: boolean; reindexed: number }> {
  const [{ now }] = await rows(ex, "SELECT NOW(6) AS now", []) as [{ now: string }];
  // the epoch-start watermark as a Date parameter: on MySQL it arrives as '1970-01-01 00:00:01' (the
  // literal it replaces), on SQLite the adapter stores it as 1000 ms. A datetime string literal cannot
  // go into an INTEGER-ms STRICT column.
  await ex.query("INSERT IGNORE INTO search_index_state (organization_id, version, watermark) VALUES (?, 0, ?)", [org, new Date(1000)]);
  const st = (await lockState(ex, org))!;
  const rebuild = st.version !== INDEX_VERSION;
  const videos = new Set<string>(), players = new Set<string>(), reels = new Set<string>(), projects = new Set<string>();
  const add = (set: Set<string>, rs: RowDataPacket[]) => rs.forEach((r) => r.id && set.add(r.id as string));
  if (rebuild) {
    await ex.query("DELETE FROM search_documents WHERE organization_id = ?", [org]);
    add(videos, await rows(ex, "SELECT id FROM video_sources WHERE organization_id = ? AND removed_at IS NULL", [org]));
    add(players, await rows(ex, `SELECT pl.id FROM players pl WHERE pl.merged_into_player_id IS NULL AND (pl.created_by_organization_id = ? OR EXISTS (SELECT 1 FROM v_track_current_identity ci
      JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id WHERE ci.player_id = pl.id AND ci.state = 'CONFIRMED' AND v.organization_id = ?))`, [org, org]));
    add(reels, await rows(ex, "SELECT id FROM reel_projects WHERE organization_id = ? AND removed_at IS NULL", [org]));
    add(projects, await rows(ex, "SELECT id FROM projects WHERE organization_id = ? AND removed_at IS NULL", [org]));
  } else {
    const w = st.watermark, since = [org, w];
    const changed = `GREATEST(x.created_at, COALESCE(x.updated_at, x.created_at), COALESCE(x.removed_at, x.created_at)) > ? - INTERVAL ${OVERLAP_S} SECOND`;
    add(videos, await rows(ex, `SELECT x.id FROM video_sources x WHERE x.organization_id = ? AND ${changed}`, since));
    add(videos, await rows(ex, `SELECT v.id FROM matches x JOIN video_sources v ON v.match_id = x.id AND v.organization_id = x.organization_id WHERE x.organization_id = ? AND ${changed}`, since));
    const recent = `> ? - INTERVAL ${OVERLAP_S} SECOND`;
    add(videos, await rows(ex, `SELECT video_id AS id FROM ball_tracks WHERE organization_id = ? AND GREATEST(created_at, COALESCE(finished_at, created_at)) ${recent}`, [org, w]));
    add(videos, await rows(ex, `SELECT video_id AS id FROM pipeline_runs WHERE organization_id = ? AND GREATEST(created_at, COALESCE(finished_at, created_at)) ${recent}`, [org, w]));
    add(videos, await rows(ex, `SELECT video_id AS id FROM match_periods WHERE organization_id = ? AND updated_at ${recent}`, [org, w]));
    add(videos, await rows(ex, `SELECT video_id AS id FROM video_markers WHERE organization_id = ? AND GREATEST(created_at, COALESCE(removed_at, created_at)) ${recent}`, [org, w]));
    add(videos, await rows(ex, `SELECT DISTINCT e.video_id AS id FROM event_decisions d JOIN event_candidates e ON e.id = d.event_id JOIN video_sources v ON v.id = e.video_id
      WHERE v.organization_id = ? AND d.decided_at ${recent}`, [org, w]));
    const decided = await rows(ex, `SELECT DISTINCT t.video_id, d.player_id FROM track_identity_decisions d JOIN tracks t ON t.id = d.track_id JOIN video_sources v ON v.id = t.video_id
      WHERE v.organization_id = ? AND d.decided_at ${recent}`, [org, w]);
    for (const r of decided) { videos.add(r.video_id); if (r.player_id) players.add(r.player_id); }
    // players renamed or given aliases: those of this organization, and the videos where he is a confirmed identity (moment names)
    const pChanged = await rows(ex, `SELECT pl.id FROM players pl WHERE (GREATEST(pl.created_at, COALESCE(pl.updated_at, pl.created_at)) ${recent}
        OR EXISTS (SELECT 1 FROM player_aliases a WHERE a.player_id = pl.id AND a.recorded_at ${recent}))
        AND (pl.created_by_organization_id = ? OR EXISTS (SELECT 1 FROM search_documents d WHERE d.organization_id = ? AND d.kind = 'PLAYER' AND d.entity_id = pl.id))`, [w, w, org, org]);
    add(players, pChanged);
    if (pChanged.length) add(videos, await rows(ex, `SELECT DISTINCT t.video_id AS id FROM v_track_current_identity ci JOIN tracks t ON t.id = ci.track_id JOIN video_sources v ON v.id = t.video_id
      WHERE ci.state = 'CONFIRMED' AND v.organization_id = ? AND ci.player_id IN (?)`, [org, pChanged.map((r) => r.id)]));
    add(reels, await rows(ex, `SELECT x.id FROM reel_projects x WHERE x.organization_id = ? AND ${changed}`, since));
    add(projects, await rows(ex, `SELECT x.id FROM projects x WHERE x.organization_id = ? AND ${changed}`, since));
  }
  for (const id of videos) await indexVideo(ex, org, id);
  for (const id of players) await indexPlayer(ex, org, id);
  for (const id of reels) await indexReel(ex, org, id);
  for (const id of projects) await indexProject(ex, org, id);
  await ex.query(`UPDATE search_index_state SET version = ?, watermark = ?${rebuild ? ", rebuilt_at = ?" : ""} WHERE organization_id = ?`,
    rebuild ? [INDEX_VERSION, now, now, org] : [INDEX_VERSION, now, org]);
  return { rebuilt: rebuild, reindexed: videos.size + players.size + reels.size + projects.size };
}

/**
 * The outbox path: re-index what one event is about, in its delivery transaction. An organization whose index was never built is left
 * to its first search (which builds it whole).
 */
export async function indexEvent(ex: Executor, org: string, aggregateType: string, aggregateId: string, payload: unknown): Promise<void> {
  const st = await lockState(ex, org);
  if (!st || st.version !== INDEX_VERSION) return;
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);
  const videos = new Set<string>();
  if (str("video_id")) videos.add(str("video_id")!);
  switch (aggregateType) {
    case "video": videos.add(aggregateId); break;
    case "reel": await indexReel(ex, org, aggregateId); break;
    case "project": await indexProject(ex, org, aggregateId); break;
    case "player": await indexPlayer(ex, org, aggregateId); break;
    case "match": for (const r of await rows(ex, "SELECT id FROM video_sources WHERE match_id = ? AND organization_id = ?", [aggregateId, org])) videos.add(r.id); break;
    case "track": {
      const [t] = await rows(ex, "SELECT video_id FROM tracks WHERE id = ?", [aggregateId]);
      if (t) videos.add(t.video_id);
      for (const k of ["player_id", "previous_player_id"]) if (str(k)) await indexPlayer(ex, org, str(k)!);
      break;
    }
    default: break;
  }
  for (const v of videos) await indexVideo(ex, org, v);
}
