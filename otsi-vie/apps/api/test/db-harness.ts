/**
 * Dual-database test harness (distribution plan §1d safeguard 2): the same tests run twice — once against
 * MySQL, once against SQLite — selected by `OTSI_VIE_TEST_DB_BACKEND` (default `mysql`, the existing suite's
 * behaviour). The SQLite run needs no server and runs HERE; the MySQL run needs the owner's host MySQL 3507
 * and the usual global setup (scratch database + migrations).
 *
 * The dialect tests create their own schema, because the full SQLite migrations are agent B's job and do not
 * exist yet: `dbt_*` tables (never colliding with the migrated schema) plus MINIMAL versions of the tables the
 * canonical allocator and the outbox publisher touch (`players`, `countries`, `canonical_id_sequences`,
 * `canonical_id_issuances`, `audit_events`, `player_merges`, `outbox_events`, `organizations`). On MySQL those
 * tables already exist from the real migrations, so `CREATE TABLE IF NOT EXISTS` is a no-op there and the
 * tests exercise the real tables; on SQLite the minimal DDL creates them (STRICT, with the same CHECKs and
 * the same unique-index names the production code matches on, notably `uq_outbox_dedupe`).
 *
 * Privileges: the runtime account (`otsi_app`) never does DDL, so on MySQL the `dbt_*` tables are created by
 * the ROOT account and granted to the app user here. The allocator tables keep their real grants — which is
 * why the allocator tests on MySQL need agent B's roles migration (INSERT on the allocator tables +
 * UPDATE of the canonical columns of `players` for `otsi_app`): until it lands they fail with 1142, and that
 * failure is the honest signal, not a test bug. See `canonical-allocator.ts`.
 */
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import mysql from "mysql2/promise";
import { inject } from "vitest";
import { v7 as uuidv7 } from "uuid";
import { Db } from "../src/core/db";

export type TestDbBackend = "mysql" | "sqlite";

/** Which backend this run tests. Default `mysql`: the existing suite never changes behaviour by accident. */
export function testDbBackend(): TestDbBackend {
  const raw = (process.env.OTSI_VIE_TEST_DB_BACKEND ?? "mysql").trim().toLowerCase();
  // "mariadb" (ADR-146 §6, the central server's host) speaks the MySQL protocol: the same mysql backend, on 127.0.0.1:3511
  if (raw === "mariadb") return "mysql";
  if (raw !== "mysql" && raw !== "sqlite") throw new Error(`OTSI_VIE_TEST_DB_BACKEND must be "mysql", "mariadb" or "sqlite", got "${process.env.OTSI_VIE_TEST_DB_BACKEND}"`);
  return raw;
}

export interface DialectDb {
  db: Db;
  /** Fixture writes (seed rows, sequence rows): the ROOT account on MySQL (the runtime account never
   *  writes to `players`/`countries`/sequences — on SQLite it is the same connection as `db`). */
  setup: Db;
  backend: TestDbBackend;
  /** The seeded organization id (exists in `organizations` on both backends, for FKs). */
  orgId: string;
  cleanup: () => Promise<void>;
}

/** MySQL DDL for the `dbt_*` tables (DATETIME(6) for instants, as in production). Runs as ROOT. */
const MYSQL_DDL = [
  `CREATE TABLE IF NOT EXISTS dbt_upserts (
     id CHAR(36) PRIMARY KEY, org CHAR(36) NOT NULL, v INT, note VARCHAR(255), flag TINYINT,
     created_at DATETIME(6), updated_at DATETIME(6), expires_at DATETIME(6),
     UNIQUE KEY uq_dbt_upserts_org_note (org, note))`,
  `CREATE TABLE IF NOT EXISTS dbt_events (
     id BIGINT AUTO_INCREMENT PRIMARY KEY, org CHAR(36) NOT NULL, kind VARCHAR(64), payload JSON,
     dedupe_key VARCHAR(191), created_at DATETIME(6), available_at DATETIME(6))`,
  "CREATE UNIQUE INDEX uq_dbt_dedupe ON dbt_events (dedupe_key)",
  `CREATE TABLE IF NOT EXISTS dbt_times (
     id CHAR(36) PRIMARY KEY, created_at DATETIME(6), expires_at DATETIME(6),
     valid_from DATE, valid_to DATE, n INT)`,
  `CREATE TABLE IF NOT EXISTS dbt_json (
     id CHAR(36) PRIMARY KEY, doc JSON, tags JSON)`,
  `CREATE TABLE IF NOT EXISTS dbt_parent (id CHAR(36) PRIMARY KEY, name VARCHAR(255))`,
  `CREATE TABLE IF NOT EXISTS dbt_child (
     id CHAR(36) PRIMARY KEY, parent_id CHAR(36), code VARCHAR(64), n INT,
     CONSTRAINT fk_dbt_child_parent FOREIGN KEY (parent_id) REFERENCES dbt_parent (id),
     CONSTRAINT ck_dbt_child_n CHECK (n <= 999999))`,
  "CREATE UNIQUE INDEX uq_dbt_child_code ON dbt_child (code)",
  `CREATE TABLE IF NOT EXISTS dbt_reports (id CHAR(36) PRIMARY KEY, config JSON, project_id CHAR(36))`,
  `CREATE TABLE IF NOT EXISTS dbt_videos (id CHAR(36) PRIMARY KEY, project_id CHAR(36))`,
  `CREATE TABLE IF NOT EXISTS dbt_archives (id CHAR(36) PRIMARY KEY, project_id CHAR(36), video_ids JSON)`,
];

/** SQLite DDL: the same tables, STRICT, with INTEGER ms for instants and TEXT ISO for DATE columns. */
const SQLITE_DDL = [
  `CREATE TABLE IF NOT EXISTS dbt_upserts (
     id TEXT PRIMARY KEY, org TEXT NOT NULL, v INTEGER, note TEXT, flag INTEGER,
     created_at INTEGER, updated_at INTEGER, expires_at INTEGER,
     UNIQUE(org, note)) STRICT`,
  `CREATE TABLE IF NOT EXISTS dbt_events (
     id INTEGER PRIMARY KEY, org TEXT NOT NULL, kind TEXT, payload TEXT, dedupe_key TEXT,
     created_at INTEGER, available_at INTEGER) STRICT`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_dbt_dedupe ON dbt_events (dedupe_key)",
  `CREATE TABLE IF NOT EXISTS dbt_times (
     id TEXT PRIMARY KEY, created_at INTEGER, expires_at INTEGER,
     valid_from TEXT, valid_to TEXT, n INTEGER) STRICT`,
  `CREATE TABLE IF NOT EXISTS dbt_json (id TEXT PRIMARY KEY, doc TEXT, tags TEXT) STRICT`,
  `CREATE TABLE IF NOT EXISTS dbt_parent (id TEXT PRIMARY KEY, name TEXT) STRICT`,
  `CREATE TABLE IF NOT EXISTS dbt_child (
     id TEXT PRIMARY KEY, parent_id TEXT REFERENCES dbt_parent(id), code TEXT,
     n INTEGER CHECK (n <= 999999)) STRICT`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_dbt_child_code ON dbt_child (code)",
  `CREATE TABLE IF NOT EXISTS dbt_reports (id TEXT PRIMARY KEY, config TEXT, project_id TEXT) STRICT`,
  `CREATE TABLE IF NOT EXISTS dbt_videos (id TEXT PRIMARY KEY, project_id TEXT) STRICT`,
  `CREATE TABLE IF NOT EXISTS dbt_archives (id TEXT PRIMARY KEY, project_id TEXT, video_ids TEXT) STRICT`,
  // minimal allocator / outbox tables (only created on SQLite; on MySQL the migrated ones are used)
  `CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT, slug TEXT) STRICT`,
  `CREATE TABLE IF NOT EXISTS players (
     id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
     canonical_state TEXT NOT NULL DEFAULT 'PROVISIONAL'
       CHECK (canonical_state IN ('PROVISIONAL', 'REGISTERED', 'RETIRED', 'MERGED')),
     canonical_otsi_id TEXT UNIQUE, created_by_organization_id TEXT, merged_into_player_id TEXT,
     birth_date TEXT, preferred_foot TEXT, primary_position TEXT, role_confirmed_by TEXT,
     role_confirmed_at INTEGER, role_confirmation_state TEXT, external_ids TEXT,
     CHECK ((canonical_state = 'PROVISIONAL' AND canonical_otsi_id IS NULL)
         OR (canonical_state IN ('REGISTERED', 'RETIRED') AND canonical_otsi_id IS NOT NULL)
         OR (canonical_state = 'MERGED')),
     CHECK ((canonical_state = 'MERGED') = (merged_into_player_id IS NOT NULL))) STRICT`,
  `CREATE TABLE IF NOT EXISTS countries (
     code TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1) STRICT`,
  `CREATE TABLE IF NOT EXISTS canonical_id_sequences (
     country_code TEXT REFERENCES countries(code), issue_year INTEGER,
     last_sequence INTEGER CHECK (last_sequence <= 999999),
     PRIMARY KEY (country_code, issue_year)) STRICT`,
  `CREATE TABLE IF NOT EXISTS canonical_id_issuances (
     canonical_otsi_id TEXT PRIMARY KEY, player_id TEXT NOT NULL UNIQUE, country_code TEXT,
     issue_year INTEGER, sequence_number INTEGER, issuing_organization_id TEXT, issued_by TEXT,
     request_key TEXT UNIQUE, issued_at INTEGER) STRICT`,
  `CREATE TABLE IF NOT EXISTS audit_events (
     id INTEGER PRIMARY KEY, organization_id TEXT, actor_id TEXT, actor_kind TEXT, actor_service TEXT,
     action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT, request_id TEXT,
     before_state TEXT, after_state TEXT, occurred_at INTEGER) STRICT`,
  `CREATE TABLE IF NOT EXISTS player_merges (
     id TEXT PRIMARY KEY, from_player_id TEXT REFERENCES players(id),
     into_player_id TEXT REFERENCES players(id), organization_id TEXT REFERENCES organizations(id),
     decided_by TEXT, reason TEXT NOT NULL, evidence_id TEXT, decided_at INTEGER,
     UNIQUE (from_player_id)) STRICT`,
  `CREATE TABLE IF NOT EXISTS outbox_events (
     id INTEGER PRIMARY KEY, organization_id TEXT REFERENCES organizations(id),
     aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL,
     event_payload TEXT NOT NULL, dedupe_key TEXT, available_at INTEGER NOT NULL,
     created_at INTEGER, claimed_at INTEGER, delivered_at INTEGER, dead_lettered_at INTEGER,
     claim_token TEXT, lease_expires_at INTEGER, attempt_count INTEGER NOT NULL DEFAULT 0,
     last_error TEXT) STRICT`,
  "CREATE UNIQUE INDEX IF NOT EXISTS uq_outbox_dedupe ON outbox_events (dedupe_key)",
];

/** A `Db` on the selected backend with the dialect schema in place, plus a seeded organization. */
export async function makeDialectDb(): Promise<DialectDb> {
  const backend = testDbBackend();
  const orgId = uuidv7();
  if (backend === "sqlite") {
    const file = join(tmpdir(), `otsi-dialect-${randomBytes(6).toString("hex")}.db`);
    const db = new Db({ dbBackend: "sqlite", dbPath: file });
    for (const ddl of SQLITE_DDL) await db.rows(ddl);
    await db.rows("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [orgId, "Dialect Org", `dialect-${orgId.slice(0, 8)}`]);
    return {
      db, setup: db, backend, orgId,
      cleanup: async () => {
        await db.onModuleDestroy();
        for (const suffix of ["", "-wal", "-shm"]) { try { unlinkSync(file + suffix); } catch { /* already gone */ } }
      },
    };
  }
  // MySQL: DDL as ROOT (the runtime account never does DDL), then grant the app user on the new tables.
  const rootDsn = inject("rootDsn");
  const appDsn = inject("appDsn");
  const root = new URL(rootDsn);
  const app = new URL(appDsn);
  const admin = await mysql.createConnection({
    host: root.hostname, port: Number(root.port), user: "root",
    password: decodeURIComponent(root.password), database: root.pathname.slice(1), multipleStatements: true,
  });
  try {
    for (const ddl of MYSQL_DDL) await admin.query(ddl);
    const dbName = root.pathname.slice(1);
    const appUser = app.username;
    for (const t of ["dbt_upserts", "dbt_events", "dbt_times", "dbt_json", "dbt_parent", "dbt_child", "dbt_reports", "dbt_videos", "dbt_archives"]) {
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${dbName}\`.\`${t}\` TO '${appUser}'@'%'`);
    }
    await admin.query("INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)", [orgId, "Dialect Org", `dialect-${orgId.slice(0, 8)}`]);
  } finally {
    await admin.end();
  }
  const db = new Db({ dbDsn: appDsn });
  const setup = new Db({ dbDsn: rootDsn });
  return { db, setup, backend, orgId, cleanup: async () => { await db.onModuleDestroy(); await setup.onModuleDestroy(); } };
}

/** A fresh country code with no sequence row yet (deterministic allocator assertions). */
export async function seedCountry(db: Db, code: string): Promise<void> {
  await db.rows("INSERT INTO countries (code, name, kind, active) VALUES (?, ?, 'ISO3166_1', 1) ON DUPLICATE KEY UPDATE code = code", [code, `Test ${code}`]);
}

/** A provisional player owned by `orgId`. */
export async function seedProvisionalPlayer(db: Db, orgId: string): Promise<string> {
  const id = uuidv7();
  await db.rows("INSERT INTO players (id, display_name, canonical_state, created_by_organization_id) VALUES (?, ?, 'PROVISIONAL', ?)",
    [id, `Dialect Player ${id.slice(0, 8)}`, orgId]);
  return id;
}
