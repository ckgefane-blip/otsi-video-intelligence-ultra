/**
 * The MySQL backend: the pool exactly as `Db` built it before the SQLite conversion (mysql2/promise, least-
 * privilege runtime account, UTC, utf8mb4, `dateStrings: true`). No translation, no value conversion, no
 * error mapping — mysql2 already speaks the shape the rest of the API expects, and this backend must stay
 * byte-for-byte the old behaviour.
 */
import mysql, { Pool, PoolConnection } from "mysql2/promise";
import type { DbBackend, DbConnection } from "./backend";

export class MysqlBackend implements DbBackend {
  readonly kind = "mysql" as const;
  readonly pool: Pool;

  constructor(dbDsn: string) {
    const u = new URL(dbDsn);
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

  async query(sql: string, params: unknown[] = []): Promise<[unknown, unknown]> {
    const [rows, fields] = await this.pool.query(sql, params);
    return [rows, fields];
  }

  async getConnection(): Promise<DbConnection> {
    const c: PoolConnection = await this.pool.getConnection();
    return {
      query: (sql: string, params: unknown[] = []) => c.query(sql, params) as Promise<[unknown, unknown]>,
      beginTransaction: () => c.beginTransaction(),
      commit: () => c.commit(),
      rollback: () => c.rollback(),
      release: () => c.release(),
      destroy: () => c.destroy(),
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
