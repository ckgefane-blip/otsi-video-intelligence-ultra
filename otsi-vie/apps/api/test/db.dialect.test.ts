/**
 * Dual-database dialect tests (distribution plan §1d safeguards 1, 2, 3). The SAME file runs twice — once
 * against MySQL, once against SQLite — selected by `OTSI_VIE_TEST_DB_BACKEND` (default `mysql`). Run it with
 * `test/run-dual-db.sh`. The SQLite half runs HERE with no server; the MySQL half needs the owner's host
 * MySQL 3507 and the usual global setup.
 *
 * Two layers:
 *   1. pure `translateForSqlite` unit tests — verbatim SQL from `src/` in, SQLite SQL out, no MySQL tokens left;
 *   2. integration tests against a `Db` on the selected backend — the same assertions on both, proving the
 *      translation is behaviourally identical, not just textually plausible.
 *
 * Known gaps, recorded honestly:
 *   - The canonical-allocator tests need agent B's roles migration on MySQL (INSERT on the allocator tables
 *     + UPDATE of the canonical columns of `players` for `otsi_app`); until it lands they fail with 1142.
 *     That failure is the honest signal, not a test bug — see `test/db-harness.ts` and `canonical-allocator.ts`.
 *   - The full API suite on SQLite needs agent B's SQLite migrations; only this file passes on SQLite today.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { Db } from "../src/core/db";
import { translateForSqlite, todayDateString } from "../src/core/db/dialect";
import { fromDatabase } from "../src/core/problem";
import { writeAudit } from "../src/core/audit";
import { publish } from "../src/core/outbox/publish";
import { issueCanonicalPlayerId, mergePlayers } from "../src/modules/players/canonical-allocator";
import { makeDialectDb, seedCountry, seedProvisionalPlayer, testDbBackend, type DialectDb } from "./db-harness";

const uid = () => uuidv7();
const YEAR = new Date().getUTCFullYear();
/** A DATETIME column reads back as a string on MySQL and as integer ms on SQLite; both are the same instant. */
const msOf = (v: unknown): number => (typeof v === "number" ? v : new Date(v as string).getTime());
const approxNow = (v: unknown, tolerance = 15_000): boolean => Math.abs(msOf(v) - Date.now()) < tolerance;
const dbErr = (e: unknown) => e as { errno?: number; sqlMessage?: string; message?: string };

/** Typed reads: `db.one`/`db.rows` require `T extends RowDataPacket`; the intersection keeps the fields typed. */
async function oneRow<T>(db: Db, sql: string, params: unknown[] = []): Promise<(RowDataPacket & T) | undefined> {
  return db.one<RowDataPacket & T>(sql, params);
}
async function allRows<T>(db: Db, sql: string, params: unknown[] = []): Promise<Array<RowDataPacket & T>> {
  return db.rows<RowDataPacket & T>(sql, params);
}

/** Await a promise that must reject with the allocator signal `code` (errno 1644). The HTTP status is
 *  per-key in `problem.ts` SIGNALS (most are 409; validation-shaped ones are 422) — assert both. */
async function expectSignal(p: Promise<unknown>, code: string, status: number): Promise<void> {
  try {
    await p;
    expect.unreachable(`expected signal ${code}`);
  } catch (e) {
    const api = fromDatabase(e);
    expect(api?.status).toBe(status);
    expect(api?.code).toBe(code);
  }
}

describe("translateForSqlite (pure)", () => {
  it("upsert: ON DUPLICATE KEY UPDATE becomes ON CONFLICT DO UPDATE with excluded.*", () => {
    const out = translateForSqlite(
      "INSERT INTO dbt_upserts (id, org, v, note, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)",
      ["u1", "o1", 3, "n1"],
    );
    expect(out.sql).toContain("ON CONFLICT");
    expect(out.sql).toContain("excluded.v");
    expect(out.sql).toContain("excluded.updated_at");
    expect(out.sql).not.toContain("ON DUPLICATE KEY UPDATE");
    expect(out.sql).not.toContain("VALUES(v)");
    expect(out.params).toHaveLength(5);
    expect(typeof out.params[4]).toBe("number");
    expect(Math.abs((out.params[4] as number) - Date.now())).toBeLessThan(5000);
  });

  it("upsert: the VALUES() row list is not mistaken for the function", () => {
    const out = translateForSqlite(
      "INSERT INTO t (a, b) VALUES (?, ?), (?, ?) ON DUPLICATE KEY UPDATE a = VALUES(a)",
      [1, 2, 3, 4],
    );
    // the translator's spacing varies (VALUES( not VALUES (), `a =excluded.a`); compare whitespace-insensitively
    const norm = out.sql.replace(/\s+/g, " ");
    expect(norm).toContain("VALUES(?, ?), (?, ?)");
    expect(norm).toContain("ON CONFLICT");
    expect(norm).toContain("excluded.a");
    expect(norm).not.toContain("VALUES(a)");
  });

  it("INSERT IGNORE becomes INSERT OR IGNORE", () => {
    const out = translateForSqlite("INSERT IGNORE INTO dbt_parent (id, name) VALUES (?, ?)", ["p1", "n"]);
    expect(out.sql.startsWith("INSERT OR IGNORE")).toBe(true);
    expect(out.sql).not.toContain("INSERT IGNORE");
  });

  it("now functions become a bound integer-ms param", () => {
    for (const fn of ["NOW(6)", "UTC_TIMESTAMP(6)", "CURRENT_TIMESTAMP(6)", "CURRENT_TIMESTAMP()"]) {
      const out = translateForSqlite(`SELECT ${fn} AS now`, []);
      expect(out.sql).toBe("SELECT ? AS now");
      expect(out.params).toHaveLength(1);
      expect(Math.abs((out.params[0] as number) - Date.now())).toBeLessThan(5000);
    }
  });

  it("CURDATE() becomes today's UTC date string", () => {
    const out = translateForSqlite("SELECT CURDATE() AS d", []);
    expect(out.sql).toBe("SELECT ? AS d");
    expect(out.params).toEqual([todayDateString()]);
  });

  it("IF() becomes CASE WHEN", () => {
    const out = translateForSqlite("SELECT IF(a > b, 'x', 'y') FROM t", []);
    expect(out.sql).toContain("CASE WHEN");
    expect(out.sql).not.toMatch(/IF\s*\(/);
  });

  it("GREATEST/LEAST become scalar max/min", () => {
    expect(translateForSqlite("SELECT GREATEST(a, b, c) FROM t", []).sql).toContain("max(a, b, c)");
    expect(translateForSqlite("SELECT LEAST(a, b) FROM t", []).sql).toContain("min(a, b)");
  });

  it("CONCAT becomes a NULL-propagating || chain", () => {
    const out = translateForSqlite("SELECT CONCAT(a, b) AS c FROM t", []);
    expect(out.sql).toContain("||");
    expect(out.sql).not.toContain("CONCAT(");
  });

  it("FIELD() becomes a CASE", () => {
    const out = translateForSqlite("SELECT id FROM t ORDER BY FIELD(code, 'b', 'a')", []);
    expect(out.sql).toContain("CASE");
    expect(out.sql).not.toContain("FIELD(");
  });

  it("JSON_EXTRACT / JSON_UNQUOTE / JSON_OBJECT / JSON_REMOVE go to JSON1", () => {
    expect(translateForSqlite("SELECT JSON_EXTRACT(doc, '$.a') FROM t", []).sql).toContain("json_extract");
    const unq = translateForSqlite("SELECT JSON_UNQUOTE(JSON_EXTRACT(doc, '$.a')) FROM t", []);
    expect(unq.sql).toContain("json_extract");
    expect(unq.sql).not.toContain("JSON_UNQUOTE");
    expect(translateForSqlite("SELECT JSON_OBJECT('k', ?) FROM t", [1]).sql).toContain("json_object");
    expect(translateForSqlite("SELECT JSON_REMOVE(doc, '$.a') FROM t", []).sql).toContain("json_remove");
  });

  it("JSON_CONTAINS(col, JSON_QUOTE(?)) becomes an EXISTS over json_each", () => {
    const out = translateForSqlite("SELECT id FROM t WHERE JSON_CONTAINS(tags, JSON_QUOTE(?))", ["x"]);
    expect(out.sql).toContain("EXISTS");
    expect(out.sql).toContain("json_each");
    expect(out.sql).not.toContain("JSON_CONTAINS");
    expect(out.params).toEqual(["x"]);
  });

  it("DATE_ADD / DATE_SUB / bare INTERVAL become ms arithmetic", () => {
    const add = translateForSqlite("UPDATE t SET e = DATE_ADD(c, INTERVAL ? DAY) WHERE id = ?", [3, "x"]);
    expect(add.sql).not.toContain("DATE_ADD");
    expect(add.sql).not.toContain("INTERVAL");
    expect(add.params).toEqual([3, "x"]);
    const sub = translateForSqlite("UPDATE t SET e = DATE_SUB(c, INTERVAL ? HOUR) WHERE id = ?", [2, "x"]);
    expect(sub.sql).not.toContain("DATE_SUB");
    expect(sub.sql).not.toContain("INTERVAL");
    const bare = translateForSqlite("SELECT id FROM t WHERE c < CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY", []);
    expect(bare.sql).not.toContain("INTERVAL");
    expect(bare.params).toHaveLength(1);
  });

  it("TIMESTAMPDIFF becomes integer arithmetic on ms", () => {
    const s = translateForSqlite("SELECT TIMESTAMPDIFF(SECOND, a, b) FROM t", []);
    expect(s.sql).not.toContain("TIMESTAMPDIFF");
    expect(s.sql).toContain("/ 1000");
    const us = translateForSqlite("SELECT TIMESTAMPDIFF(MICROSECOND, a, b) FROM t", []);
    expect(us.sql).not.toContain("TIMESTAMPDIFF");
    expect(us.sql).toContain("* 1000");
  });

  it("DATE_FORMAT becomes strftime (ISO form) or strftime (date form)", () => {
    const iso = translateForSqlite("SELECT DATE_FORMAT(c, '%Y-%m-%dT%H:%i:%s.%fZ') FROM t", []);
    expect(iso.sql).not.toContain("DATE_FORMAT");
    expect(iso.sql).toContain("strftime");
    const d = translateForSqlite("SELECT DATE_FORMAT(c, '%Y-%m-%d') FROM t", []);
    expect(d.sql).not.toContain("DATE_FORMAT");
    expect(d.sql).toContain("strftime('%Y-%m-%d'");
  });

  it("FOR UPDATE is stripped (BEGIN IMMEDIATE replaces it); SKIP LOCKED goes with it", () => {
    expect(translateForSqlite("SELECT * FROM t WHERE id = ? FOR UPDATE", ["x"]).sql).not.toContain("FOR UPDATE");
    const claim = translateForSqlite("SELECT * FROM o WHERE id = ? FOR UPDATE OF o SKIP LOCKED", ["x"]);
    expect(claim.sql).not.toContain("FOR UPDATE");
    expect(claim.sql).not.toContain("SKIP LOCKED");
    const limited = translateForSqlite("SELECT * FROM t WHERE id = ? LIMIT 1 FOR UPDATE", ["x"]);
    expect(limited.sql).not.toContain("FOR UPDATE");
    expect(limited.sql).toContain("LIMIT 1");
  });

  it("IN (?) expands arrays; an empty array becomes IN (NULL)", () => {
    const many = translateForSqlite("SELECT id FROM t WHERE id IN (?)", [[1, 2, 3]]);
    expect(many.sql).toContain("IN (?, ?, ?)");
    expect(many.params).toEqual([1, 2, 3]);
    const none = translateForSqlite("SELECT id FROM t WHERE id IN (?)", [[]]);
    expect(none.sql).toContain("IN (NULL)");
    expect(none.params).toEqual([]);
  });

  it("bound LIMIT ? and row-value IN are unchanged", () => {
    const lim = translateForSqlite("SELECT id FROM t LIMIT ?", [2]);
    expect(lim.sql).toBe("SELECT id FROM t LIMIT ?");
    expect(lim.params).toEqual([2]);
    const row = translateForSqlite("SELECT * FROM t WHERE (a, b) IN ((?, ?), (?, ?))", [1, 2, 3, 4]);
    expect(row.sql).toContain("IN ((?, ?), (?, ?))");
  });

  it("LIKE ? gains an explicit ESCAPE (modules escape %/_ with backslash)", () => {
    const out = translateForSqlite("SELECT id FROM t WHERE name LIKE ?", ["100\\%%"]);
    expect(out.sql).toContain("LIKE ? ESCAPE '\\'");
  });

  it("JSON_TABLE becomes json_each with .value and ON 1 (both access.ts shapes)", () => {
    const join = translateForSqlite(
      "SELECT r.id, j.vid FROM dbt_reports r LEFT JOIN JSON_TABLE(r.config, '$.video_ids[*]' COLUMNS (vid VARCHAR(36) PATH '$')) j ON TRUE WHERE r.project_id = ?",
      ["p1"],
    );
    expect(join.sql).not.toContain("JSON_TABLE");
    expect(join.sql).toContain("json_each");
    expect(join.sql).toContain("j.value");
    expect(join.sql).not.toContain("j.vid");
    expect(join.sql).toContain("ON 1");
    const notExists = translateForSqlite(
      "SELECT v.id FROM dbt_videos v WHERE NOT EXISTS (SELECT 1 FROM dbt_archives a JOIN JSON_TABLE(a.video_ids, '$[*]' COLUMNS (vid VARCHAR(36) PATH '$')) j ON TRUE WHERE j.vid = v.id)",
      [],
    );
    expect(notExists.sql).not.toContain("JSON_TABLE");
    expect(notExists.sql).toContain("json_each");
    expect(notExists.sql).toContain("j.value");
    expect(notExists.sql).toContain("ON 1");
  });

  it("RAND() / FLOOR() / CAST DECIMAL go to random() / floor() / REAL", () => {
    expect(translateForSqlite("SELECT id FROM t ORDER BY RAND()", []).sql).toContain("random()");
    expect(translateForSqlite("SELECT FLOOR(x) FROM t", []).sql).toContain("floor(x)");
    expect(translateForSqlite("SELECT CAST(x AS DECIMAL(12,3)) FROM t", []).sql).toContain("CAST(x AS REAL)");
  });

  it("no MySQL token survives in a battery of real statements from src/", () => {
    const mysqlTokens = /NOW\(|UTC_TIMESTAMP|CURRENT_TIMESTAMP|CURDATE\(|DATE_ADD|DATE_SUB|INTERVAL|ON DUPLICATE|FOR UPDATE|SKIP LOCKED|IF\(|GREATEST|LEAST|FIELD\(|CONCAT\(|JSON_EXTRACT|JSON_UNQUOTE|JSON_OBJECT|JSON_CONTAINS|JSON_TABLE|JSON_REMOVE|TIMESTAMPDIFF|DATE_FORMAT|RAND\(|FLOOR\(|INSERT IGNORE|REPLACE INTO/;
    const stmts: Array<[string, unknown[]]> = [
      ["INSERT INTO dbt_upserts (id, org, v, note, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)", ["u", "o", 1, "n"]],
      ["INSERT INTO outbox_events (organization_id, aggregate_type, aggregate_id, event_type, event_payload, dedupe_key, available_at) VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MICROSECOND))", ["o", "player", "a", "player.created", "{}", "k", 0]],
      ["SELECT * FROM outbox_events o WHERE o.delivered_at IS NULL AND o.available_at <= UTC_TIMESTAMP(6) ORDER BY o.available_at, o.id LIMIT 10 FOR UPDATE OF o SKIP LOCKED", []],
      ["UPDATE dbt_times SET n = IF(n + 1 >= ?, 1, 0), expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MINUTE) WHERE id = ?", [3, 30, "x"]],
      ["SELECT JSON_UNQUOTE(JSON_EXTRACT(doc, '$.a')) FROM t WHERE JSON_CONTAINS(tags, JSON_QUOTE(?))", ["x"]],
      ["SELECT GREATEST(a, b) AS g, CONCAT(x, y) AS c, FLOOR(z) AS f FROM t WHERE created_at < CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY ORDER BY FIELD(code, 'b', 'a') LIMIT ?", [5]],
      ["SELECT r.id, j.vid FROM dbt_reports r LEFT JOIN JSON_TABLE(r.config, '$.video_ids[*]' COLUMNS (vid VARCHAR(36) PATH '$')) j ON TRUE WHERE r.project_id = ?", ["p"]],
      ["INSERT IGNORE INTO dbt_parent (id, name) VALUES (?, ?)", ["p", "n"]],
      ["SELECT DATE_FORMAT(c, '%Y-%m-%dT%H:%i:%s.%fZ'), TIMESTAMPDIFF(SECOND, a, b), RAND() FROM t", []],
    ];
    for (const [sql, params] of stmts) {
      const out = translateForSqlite(sql, params);
      expect(out.sql, sql).not.toMatch(mysqlTokens);
    }
  });

  it("unsupported constructs fail loudly instead of silently changing meaning", () => {
    expect(() => translateForSqlite("REPLACE INTO t (id) VALUES (?)", ["x"])).toThrow(/REPLACE INTO/);
    expect(() => translateForSqlite("SELECT JSON_SET(doc, '$.a', ?) FROM t", [1])).toThrow(/JSON_SET/);
    expect(() => translateForSqlite("SELECT * INTO t2 FROM t", [])).toThrow(/INTO/);
  });
});

describe("dialect behaviour on the selected backend", () => {
  const backend = testDbBackend();
  const itSqliteOnly = backend === "sqlite" ? it : it.skip;
  let f: DialectDb;
  let db: Db;

  beforeAll(async () => {
    f = await makeDialectDb();
    db = f.db;
  });
  afterAll(async () => {
    await f.cleanup();
  });

  it("upsert: VALUES() form, CURRENT_TIMESTAMP(6) in SET, and the no-op dedupe form", async () => {
    const id = uid();
    await db.rows(
      "INSERT INTO dbt_upserts (id, org, v, note, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)",
      [id, "org-a", 1, "note-a"],
    );
    await db.rows(
      "INSERT INTO dbt_upserts (id, org, v, note, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE v = VALUES(v), updated_at = VALUES(updated_at)",
      [uid(), "org-a", 7, "note-a"],
    );
    const row = await oneRow<{ v: number; updated_at: unknown }>(db, "SELECT v, updated_at FROM dbt_upserts WHERE org = ? AND note = ?", ["org-a", "note-a"]);
    expect(row?.v).toBe(7);
    expect(approxNow(row?.updated_at)).toBe(true);
    // the no-op form used by the outbox dedupe path: same key, same values, no error, still one row
    await db.rows("INSERT INTO dbt_events (org, kind, dedupe_key, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key", ["org-a", "k", "dup-noop"]);
    await db.rows("INSERT INTO dbt_events (org, kind, dedupe_key, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key", ["org-a", "k", "dup-noop"]);
    const count = await oneRow<{ c: number }>(db, "SELECT COUNT(*) AS c FROM dbt_events WHERE dedupe_key = ?", ["dup-noop"]);
    expect(count?.c).toBe(1);
  });

  it("INSERT IGNORE: a duplicate is silently skipped", async () => {
    const id = uid();
    await db.rows("INSERT IGNORE INTO dbt_parent (id, name) VALUES (?, ?)", [id, "first"]);
    await db.rows("INSERT IGNORE INTO dbt_parent (id, name) VALUES (?, ?)", [id, "second"]);
    const row = await oneRow<{ name: string }>(db, "SELECT name FROM dbt_parent WHERE id = ?", [id]);
    expect(row?.name).toBe("first");
  });

  it("dates are integer ms on SQLite and DATETIME strings on MySQL, same instant either way", async () => {
    const id = uid();
    const at = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6));
    await db.rows("INSERT INTO dbt_times (id, created_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP(6))", [id, at]);
    const row = await oneRow<{ created_at: unknown; expires_at: unknown }>(db, "SELECT created_at, expires_at FROM dbt_times WHERE id = ?", [id]);
    expect(msOf(row?.created_at)).toBe(at.getTime());
    if (backend === "sqlite") {
      expect(typeof row?.created_at).toBe("number");
      expect(typeof row?.expires_at).toBe("number");
    }
    expect(approxNow(row?.expires_at)).toBe(true);
  });

  it("Date params become ms; boolean params become 0/1", async () => {
    const id = uid();
    const at = new Date(Date.UTC(2026, 5, 6, 7, 8, 9, 10));
    await db.rows("INSERT INTO dbt_upserts (id, org, v, flag, created_at) VALUES (?, ?, ?, ?, ?)", [id, "org-b", 1, true, at]);
    await db.rows("INSERT INTO dbt_upserts (id, org, v, flag, created_at) VALUES (?, ?, ?, ?, ?)", [uid(), "org-b", 2, false, at]);
    const rows = await allRows<{ flag: number; created_at: unknown }>(db, "SELECT flag, created_at FROM dbt_upserts WHERE org = ? ORDER BY v", ["org-b"]);
    expect(rows.map((r) => r.flag)).toEqual([1, 0]);
    expect(msOf(rows[0]!.created_at)).toBe(at.getTime());
  });

  it("CURDATE() inserts today's UTC date; DATE-only columns stay TEXT ISO on SQLite", async () => {
    const id = uid();
    await db.rows("INSERT INTO dbt_times (id, valid_from, valid_to) VALUES (?, CURDATE(), '2026-12-31')", [id]);
    const row = await oneRow<{ valid_from: string; valid_to: string }>(db, "SELECT valid_from, valid_to FROM dbt_times WHERE id = ?", [id]);
    expect(row?.valid_from).toBe(todayDateString());
    expect(row?.valid_to).toBe("2026-12-31");
    if (backend === "sqlite") expect(typeof row?.valid_from).toBe("string");
  });

  it("interval arithmetic: DATE_ADD / DATE_SUB in every unit, literal and bound", async () => {
    const id = uid();
    const at = new Date(Date.UTC(2026, 0, 2, 0, 0, 0, 0));
    await db.rows("INSERT INTO dbt_times (id, created_at) VALUES (?, ?)", [id, at]);
    await db.rows("UPDATE dbt_times SET expires_at = DATE_ADD(created_at, INTERVAL ? DAY) WHERE id = ?", [3, id]);
    let row = await oneRow<{ created_at: unknown; expires_at: unknown }>(db, "SELECT created_at, expires_at FROM dbt_times WHERE id = ?", [id]);
    expect(msOf(row?.expires_at) - msOf(row?.created_at)).toBe(3 * 86_400_000);
    await db.rows("UPDATE dbt_times SET expires_at = DATE_SUB(created_at, INTERVAL 90 MINUTE) WHERE id = ?", [id]);
    row = await oneRow<{ created_at: unknown; expires_at: unknown }>(db, "SELECT created_at, expires_at FROM dbt_times WHERE id = ?", [id]);
    expect(msOf(row?.created_at) - msOf(row?.expires_at)).toBe(90 * 60_000);
    await db.rows("UPDATE dbt_times SET expires_at = DATE_ADD(created_at, INTERVAL 1500 MICROSECOND) WHERE id = ?", [id]);
    row = await oneRow<{ created_at: unknown; expires_at: unknown }>(db, "SELECT created_at, expires_at FROM dbt_times WHERE id = ?", [id]);
    // 1500 us = 1.5 ms: MySQL stores it exactly in DATETIME(6) and JS reads it back truncated to 1 ms;
    // SQLite stores the ms integer 1.5 — either way the gap is between 1 and 2 ms
    expect(msOf(row?.expires_at) - msOf(row?.created_at)).toBeGreaterThanOrEqual(1);
    expect(msOf(row?.expires_at) - msOf(row?.created_at)).toBeLessThanOrEqual(2);
    await db.rows("UPDATE dbt_times SET expires_at = DATE_ADD(created_at, INTERVAL 2 SECOND) WHERE id = ?", [id]);
    row = await oneRow<{ created_at: unknown; expires_at: unknown }>(db, "SELECT created_at, expires_at FROM dbt_times WHERE id = ?", [id]);
    expect(msOf(row?.expires_at) - msOf(row?.created_at)).toBe(2000);
    // bare INTERVAL after CURRENT_TIMESTAMP(6), the jobs.ts shape
    const old = uid();
    await db.rows("INSERT INTO dbt_times (id, created_at) VALUES (?, ?)", [old, new Date(Date.now() - 2 * 86_400_000)]);
    const fresh = uid();
    await db.rows("INSERT INTO dbt_times (id, created_at) VALUES (?, CURRENT_TIMESTAMP(6))", [fresh]);
    const stale = await allRows<{ id: string }>(db, "SELECT id FROM dbt_times WHERE created_at < CURRENT_TIMESTAMP(6) - INTERVAL 1 DAY AND id IN (?, ?)", [old, fresh]);
    expect(stale.map((r) => r.id)).toEqual([old]);
  });

  it("JSON: JSON_OBJECT / JSON_EXTRACT / JSON_UNQUOTE / JSON_REMOVE / JSON_CONTAINS round-trip", async () => {
    const id = uid();
    await db.rows("INSERT INTO dbt_json (id, doc, tags) VALUES (?, JSON_OBJECT('a', ?, 'n', ?), ?)", [id, "hello", 42, JSON.stringify(["x", "y"])]);
    const row = await oneRow<{ a: string; n: number; raw: string }>(db, 
      "SELECT JSON_EXTRACT(doc, '$.a') AS a, JSON_EXTRACT(doc, '$.n') AS n, JSON_UNQUOTE(JSON_EXTRACT(doc, '$.a')) AS raw FROM dbt_json WHERE id = ?", [id]);
    // json_extract returns the bare value on both engines; the string form is 'hello' either way
    expect(String(row?.a)).toContain("hello");
    expect(Number(row?.n)).toBe(42);
    expect(row?.raw).toBe("hello");
    await db.rows("UPDATE dbt_json SET doc = JSON_REMOVE(doc, '$.n') WHERE id = ?", [id]);
    const after = await oneRow<{ n: unknown }>(db, "SELECT JSON_EXTRACT(doc, '$.n') AS n FROM dbt_json WHERE id = ?", [id]);
    expect(after?.n).toBeNull();
    const hit = await oneRow<{ c: number }>(db, "SELECT COUNT(*) AS c FROM dbt_json WHERE id = ? AND JSON_CONTAINS(tags, JSON_QUOTE(?))", [id, "y"]);
    expect(hit?.c).toBe(1);
    const miss = await oneRow<{ c: number }>(db, "SELECT COUNT(*) AS c FROM dbt_json WHERE id = ? AND JSON_CONTAINS(tags, JSON_QUOTE(?))", [id, "z"]);
    expect(miss?.c).toBe(0);
  });

  it("GROUP_CONCAT with a separator; CONCAT NULL-propagates and COALESCE falls back", async () => {
    for (const code of ["ga", "gb", "gc"]) await db.rows("INSERT INTO dbt_child (id, code) VALUES (?, ?)", [uid(), code]);
    const row = await oneRow<{ joined: string }>(db, "SELECT GROUP_CONCAT(code SEPARATOR ';') AS joined FROM dbt_child WHERE code IN (?, ?, ?)", ["ga", "gb", "gc"]);
    expect(row?.joined.split(";").sort()).toEqual(["ga", "gb", "gc"]);
    const plain = await oneRow<{ c: string | null; f: string }>(db, "SELECT CONCAT('a', NULL) AS c, COALESCE(CONCAT('a', NULL), 'fallback') AS f");
    expect(plain?.c).toBeNull();
    expect(plain?.f).toBe("fallback");
    const joined = await oneRow<{ c: string }>(db, "SELECT CONCAT('a', 'b') AS c");
    expect(joined?.c).toBe("ab");
  });

  it("FIELD() orders the same on both backends", async () => {
    const ids = { a: uid(), b: uid(), c: uid() };
    for (const [code, id] of [["fa", ids.a], ["fb", ids.b], ["fc", ids.c]] as const) {
      await db.rows("INSERT INTO dbt_child (id, code) VALUES (?, ?)", [id, code]);
    }
    const rows = await allRows<{ code: string }>(db, "SELECT code FROM dbt_child WHERE id IN (?, ?, ?) ORDER BY FIELD(code, 'fb', 'fa')", [ids.a, ids.b, ids.c]);
    expect(rows.map((r) => r.code)).toEqual(["fc", "fb", "fa"]); // FIELD() is 0 for unlisted codes, and 0 sorts first
  });

  it("GREATEST / LEAST, including the NULL rule", async () => {
    const row = await oneRow<{ g: number; l: number; gn: null }>(db, "SELECT GREATEST(1, 5, 3) AS g, LEAST(1, 5, 3) AS l, GREATEST(1, NULL, 3) AS gn");
    expect(row?.g).toBe(5);
    expect(row?.l).toBe(1);
    expect(row?.gn).toBeNull();
  });

  it("IF() in UPDATE SET with DATE_ADD (the auth lock-out shape)", async () => {
    const id = uid();
    await db.rows("INSERT INTO dbt_times (id, n) VALUES (?, ?)", [id, 2]);
    await db.rows("UPDATE dbt_times SET n = IF(n + 1 >= ?, 1, 0), expires_at = DATE_ADD(CURRENT_TIMESTAMP(6), INTERVAL ? MINUTE) WHERE id = ?", [3, 30, id]);
    const row = await oneRow<{ n: number; expires_at: unknown }>(db, "SELECT n, expires_at FROM dbt_times WHERE id = ?", [id]);
    expect(row?.n).toBe(1);
    expect(msOf(row?.expires_at) - Date.now()).toBeGreaterThan(29 * 60_000);
    expect(msOf(row?.expires_at) - Date.now()).toBeLessThan(31 * 60_000);
  });

  it("TIMESTAMPDIFF SECOND and MICROSECOND; DATE_FORMAT both formats", async () => {
    const a = uid();
    const b = uid();
    const atA = new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 0));
    const atB = new Date(atA.getTime() + 90_000);
    await db.rows("INSERT INTO dbt_times (id, created_at) VALUES (?, ?)", [a, atA]);
    await db.rows("INSERT INTO dbt_times (id, created_at) VALUES (?, ?)", [b, atB]);
    const diff = await oneRow<{ s: number; us: number }>(db, 
      "SELECT TIMESTAMPDIFF(SECOND, x.created_at, y.created_at) AS s, TIMESTAMPDIFF(MICROSECOND, x.created_at, y.created_at) AS us FROM dbt_times x, dbt_times y WHERE x.id = ? AND y.id = ?",
      [a, b],
    );
    expect(diff?.s).toBe(90);
    expect(diff?.us).toBe(90_000_000);
    const fmt = await oneRow<{ iso: string; d: string }>(db, 
      "SELECT DATE_FORMAT(created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS iso, DATE_FORMAT(created_at, '%Y-%m-%d') AS d FROM dbt_times WHERE id = ?", [a]);
    expect(fmt?.iso).toMatch(/^2026-01-02T03:04:05\.\d{6}Z$/);
    expect(fmt?.d).toBe("2026-01-02");
    if (backend === "mysql") expect(fmt?.iso).toBe("2026-01-02T03:04:05.000000Z");
  });

  it("RAND() ORDER BY returns every row; FLOOR() and CAST DECIMAL agree", async () => {
    const ids = [uid(), uid(), uid(), uid(), uid()];
    for (const id of ids) await db.rows("INSERT INTO dbt_parent (id, name) VALUES (?, ?)", [id, `r-${id.slice(0, 6)}`]);
    const rows = await allRows<{ id: string }>(db, "SELECT id FROM dbt_parent WHERE id IN (?, ?, ?, ?, ?) ORDER BY RAND() LIMIT 5", ids);
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
    const calc = await oneRow<{ f: number; c: number }>(db, "SELECT FLOOR(7.9) AS f, CAST(1.2345 AS DECIMAL(12,3)) AS c");
    expect(calc?.f).toBe(7);
    expect(Math.abs((calc?.c ?? 0) - 1.234)).toBeLessThan(0.001);
  });

  it("FOR UPDATE is stripped and the query still returns rows", async () => {
    const id = uid();
    await db.rows("INSERT INTO dbt_parent (id, name) VALUES (?, ?)", [id, "locked"]);
    const row = await oneRow<{ name: string }>(db, "SELECT name FROM dbt_parent WHERE id = ? LIMIT 1 FOR UPDATE", [id]);
    expect(row?.name).toBe("locked");
    const claimed = await allRows<{ id: string }>(db, "SELECT id FROM dbt_parent o WHERE o.id = ? FOR UPDATE OF o SKIP LOCKED", [id]);
    expect(claimed).toHaveLength(1);
  });

  it("bound LIMIT ?, IN (?) expansion, empty IN (?), row-value IN", async () => {
    const ids = [uid(), uid(), uid()];
    for (const id of ids) await db.rows("INSERT INTO dbt_parent (id, name) VALUES (?, ?)", [id, "lim"]);
    const limited = await allRows<{ id: string }>(db, "SELECT id FROM dbt_parent WHERE name = ? LIMIT ?", ["lim", 2]);
    expect(limited).toHaveLength(2);
    const inMany = await allRows<{ id: string }>(db, "SELECT id FROM dbt_parent WHERE id IN (?)", [ids.slice(0, 2)]);
    expect(inMany).toHaveLength(2);
    const inNone = await allRows<{ id: string }>(db, "SELECT id FROM dbt_parent WHERE id IN (?)", [[]]);
    expect(inNone).toHaveLength(0);
    const org = `rv-${uid()}`;
    await db.rows("INSERT INTO dbt_upserts (id, org, v, note) VALUES (?, ?, ?, ?)", [uid(), org, 1, "one"]);
    await db.rows("INSERT INTO dbt_upserts (id, org, v, note) VALUES (?, ?, ?, ?)", [uid(), org, 2, "two"]);
    const pairs = await allRows<{ note: string }>(db, "SELECT note FROM dbt_upserts WHERE (org, note) IN ((?, ?), (?, ?))", [org, "one", org, "two"]);
    expect(pairs.map((r) => r.note).sort()).toEqual(["one", "two"]);
  });

  it("LIKE ? honours the backslash escape (escaped % matches only a literal %)", async () => {
    const rows = [["100% sure"], ["100x sure"], ["100 sure"]];
    for (const [name] of rows) await db.rows("INSERT INTO dbt_parent (id, name) VALUES (?, ?)", [uid(), name]);
    const found = await allRows<{ name: string }>(db, "SELECT name FROM dbt_parent WHERE name LIKE ?", ["100\\%%"]);
    expect(found.map((r) => r.name)).toEqual(["100% sure"]);
  });

  it("JSON_TABLE: both access.ts shapes join the array and return the video ids", async () => {
    const projectId = uid();
    const v1 = uid();
    const v2 = uid();
    const v3 = uid();
    for (const v of [v1, v2, v3]) await db.rows("INSERT INTO dbt_videos (id, project_id) VALUES (?, ?)", [v, projectId]);
    await db.rows("INSERT INTO dbt_reports (id, config, project_id) VALUES (?, ?, ?)",
      [uid(), JSON.stringify({ video_ids: [v1, v2] }), projectId]);
    await db.rows("INSERT INTO dbt_archives (id, project_id, video_ids) VALUES (?, ?, ?)",
      [uid(), projectId, JSON.stringify([v1])]);
    const joined = await allRows<{ vid: string }>(db, 
      "SELECT j.vid AS vid FROM dbt_reports r LEFT JOIN JSON_TABLE(r.config, '$.video_ids[*]' COLUMNS (vid VARCHAR(36) PATH '$')) j ON TRUE WHERE r.project_id = ?",
      [projectId],
    );
    expect(joined.map((r) => r.vid).sort()).toEqual([v1, v2].sort());
    const unreferenced = await allRows<{ id: string }>(db, 
      "SELECT v.id FROM dbt_videos v WHERE v.project_id = ? AND NOT EXISTS (SELECT 1 FROM dbt_archives a JOIN JSON_TABLE(a.video_ids, '$[*]' COLUMNS (vid VARCHAR(36) PATH '$')) j ON TRUE WHERE j.vid = v.id)",
      [projectId],
    );
    expect(unreferenced.map((r) => r.id).sort()).toEqual([v2, v3].sort());
  });

  it("foreign keys reject a dangling reference with errno 1452", async () => {
    const err = await db.rows("INSERT INTO dbt_child (id, parent_id, code) VALUES (?, ?, ?)", [uid(), uid(), "orphan"]).then(
      () => null,
      (e) => dbErr(e),
    );
    expect(err?.errno).toBe(1452);
  });

  it("CHECK constraints reject an out-of-range value with errno 3819", async () => {
    const err = await db.rows("INSERT INTO dbt_child (id, code, n) VALUES (?, ?, ?)", [uid(), "big", 1_000_000]).then(
      () => null,
      (e) => dbErr(e),
    );
    expect(err?.errno).toBe(3819);
    expect(fromDatabase(err)?.status).toBe(422);
  });

  itSqliteOnly("STRICT tables reject a wrong-type insert with errno 1366", async () => {
    const err = await db.rows("INSERT INTO dbt_times (id, n) VALUES (?, 'not-a-number')", [uid()]).then(
      () => null,
      (e) => dbErr(e),
    );
    expect(err?.errno).toBe(1366);
  });

  it("duplicate key maps to errno 1062 with the index name in the message", async () => {
    await db.rows("INSERT INTO dbt_events (org, kind, dedupe_key) VALUES (?, ?, ?)", ["org-c", "k", "dup-1062"]);
    const err = await db.rows("INSERT INTO dbt_events (org, kind, dedupe_key) VALUES (?, ?, ?)", ["org-c", "k", "dup-1062"]).then(
      () => null,
      (e) => dbErr(e),
    );
    expect(err?.errno).toBe(1062);
    expect(err?.sqlMessage).toMatch(/uq_dbt_dedupe/);
    expect(fromDatabase(err)?.status).toBe(409);
  });

  it("publish() dedupes on the outbox key and returns the same id", async () => {
    const key = `dialect-${uid()}`;
    const aggregateId = uid();
    const msg = { organizationId: f.orgId, aggregateType: "player", aggregateId, eventType: "player.created", payload: { ok: true }, dedupeKey: key };
    const first = await db.tx(async (ex) => publish(ex, msg));
    expect(first.duplicate).toBe(false);
    expect(first.id).toBeGreaterThan(0);
    const second = await db.tx(async (ex) => publish(ex, msg));
    expect(second).toEqual({ id: first.id, duplicate: true });
    const row = await oneRow<{ available_at: unknown }>(db, "SELECT available_at FROM outbox_events WHERE dedupe_key = ?", [key]);
    expect(approxNow(row?.available_at)).toBe(true);
  });

  it("writeAudit returns the new id; the row is readable back", async () => {
    const entityId = uid();
    const id = await db.tx(async (ex) =>
      writeAudit(ex, { organizationId: f.orgId, kind: "SERVICE", service: "dialect-test" },
        { action: "dialect.test", entityType: "player", entityId, after: { a: 1 } }),
    );
    expect(id).toBeGreaterThan(0);
    const row = await oneRow<{ action: string; entity_id: string }>(db, "SELECT action, entity_id FROM audit_events WHERE id = ?", [id]);
    expect(row?.action).toBe("dialect.test");
    expect(row?.entity_id).toBe(entityId);
  });

  it("pool.query / getConnection() answer in mysql2 shape (affectedRows / insertId)", async () => {
    const [ins] = await db.pool.query("INSERT INTO dbt_parent (id, name) VALUES (?, ?)", [uid(), "pool"]);
    expect((ins as { affectedRows: number }).affectedRows).toBe(1);
    expect(Number((ins as { insertId: number }).insertId)).toBeGreaterThanOrEqual(0);
    const conn = await db.pool.getConnection();
    try {
      const [rows] = await conn.query("SELECT 1 AS one");
      expect((rows as Array<{ one: number }>)[0]?.one).toBe(1);
    } finally {
      conn.release();
    }
  });

  it("tx(): two racing transactions on the same row both proceed; a throw rolls back", async () => {
    const id = uid();
    await db.rows("INSERT INTO dbt_times (id, n) VALUES (?, ?)", [id, 0]);
    await Promise.all([
      db.tx(async (ex) => { await ex.query("UPDATE dbt_times SET n = n + 1 WHERE id = ?", [id]); }),
      db.tx(async (ex) => { await ex.query("UPDATE dbt_times SET n = n + 1 WHERE id = ?", [id]); }),
    ]);
    const row = await oneRow<{ n: number }>(db, "SELECT n FROM dbt_times WHERE id = ?", [id]);
    expect(row?.n).toBe(2);
    const ghost = uid();
    await expect(db.tx(async (ex) => {
      await ex.query("INSERT INTO dbt_parent (id, name) VALUES (?, ?)", [ghost, "ghost"]);
      throw new Error("boom");
    })).rejects.toThrow("boom");
    expect(await db.one("SELECT id FROM dbt_parent WHERE id = ?", [ghost])).toBeUndefined();
  });

  itSqliteOnly("tx(): a nested transaction throws fast instead of deadlocking", async () => {
    await expect(db.tx(async () => { await db.tx(async () => { /* never reached */ }); })).rejects.toThrow();
  });

  it("retryTransient: SQLITE_BUSY/SQLITE_LOCKED are retried with the same counters as 1213/1205", async () => {
    const before = db.transient.retried.get(1205) ?? 0;
    let calls = 0;
    const out = await db.retryTransient(async () => {
      if (++calls < 3) throw Object.assign(new Error("busy"), { sqliteCode: "SQLITE_BUSY" });
      return 42;
    }, 4);
    expect(out).toBe(42);
    expect(calls).toBe(3);
    expect(db.transient.retried.get(1205) ?? 0).toBe(before + 2);
  });

  it("retryTransient: SQLITE_CONSTRAINT is fatal and is never retried", async () => {
    let calls = 0;
    await expect(db.retryTransient(async () => {
      calls++;
      throw Object.assign(new Error("constraint"), { sqliteCode: "SQLITE_CONSTRAINT", errno: 1062 });
    })).rejects.toThrow("constraint");
    expect(calls).toBe(1);
  });

  it("retryTransient: exhaustion increments the counter and rethrows", async () => {
    const before = db.transient.exhausted;
    await expect(db.retryTransient(async () => {
      throw Object.assign(new Error("locked"), { sqliteCode: "SQLITE_LOCKED" });
    }, 2)).rejects.toThrow("locked");
    expect(db.transient.exhausted).toBe(before + 1);
  });
});

describe("canonical allocator (both backends, same code path)", () => {
  let f: DialectDb;
  let db: Db;
  let setup: Db;

  beforeAll(async () => {
    f = await makeDialectDb();
    db = f.db;
    setup = f.setup;
  });
  afterAll(async () => {
    await f.cleanup();
  });

  const issue = (country: string, playerId: string, requestKey: string | null = null) =>
    issueCanonicalPlayerId(db, { playerId, countryCode: country, organizationId: f.orgId, issuedBy: uid(), requestKey });

  it("issues OTSI-CCC-YYYY-NNNNNN, registers the player, and audits it", async () => {
    await seedCountry(setup, "ZAA");
    const player = await seedProvisionalPlayer(setup, f.orgId);
    const id = await issue("ZAA", player);
    expect(id).toBe(`OTSI-ZAA-${YEAR}-000001`);
    const row = await oneRow<{ canonical_state: string; canonical_otsi_id: string | null }>(db, 
      "SELECT canonical_state, canonical_otsi_id FROM players WHERE id = ?", [player]);
    expect(row?.canonical_state).toBe("REGISTERED");
    expect(row?.canonical_otsi_id).toBe(id);
    const issuance = await oneRow<{ sequence_number: number }>(db, 
      "SELECT sequence_number FROM canonical_id_issuances WHERE canonical_otsi_id = ?", [id]);
    expect(issuance?.sequence_number).toBe(1);
    const audit = await oneRow<{ action: string }>(db, 
      "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id DESC LIMIT 1", [player]);
    expect(audit?.action).toBe("player.canonical_id_issued");
  });

  it("the same request key replays the same ID without a second issuance", async () => {
    await seedCountry(setup, "ZAB");
    const player = await seedProvisionalPlayer(setup, f.orgId);
    const first = await issue("ZAB", player, "replay-key-1");
    const second = await issue("ZAB", player, "replay-key-1");
    expect(second).toBe(first);
    const count = await oneRow<{ c: number }>(db, "SELECT COUNT(*) AS c FROM canonical_id_issuances WHERE player_id = ?", [player]);
    expect(count?.c).toBe(1);
  });

  it("the same request key for another player is a 409", async () => {
    const p1 = await seedProvisionalPlayer(setup, f.orgId);
    const p2 = await seedProvisionalPlayer(setup, f.orgId);
    await issue("ZAB", p1, "replay-key-2");
    await expectSignal(issue("ZAB", p2, "replay-key-2"), "REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER", 409);
  });

  it("an already-registered player returns its ID (no new issuance)", async () => {
    const player = await seedProvisionalPlayer(setup, f.orgId);
    const first = await issue("ZAB", player);
    const second = await issue("ZAB", player);
    expect(second).toBe(first);
    const count = await oneRow<{ c: number }>(db, "SELECT COUNT(*) AS c FROM canonical_id_issuances WHERE player_id = ?", [player]);
    expect(count?.c).toBe(1);
  });

  it("an unknown or malformed country code is a 409", async () => {
    const player = await seedProvisionalPlayer(setup, f.orgId);
    await expectSignal(issue("QQQ", player), "INVALID_COUNTRY_CODE", 422);
    await expectSignal(issue("nga", player), "INVALID_COUNTRY_CODE", 422);
  });

  it("a registered player returns its ID (never a second one); a merged player cannot be issued one", async () => {
    const player = await seedProvisionalPlayer(setup, f.orgId);
    const first = await issue("ZAB", player);
    expect(await issue("ZAB", player, "fresh-key")).toBe(first);
    // a MERGED player has no canonical ID and is not provisional, so issuance is refused
    const survivor = await seedProvisionalPlayer(setup, f.orgId);
    await issue("ZAB", survivor);
    const duplicate = await seedProvisionalPlayer(setup, f.orgId);
    await mergePlayers(db, { mergeId: uid(), fromPlayerId: duplicate, intoPlayerId: survivor, organizationId: f.orgId, decidedBy: uid(), reason: "duplicate record", evidenceId: null });
    await expectSignal(issue("ZAB", duplicate), "PLAYER_NOT_ELIGIBLE_FOR_ISSUANCE", 409);
  });

  it("the sequence increments per country", async () => {
    const p1 = await seedProvisionalPlayer(setup, f.orgId);
    const p2 = await seedProvisionalPlayer(setup, f.orgId);
    expect(await issue("ZAB", p1)).toMatch(new RegExp(`^OTSI-ZAB-${YEAR}-\\d{6}$`));
    expect(await issue("ZAB", p2)).toMatch(new RegExp(`^OTSI-ZAB-${YEAR}-\\d{6}$`));
    const rows = await allRows<{ canonical_otsi_id: string }>(db, 
      "SELECT canonical_otsi_id FROM players WHERE id IN (?, ?) ORDER BY canonical_otsi_id", [p1, p2]);
    const seqs = rows.map((r) => Number(r.canonical_otsi_id.slice(-6)));
    expect(seqs).toHaveLength(2);
    expect(seqs[1]).toBe(seqs[0]! + 1);
  });

  it("a sequence at 999999 is exhausted (409)", async () => {
    await seedCountry(setup, "ZAC");
    await setup.rows("INSERT INTO canonical_id_sequences (country_code, issue_year, last_sequence) VALUES (?, ?, 999999)", ["ZAC", YEAR]);
    const player = await seedProvisionalPlayer(setup, f.orgId);
    await expectSignal(issue("ZAC", player), "CANONICAL_SEQUENCE_EXHAUSTED", 409);
  });

  it("merge: the duplicate becomes MERGED, the merge row and audit row exist", async () => {
    await seedCountry(setup, "ZAD");
    const survivor = await seedProvisionalPlayer(setup, f.orgId);
    await issue("ZAD", survivor);
    const duplicate = await seedProvisionalPlayer(setup, f.orgId);
    const mergeId = uid();
    await mergePlayers(db, {
      mergeId, fromPlayerId: duplicate, intoPlayerId: survivor,
      organizationId: f.orgId, decidedBy: uid(), reason: "duplicate record", evidenceId: null,
    });
    const from = await oneRow<{ canonical_state: string; merged_into_player_id: string | null }>(db, 
      "SELECT canonical_state, merged_into_player_id FROM players WHERE id = ?", [duplicate]);
    expect(from?.canonical_state).toBe("MERGED");
    expect(from?.merged_into_player_id).toBe(survivor);
    const merge = await oneRow<{ into_player_id: string }>(db, "SELECT into_player_id FROM player_merges WHERE id = ?", [mergeId]);
    expect(merge?.into_player_id).toBe(survivor);
    const audit = await oneRow<{ action: string }>(db, 
      "SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id DESC LIMIT 1", [duplicate]);
    expect(audit?.action).toBe("player.merged");
  });

  it("merge: self-merge, a short reason, and re-merging are all 409s", async () => {
    const survivor = await seedProvisionalPlayer(setup, f.orgId);
    await issue("ZAD", survivor);
    const duplicate = await seedProvisionalPlayer(setup, f.orgId);
    await expectSignal(
      mergePlayers(db, { mergeId: uid(), fromPlayerId: survivor, intoPlayerId: survivor, organizationId: f.orgId, decidedBy: uid(), reason: "duplicate record", evidenceId: null }),
      "CANNOT_MERGE_A_PLAYER_INTO_ITSELF", 422,
    );
    await expectSignal(
      mergePlayers(db, { mergeId: uid(), fromPlayerId: duplicate, intoPlayerId: survivor, organizationId: f.orgId, decidedBy: uid(), reason: "x", evidenceId: null }),
      "MERGE_REASON_REQUIRED", 422,
    );
    await mergePlayers(db, { mergeId: uid(), fromPlayerId: duplicate, intoPlayerId: survivor, organizationId: f.orgId, decidedBy: uid(), reason: "duplicate record", evidenceId: null });
    await expectSignal(
      mergePlayers(db, { mergeId: uid(), fromPlayerId: duplicate, intoPlayerId: survivor, organizationId: f.orgId, decidedBy: uid(), reason: "duplicate record", evidenceId: null }),
      "PLAYER_ALREADY_MERGED", 409,
    );
  });

  it("merge: the survivor must be REGISTERED", async () => {
    const provisional = await seedProvisionalPlayer(setup, f.orgId);
    const duplicate = await seedProvisionalPlayer(setup, f.orgId);
    await expectSignal(
      mergePlayers(db, { mergeId: uid(), fromPlayerId: duplicate, intoPlayerId: provisional, organizationId: f.orgId, decidedBy: uid(), reason: "duplicate record", evidenceId: null }),
      "SURVIVOR_MUST_BE_REGISTERED", 409,
    );
  });
});
