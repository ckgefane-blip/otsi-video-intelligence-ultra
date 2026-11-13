/**
 * The MySQL backend: the pool exactly as `Db` built it before the SQLite conversion (mysql2/promise, least-
 * privilege runtime account, UTC, utf8mb4, `dateStrings: true`). No translation, no value conversion, no
 * error mapping — mysql2 already speaks the shape the rest of the API expects, and this backend must stay
 * byte-for-byte the old behaviour.
 *
 * One exception, for MariaDB only (ADR-146 §6, the central server on the Spaceship host's MariaDB 11.4): MariaDB has no
 * JSON type — a JSON column is LONGTEXT with a `json_valid()` check — so mysql2 hands it back as a string where MySQL
 * hands back the parsed value. Before the first query the backend asks the server what it is; on MariaDB it reads which
 * columns carry `json_valid()` and parses exactly those, so every caller sees the same values as on MySQL. On MySQL the
 * type cast passes every value through untouched.
 */
import mysql, { Pool, PoolConnection } from "mysql2/promise";
import type { DbBackend, DbConnection } from "./backend";

const TEXT_TYPES = new Set(["BLOB", "TINY_BLOB", "MEDIUM_BLOB", "LONG_BLOB", "VAR_STRING", "STRING"]);
type CastField = { type: string; table: string; name: string; string: (encoding?: string) => string | null };

/** The type cast that parses MariaDB's JSON columns (a no-op until `detectMariaJson` finds a MariaDB server). */
export function mariaJsonTypeCast(json: MariaJsonColumns) {
  return (field: CastField, next: () => unknown) => {
    if (!json.active || !TEXT_TYPES.has(field.type) || !json.isJson(field.table, field.name)) return next();
    const v = field.string("utf8");
    return v === null ? null : JSON.parse(v);
  };
}

/** On MariaDB, learn the JSON columns of the current schema; on MySQL, nothing to do. */
export async function detectMariaJson(raw: (sql: string) => Promise<unknown>, json: MariaJsonColumns): Promise<void> {
  const [[v]] = (await raw("SELECT VERSION() AS v")) as [[{ v: string }]];
  if (!/mariadb/i.test(v.v)) return;
  // the runtime account cannot read information_schema.CHECK_CONSTRAINTS, but it can read SHOW CREATE TABLE: a JSON
  // column there is "`name` longtext ... CHECK (json_valid(`name`))"
  const [longCols] = (await raw(
    "SELECT DISTINCT TABLE_NAME AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE = 'longtext'",
  )) as [Array<{ t: string }>];
  const jsonCols: Array<{ t: string; c: string }> = [];
  for (const { t } of longCols) {
    const [[row]] = (await raw(`SHOW CREATE TABLE \`${t.replace(/`/g, "``")}\``)) as [[Record<string, string>]];
    const ddl = row?.["Create Table"] ?? "";
    for (const m of ddl.matchAll(/CHECK \(json_valid\(`([A-Za-z0-9_]+)`\)\)/g)) if (m[1]) jsonCols.push({ t, c: m[1] });
  }
  const [textCols] = (await raw(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND DATA_TYPE IN ('longtext','mediumtext','text','varchar','char','tinytext')",
  )) as [Array<{ t: string; c: string }>];
  json.load(jsonCols, textCols);
}

/** MariaDB's JSON columns: by table and column, plus column names that are JSON in every table that has them. */
export class MariaJsonColumns {
  active = false;
  private byTable = new Set<string>();
  private alwaysJson = new Set<string>();

  load(jsonCols: Array<{ t: string; c: string }>, textCols: Array<{ t: string; c: string }>): void {
    this.active = true;
    for (const { t, c } of jsonCols) this.byTable.add(`${t}.${c}`);
    const names = new Set(jsonCols.map((r) => r.c));
    const mixed = new Set(textCols.filter((r) => names.has(r.c) && !this.byTable.has(`${r.t}.${r.c}`)).map((r) => r.c));
    for (const n of names) if (!mixed.has(n)) this.alwaysJson.add(n);
  }

  /** `table` is the query's alias for the table, so a column name that is JSON everywhere also counts. */
  isJson(table: string, name: string): boolean {
    return this.byTable.has(`${table}.${name}`) || this.alwaysJson.has(name);
  }
}

export class MysqlBackend implements DbBackend {
  readonly kind = "mysql" as const;
  readonly pool: Pool;
  private readonly json = new MariaJsonColumns();
  private readonly ready: Promise<void>;

  constructor(dbDsn: string) {
    const u = new URL(dbDsn);
    const json = this.json;
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
      typeCast: mariaJsonTypeCast(json),
    } as mysql.PoolOptions);
    this.gate();
    this.ready = this.detect();
    this.ready.catch(() => undefined); // a failed detection surfaces on the first query
  }

  private detect(): Promise<void> {
    return detectMariaJson(this.rawQuery!, this.json);
  }

  private rawQuery?: (sql: string) => Promise<unknown>;

  /** Every pool entry point waits for `detect()` first, so no row is read before the JSON columns are known. */
  private gate(): void {
    const pool = this.pool as unknown as { [k: string]: (...a: unknown[]) => Promise<unknown> };
    const q = pool.query!.bind(pool);
    this.rawQuery = (sql: string) => q(sql);
    for (const name of ["query", "execute", "getConnection"]) {
      const orig = pool[name]!.bind(pool);
      pool[name] = async (...a: unknown[]) => { await this.ready; return orig(...a); };
    }
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
