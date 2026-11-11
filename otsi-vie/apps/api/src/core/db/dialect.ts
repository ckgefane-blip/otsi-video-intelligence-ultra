/**
 * The dialect translator: the ONE place MySQL-flavoured SQL becomes SQLite SQL (ADR-144 §1.2, distribution plan §1d
 * safeguards 1-3). Modules keep writing the MySQL form they were written in; the SQLite backend runs every statement
 * through {@link translateForSqlite} first. The MySQL backend never translates anything, so MySQL behaviour is
 * byte-for-byte what it was before this file existed.
 *
 * The translator is a single left-to-right walk that rebuilds the parameter list as it goes: a `?` in the source
 * takes the next source parameter, and every generated `?` (a "now" value, a CURDATE() value, ...) takes its value
 * at exactly the position it appears in the SQL, so parameter order can never drift between the two backends.
 *
 * DIALECT CATALOG — every MySQL-only construct found in `apps/api/src/` (surveyed 2026-11-11), its conversion,
 * and the test covering it (all in `test/db.dialect.test.ts` unless noted):
 *
 *  1. `INSERT ... ON DUPLICATE KEY UPDATE a = VALUES(a), ...` (24 sites, e.g. account.ts, reels.ts, periods.ts)
 *     -> `INSERT ... ON CONFLICT DO UPDATE SET a = excluded.a, ...` (no conflict target: SQLite applies the
 *     upsert to whichever unique constraint fired). `VALUES(col)` outside an upsert is an error. A no-op
 *     assignment (`dedupe_key = dedupe_key`) stays a no-op. Test: "upsert".
 *  2. `INSERT IGNORE` (4 sites: indexer.ts, playerreport.ts, billing.ts) -> `INSERT OR IGNORE`. Test: "insert ignore".
 *  3. `CURRENT_TIMESTAMP(6)` / `UTC_TIMESTAMP(6)` / `NOW(6)` (109 + 6 + 3 sites) -> a bound `?` holding
 *     `nowMs()` (integer ms since the epoch). Dates are integer ms on SQLite, DATETIME(6) on MySQL; the same
 *     instant is stored on both, only the representation differs. Test: "now values".
 *  4. `DATE_ADD(X, INTERVAL n|? UNIT)` / `DATE_SUB(...)` (11 sites) and bare `X +/- INTERVAL n|? UNIT`
 *     (16 sites, e.g. `expires_at <= CURRENT_TIMESTAMP(6)`, `finished_at >= CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY`)
 *     -> ms arithmetic in code: `X + amount * factor` (DAY 86400000, HOUR 3600000, MINUTE 60000, SECOND 1000,
 *     MICROSECOND `amount / 1000`). Test: "interval arithmetic".
 *  5. `CURDATE()` (players.service.ts: `valid_from`/`valid_to` close-out) -> a bound `?` holding today's date as a
 *     'YYYY-MM-DD' TEXT string. DATE-only columns (birth_date, valid_from, valid_to) stay TEXT ISO on SQLite
 *     (agent B's DDL rule), because modules pass ISO date strings for them and compare them lexicographically;
 *     only DATETIME/TIMESTAMP columns become INTEGER ms. Test: "curdate".
 *  6. `JSON_EXTRACT(x, '$.path')` (42 sites) -> `json_extract(x, '$.path')` (JSON1). `JSON_UNQUOTE(JSON_EXTRACT(...))`
 *     (13 sites) collapses to the same `json_extract(...)`: SQLite already returns the unquoted value, MySQL
 *     returns the JSON-quoted one. A bare JSON_EXTRACT of a string therefore differs in shape between backends
 *     only before UNQUOTE; every site either UNQUOTEs or tests IS [NOT] NULL, both of which are identical after
 *     translation. Test: "json extract".
 *  7. `JSON_OBJECT(...)` (audit insert in the canonical allocator; `COALESCE(config, JSON_OBJECT())` in access.ts)
 *     -> `json_object(...)`. `JSON_REMOVE(event_payload, '$.credential')` (subscribers.ts) -> `json_remove(...)`.
 *     `JSON_CONTAINS(moments, JSON_QUOTE(?))` (pitch.ts) -> `EXISTS (SELECT 1 FROM json_each(moments) WHERE value = ?)`.
 *     Test: "json object/remove/contains".
 *  8. `JSON_TABLE(<expr>, '<path>[*]' COLUMNS (vid ... PATH '$')) alias` (access.ts, 3 sites) -> the JSON1
 *     table-valued function `json_each(<expr>, '<path>') alias`, and every `<alias>.vid` in the same statement
 *     becomes `<alias>.value`. `ON TRUE` (the join condition those statements use) -> `ON 1`. Any other
 *     JSON_TABLE shape throws. Test: "json table (access.ts)".
 *  9. `IF(cond, a, b)` (11 sites, incl. `IF(status='ACTIVE', role, VALUES(role))` in an upsert and
 *     `IF(failed_attempts + 1 >= ?, DATE_ADD(...), locked_until)`) -> `(CASE WHEN cond THEN a ELSE b END)`.
 *     NOTE: SQLite evaluates every SET assignment against the ORIGINAL row (MySQL uses already-updated values
 *     left to right); the one site that depends on this (auth.service.ts lock-out) already writes its condition
 *     against the pre-update value (`failed_attempts + 1`), so both engines agree. Test: "if".
 * 10. `GREATEST(...)` / `LEAST(...)` (9 + 2 sites, incl. the indexer watermark comparison) -> SQLite scalar
 *     `max(...)` / `min(...)`. Both return NULL when any argument is NULL. Test: "greatest/least".
 * 11. `CONCAT(a, ' vs ', b)` (5 sites: archive.ts, removal.ts) -> a NULL-propagating `||` chain:
 *     `(CASE WHEN a IS NULL OR b IS NULL THEN NULL ELSE a || b END)` — MySQL CONCAT returns NULL when any
 *     argument is NULL, SQLite `||` treats NULL as empty, so a plain `||` would turn a COALESCE fallback
 *     (`COALESCE(CONCAT(...), m.competition, 'Match')`) into the string ' vs '. Test: "concat".
 * 12. `FIELD(x, 'a', 'b', ...)` in ORDER BY (3 sites: exports.ts, team.ts, analysis.ts)
 *     -> `(CASE x WHEN 'a' THEN 1 WHEN 'b' THEN 2 ... ELSE 0 END)`: MySQL FIELD() is 1-based and returns 0
 *     for values not in the list, so the CASE must be too — a 0-based CASE would silently reorder rows on
 *     SQLite (listed values first, where MySQL puts unlisted values first). Test: "field".
 * 13. `TIMESTAMPDIFF(SECOND, a, b)` (dispatcher outboxStats, monitoring.ts) -> `CAST((b - a) / 1000 AS INTEGER)`;
 *     `TIMESTAMPDIFF(MICROSECOND, a, b)` (estimate.ts) -> `((b - a) * 1000)` (the caller's `/ 1e6` then yields
 *     seconds). Both engines truncate the fractional part toward zero. Test: "timestampdiff".
 * 14. `DATE_FORMAT(x, '%Y-%m-%dT%H:%i:%s.%fZ')` (events.ts, decision timestamps) ->
 *     `strftime('%Y-%m-%dT%H:%M:%S', x / 1000, 'unixepoch') || '.' || printf('%06d', (x % 1000) * 1000) || 'Z'`
 *     (SQLite stores ms, so the microsecond digits are always 000; the 6-digit shape is preserved).
 *     `DATE_FORMAT(x, '%Y-%m-%d')` (players.service.ts, birth_date) ->
 *     `strftime('%Y-%m-%d', x / 1000, 'unixepoch')`: the value is integer ms on SQLite, so a plain
 *     `substr(x, 1, 10)` would return the first 10 digits of the ms number. Any other format string throws.
 *     Test: "date format".
 * 15. `RAND()` (overview.ts, `ORDER BY RAND() LIMIT 1`) -> `random()`. Test: "rand".
 * 16. `FLOOR(x)` (heat.ts, periods.ts) -> `floor(x)` (SQLite math functions, present since 3.35; the bundled
 *     SQLite here is 3.53). Integer division already truncates toward zero for the non-negative values used.
 *     Test: "floor".
 * 17. `CAST(x AS DECIMAL(12,3))` (estimate.ts) -> `CAST(x AS REAL)`: SQLite keeps full precision instead of
 *     rounding to 3 decimals; the value is an estimate shown to one decimal place, so this is strictly more
 *     precise, not less. Other CAST types pass through unchanged. Test: "cast decimal".
 * 18. `FOR UPDATE`, `FOR UPDATE OF o SKIP LOCKED` (59 sites) -> removed. The replacement is the transaction
 *     itself: `tx()` runs `BEGIN IMMEDIATE` on SQLite, which takes the write lock up front and serialises
 *     concurrent writers, so a read-modify-write inside `tx()` is safe without row locks. A `FOR UPDATE`
 *     outside a transaction locked nothing past the statement on MySQL either (autocommit), so dropping it
 *     there changes nothing. Test: "for update".
 * 19. `LIMIT ?` (3 sites: dispatcher claim, admin audit list, audit service) -> unchanged: SQLite binds LIMIT
 *     parameters. (The MySQL `LIMIT ?, ?` offset form is NOT used anywhere; it would need `LIMIT ? OFFSET ?`.)
 *     Test: "limit bound".
 * 20. `IN (?)` with an array parameter (35 sites, e.g. dispatcher claim, heat.ts, archive.ts) -> expanded to
 *     `IN (?, ?, ...)`; an empty array becomes `IN (NULL)` (matches nothing, valid SQL). mysql2 expands arrays
 *     natively, so the MySQL path needs no equivalent. Test: "in list".
 * 21. `LIKE ?` (3 sites: clubs, player search, search_terms) -> `LIKE ? ESCAPE '\'`: the modules escape `%` and
 *     `_` with a backslash for MySQL, and SQLite only honours that escape with an explicit ESCAPE clause.
 *     Test: "like escape".
 * 22. `TRUE` / `FALSE` literals (sharing.ts, matches.ts, billing.ts) -> unchanged: SQLite accepts both as 1/0.
 * 23. `CALL sp_issue_canonical_player_id(...)` / `CALL sp_merge_players(...)` (players.service.ts) -> NOT
 *     translated: stored procedures do not exist in SQLite. Both procedures are reimplemented in application
 *     code in `src/modules/players/canonical-allocator.ts` and run through `db.tx()` on BOTH backends, so the
 *     same code path issues IDs on MySQL and SQLite. A `CALL` reaching this translator throws. Test: allocator
 *     tests in `test/db.dialect.test.ts`.
 * 24. `UPDATE ... JOIN ...` (removal.ts share-link revocation) -> rewritten in the module to a subquery
 *     (`asset_id IN (SELECT output_asset_id FROM render_jobs ...)`) — MySQL has no portable form of the
 *     multi-table UPDATE. No translator rule: the module now carries the dialect-neutral form.
 * 25. `SELECT ... INTO`, `REPLACE INTO`, `UNIX_TIMESTAMP`, `FROM_UNIXTIME`, `JSON_SET`, `->>`, `SQL_CALC_FOUND_ROWS`,
 *     `FOUND_ROWS`, `NOW()` without precision, `UUID()`, `LAST_INSERT_ID()`, `INSERT ... SELECT` except the one
 *     in reels.ts (SQLite supports INSERT...SELECT) — none of these occur in `apps/api/src/` except where noted,
 *     so there is no rule for them; if one appears later the leftover-token check below fails the statement
 *     loudly instead of running the wrong SQL.
 * 26. `GROUP_CONCAT(x SEPARATOR ' ')` (indexer.ts, player aliases) -> `group_concat(x, ' ')`; without a
 *     separator -> `group_concat(x)`; `DISTINCT` passes through (`group_concat(DISTINCT x, ' ')`). An
 *     `ORDER BY` inside the aggregate throws: SQLite has no such form, and silently dropping the order
 *     would change the alias string. Test: "group concat".
 *
 * CASE SENSITIVITY (decided per column, plan §1d.3): SQLite `=` on TEXT is BINARY (case-sensitive); MySQL's
 * default collation is case-insensitive. The columns the API compares with `=` are safe as-is because the value
 * is normalised before the comparison, or the comparison must be exact:
 *  - `email_normalized`, `open_email`, invitation `email_normalized` (team.ts, auth.service.ts): the contract
 *    lowercases e-mail addresses at the boundary (`z.string().trim().toLowerCase().email(...)`), and sign-in
 *    lowercases again; both sides are lowercase on both backends.
 *  - `token_hash`, `refresh_hash`, `code_hash`, `challenge`, UUIDs, `canonical_otsi_id`, `country_code`
 *    (CountryCode contract: `/^[A-Z]{3}$/`): exact by nature; the allocator's own country check used
 *    `COLLATE ascii_bin` (case-sensitive) on MySQL too, so SQLite matches it.
 *  - `display_name` / `canonical_name` in LIKE prefix searches (players.service.ts, matches.ts): ASCII case
 *    differs (SQLite LIKE is ASCII case-insensitive, MySQL ai_ci is Unicode case-insensitive), and non-ASCII
 *    case differs (e.g. Cyrillic club names typed in another case). KNOWN GAP, accepted for now: the main
 *    search path (Smart Search via search_terms, which lowercases with NFKD) is unaffected; these are
 *    secondary list filters. A normalised column would be needed to close it.
 *  - `LOWER(u.email)` (team.ts member check): e-mail addresses are ASCII, so SQLite LOWER() folds them.
 *
 * NOT TRANSLATED (identical on both engines, no rule needed): `COALESCE`, `IFNULL`, `NULLIF`, `CASE`, `CAST`
 * (except DECIMAL, rule 17), `EXISTS`, `IN`, row-value `IN ((?, ?))`, `UNION ALL`, window functions
 * (`ROW_NUMBER() OVER (...)`), `ORDER BY ... IS NULL`, `GROUP BY`, `HAVING` without GROUP BY, `ABS`, `LENGTH`,
 * `SUBSTR`, `TRIM`, `MAX`/`MIN` as aggregates, `COUNT(DISTINCT ...)`, backtick-quoted identifiers, `ON TRUE`
 * (rewritten to `ON 1` only as part of rule 8; a bare `ON TRUE` is also rewritten, see below).
 *
 * DEPENDENCIES ON AGENT B (SQLite DDL, not this layer): STRICT tables (the adapter assumes them and tests that
 * a wrong-type insert is rejected); the views `v_player_identity`, `v_track_current_identity`,
 * `v_track_link_current` recreated in SQLite (recursive CTEs are supported); unique indexes keeping their MySQL
 * names (notably `uq_outbox_dedupe`, which `publish.ts` matches in the error message); the CHECK on
 * `canonical_id_sequences.last_sequence <= 999999`; the guard triggers behind problem.ts SIGNAL codes
 * (CANONICAL_ID_IMMUTABLE et al.) as equivalent SQLite triggers.
 */

export function nowMs(): number {
  return Date.now();
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** UTC midnight today, as integer ms (the value CURDATE() stands for once DATE columns are TEXT ISO — see rule 5). */
export function todayUtcMs(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Today's UTC date as 'YYYY-MM-DD' (the bound value CURDATE() becomes). */
export function todayDateString(): string {
  return new Date(todayUtcMs()).toISOString().slice(0, 10);
}

const MS_PER_UNIT: Record<string, number> = {
  MICROSECOND: 0, // handled by division, not multiplication (see intervalFactor)
  SECOND: 1000,
  MINUTE: 60_000,
  HOUR: 3_600_000,
  DAY: 86_400_000,
};

/** `amount * factor` for an INTERVAL unit, or `amount / 1000` for MICROSECOND (ms storage). */
function intervalExpr(amountSql: string, unit: string): string {
  if (unit === "MICROSECOND") return `${amountSql} / 1000`;
  const factor = MS_PER_UNIT[unit];
  if (factor === undefined) throw new Error(`unsupported INTERVAL unit "${unit}" (supported: MICROSECOND, SECOND, MINUTE, HOUR, DAY)`);
  return `${amountSql} * ${factor}`;
}

/** Tokens the translator must never leave in SQLite SQL (MySQL spellings, case-sensitive: the translator only
 *  ever emits the lowercase SQLite spellings, so an uppercase hit means a construct was missed). */
const FORBIDDEN_AFTER_TRANSLATION = [
  "ON DUPLICATE KEY",
  "JSON_EXTRACT",
  "JSON_UNQUOTE",
  "JSON_TABLE",
  "JSON_OBJECT",
  "JSON_REMOVE",
  "JSON_CONTAINS",
  "JSON_SET",
  "CURRENT_TIMESTAMP",
  "UTC_TIMESTAMP",
  "CURDATE",
  "TIMESTAMPDIFF",
  "DATE_FORMAT",
  "FOR UPDATE",
  "INTERVAL",
  "SKIP LOCKED",
  "INSERT IGNORE",
  "REPLACE INTO",
] as const;

function assertNoMysqlRemains(sql: string): void {
  for (const token of FORBIDDEN_AFTER_TRANSLATION) {
    if (sql.includes(token)) throw new Error(`untranslated MySQL construct in SQLite SQL: "${token}" in: ${sql}`);
  }
  // Function-style tokens need a word boundary + "(" so a column named e.g. "if_flag" never trips the check.
  for (const fn of ["NOW", "IF", "GREATEST", "LEAST", "CONCAT", "FIELD", "RAND", "CALL"]) {
    if (new RegExp(`\\b${fn}\\s*\\(`, "").test(sql)) throw new Error(`untranslated MySQL function in SQLite SQL: "${fn}(..." in: ${sql}`);
  }
}

interface UpsertAlias {
  alias: string;
}

/** Split a comma list on top-level commas only (parentheses, string literals and backticks respected). */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0, start = 0, i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === "'") { i++; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { i += 2; continue; } i++; break; } i++; } continue; }
    if (c === '"') { i++; while (i < s.length) { if (s[i] === '"') { i++; break; } i++; } continue; }
    if (c === "`") { i++; while (i < s.length) { if (s[i] === "`") { i++; break; } i++; } continue; }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === "," && depth === 0) { parts.push(s.slice(start, i)); start = i + 1; }
    i++;
  }
  parts.push(s.slice(start));
  return parts;
}

/** The index just past the `)` matching the `(` at `open` (string literals and backticks respected). */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  // NOTE: this is a `for` loop, so `continue` still runs the `i++` update: after skipping a quoted literal
  // `i` must point AT the closing quote (not past it), or the character after the literal — often the very
  // `)` being matched — is skipped and the call reports "unbalanced parentheses".
  for (let i = open; i < s.length; i++) {
    const c = s[i]!;
    if (c === "'") { i++; while (i < s.length) { if (s[i] === "'") { if (s[i + 1] === "'") { i += 2; continue; } break; } i++; } continue; }
    if (c === '"') { i++; while (i < s.length) { if (s[i] === '"') { break; } i++; } continue; }
    if (c === "`") { i++; while (i < s.length) { if (s[i] === "`") { break; } i++; } continue; }
    if (c === "(") depth++;
    else if (c === ")") { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error(`unbalanced parentheses in SQL: ${s}`);
}

class Translator {
  private out: string[] = [];
  private outParams: unknown[] = [];
  private cursor = 0; // next unread source parameter
  private jsonTableAliases: UpsertAlias[] = [];
  private inUpsert = false;

  constructor(
    private readonly sql: string,
    private readonly params: readonly unknown[],
  ) {}

  run(): { sql: string; params: unknown[] } {
    this.translateRange(0, this.sql.length);
    let out = this.out.join("");
    // rule 8: <alias>.vid -> <alias>.value for every JSON_TABLE alias introduced in this statement.
    for (const { alias } of this.jsonTableAliases) {
      out = out.replace(new RegExp(`\\b${alias}\\.vid\\b`, "g"), `${alias}.value`);
    }
    assertNoMysqlRemains(out);
    return { sql: out, params: this.outParams };
  }

  /** Take the next source parameter (throws if the SQL has more placeholders than parameters). */
  private nextParam(): unknown {
    if (this.cursor >= this.params.length) throw new Error(`not enough parameters for SQL: ${this.sql}`);
    return this.params[this.cursor++];
  }

  private emit(s: string): void {
    this.out.push(s);
  }

  /** Translate the SQL in `sql[start..end)` into the shared output, consuming source parameters in order. */
  private translateRange(start: number, end: number): void {
    const s = this.sql;
    let i = start;
    const isWordChar = (c: string | undefined) => !!c && /[A-Za-z0-9_$]/.test(c);
    /** Try to match `word` at `pos` (case-insensitive, word-bounded). Returns the end position or -1. */
    const matchWord = (pos: number, word: string): number => {
      if (s.slice(pos, pos + word.length).toUpperCase() !== word) return -1;
      if (isWordChar(s[pos - 1]) || isWordChar(s[pos + word.length])) return -1;
      return pos + word.length;
    };
    /** Skip whitespace from `pos`. */
    const skipWs = (pos: number): number => {
      while (pos < end && /\s/.test(s[pos]!)) pos++;
      return pos;
    };
    /** Read an identifier (bare or backticked) at `pos`; returns [text, end] or null. */
    const readIdent = (pos: number): [string, number] | null => {
      if (s[pos] === "`") {
        const close = s.indexOf("`", pos + 1);
        if (close === -1 || close >= end) return null;
        return [s.slice(pos, close + 1), close + 1];
      }
      const m = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(s.slice(pos, end));
      return m ? [m[0], pos + m[0].length] : null;
    };
    /** Copy a quoted literal starting at `pos` (`'...'`, `"..."`, `` `...` ``) verbatim; returns the end position. */
    const copyQuoted = (pos: number): number => {
      const q = s[pos]!;
      let j = pos + 1;
      while (j < end) {
        if (s[j] === q) {
          // '' (two single quotes) is an escaped quote inside a '...' literal; "" likewise.
          if (q !== "`" && s[j + 1] === q) { j += 2; continue; }
          j++;
          break;
        }
        // a backslash escapes the next character inside a MySQL string literal
        if (q !== "`" && s[j] === "\\") { j += 2; continue; }
        j++;
      }
      this.emit(s.slice(pos, j));
      return j;
    };

    while (i < end) {
      const c = s[i]!;
      // whitespace, punctuation and operators pass through unchanged
      if (/\s/.test(c)) { this.emit(c); i++; continue; }
      if (c === "'" || c === '"' || c === "`") { i = copyQuoted(i); continue; }
      if (c === "-" && s[i + 1] === "-") { const eol = s.indexOf("\n", i); const stop = eol === -1 ? end : eol; this.emit(s.slice(i, stop)); i = stop; continue; }
      if (c === "/" && s[i + 1] === "*") { const close = s.indexOf("*/", i + 2); const stop = close === -1 ? end : close + 2; this.emit(s.slice(i, stop)); i = stop; continue; }

      // ---- placeholders (rule 20: IN (?) array expansion is handled where IN is matched) ----
      if (c === "?") {
        this.outParams.push(this.nextParam());
        this.emit("?");
        i++;
        continue;
      }

      // ---- word dispatch (keywords and function calls) ----
      const wordMatch = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(s.slice(i, end));
      if (wordMatch) {
        const word = wordMatch[0];
        const upper = word.toUpperCase();
        const afterWord = i + word.length;
        const afterWs = skipWs(afterWord);
        const followedByParen = s[afterWs] === "(";

        // SELECT ... INTO has no SQLite form (rule 25): fail loudly. INSERT INTO is fine — the
        // statement (or fragment) starts with INSERT there, not SELECT.
        if (upper === "INTO" && /^\s*(\(\s*)?SELECT\b/i.test(this.sql)) {
          throw new Error(`SELECT ... INTO is not supported on SQLite in: ${this.sql}`);
        }

        // INSERT IGNORE -> INSERT OR IGNORE (rule 2)
        if (upper === "INSERT") {
          const ign = matchWord(afterWs, "IGNORE");
          if (ign !== -1) { this.emit("INSERT OR IGNORE"); i = ign; continue; }
          this.emit(word); i = afterWord; continue;
        }
        // ON DUPLICATE KEY UPDATE <assignments> -> ON CONFLICT DO UPDATE SET <translated> (rule 1)
        if (upper === "ON") {
          const dup = matchWord(afterWs, "DUPLICATE");
          if (dup !== -1) {
            const key = matchWord(skipWs(dup), "KEY");
            const upd = key !== -1 ? matchWord(skipWs(key), "UPDATE") : -1;
            if (upd !== -1) {
              this.emit("ON CONFLICT DO UPDATE SET ");
              const rest = s.slice(upd, end);
              const assigns = splitTopLevel(rest);
              this.inUpsert = true;
              assigns.forEach((a, idx) => {
                const eq = a.indexOf("=");
                if (eq === -1) throw new Error(`malformed ON DUPLICATE KEY UPDATE assignment: "${a}" in: ${this.sql}`);
                this.emit(a.slice(0, eq + 1));
                // the right-hand side is translated with VALUES(col) -> excluded.col
                this.translateFragment(a.slice(eq + 1));
                if (idx < assigns.length - 1) this.emit(", ");
              });
              this.inUpsert = false;
              i = end;
              continue;
            }
          }
          // ON TRUE -> ON 1 (rule 8)
          const tru = matchWord(afterWs, "TRUE");
          if (tru !== -1) { this.emit("ON 1"); i = tru; continue; }
          this.emit(word); i = afterWord; continue;
        }
        // VALUES(col) -> excluded.col, but only inside an upsert assignment (rule 1). A VALUES(...)
        // row list is translated normally (its ? placeholders consume parameters in order).
        if (upper === "VALUES" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const inner = s.slice(afterWs + 1, close - 1).trim();
          const m = /^(`?[A-Za-z_][A-Za-z0-9_$]*`?)$/.exec(inner);
          if (m && this.inUpsert) {
            this.emit(`excluded.${m[1]}`);
            i = close;
            continue;
          }
          this.emit("VALUES(");
          this.translateFragment(s.slice(afterWs + 1, close - 1));
          this.emit(")");
          i = close;
          continue;
        }
        // "now" functions -> a bound ms parameter (rule 3). The parentheses are required: a bare
        // word such as the `now` alias in `SELECT NOW(6) AS now` must never be mistaken for the function.
        if ((upper === "CURRENT_TIMESTAMP" || upper === "UTC_TIMESTAMP" || upper === "NOW") && followedByParen && /^\(\s*\d*\s*\)/.test(s.slice(afterWs, end))) {
          let j = afterWord;
          if (s[afterWs] === "(") j = matchingParen(s, afterWs);
          this.outParams.push(nowMs());
          this.emit("?");
          i = j;
          continue;
        }
        // CURDATE() -> a bound 'YYYY-MM-DD' parameter (rule 5)
        if (upper === "CURDATE" && followedByParen) {
          const close = matchingParen(s, afterWs);
          if (s.slice(afterWs + 1, close - 1).trim() !== "") throw new Error(`CURDATE() takes no arguments in: ${this.sql}`);
          this.outParams.push(todayDateString());
          this.emit("?");
          i = close;
          continue;
        }
        // DATE_ADD / DATE_SUB (rule 4)
        if ((upper === "DATE_ADD" || upper === "DATE_SUB") && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length !== 2) throw new Error(`${upper} needs exactly 2 arguments in: ${this.sql}`);
          const interval = /^\s*INTERVAL\s+(.+?)\s+([A-Za-z]+)\s*$/.exec(args[1]!);
          if (!interval) throw new Error(`${upper} second argument must be INTERVAL <amount> <unit> in: ${this.sql}`);
          const amount = interval[1]!.trim();
          const unit = interval[2]!.toUpperCase();
          this.emit("(");
          this.translateFragment(args[0]!);
          this.emit(upper === "DATE_ADD" ? " + " : " - ");
          this.emitIntervalAmount(amount, unit);
          this.emit(")");
          i = close;
          continue;
        }
        // bare INTERVAL after + / - (rule 4)
        if (upper === "INTERVAL") {
          const m = /^\s*(\?|\d+)\s+([A-Za-z]+)/.exec(s.slice(afterWord, end));
          if (!m) throw new Error(`malformed INTERVAL expression in: ${this.sql}`);
          this.emitIntervalAmount(m[1]!, m[2]!.toUpperCase());
          i = afterWord + m[0].length;
          continue;
        }
        // IF(cond, a, b) -> CASE WHEN (rule 9)
        if (upper === "IF" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length !== 3) throw new Error(`IF() needs exactly 3 arguments in: ${this.sql}`);
          this.emit("(CASE WHEN ");
          this.translateFragment(args[0]!);
          this.emit(" THEN ");
          this.translateFragment(args[1]!);
          this.emit(" ELSE ");
          this.translateFragment(args[2]!);
          this.emit(" END)");
          i = close;
          continue;
        }
        // GREATEST / LEAST -> max / min (rule 10)
        if ((upper === "GREATEST" || upper === "LEAST") && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          this.emit(upper === "GREATEST" ? "max(" : "min(");
          args.forEach((a, idx) => { this.translateFragment(a); if (idx < args.length - 1) this.emit(", "); });
          this.emit(")");
          i = close;
          continue;
        }
        // CONCAT -> NULL-propagating || chain (rule 11)
        if (upper === "CONCAT" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length === 0) throw new Error(`CONCAT() needs at least 1 argument in: ${this.sql}`);
          this.emit("(CASE WHEN ");
          args.forEach((a, idx) => { this.translateFragment(a); this.emit(" IS NULL"); if (idx < args.length - 1) this.emit(" OR "); });
          this.emit(" THEN NULL ELSE ");
          args.forEach((a, idx) => { this.translateFragment(a); if (idx < args.length - 1) this.emit(" || "); });
          this.emit(" END)");
          i = close;
          continue;
        }
        // GROUP_CONCAT(expr [SEPARATOR 'x']) -> group_concat(expr[, 'x']) (rule 14). SQLite has no
        // ORDER BY inside the aggregate, so that form fails loudly instead of silently dropping the order.
        if (upper === "GROUP_CONCAT" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const inner = s.slice(afterWs + 1, close - 1);
          if (/\bORDER\s+BY\b/i.test(inner)) {
            throw new Error(`GROUP_CONCAT ... ORDER BY is not supported on SQLite in: ${this.sql}`);
          }
          const sep = /\s+SEPARATOR\s+'((?:[^']|'')*)'\s*$/i.exec(inner);
          let expr = sep ? inner.slice(0, sep.index) : inner;
          const distinct = /^\s*DISTINCT\s+/i.test(expr);
          if (distinct) expr = expr.replace(/^\s*DISTINCT\s+/i, "");
          this.emit("group_concat(");
          if (distinct) this.emit("DISTINCT ");
          this.translateFragment(expr);
          if (sep) this.emit(`, '${sep[1]!}'`);
          this.emit(")");
          i = close;
          continue;
        }
        // FIELD(x, ...) -> CASE (rule 12). MySQL FIELD() is 1-based and returns 0 for unlisted values,
        // so the CASE must be too: THEN 1, THEN 2, ... ELSE 0. (A 0-based CASE would silently reorder
        // rows on SQLite — listed values would sort first, where MySQL puts unlisted values first.)
        if (upper === "FIELD" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length < 2) throw new Error(`FIELD() needs at least 2 arguments in: ${this.sql}`);
          this.emit("(CASE ");
          this.translateFragment(args[0]!);
          args.slice(1).forEach((a, idx) => { this.emit(" WHEN "); this.translateFragment(a); this.emit(` THEN ${idx + 1}`); });
          this.emit(" ELSE 0 END)");
          i = close;
          continue;
        }
        // JSON_EXTRACT -> json_extract (rule 6)
        if (upper === "JSON_EXTRACT" && followedByParen) {
          const close = matchingParen(s, afterWs);
          this.emit("json_extract(");
          this.translateFragment(s.slice(afterWs + 1, close - 1));
          this.emit(")");
          i = close;
          continue;
        }
        // JSON_UNQUOTE(JSON_EXTRACT(...)) -> json_extract(...); bare JSON_UNQUOTE(x) -> x (rule 6)
        if (upper === "JSON_UNQUOTE" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const inner = s.slice(afterWs + 1, close - 1).trim();
          // the inner call is translated by the same walker, so a JSON_EXTRACT inside becomes json_extract
          this.translateFragment(inner);
          i = close;
          continue;
        }
        // JSON_OBJECT -> json_object, JSON_REMOVE -> json_remove (rule 7)
        if ((upper === "JSON_OBJECT" || upper === "JSON_REMOVE") && followedByParen) {
          const close = matchingParen(s, afterWs);
          this.emit(upper === "JSON_OBJECT" ? "json_object(" : "json_remove(");
          this.translateFragment(s.slice(afterWs + 1, close - 1));
          this.emit(")");
          i = close;
          continue;
        }
        // JSON_CONTAINS(col, JSON_QUOTE(?)) -> EXISTS (SELECT 1 FROM json_each(col) WHERE value = ?) (rule 7)
        if (upper === "JSON_CONTAINS" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length !== 2) throw new Error(`JSON_CONTAINS needs exactly 2 arguments in: ${this.sql}`);
          const quote = /^\s*JSON_QUOTE\s*\((.+)\)\s*$/i.exec(args[1]!);
          if (!quote) throw new Error(`JSON_CONTAINS with a non-JSON_QUOTE second argument is not supported in: ${this.sql}`);
          this.emit("EXISTS (SELECT 1 FROM json_each(");
          this.translateFragment(args[0]!);
          this.emit(") WHERE value = ");
          this.translateFragment(quote[1]!);
          this.emit(")");
          i = close;
          continue;
        }
        // JSON_TABLE(expr, 'path[*]' COLUMNS (vid ... PATH '$')) alias -> json_each(expr, 'path') alias (rule 8).
        // NOTE: the path and the COLUMNS clause are ONE argument (no comma between them), so splitTopLevel
        // returns exactly two args: the expression and `'path' COLUMNS (...)`.
        if (upper === "JSON_TABLE" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length !== 2) {
            throw new Error(`unsupported JSON_TABLE shape (only the single-vid-column form in access.ts is supported) in: ${this.sql}`);
          }
          const rest = /^\s*'((?:[^']|'')*)'\s+COLUMNS\s*\(([\s\S]*)\)\s*$/i.exec(args[1]!);
          if (!rest) {
            throw new Error(`unsupported JSON_TABLE shape (expected 'path' COLUMNS (...)) in: ${this.sql}`);
          }
          const path = rest[1]!.replace(/''/g, "'");
          if (!path.endsWith("[*]")) throw new Error(`JSON_TABLE path must end with [*] in: ${this.sql}`);
          // one vid column with PATH '$'; the type may contain parens (VARCHAR(36)), so match loosely
          if (!/^\s*vid\s+[\s\S]*?PATH\s+'\$'\s*$/i.test(rest[2]!)) {
            throw new Error(`unsupported JSON_TABLE COLUMNS clause (only one vid column with PATH '$') in: ${this.sql}`);
          }
          const aliasAt = skipWs(close);
          const alias = readIdent(aliasAt);
          if (!alias) throw new Error(`JSON_TABLE needs an alias in: ${this.sql}`);
          this.jsonTableAliases.push({ alias: alias[0] });
          this.emit("json_each(");
          this.translateFragment(args[0]!);
          this.emit(`, '${path.slice(0, -3).replace(/'/g, "''")}') ${alias[0]}`);
          i = alias[1];
          continue;
        }
        // TIMESTAMPDIFF (rule 13)
        if (upper === "TIMESTAMPDIFF" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length !== 3) throw new Error(`TIMESTAMPDIFF needs exactly 3 arguments in: ${this.sql}`);
          const unit = args[0]!.trim().toUpperCase();
          if (unit === "SECOND") {
            this.emit("CAST((");
            this.translateFragment(args[2]!);
            this.emit(" - ");
            this.translateFragment(args[1]!);
            this.emit(") / 1000 AS INTEGER)");
          } else if (unit === "MICROSECOND") {
            this.emit("((");
            this.translateFragment(args[2]!);
            this.emit(" - ");
            this.translateFragment(args[1]!);
            this.emit(") * 1000)");
          } else {
            throw new Error(`unsupported TIMESTAMPDIFF unit "${unit}" (supported: SECOND, MICROSECOND) in: ${this.sql}`);
          }
          i = close;
          continue;
        }
        // DATE_FORMAT (rule 14) — only the two formats used in the codebase
        if (upper === "DATE_FORMAT" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const args = splitTopLevel(s.slice(afterWs + 1, close - 1));
          if (args.length !== 2) throw new Error(`DATE_FORMAT needs exactly 2 arguments in: ${this.sql}`);
          const fmt = args[1]!.trim();
          if (fmt === "'%Y-%m-%dT%H:%i:%s.%fZ'") {
            this.emit("(strftime('%Y-%m-%dT%H:%M:%S', ");
            this.translateFragment(args[0]!);
            this.emit(" / 1000, 'unixepoch') || '.' || printf('%06d', (");
            this.translateFragment(args[0]!);
            this.emit(" % 1000) * 1000) || 'Z')");
          } else if (fmt === "'%Y-%m-%d'") {
            // The value is integer ms on SQLite (a DATETIME string on MySQL), so a plain substr() of the
            // first 10 characters would return the first 10 digits of the ms number. Convert via strftime.
            this.emit("(strftime('%Y-%m-%d', ");
            this.translateFragment(args[0]!);
            this.emit(" / 1000, 'unixepoch'))");
          } else {
            throw new Error(`unsupported DATE_FORMAT format ${fmt} (only '%Y-%m-%dT%H:%i:%s.%fZ' and '%Y-%m-%d') in: ${this.sql}`);
          }
          i = close;
          continue;
        }
        // RAND() -> random() (rule 15); FLOOR(x) -> floor(x) (rule 16)
        if (upper === "RAND" && followedByParen) {
          const close = matchingParen(s, afterWs);
          if (s.slice(afterWs + 1, close - 1).trim() !== "") throw new Error(`RAND() takes no arguments in: ${this.sql}`);
          this.emit("random()");
          i = close;
          continue;
        }
        if (upper === "FLOOR" && followedByParen) {
          const close = matchingParen(s, afterWs);
          this.emit("floor(");
          this.translateFragment(s.slice(afterWs + 1, close - 1));
          this.emit(")");
          i = close;
          continue;
        }
        // CAST(x AS DECIMAL(12,3)) -> CAST(x AS REAL) (rule 17); other CASTs pass through
        if (upper === "CAST" && followedByParen) {
          const close = matchingParen(s, afterWs);
          const inner = s.slice(afterWs + 1, close - 1);
          const m = /^([\s\S]+?)\s+AS\s+DECIMAL\s*\(\s*12\s*,\s*3\s*\)\s*$/i.exec(inner);
          if (m) {
            this.emit("CAST(");
            this.translateFragment(m[1]!);
            this.emit(" AS REAL)");
          } else {
            this.emit("CAST(");
            this.translateFragment(inner);
            this.emit(")");
          }
          i = close;
          continue;
        }
        // FOR UPDATE [OF t] [SKIP LOCKED] -> removed (rule 18)
        if (upper === "FOR") {
          const upd = matchWord(afterWs, "UPDATE");
          if (upd !== -1) {
            let j = upd;
            const of = matchWord(skipWs(j), "OF");
            if (of !== -1) {
              const id = readIdent(skipWs(of));
              if (id) j = id[1];
            }
            const skip = matchWord(skipWs(j), "SKIP");
            if (skip !== -1) {
              const locked = matchWord(skipWs(skip), "LOCKED");
              if (locked !== -1) j = locked;
            }
            // drop the trailing space the statement had before FOR UPDATE, so "LIMIT 1 FOR UPDATE"
            // becomes "LIMIT 1" rather than "LIMIT 1 " (cosmetic; SQLite ignores the space either way)
            while (this.out.length > 0 && /^\s+$/.test(this.out[this.out.length - 1]!)) this.out.pop();
            i = j;
            continue;
          }
          this.emit(word); i = afterWord; continue;
        }
        // IN (?) array expansion (rule 20)
        if (upper === "IN") {
          const afterIn = skipWs(afterWord);
          if (s[afterIn] === "(") {
            const q = skipWs(afterIn + 1);
            if (s[q] === "?") {
              const close = skipWs(q + 1);
              if (s[close] === ")") {
                const value = this.nextParam();
                if (Array.isArray(value)) {
                  if (value.length === 0) {
                    this.emit("IN (NULL)");
                  } else {
                    this.emit("IN (");
                    value.forEach((v, idx) => { this.outParams.push(v); this.emit("?"); if (idx < value.length - 1) this.emit(", "); });
                    this.emit(")");
                  }
                } else {
                  this.outParams.push(value);
                  this.emit("IN (?)");
                }
                i = close + 1;
                continue;
              }
            }
          }
          this.emit(word); i = afterWord; continue;
        }
        // LIKE -> append ESCAPE '\' after the pattern operand (rule 21)
        if (upper === "LIKE") {
          this.emit(word);
          let j = afterWord;
          // copy the whitespace, then one operand (? / string literal / identifier)
          const wsEnd = skipWs(j);
          this.emit(s.slice(j, wsEnd));
          j = wsEnd;
          if (s[j] === "?") {
            this.outParams.push(this.nextParam());
            this.emit("?");
            j++;
          } else if (s[j] === "'" || s[j] === '"') {
            j = copyQuoted(j);
          } else {
            const id = readIdent(j);
            if (id) { this.emit(id[0]); j = id[1]; }
          }
          const escAt = skipWs(j);
          if (matchWord(escAt, "ESCAPE") === -1) this.emit(" ESCAPE '\\'");
          i = j;
          continue;
        }
        // CALL is never translated: the procedures live in application code now (rule 23)
        if (upper === "CALL") throw new Error(`CALL to a stored procedure is not supported on SQLite (see canonical-allocator.ts): ${this.sql}`);
        // anything else: a plain word (table / column / keyword) — copy verbatim
        this.emit(word);
        i = afterWord;
        continue;
      }

      // numbers and everything else pass through unchanged
      this.emit(c);
      i++;
    }
  }

  /** Emit an INTERVAL amount (`?` consumes a parameter; a literal stays) scaled to ms (rule 4). */
  private emitIntervalAmount(amount: string, unit: string): void {
    let amountSql: string;
    if (amount === "?") {
      this.outParams.push(this.nextParam());
      amountSql = "?";
    } else if (/^\d+$/.test(amount)) {
      amountSql = amount;
    } else {
      throw new Error(`unsupported INTERVAL amount "${amount}" (only ? or a number literal)`);
    }
    this.emit(intervalExpr(amountSql, unit));
  }

  /** Translate a fragment of the same statement (a function argument, an upsert right-hand side, ...). */
  private translateFragment(fragment: string): void {
    // Leading/trailing whitespace of a fragment is insignificant in SQL; trimming it keeps the output
    // tidy (e.g. `GREATEST(a, b)` does not become `max(a,  b)` from the space after each comma).
    const trimmed = fragment.trim();
    const savedSql = this.sql;
    // translateFragment reuses the walker on the fragment text; the parameter cursor and output are shared,
    // so parameters stay in statement order. The fragment is translated as if it were the whole statement
    // starting at offset 0 of a temporary view — implemented by swapping `sql` for the duration.
    (this as unknown as { sql: string }).sql = trimmed;
    try {
      this.translateRange(0, trimmed.length);
    } finally {
      (this as unknown as { sql: string }).sql = savedSql;
    }
  }
}

/**
 * Translate MySQL-flavoured API SQL to SQLite SQL, rebuilding the parameter list in statement order.
 * Pure (no I/O, no clock except the generated "now" values); the MySQL backend never calls it.
 * Throws on any construct it does not know how to translate, so a new MySQL-ism fails loudly instead of
 * running the wrong SQL on a user's PC.
 */
export function translateForSqlite(sql: string, params: readonly unknown[]): { sql: string; params: unknown[] } {
  return new Translator(sql, params).run();
}

/** Convert one bound value to its SQLite form: Date -> integer ms, boolean -> 0/1, undefined -> NULL. */
export function toSqliteValue(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === undefined) return null;
  if (v !== null && typeof v === "object" && !Buffer.isBuffer(v) && !(v instanceof Uint8Array)) {
    throw new Error(`cannot bind a ${v.constructor?.name ?? "object"} as a SQLite parameter (JSON.stringify it first)`);
  }
  return v;
}

/** The MySQL-shaped error for a SIGNAL the application code raises itself (canonical allocator, rule 23):
 *  errno 1644 with the bare signal key as sqlMessage, exactly what problem.ts's fromDatabase() reads. */
export function signalError(key: string): Error & { errno: number; sqlMessage: string } {
  const e = new Error(key) as Error & { errno: number; sqlMessage: string };
  e.errno = 1644;
  e.sqlMessage = key;
  return e;
}
