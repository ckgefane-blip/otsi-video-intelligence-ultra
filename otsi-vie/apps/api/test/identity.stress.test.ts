/**
 * OTSI Player ID issuance under concurrent load (ADR-016; owner directive 2026-10-27: root-cause the intermittent 20-concurrent failure).
 *
 * Every round registers N provisional players at once through the real HTTP API and MySQL, then checks — from the database, not from
 * the responses — that every issued ID is unique, contiguous per country and year, persisted on the player, recorded once in the
 * issuance ledger and in the audit log, and that every failed request left no ID and no ledger row behind. Every non-200 response is
 * written to an evidence file with its body, so a failure is diagnosable from the evidence, not from a rerun.
 *
 * The default run (CI) does one round of 50 for a never-used country (the sequence row does not exist yet) and one of 50 for a used one.
 * OTSI_VIE_STRESS_ROUNDS / OTSI_VIE_STRESS_SIZES widen it (tools/dev: e.g. 10 rounds of 20,50,100,200).
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Db } from "../src/core/db";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: mysql.Connection;
let a: Member;
const EVIDENCE = process.env.OTSI_VIE_STRESS_EVIDENCE ?? path.join(process.env.TEMP ?? ".", "otsi-id-stress.jsonl");
const ROUNDS = Number(process.env.OTSI_VIE_STRESS_ROUNDS ?? 1);
const SIZES = (process.env.OTSI_VIE_STRESS_SIZES ?? "50").split(",").map(Number);
// countries with no issuance in a fresh test database (the first request of each round creates the sequence row)
const FRESH = ["BWA", "LSO", "SWZ", "NAM", "MOZ", "MWI", "ZMB", "ZWE", "AGO", "COD", "COG", "GAB", "CMR", "TCD", "CAF", "GNQ", "STP", "BDI", "RWA", "SSD",
  "ERI", "DJI", "SOM", "ETH", "SDN", "LBY", "TUN", "DZA", "MAR", "MRT", "MLI", "NER", "BFA", "GHA", "TGO", "BEN", "CIV", "LBR", "SLE", "GIN"];
let fresh = 0;

async function call(method: "POST", url: string, body: unknown, idem: string) {
  const r = await app.inject({ method, url, headers: { ...a.headers, "idempotency-key": idem }, payload: body as object });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

async function round(n: number, country: string, label: string) {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 25) {                     // create the provisional players (not part of the measured race)
    ids.push(...await Promise.all(Array.from({ length: Math.min(25, n - i) }, async (_, j) =>
      (await call("POST", "/v1/players", { display_name: `Stress ${label} ${i + j}` }, key())).body.player_id as string)));
  }
  const t0 = Date.now();
  const results = await Promise.all(ids.map((id) => call("POST", `/v1/players/${id}/registration`, { country_code: country }, key())));
  const ms = Date.now() - t0;
  const failed = results.map((r, i) => ({ ...r, player: ids[i] })).filter((r) => r.status !== 200);
  mkdirSync(path.dirname(EVIDENCE), { recursive: true });
  const t = app.get(Db).transient;
  const retries = { retried: Object.fromEntries(t.retried), exhausted: t.exhausted, maxAttemptUsed: t.maxAttemptUsed };
  t.retried.clear(); t.exhausted = 0; t.maxAttemptUsed = 0;
  const [inno] = await db.query<mysql.RowDataPacket[]>("SHOW ENGINE INNODB STATUS");
  const status = String(inno[0]?.Status ?? "");
  const dl = status.includes("LATEST DETECTED DEADLOCK") ? status.slice(status.indexOf("LATEST DETECTED DEADLOCK"), status.indexOf("TRANSACTIONS\n------------")) : null;
  appendFileSync(EVIDENCE, JSON.stringify({ at: new Date().toISOString(), label, n, country, ms, retries, latest_deadlock: dl, failed: failed.map((f) => ({ status: f.status, body: f.body, player: f.player })) }) + "\n");

  // the database's view
  const [rows] = await db.query<mysql.RowDataPacket[]>(
    `SELECT p.id, p.canonical_otsi_id, p.canonical_state, i.canonical_otsi_id AS ledger_id, i.sequence_number,
            (SELECT COUNT(*) FROM canonical_id_issuances x WHERE x.player_id = p.id) AS ledger_rows,
            (SELECT COUNT(*) FROM audit_events e WHERE e.entity_id = p.id AND e.action = 'player.canonical_id_issued') AS audits
       FROM players p LEFT JOIN canonical_id_issuances i ON i.player_id = p.id WHERE p.id IN (?)`, [ids]);
  const issued = rows.filter((r) => r.canonical_otsi_id);
  for (const r of rows) {
    if (r.canonical_otsi_id) {
      expect(r).toMatchObject({ canonical_state: "REGISTERED", ledger_id: r.canonical_otsi_id, ledger_rows: 1, audits: 1 });
      expect(r.canonical_otsi_id).toMatch(new RegExp(`^OTSI-${country}-\\d{4}-\\d{6}$`));
    } else {
      expect(r).toMatchObject({ canonical_state: "PROVISIONAL", ledger_rows: 0, audits: 0 });       // a failure leaves nothing behind
    }
  }
  const cids = issued.map((r) => r.canonical_otsi_id as string);
  expect(new Set(cids).size).toBe(cids.length);                                                      // unique
  const [all] = await db.query<mysql.RowDataPacket[]>("SELECT sequence_number FROM canonical_id_issuances WHERE country_code = ? ORDER BY sequence_number", [country]);
  const seqs = all.map((r) => Number(r.sequence_number));
  expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));                         // contiguous from 1, no gap or reuse
  // a successful response names exactly the ID the database persisted
  for (const [i, r] of results.entries()) if (r.status === 200) expect(r.body.canonical_otsi_id).toBe(rows.find((x) => x.id === ids[i])!.canonical_otsi_id);
  return { failed, ms, issued: cids.length };
}

beforeAll(async () => {
  app = await startApi({});
  db = await rootDb();
  a = await seedMember(db, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe("OTSI Player ID issuance under load", () => {
  it("issues unique, contiguous, persisted IDs to every concurrent request, for a new and for a used country", async () => {
    for (let r = 0; r < ROUNDS; r++) {
      for (const n of SIZES) {
        const country = FRESH[fresh++ % FRESH.length]!;
        const first = await round(n, country, `fresh-${n}-${r}`);                // the sequence row is created by this race
        const again = await round(n, country, `used-${n}-${r}`);                 // the row exists
        expect({ fresh: first.failed.map((f) => [f.status, f.body?.code]), used: again.failed.map((f) => [f.status, f.body?.code]) })
          .toEqual({ fresh: [], used: [] });
      }
    }
  }, 600_000);
});
