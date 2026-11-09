/**
 * The signed-in person's own account through the real HTTP stack and MySQL: the name and the end of the first-run welcome (PATCH /v1/me)
 * and the profile photo (PUT / GET / DELETE /v1/me/avatar). A photo belongs to one person only; only real pictures are kept.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { appDb, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let a: Member, b: Member;

// smallest valid PNG (1x1) and JPEG signature + padding
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

const json = (r: { body: string }) => (r.body ? JSON.parse(r.body) : null);
const patch = (m: Member, payload: unknown) => app.inject({ method: "PATCH", url: "/v1/me", headers: m.headers, payload: payload as object });
const put = (m: Member, body: Buffer, type: string) => app.inject({ method: "PUT", url: "/v1/me/avatar", headers: { ...m.headers, "content-type": type }, payload: body });
const get = (m: Member) => app.inject({ method: "GET", url: "/v1/me/avatar", headers: m.headers });
const del = (m: Member) => app.inject({ method: "DELETE", url: "/v1/me/avatar", headers: m.headers });
const me = async (m: Member) => json(await app.inject({ method: "GET", url: "/v1/me", headers: m.headers }));

beforeAll(async () => {
  app = await startApi({});
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "ANALYST");
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("name and first-run welcome", () => {
  it("a new account has not finished the welcome; saving the name and finishing records both once", async () => {
    expect((await me(a)).user.onboarded_at).toBeNull();
    const r = await patch(a, { display_name: "  Edmond Osio ".trim(), onboarding_done: true });
    expect(r.statusCode).toBe(200);
    const first = json(r).user;
    expect(first.display_name).toBe("Edmond Osio");
    expect(first.onboarded_at).toBeTruthy();
    // replaying the welcome and saving again never moves the original finish time
    await patch(a, { display_name: "Edmond O", onboarding_done: true });
    const again = (await me(a)).user;
    expect(again.display_name).toBe("Edmond O");
    expect(again.onboarded_at).toBe(first.onboarded_at);
  });

  it("refuses a one-letter name, an over-long name and unknown fields; nothing changes", async () => {
    expect((await patch(b, { display_name: "A" })).statusCode).toBe(422);
    expect((await patch(b, { display_name: "x".repeat(81) })).statusCode).toBe(422);
    expect((await patch(b, { onboarding_done: false })).statusCode).toBe(422);
    const u = (await me(b)).user;
    expect(u.display_name).toBe("Test User");
    expect(u.onboarded_at).toBeNull();
  });

  it("changes only the caller's own account", async () => {
    await patch(a, { display_name: "Only Me" });
    expect((await me(b)).user.display_name).toBe("Test User");
  });
});

describe("profile photo", () => {
  it("is saved, read back byte for byte, shown in /v1/me, and removed", async () => {
    expect((await get(b)).statusCode).toBe(404);
    expect((await put(b, PNG, "image/png")).statusCode).toBe(200);
    const g = await get(b);
    expect(g.statusCode).toBe(200);
    expect(g.headers["content-type"]).toBe("image/png");
    expect(g.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(g.rawPayload, PNG)).toBe(0);
    expect((await me(b)).user.avatar_updated_at).toBeTruthy();
    await put(b, JPEG, "image/jpeg");
    expect((await get(b)).headers["content-type"]).toBe("image/jpeg");
    expect((await del(b)).statusCode).toBe(200);
    expect((await get(b)).statusCode).toBe(404);
    expect((await me(b)).user.avatar_updated_at).toBeNull();
  });

  it("keeps only real pictures: wrong bytes, a wrong type and an oversize file are refused", async () => {
    expect((await put(a, Buffer.from("this is not a picture at all"), "image/png")).statusCode).toBe(400);
    expect((await put(a, PNG, "text/plain")).statusCode).toBeGreaterThanOrEqual(400);
    expect((await put(a, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(420_000)]), "image/jpeg")).statusCode).toBeGreaterThanOrEqual(400);
    expect((await get(a)).statusCode).toBe(404);
  });

  it("belongs to one person: another person's photo is never returned", async () => {
    await put(a, PNG, "image/png");
    expect((await get(b)).statusCode).toBe(404);
    await del(a);
  });

  it("needs a signed-in person", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/me/avatar" })).statusCode).toBe(401);
    expect((await app.inject({ method: "PATCH", url: "/v1/me", payload: { display_name: "Nobody" } })).statusCode).toBe(401);
  });
});

describe("Guided / Pro per page (A.7, ADR-072)", () => {
  const modes = async (m: Member) => app.inject({ method: "GET", url: "/v1/me/page-modes", headers: m.headers });
  const setMode = (m: Member | null, page: string, payload: unknown) =>
    app.inject({ method: "PUT", url: `/v1/me/page-modes/${page}`, headers: m?.headers ?? {}, payload: payload as object });

  it("is the person's own choice, per page; none means Pro", async () => {
    expect(json(await modes(a))).toEqual({ modes: {} });
    const s1 = await setMode(a, "studio", { mode: "GUIDED" });
    expect(s1.statusCode).toBe(200);
    expect(json(s1)).toEqual({ modes: { studio: "GUIDED" } });
    expect(json(await setMode(a, "processing", { mode: "GUIDED" }))).toEqual({ modes: { processing: "GUIDED", studio: "GUIDED" } });
    expect(json(await setMode(a, "studio", { mode: "PRO" }))).toEqual({ modes: { processing: "GUIDED", studio: "PRO" } });
    // someone else: untouched
    expect(json(await modes(b))).toEqual({ modes: {} });
    const [rows] = await root.query("SELECT COUNT(*) AS n FROM user_page_modes WHERE user_id = ?", [a.userId]);
    expect((rows as { n: number }[])[0]!.n).toBe(2);
  });

  it("refuses an unknown page or mode, and needs a sign-in", async () => {
    expect((await setMode(a, "nowhere", { mode: "PRO" })).statusCode).toBe(404);
    expect((await setMode(a, "studio", { mode: "EXPERT" })).statusCode).toBe(422);
    expect((await setMode(a, "studio", {})).statusCode).toBe(422);
    expect((await setMode(null, "studio", { mode: "PRO" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/page-modes" })).statusCode).toBe(401);
  });
});
