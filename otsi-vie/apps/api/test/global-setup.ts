/**
 * Once per test run: a BRAND-NEW scratch database on the isolated MySQL 8.4 server (127.0.0.1:3507), migrated with the real migrator,
 * roles provisioned, and a least-privilege runtime account (role otsi_app) for the API under test. A throwaway RSA key pair stands in
 * for the OIDC issuer (the API verifies issuer, audience and signature exactly as in production). Everything is dropped afterwards.
 * Never touches port 3306 or any existing database.
 *
 * SQLite mode (`OTSI_VIE_TEST_DB_BACKEND=sqlite`): no server, no migrations — the scratch database is a temp file and `appDsn`
 * is its path. Only the dialect tests (`test/db.dialect.test.ts`) pass on SQLite today: they create their own schema. The full
 * API suite on SQLite needs agent B's SQLite migrations and fails on missing tables until they land.
 *
 * MariaDB mode (`OTSI_VIE_TEST_DB_BACKEND=mariadb`, ADR-146 §6): the same, on the disposable MariaDB 11.4 server that stands in
 * for the central server's host (container otsi-vie-central-mariadb, 127.0.0.1:3511; root password in
 * .local/mariadb-central-test.env). The migrator applies its MariaDB rewrite (tools/db/mariadb_compat.py) on its own.
 * The MariaDB server MUST run with --default-time-zone=+00:00 (UTC): the API stores expiry/validity times with the
 * DB's CURRENT_TIMESTAMP and compares them against Node's UTC clock, so a server in any other timezone makes
 * time checks misbehave (wallet tests fail with 409 RIGHTS_NOT_VALID_NOW; webauthn challenge expiry checks break).
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { exportJWK, exportSPKI, generateKeyPair } from "jose";
import mysql from "mysql2/promise";
type GlobalSetupContext = { provide: (key: "rootDsn" | "appDsn" | "publicKeyPem" | "privateJwk", value: string) => void };

const ROOT = path.resolve(process.cwd(), "../../..");            // D:\OTSI-Workspace\VIE-Engine-v2 (tests run from apps/api)
const APP = path.join(ROOT, "otsi-vie");
const PY = path.join(ROOT, ".venv", "Scripts", "python.exe");
const MARIA = (process.env.OTSI_VIE_TEST_DB_BACKEND ?? "").trim().toLowerCase() === "mariadb";
const PORT = MARIA ? 3511 : 3507;

function rootPassword(): string {
  const [file, key] = MARIA ? ["mariadb-central-test.env", "MARIADB_ROOT_PASSWORD"] : ["mysql-lint.env", "MYSQL_ROOT_PASSWORD"];
  const env = readFileSync(path.join(ROOT, ".local", file), "utf8");
  const m = new RegExp(`^${key}=(.+)$`, "m").exec(env);
  if (!m) throw new Error(`no ${key} in .local/${file}${MARIA ? "" : " (run tools/db/db_check.py once)"}`);
  return m[1]!.trim();
}

export default async function setup({ provide }: GlobalSetupContext) {
  if ((process.env.OTSI_VIE_TEST_DB_BACKEND ?? "mysql").trim().toLowerCase() === "sqlite") {
    // No MySQL provisioning here: no .local/mysql-lint.env is read, no server is contacted. `appDsn` is the
    // scratch SQLite file; `rootDsn` is empty because the dialect harness uses the same connection for fixtures.
    const file = path.join(tmpdir(), `otsi-api-test-${randomBytes(6).toString("hex")}.db`);
    const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
    provide("rootDsn", "");
    provide("appDsn", file);
    provide("publicKeyPem", await exportSPKI(publicKey));
    provide("privateJwk", JSON.stringify(await exportJWK(privateKey)));
    return async () => {
      for (const suffix of ["", "-wal", "-shm"]) { try { unlinkSync(file + suffix); } catch { /* already gone */ } }
    };
  }
  const pw = rootPassword();
  const db = `vie_api_${randomBytes(6).toString("hex")}`;
  const appUser = `otsi_app_t_${randomBytes(3).toString("hex")}`;
  const appPw = randomBytes(18).toString("hex");
  const admin = await mysql.createConnection({ host: "127.0.0.1", port: PORT, user: "root", password: pw });
  // MySQL 8.4's default collation is utf8mb4_0900_ai_ci; MariaDB 10.11 (this VM) does not have it, so
  // MariaDB mode uses utf8mb4_unicode_ci (MariaDB 11.4 has both). The collation is only the scratch
  // database's default; the migrations set their own collations.
  const collation = MARIA ? "utf8mb4_unicode_ci" : "utf8mb4_0900_ai_ci";
  await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE ${collation}`);
  const rootDsn = `mysql://root:${encodeURIComponent(pw)}@127.0.0.1:${PORT}/${db}`;
  execFileSync(PY, [path.join(APP, "tools", "db", "migrate.py"), "up", "--dsn", rootDsn], { stdio: "pipe" });
  execFileSync(PY, [path.join(APP, "tools", "db", "roles.py"), "--dsn", rootDsn], { stdio: "pipe" });
  await admin.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY '${appPw}'`);
  await admin.query(`GRANT otsi_app TO '${appUser}'@'%'`);
  // MariaDB spells the default-role statement differently
  await admin.query(MARIA ? `SET DEFAULT ROLE otsi_app FOR '${appUser}'@'%'` : `SET DEFAULT ROLE otsi_app TO '${appUser}'@'%'`);
  const { publicKey, privateKey } = await generateKeyPair("RS256", { extractable: true });
  provide("rootDsn", rootDsn);
  provide("appDsn", `mysql://${appUser}:${appPw}@127.0.0.1:${PORT}/${db}`);
  provide("publicKeyPem", await exportSPKI(publicKey));
  provide("privateJwk", JSON.stringify(await exportJWK(privateKey)));
  return async () => {
    await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
    await admin.query(`DROP USER IF EXISTS '${appUser}'@'%'`);
    await admin.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    rootDsn: string;
    appDsn: string;
    publicKeyPem: string;
    privateJwk: string;
  }
}
