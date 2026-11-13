/** GET /v1/settings/storage (SOT, Preferences.dc.html): the library and cache folder paths Settings > Preferences shows. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member;

async function call(m: Member, method: "GET", url: string) {
  const r = await app.inject({ method, url, headers: m.headers });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-settings-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("settings storage folders", () => {
  it("returns the library folder the API was started with, and no cache folder when none is configured", async () => {
    const r = await call(a, "GET", "/v1/settings/storage");
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ library_folder: dir, cache_folder: null });
  });
});
