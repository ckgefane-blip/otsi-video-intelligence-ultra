/**
 * Once per test run: a BRAND-NEW scratch database on the isolated MySQL 8.4 server (127.0.0.1:3507), migrated with the real migrator,
 * roles provisioned, and a least-privilege runtime account (role otsi_app) for the API under test. A throwaway RSA key pair stands in
 * for the OIDC issuer (the API verifies issuer, audience and signature exactly as in production). Everything is dropped afterwards.
 * Never touches port 3306 or any existing database.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { exportJWK, exportSPKI, generateKeyPair } from "jose";
import mysql from "mysql2/promise";
type GlobalSetupContext = { provide: (key: "rootDsn" | "appDsn" | "publicKeyPem" | "privateJwk", value: string) => void };

const ROOT = path.resolve(process.cwd(), "../../..");            // D:\OTSI-Workspace\VIE-Engine-v2 (tests run from apps/api)
const APP = path.join(ROOT, "otsi-vie");
const PY = path.join(ROOT, ".venv", "Scripts", "python.exe");
const PORT = 3507;

function rootPassword(): string {
  const env = readFileSync(path.join(ROOT, ".local", "mysql-lint.env"), "utf8");
  const m = /^MYSQL_ROOT_PASSWORD=(.+)$/m.exec(env);
  if (!m) throw new Error("no MYSQL_ROOT_PASSWORD in .local/mysql-lint.env (run tools/db/db_check.py once)");
  return m[1]!.trim();
}

export default async function setup({ provide }: GlobalSetupContext) {
  const pw = rootPassword();
  const db = `vie_api_${randomBytes(6).toString("hex")}`;
  const appUser = `otsi_app_t_${randomBytes(3).toString("hex")}`;
  const appPw = randomBytes(18).toString("hex");
  const admin = await mysql.createConnection({ host: "127.0.0.1", port: PORT, user: "root", password: pw });
  await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  const rootDsn = `mysql://root:${encodeURIComponent(pw)}@127.0.0.1:${PORT}/${db}`;
  execFileSync(PY, [path.join(APP, "tools", "db", "migrate.py"), "up", "--dsn", rootDsn], { stdio: "pipe" });
  execFileSync(PY, [path.join(APP, "tools", "db", "roles.py"), "--dsn", rootDsn], { stdio: "pipe" });
  await admin.query(`CREATE USER '${appUser}'@'%' IDENTIFIED BY '${appPw}'`);
  await admin.query(`GRANT otsi_app TO '${appUser}'@'%'`);
  await admin.query(`SET DEFAULT ROLE otsi_app TO '${appUser}'@'%'`);
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
