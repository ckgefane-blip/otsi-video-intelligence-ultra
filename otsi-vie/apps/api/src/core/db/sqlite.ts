/**
 * The SQLite backend: one `node:sqlite` database for the desktop (ADR-144 §1.2).
 *
 * Node version: `node:sqlite` shipped in Node 22.5.0 behind `--experimental-sqlite` and was UNFLAGGED in
 * 22.13.0 / 23.4.0 (still experimental, prints an `ExperimentalWarning` on 22.x). The repo pins
 * `>=22.11 <23`, so:
 *  - Node 22.13 and later (including the owner's 22.23.2): no flag needed.
 *  - Node 22.11–22.12: the API process must be started with `--experimental-sqlite` as the FIRST argument to
 *    `node`, i.e. in `apps/desktop/backend.js` `spawnChild('api', node.cmd, ['--experimental-sqlite',
 *    <main.js>])` and the same for `spawnChild('outbox', ...)` (and any direct `node dist/...` invocation).
 *    The flag cannot be set through NODE_OPTIONS (Node rejects experimental flags there).
 *  - If the coordinator would rather not carry the flag, raise the engines floor to `>=22.13.0` instead.
 *  `node:sqlite` is loaded with a bare `require("node:sqlite")` (see below), so on 22.11–22.12 without the
 *  flag the process still fails at LOAD time with `ERR_UNKNOWN_BUILTIN_MODULE` — loudly, at start-up, never
 *  mid-request. `node:sqlite` is never loaded in MySQL mode (see `db.ts`: the SQLite backend is constructed
 *  only when the backend is sqlite), but the module must resolve on every start; that is the documented
 *  trade-off (the alternative, a lazy loader, would make every synchronous `db.pool` access async).
 *
 * Concurrency (plan §1d.4, partial — the three-workers-on-a-real-match test is agent C's job): SQLite has ONE
 * writer. This backend holds ONE connection and serialises every statement through a promise-chain mutex, so
 * two API callers can never interleave statements on the connection. A transaction (`tx()`) holds the lock
 * for its whole duration and runs `BEGIN IMMEDIATE` (a deferred transaction would let a concurrent writer in
 * and produce SQLITE_BUSY on commit — the classic SQLite mistake). `busy_timeout = 5000` is the backstop for
 * writers OUTSIDE this process (a second copy of the app, the worker). WAL mode lets readers proceed while
 * one writer holds the database.
 *
 * Errors are mapped onto the MySQL numbers the rest of the API already handles (see `dialect.ts` header):
 * UNIQUE -> 1062 (with the unique index's name appended to sqlMessage, so `publish.ts`'s
 * `/uq_outbox_dedupe/` test keeps working — agent B's DDL must keep the MySQL index names), FOREIGN KEY ->
 * 1451 on DELETE / 1452 otherwise, CHECK -> 3819, NOT NULL -> 1048, STRICT datatype mismatch -> 1366
 * (plain "datatype mismatch", errcode 20, and the STRICT refusal "cannot store ...", errcode 3091),
 * no such table -> 1146, SQLITE_BUSY -> 1205, SQLITE_LOCKED -> 1213 (both transient, retried by
 * `retryTransient` exactly like MySQL 1205/1213), SQLITE_CONSTRAINT -> never retried.
 *
 * Rows come back from `node:sqlite` as null-prototype objects; they are normalised to plain objects here, so
 * no call site can tell which backend served it.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType, SupportedValueType } from "node:sqlite";
import type { DbBackend, DbConnection } from "./backend";
import { toSqliteValue, translateForSqlite } from "./dialect";

// `node:sqlite` is loaded with a bare `require`, NOT a static `import`: vite-node 2.1.8 (the Vitest 2.1.8
// test runner) does not know `node:sqlite` as a builtin — its prefixed-builtins list is only `node:test` —
// so it strips the `node:` prefix, decides bare `sqlite` is not a builtin either (it is not in
// `module.builtinModules`), and tries to load a FILE named `sqlite` ("Failed to load url sqlite"). A bare
// `require` is never seen by Vite's import analysis, so Node's own loader resolves it — in the tests (the
// runner provides `require`) and in the compiled CommonJS build alike. The proper fix is to upgrade
// vite-node/Vitest past the version that knows `node:sqlite`; until then this require stays. The
// `import type` above is erased at compile time and never reaches the loader.
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

type MysqlShapedError = Error & { errno?: number; code?: string; sqlMessage?: string; sqliteCode?: string };

const READ_KINDS = new Set(["SELECT", "WITH", "PRAGMA", "EXPLAIN", "VALUES"]);

function firstWord(sql: string): string {
  const m = /^\s*([A-Za-z]+)/.exec(sql);
  return m ? m[1]!.toUpperCase() : "";
}

export class SqliteBackend implements DbBackend {
  readonly kind = "sqlite" as const;
  private readonly db: DatabaseSyncType;
  /** Serialises every statement on the single connection (see the header). */
  private mutex: Promise<void> = Promise.resolve();
  /** True while a `BEGIN IMMEDIATE` transaction is open: a nested tx / pooled connection then fails fast. */
  private txActive = false;
  /** table -> "col,col" -> unique index name (or null when the columns match no named index). */
  private uniqueIndexCache = new Map<string, Map<string, string | null>>();

  /** The pool-shaped object `Db` exposes as `db.pool` (query / getConnection / end). */
  readonly pool: { query: (sql: string, params?: unknown[]) => Promise<[unknown, unknown]>; getConnection: () => Promise<DbConnection>; end: () => Promise<void> };

  constructor(readonly path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    // Foreign keys on for EVERY connection (there is one): without this, a child row pointing at a
    // deleted parent would insert silently. WAL + a busy timeout + NORMAL synchronous (safe under WAL).
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA busy_timeout = 5000");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.pool = {
      query: (sql, params) => this.query(sql, params),
      getConnection: () => this.getConnection(),
      end: () => this.close(),
    };
  }

  /** Pool-level query: one statement, serialised, translated, with SQLite values converted. */
  async query(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    const release = await this.acquire();
    try {
      return this.runDirect(sql, params);
    } finally {
      release();
    }
  }

  async getConnection(): Promise<DbConnection> {
    if (this.txActive) throw new Error("nested transactions are not supported on SQLite (and implicitly commit on MySQL): restructure the caller to use one tx()");
    const release = await this.acquire();
    let destroyed = false;
    let inTx = false;
    const backend = this;
    const guard = () => {
      if (destroyed) throw new Error("database connection destroyed (a timed-out handler kept using it)");
    };
    return {
      async query(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
        guard();
        return backend.runDirect(sql, params);
      },
      async beginTransaction(): Promise<void> {
        guard();
        if (inTx) throw new Error("nested transactions are not supported on SQLite (and implicitly commit on MySQL): restructure the caller to use one tx()");
        backend.execDirect("BEGIN IMMEDIATE");
        inTx = true;
        backend.txActive = true;
      },
      async commit(): Promise<void> {
        guard();
        if (!inTx) throw new Error("commit without a transaction");
        backend.execDirect("COMMIT");
        inTx = false;
        backend.txActive = false;
      },
      async rollback(): Promise<void> {
        // a rollback after a failed statement is the normal path; "no transaction is active" (already
        // rolled back / committed) is not an error here — Db.tx() calls rollback() defensively.
        try {
          backend.execDirect("ROLLBACK");
        } catch (e) {
          if (!/no transaction is active/.test((e as Error).message ?? "")) throw e;
        }
        inTx = false;
        backend.txActive = false;
      },
      release(): void {
        if (destroyed) return;
        destroyed = true; // a released connection must not be used again (matches mysql2 pool semantics)
        if (inTx) {
          try { backend.execDirect("ROLLBACK"); } catch { /* already gone */ }
          inTx = false;
          backend.txActive = false;
        }
        release();
      },
      destroy(): void {
        if (destroyed) return;
        destroyed = true;
        if (inTx) {
          try { backend.execDirect("ROLLBACK"); } catch { /* already gone */ }
          inTx = false;
          backend.txActive = false;
        }
        release();
      },
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }

  /** Run one statement on the connection. Caller must hold the mutex (pool query / tx connection). */
  private runDirect(sql: string, params: unknown[]): [unknown, unknown] {
    const { sql: translated, params: translatedParams } = translateForSqlite(sql, params);
    const bound: SupportedValueType[] = translatedParams.map(toSqliteValue) as SupportedValueType[];
    const kind = firstWord(translated);
    try {
      if (READ_KINDS.has(kind)) {
        const rows = this.db.prepare(translated).all(...bound) as Record<string, unknown>[];
        return [rows.map((r) => ({ ...r })), undefined];
      }
      const res = this.db.prepare(translated).run(...bound);
      return [{ affectedRows: res.changes, insertId: Number(res.lastInsertRowid) }, undefined];
    } catch (e) {
      throw this.mapError(e, kind);
    }
  }

  /** Run an internal statement (BEGIN IMMEDIATE / COMMIT / ROLLBACK / PRAGMA): no translation, no mapping. */
  private execDirect(sql: string): void {
    this.db.exec(sql);
  }

  private async acquire(): Promise<() => void> {
    let release!: () => void;
    const willLock = this.mutex;
    this.mutex = new Promise<void>((r) => {
      release = r;
    });
    await willLock;
    return release;
  }

  /** Map a node:sqlite error onto the MySQL-shaped error the API handles (see the header). */
  private mapError(e: unknown, kind: string): MysqlShapedError {
    const raw = e as { code?: string; errcode?: number; message?: string };
    const message = raw.message ?? String(e);
    const out = new Error(message) as MysqlShapedError;
    out.code = raw.code ?? "ERR_SQLITE_ERROR";
    out.sqlMessage = message;
    const errcode = raw.errcode;
    if (message.startsWith("UNIQUE constraint failed:")) {
      out.errno = 1062;
      out.code = "ER_DUP_ENTRY";
      const index = this.uniqueIndexFor(message);
      if (index) out.sqlMessage = `${message} (${index})`;
    } else if (message.startsWith("FOREIGN KEY constraint failed")) {
      out.errno = kind === "DELETE" ? 1451 : 1452;
      out.code = out.errno === 1451 ? "ER_ROW_IS_REFERENCED_2" : "ER_NO_REFERENCED_ROW_2";
    } else if (message.startsWith("CHECK constraint failed")) {
      out.errno = 3819;
      out.code = "ER_CHECK_CONSTRAINT_VIOLATED";
    } else if (message.startsWith("NOT NULL constraint failed")) {
      out.errno = 1048;
      out.code = "ER_BAD_NULL_ERROR";
    } else if (message === "datatype mismatch" || errcode === 3091 || message.startsWith("cannot store ")) {
      out.errno = 1366; // STRICT table: a value of the wrong type — plain "datatype mismatch" (errcode 20),
      // or the STRICT refusal "cannot store TEXT value in INTEGER column ..." (errcode 3091,
      // SQLITE_CONSTRAINT_DATATYPE). Both are the SQLite half of safeguard 3.
      out.code = "ER_TRUNCATED_WRONG_VALUE";
    } else if (errcode === 5 || /database is locked/.test(message)) {
      out.errno = 1205; // transient: retried by retryTransient, exactly like MySQL 1205
      out.code = "ER_LOCK_WAIT_TIMEOUT";
      out.sqliteCode = "SQLITE_BUSY";
    } else if (errcode === 6 || /database table is locked/.test(message)) {
      out.errno = 1213; // transient: retried by retryTransient, exactly like MySQL 1213
      out.code = "ER_LOCK_DEADLOCK";
      out.sqliteCode = "SQLITE_LOCKED";
    } else if (message.startsWith("no such table:")) {
      out.errno = 1146;
      out.code = "ER_NO_SUCH_TABLE";
    }
    // SQLITE_CONSTRAINT (and anything unrecognised) keeps no errno: it is fatal, never retried, and
    // problem.ts reports it as a 500 — the same as an unmapped MySQL error.
    return out;
  }

  /**
   * The unique index behind a "UNIQUE constraint failed: table.col, ..." message, by matching the failed
   * columns against the table's unique indexes (PRAGMA index_list / index_info). Its name goes into
   * sqlMessage so callers that match on an index name (publish.ts: /uq_outbox_dedupe/) keep working.
   * Returns null when the columns match no named index (e.g. the PRIMARY KEY autoindex).
   */
  private uniqueIndexFor(message: string): string | null {
    const m = /^UNIQUE constraint failed: (.+)$/.exec(message);
    if (!m) return null;
    const cols = m[1]!.split(", ").map((c) => c.slice(c.indexOf(".") + 1));
    const table = m[1]!.split(", ")[0]!.slice(0, m[1]!.split(", ")[0]!.indexOf("."));
    const key = cols.join(",");
    let byTable = this.uniqueIndexCache.get(table);
    if (!byTable) {
      byTable = new Map();
      this.uniqueIndexCache.set(table, byTable);
    }
    if (byTable.has(key)) return byTable.get(key)!;
    let found: string | null = null;
    try {
      const indexes = this.db.prepare(`PRAGMA index_list("${table.replace(/"/g, '""')}")`).all() as { name: string; unique: number }[];
      for (const idx of indexes) {
        if (!idx.unique) continue;
        const info = this.db.prepare(`PRAGMA index_info("${idx.name.replace(/"/g, '""')}")`).all() as { name: string }[];
        if (info.map((c) => c.name).join(",") === key) { found = idx.name; break; }
      }
    } catch {
      found = null; // the lookup is best-effort: the raw message is still a 1062 either way
    }
    byTable.set(key, found);
    return found;
  }
}
