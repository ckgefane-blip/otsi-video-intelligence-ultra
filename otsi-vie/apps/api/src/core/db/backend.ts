/**
 * The internal backend interface behind `Db` (ADR-144 §1.2, distribution plan §1d safeguard 1). One interface,
 * two implementations: `mysql.ts` (the server / central deployment) and `sqlite.ts` (the desktop).
 *
 * `query` answers in mysql2 shape — `[rows, fields]` for reads, `[{ affectedRows, insertId }, fields]` for
 * writes — so every existing call site (`db.rows`, `db.one`, `db.pool.query`, `c.query`, `db.pool.getConnection`)
 * keeps working unchanged on either backend. The SQLite implementation is responsible for translating the SQL
 * (via `dialect.ts`) and for mapping SQLite errors onto the MySQL error numbers the rest of the API already
 * handles (`errno` 1062 duplicate, 1451/1452 foreign key, 3819 check, 1205/1213 transient locks).
 */

export interface DbConnection {
  /** Run one statement, in mysql2 `[rows, fields]` / `[header, fields]` shape. */
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  /** Return the connection to the pool (SQLite: release the writer lock). */
  release(): void;
  /** Abandon the connection without reusing it (SQLite: further queries throw). */
  destroy(): void;
}

export interface DbBackend {
  readonly kind: "mysql" | "sqlite";
  /** Pool-level query (autocommit on MySQL; one serialised statement on SQLite). */
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
  /** A dedicated connection (for `tx()` and for the outbox dispatcher's fenced delivery). */
  getConnection(): Promise<DbConnection>;
  /** Close the pool / database. */
  close(): Promise<void>;
}
