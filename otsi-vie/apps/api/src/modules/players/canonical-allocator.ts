/**
 * The canonical player-ID allocator and the controlled player merge, as APPLICATION code (ADR-144 §1.2,
 * distribution plan §1d.3: "MySQL stored routines ... moved into application code").
 *
 * These were MySQL stored procedures (`sp_issue_canonical_player_id`, migration 0018; `sp_merge_players`,
 * migration 0007). SQLite has no stored procedures, so the same logic lives here now and runs through
 * `db.tx()` on BOTH backends — one code path issuing IDs on MySQL and SQLite, with the same observable
 * behaviour, the same error keys, and the same concurrency safety (the transaction serialises issuers: on
 * MySQL the `SELECT ... FOR UPDATE` row locks do it, on SQLite `BEGIN IMMEDIATE` does it; `retryTransient`
 * restarts the loser on either backend).
 *
 * Behaviour, verified against the procedures line by line (see the dialect tests):
 *  - an issued ID is returned exactly once and never re-issued (same player, same request key, or an
 *    already-registered player all return the existing ID);
 *  - a request key used for another player is refused (`REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER`);
 *  - the sequence is one atomic upsert (`INSERT ... ON DUPLICATE KEY UPDATE last_sequence = last_sequence + 1`,
 *    translated by the dialect layer); past 999999 the row's CHECK fails and the issue is reported as
 *    exhaustion (`CANONICAL_SEQUENCE_EXHAUSTED`), never wrapped around;
 *  - the ID format is `OTSI-<CCC>-<YYYY>-<NNNNNN>` (country, UTC year, zero-padded sequence);
 *  - every issue / merge writes its audit row in the same transaction (the allocator is the only writer of
 *    `canonical_id_issuances`, `canonical_id_sequences`, `player_merges` and of the canonical columns of
 *    `players` — see the roles note below);
 *  - errors are raised as `signalError(key)` (errno 1644, sqlMessage = the key), exactly what MySQL's
 *    `SIGNAL SQLSTATE '45000'` surfaced as, so `problem.ts` maps them to the same HTTP statuses.
 *
 * ROLES NOTE (agent B, MySQL): the procedures ran as DEFINER, so the runtime account (`otsi_app`) never
 * needed to write the allocator tables — `roles.py` grants it only SELECT on `canonical_id_issuances`,
 * `canonical_id_sequences`, `player_merges` and a column-restricted UPDATE on `players`. This module writes
 * those tables directly, so the MySQL deployment needs a migration granting `otsi_app` INSERT on the three
 * tables and UPDATE (`canonical_otsi_id`, `canonical_state`, `merged_into_player_id`) on `players`. The
 * defence-in-depth triggers (e.g. CANONICAL_ID_IMMUTABLE, migration 0007) still refuse every illicit change,
 * so the grant only lets the API do through this module what the procedures used to do. On SQLite there are
 * no roles: the same invariants rest on the equivalent SQLite triggers (agent B's DDL).
 */
import type { RowDataPacket } from "mysql2/promise";
import type { Db } from "../../core/db";
import { signalError } from "../../core/db/dialect";

const COUNTRY_CODE = /^[A-Z]{3}$/;
const MAX_SEQUENCE = 999999;

export interface IssueCanonicalIdInput {
  playerId: string;
  countryCode: string;
  organizationId: string;
  issuedBy: string;
  /** Idempotency key (may be null): a replay returns the original ID instead of issuing a second one. */
  requestKey: string | null;
}

/** Issue (or return) the permanent OTSI Player ID for a provisional player. Exactly once per player. */
export async function issueCanonicalPlayerId(db: Db, input: IssueCanonicalIdInput): Promise<string> {
  const { playerId, countryCode, organizationId, issuedBy, requestKey } = input;
  if (!playerId || !organizationId || !issuedBy) throw signalError("ISSUER_AND_PLAYER_REQUIRED");
  if (!countryCode || !COUNTRY_CODE.test(countryCode)) throw signalError("INVALID_COUNTRY_CODE");
  return db.tx(async (c) => {
    if (requestKey !== null) {
      // a NON-locking consistent read (migration 0018): the lookup must not take a gap lock, or two
      // concurrent issuances deadlock against each other (see the migration's header). Same-player races
      // stay serialised by the players row lock below; a key reused for another player is refused by the
      // unique key on the ledger (and by this check, which reports it plainly).
      const [found] = await c.query<RowDataPacket[]>(
        "SELECT player_id, canonical_otsi_id FROM canonical_id_issuances WHERE request_key = ?", [requestKey]);
      const row = found[0];
      if (row) {
        if (row.player_id !== playerId) throw signalError("REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER");
        return row.canonical_otsi_id as string;
      }
    }
    const [players] = await c.query<RowDataPacket[]>(
      "SELECT canonical_state, canonical_otsi_id FROM players WHERE id = ? FOR UPDATE", [playerId]);
    const player = players[0];
    if (!player) throw signalError("PLAYER_NOT_FOUND");
    if (player.canonical_otsi_id) return player.canonical_otsi_id as string; // exactly once: never re-issued
    if (player.canonical_state !== "PROVISIONAL") throw signalError("PLAYER_NOT_ELIGIBLE_FOR_ISSUANCE");
    const [countries] = await c.query<RowDataPacket[]>("SELECT 1 FROM countries WHERE code = ? AND active", [countryCode]);
    if (!countries.length) throw signalError("INVALID_COUNTRY_CODE");
    const year = new Date().getUTCFullYear();
    // ONE atomic statement reserves the next number and takes the row's exclusive lock at once. Past
    // 999999 the row's CHECK fails (errno 3819 on both backends): that is reported as exhaustion, never
    // wrapped around. (On MySQL the procedure caught 3819 with a handler; here the catch does the same.)
    try {
      await c.query(
        "INSERT INTO canonical_id_sequences (country_code, issue_year, last_sequence) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE last_sequence = last_sequence + 1",
        [countryCode, year]);
    } catch (e) {
      if ((e as { errno?: number }).errno === 3819) throw signalError("CANONICAL_SEQUENCE_EXHAUSTED");
      throw e;
    }
    const [seqRows] = await c.query<RowDataPacket[]>(
      "SELECT last_sequence FROM canonical_id_sequences WHERE country_code = ? AND issue_year = ?", [countryCode, year]);
    const seqRow = seqRows[0];
    if (!seqRow) throw signalError("SEQUENCE_UNAVAILABLE");
    const seq = Number(seqRow.last_sequence);
    if (seq > MAX_SEQUENCE) throw signalError("CANONICAL_SEQUENCE_EXHAUSTED");
    const canonicalId = `OTSI-${countryCode}-${String(year).padStart(4, "0")}-${String(seq).padStart(6, "0")}`;
    await c.query(
      `INSERT INTO canonical_id_issuances (canonical_otsi_id, player_id, country_code, issue_year, sequence_number,
        issuing_organization_id, issued_by, request_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [canonicalId, playerId, countryCode, year, seq, organizationId, issuedBy, requestKey]);
    await c.query("UPDATE players SET canonical_otsi_id = ?, canonical_state = 'REGISTERED' WHERE id = ?", [canonicalId, playerId]);
    await c.query(
      `INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, after_state)
        VALUES (?, ?, 'player.canonical_id_issued', 'player', ?,
                JSON_OBJECT('canonical_otsi_id', ?, 'country_code', ?, 'issue_year', ?, 'sequence_number', ?))`,
      [organizationId, issuedBy, playerId, canonicalId, countryCode, year, seq]);
    return canonicalId;
  });
}

export interface MergePlayersInput {
  mergeId: string;
  fromPlayerId: string;
  intoPlayerId: string;
  organizationId: string;
  decidedBy: string;
  reason: string;
  evidenceId: string | null;
}

/** Merge a duplicate PROVISIONAL record into a REGISTERED player. Merges are final. */
export async function mergePlayers(db: Db, input: MergePlayersInput): Promise<void> {
  const { mergeId, fromPlayerId, intoPlayerId, organizationId, decidedBy, reason, evidenceId } = input;
  if (fromPlayerId === intoPlayerId) throw signalError("CANNOT_MERGE_A_PLAYER_INTO_ITSELF");
  if (reason === null || reason.trim().length < 3) throw signalError("MERGE_REASON_REQUIRED");
  await db.tx(async (c) => {
    // lock both rows in a fixed order (by id) so two opposite merges cannot deadlock or both succeed
    const [firstId, secondId] = [fromPlayerId, intoPlayerId].sort();
    await c.query("SELECT canonical_state FROM players WHERE id = ? FOR UPDATE", [firstId]);
    await c.query("SELECT canonical_state FROM players WHERE id = ? FOR UPDATE", [secondId]);
    const [rows] = await c.query<RowDataPacket[]>(
      "SELECT id, canonical_state, canonical_otsi_id FROM players WHERE id = ? OR id = ?", [fromPlayerId, intoPlayerId]);
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    const from = byId.get(fromPlayerId);
    const into = byId.get(intoPlayerId);
    if (!from || !into) throw signalError("PLAYER_NOT_FOUND");
    if (from.canonical_state === "MERGED" || into.canonical_state === "MERGED") throw signalError("PLAYER_ALREADY_MERGED");
    if (into.canonical_state !== "REGISTERED") throw signalError("SURVIVOR_MUST_BE_REGISTERED");
    await c.query(
      `INSERT INTO player_merges (id, from_player_id, into_player_id, organization_id, decided_by, reason, evidence_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mergeId, fromPlayerId, intoPlayerId, organizationId, decidedBy, reason, evidenceId]);
    await c.query("UPDATE players SET canonical_state = 'MERGED', merged_into_player_id = ? WHERE id = ?", [intoPlayerId, fromPlayerId]);
    await c.query(
      `INSERT INTO audit_events (organization_id, actor_id, action, entity_type, entity_id, after_state)
        VALUES (?, ?, 'player.merged', 'player', ?,
                JSON_OBJECT('into_player_id', ?, 'merge_id', ?,
                            'from_canonical_otsi_id', ?, 'into_canonical_otsi_id', ?))`,
      [organizationId, decidedBy, fromPlayerId, intoPlayerId, mergeId,
        (from.canonical_otsi_id as string | null) ?? null, (into.canonical_otsi_id as string | null) ?? null]);
  });
}
