/**
 * MySQL access for the API: one pool (the least-privilege runtime account), parameterised queries only, explicit transactions,
 * and a bounded retry for the transient lock errors MySQL documents as "restart the transaction" (1213 deadlock, 1205 lock wait).
 */
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import mysql, { Pool, PoolConnection, RowDataPacket } from "mysql2/promise";
import { CONFIG, Config } from "./config";

export type Executor = Pick<PoolConnection, "query">;
const TRANSIENT = new Set([1213, 1205]);

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(CONFIG) cfg: Pick<Config, "dbDsn">) {
    const u = new URL(cfg.dbDsn);
    this.pool = mysql.createPool({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.replace(/^\//, ""),
      charset: "utf8mb4",
      timezone: "Z",
      dateStrings: true,
      connectionLimit: 10,
      multipleStatements: false,
    });
  }

  async rows<T extends RowDataPacket>(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<T[]> {
    const [r] = await ex.query<T[]>(sql, params);
    return r;
  }

  async one<T extends RowDataPacket>(sql: string, params: unknown[] = [], ex: Executor = this.pool): Promise<T | undefined> {
    return (await this.rows<T>(sql, params, ex))[0];
  }

  /** Run `fn` in one transaction: committed if it returns, rolled back if it throws. */
  async tx<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    const c = await this.pool.getConnection();
    try {
      await c.beginTransaction();
      const out = await fn(c);
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

  /** Repeat an idempotent operation when MySQL reports a transient lock conflict (at most `attempts` times). */
  async retryTransient<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (e) {
        const errno = (e as { errno?: number }).errno;
        if (!errno || !TRANSIENT.has(errno)) throw e;
        this.transient.retried.set(errno, (this.transient.retried.get(errno) ?? 0) + 1);
        this.transient.maxAttemptUsed = Math.max(this.transient.maxAttemptUsed, i + 1);
        if (i >= attempts) { this.transient.exhausted++; throw e; }
        await new Promise((r) => setTimeout(r, Math.min(400, 10 * 2 ** i) + Math.floor(Math.random() * 25)));   // exponential, jittered
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
