/**
 * Database access for the API: ONE layer, TWO backends (ADR-144 §1.2, distribution plan §1d safeguard 1).
 *
 * The public surface is unchanged from the MySQL-only version — `rows<T>(sql, params, ex)`, `one<T>(...)`,
 * `tx<T>(fn)`, `retryTransient<T>(fn, attempts)` — so every existing call site keeps working unchanged on
 * either backend. Which backend runs is chosen by the config (`OTSI_VIE_DB_BACKEND=mysql|sqlite`,
 * `OTSI_VIE_DB_PATH` for SQLite); the default is MySQL, exactly as before.
 *
 *  - MySQL (`db/mysql.ts`): the mysql2/promise pool exactly as it was — no translation, no conversion.
 *  - SQLite (`db/sqlite.ts`): one `node:sqlite` database, every statement translated by `db/dialect.ts`
 *    (MySQL-flavoured SQL in, SQLite SQL out) and every error mapped onto the MySQL numbers the API
 *    already handles. `tx()` runs `BEGIN IMMEDIATE` there, and all statements are serialised through one
 *    connection, so concurrent writers queue instead of colliding.
 *
 * `pool` is the backend's pool-shaped object: the real mysql2 pool on MySQL, a translating shim on SQLite
 * (same `query` / `getConnection` / `end` shape). `retryTransient` retries MySQL 1213/1205 and the SQLite
 * equivalents (SQLITE_BUSY / SQLITE_LOCKED, mapped to the same numbers) with the same diagnostics counters;
 * SQLITE_CONSTRAINT is fatal and is never retried.
 */
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { CONFIG, Config } from "./config";
import type { DbBackend } from "./db/backend";
import { MysqlBackend } from "./db/mysql";
import { SqliteBackend } from "./db/sqlite";

export type Executor = Pick<PoolConnection, "query">;
const TRANSIENT = new Set([1213, 1205]);
const TRANSIENT_SQLITE = new Set(["SQLITE_BUSY", "SQLITE_LOCKED"]);

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;
  /** Which backend this instance runs (for diagnostics and for tests that branch on it). */
  readonly backendKind: "mysql" | "sqlite";
  private readonly backend: DbBackend;

  constructor(@Inject(CONFIG) cfg: Pick<Config, "dbDsn" | "dbBackend" | "dbPath">) {
    this.backendKind = cfg.dbBackend ?? "mysql";
    if (this.backendKind === "sqlite") {
      // node:sqlite is loaded here and only here: a MySQL process never touches it (see sqlite.ts for
      // the Node 22.11-22.12 --experimental-sqlite note).
      if (!cfg.dbPath) throw new Error("OTSI_VIE_DB_PATH is required when OTSI_VIE_DB_BACKEND=sqlite");
      const sqlite = new SqliteBackend(cfg.dbPath);
      this.backend = sqlite;
      this.pool = sqlite.pool as unknown as Pool;
    } else {
      if (!cfg.dbDsn) throw new Error("OTSI_VIE_DB_DSN is required when OTSI_VIE_DB_BACKEND=mysql");
      const mysqlBackend = new MysqlBackend(cfg.dbDsn);
      this.backend = mysqlBackend;
      this.pool = mysqlBackend.pool;
    }
  }

  async rows<T extends RowDataPacket>(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<T[]> {
    const [r] = await ex.query<T[]>(sql, params);
    return r;
  }

  async one<T extends RowDataPacket>(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<T | undefined> {
    return (await this.rows<T>(sql, params, ex))[0];
  }

  /** Run `fn` in one transaction: committed if it returns, rolled back if it throws. On SQLite the
   *  transaction is `BEGIN IMMEDIATE` (see sqlite.ts); nested transactions throw instead of deadlocking. */
  async tx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    const c = await this.backend.getConnection();
    try {
      await c.beginTransaction();
      const out = await fn(c as unknown as PoolConnection);
      await c.commit();
      return out;
    } catch (e) {
      await c.rollback().catch(() => undefined);
      throw e;
    } finally {
      c.release();
    }
  }

  /** Transient lock conflicts seen and retried, by MySQL error number (diagnostics; read by the load tests and health checks). */
  readonly transient = { retried: new Map<number, number>(), exhausted: 0, maxAttemptUsed: 0 };

  /** Repeat an idempotent operation when the database reports a transient lock conflict (at most `attempts` times).
   *  MySQL 1213/1205 and SQLite SQLITE_BUSY/SQLITE_LOCKED (mapped to the same numbers) are transient;
   *  SQLITE_CONSTRAINT and every other error are fatal and are never retried. */
  async retryTransient<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const err = e as { errno?: number; sqliteCode?: string };
        const isTransient = (err.errno !== undefined && TRANSIENT.has(err.errno))
          || (err.sqliteCode !== undefined && TRANSIENT_SQLITE.has(err.sqliteCode));
        if (!isTransient) throw e;
        const key = err.errno ?? (err.sqliteCode === "SQLITE_BUSY" ? 1205 : 1213);
        this.transient.retried.set(key, (this.transient.retried.get(key) ?? 0) + 1);
        this.transient.maxAttemptUsed = Math.max(this.transient.maxAttemptUsed, i + 1);
        if (i >= attempts) { this.transient.exhausted++; throw e; }
        await new Promise((r) => setTimeout(r, Math.min(400, 10 * 2 ** i) + Math.floor(Math.random() * 25)));   // exponential, jittered
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.backend.close();
  }
}
