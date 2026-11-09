/**
 * Canonical OTSI Player ID through the real HTTP API (Fastify inject), the real MySQL schema and the least-privilege runtime account.
 * Owner identity tests covered here: 4 (API concurrency), 5, 11, 12, 13, 14, 15, 20, plus authentication / authorization.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi, token } from "./helpers";

const ID = /^OTSI-[A-Z]{3}-[0-9]{4}-[0-9]{6}$/;
let app: NestFastifyApplication;
let db: mysql.Connection;
let a: Member;          // organization A (owner)
let b: Member;          // organization B (owner)

async function call(m: Member | Record<string, string>, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers = { ...("headers" in m ? (m as Member).headers : (m as Record<string, string>)), ...extra };
  const r = await app.inject({ method, url, headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
const create = (m: Member, name = "Test Player", k = key()) => call(m, "POST", "/v1/players", { display_name: name }, { "idempotency-key": k });
const register = (m: Member, id: string, country = "NGA", k = key()) => call(m, "POST", `/v1/players/${id}/registration`, { country_code: country }, { "idempotency-key": k });

beforeAll(async () => {
  app = await startApi();
  db = await rootDb();
  a = await seedMember(db, "OWNER");
  b = await seedMember(db, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await db?.end();
});

describe("authentication and tenant context", () => {
  it("refuses a missing, foreign, mis-addressed or expired token", async () => {
    expect((await call({ "x-organization-id": a.orgId }, "GET", "/v1/players/00000000-0000-0000-0000-000000000000")).body.code).toBe("UNAUTHENTICATED");
    for (const t of [await token(a.subject, { iss: "https://evil.invalid/" }), await token(a.subject, { aud: "another-api" }), await token(a.subject, { expSeconds: -60 })]) {
      const r = await call({ authorization: `Bearer ${t}`, "x-organization-id": a.orgId }, "GET", "/v1/players/00000000-0000-0000-0000-000000000000");
      expect([r.status, r.body.code]).toEqual([401, "INVALID_TOKEN"]);
    }
  });

  it("never trusts the organization header alone", async () => {
    const r = await call({ ...a.headers, "x-organization-id": b.orgId }, "GET", "/v1/players/00000000-0000-0000-0000-000000000000");
    expect([r.status, r.body.code]).toEqual([403, "NOT_A_MEMBER"]);
  });

  it("enforces roles from the membership, not the token", async () => {
    const viewer = await seedMember(db, "VIEWER", a.orgId);
    const r = await create(viewer);
    expect([r.status, r.body.code]).toEqual([403, "ROLE_NOT_ALLOWED"]);
  });
});

describe("player registry and the permanent OTSI Player ID", () => {
  it("creates provisional players without inventing an ID, idempotently (test 5)", async () => {
    const k = key();
    const first = await create(a, "Provisional One", k);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ canonical_otsi_id: null, canonical_state: "PROVISIONAL", identity_label: "PROVISIONAL_PLAYER" });
    const again = await create(a, "Provisional One", k);
    expect(again.status).toBe(200);
    expect(again.body.player_id).toBe(first.body.player_id);
    expect((await call(a, "POST", "/v1/players", { display_name: "No Key" })).body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    const bad = await call(a, "POST", "/v1/players", { display_name: "x" }, { "idempotency-key": key() });
    expect([bad.status, bad.body.code]).toEqual([422, "INVALID_REQUEST"]);           // a bad body is the caller's error, never a 500
  });

  it("issues exactly one permanent ID, visible identically to every organization and endpoint (tests 15, 20)", async () => {
    const p = (await create(a, "Registered One")).body.player_id as string;
    expect((await call(b, "GET", `/v1/players/${p}`)).status).toBe(404);              // B cannot see A's provisional record
    expect((await register(b, p)).status).toBe(404);                                   // nor register it
    const analyst = await seedMember(db, "ANALYST", a.orgId);
    expect((await register(analyst, p)).body.code).toBe("ROLE_NOT_ALLOWED");
    const reg = await register(a, p, "NGA");
    expect(reg.status).toBe(200);
    expect(reg.body.canonical_otsi_id).toMatch(ID);
    expect(reg.body.identity_label).toBe("REGISTERED_PLAYER");
    const cid = reg.body.canonical_otsi_id as string;
    expect((await register(a, p, "GHA")).body.canonical_otsi_id).toBe(cid);           // a second registration returns the same ID
    for (const viewerOf of [a, b]) {                                                   // the shared registry: same ID for everyone
      expect((await call(viewerOf, "GET", `/v1/players/${p}`)).body.canonical_otsi_id).toBe(cid);
      expect((await call(viewerOf, "GET", `/v1/players/by-otsi-id/${cid}`)).body.player_id).toBe(p);
    }
    expect((await call(a, "GET", `/v1/players/by-otsi-id/${cid.toLowerCase()}`)).body.code).toBe("INVALID_OTSI_PLAYER_ID");
  });

  it("allocates distinct, contiguous IDs under concurrent API requests (test 4)", async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, async (_, i) => (await create(a, `Concurrent ${i}`)).body.player_id as string));
    const results = await Promise.all(ids.map((id) => register(a, id, "BEN")));
    if (!results.every((r) => r.status === 200)) console.log("DBG", JSON.stringify(results.filter((r) => r.status !== 200).map((r) => [r.status, r.body])));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const cids = results.map((r) => r.body.canonical_otsi_id as string);
    expect(new Set(cids).size).toBe(20);
    const seqs = cids.map((c) => Number(c.slice(-6))).sort((x, y) => x - y);
    expect(seqs[19]! - seqs[0]!).toBe(19);
  });

  it("merges a tenant duplicate into the registered player, keeping both records (test 14)", async () => {
    const survivor = (await create(a, "Survivor")).body.player_id as string;
    const survivorId = (await register(a, survivor, "SEN")).body.canonical_otsi_id as string;
    const dup = (await create(a, "Survivor (dup import)")).body.player_id as string;
    const merged = await call(a, "POST", `/v1/players/${dup}/merge`, { into_player_id: survivor, reason: "same date of birth and passport" });
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ identity_label: "MERGED_DUPLICATE", canonical_otsi_id: survivorId, own_canonical_otsi_id: null, resolved_player_id: survivor });
    const other = (await create(a, "Other registered")).body.player_id as string;
    await register(a, other, "SEN");
    const r = await call(a, "POST", `/v1/players/${other}/merge`, { into_player_id: survivor, reason: "looks alike" });
    expect([r.status, r.body.code]).toEqual([403, "PLATFORM_ADMIN_REQUIRED"]);    // the shared registry is not a tenant's to rewrite
  });
});

describe("tracks resolve to the permanent identity", () => {
  it("shows an unknown track as Unidentified Player and never as a candidate (test 12)", async () => {
    const { trackIds } = await seedTracks(db, a, 1);
    const r = await call(a, "GET", `/v1/tracks/${trackIds[0]}/identity`);
    expect(r.body).toMatchObject({ state: "UNRESOLVED", player: null, decision_id: null, display: { kind: "UNIDENTIFIED", label: "Unidentified Player · track 1" } });
    const p = (await create(a, "Candidate")).body.player_id as string;
    await call(a, "POST", `/v1/tracks/${trackIds[0]}/identity-decisions`, { state: "CANDIDATE", player_id: p });
    expect((await call(a, "GET", `/v1/tracks/${trackIds[0]}/identity`)).body).toMatchObject({ state: "CANDIDATE", player: null, display: { kind: "UNIDENTIFIED" } });
  });

  it("confirms, corrects with history and reason, and refuses a stale correction (test 13)", async () => {
    const { trackIds } = await seedTracks(db, a, 1);
    const t = trackIds[0]!;
    const right = (await create(a, "Right Player")).body.player_id as string;
    const wrong = (await create(a, "Wrong Player")).body.player_id as string;
    const rightId = (await register(a, right, "CMR")).body.canonical_otsi_id as string;
    const first = await call(a, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: wrong });
    expect(first.status).toBe(201);
    const d1 = first.body.decision_id as string;
    expect((await call(a, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: right })).body.code).toBe("STALE_DECISION");
    expect((await call(a, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: right, supersedes_id: d1 })).body.code).toBe("CORRECTION_REASON_REQUIRED");
    const fixed = await call(a, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: right, supersedes_id: d1, reason: "back number 15 at 12:03" });
    expect(fixed.body).toMatchObject({ state: "CONFIRMED", player: { player_id: right, canonical_otsi_id: rightId }, display: { kind: "IDENTIFIED", label: `Right Player · ${rightId}` } });
    const [hist] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM track_identity_decisions WHERE track_id = ?", [t]);
    expect(hist[0]!.n).toBe(2);                                                          // the original decision is kept
    const [events] = await db.query<mysql.RowDataPacket[]>("SELECT event_type FROM outbox_events WHERE aggregate_id = ? ORDER BY id", [t]);
    expect(events.map((e) => e.event_type)).toEqual(["track.identity_decided", "track.identity_corrected"]);   // downstream re-evaluation
    const [audits] = await db.query<mysql.RowDataPacket[]>("SELECT action, actor_id FROM audit_events WHERE entity_id = ? ORDER BY id", [t]);
    expect(audits.map((x) => [x.action, x.actor_id])).toEqual([["track.identity_decided", a.userId], ["track.identity_corrected", a.userId]]);
  });

  it("keeps the same ID across tracking restarts and camera cuts, issuing nothing new (tests 10, 11, 20)", async () => {
    const p = (await create(a, "Restarted")).body.player_id as string;
    const cid = (await register(a, p, "GAB")).body.canonical_otsi_id as string;
    const [[before]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM canonical_id_issuances");
    for (let run = 0; run < 2; run++) {
      const { trackIds } = await seedTracks(db, a, 3);
      for (const t of trackIds) {
        const r = await call(a, "POST", `/v1/tracks/${t}/identity-decisions`, { state: "CONFIRMED", player_id: p });
        expect(r.body.player.canonical_otsi_id).toBe(cid);
      }
    }
    const [[after]] = await db.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM canonical_id_issuances");
    expect(after!.n).toBe(before!.n);
  });

  it("keeps tracks inside their organization and refuses merged identities (test 15)", async () => {
    const { trackIds } = await seedTracks(db, a, 1);
    expect((await call(b, "GET", `/v1/tracks/${trackIds[0]}/identity`)).status).toBe(404);
    expect((await call(b, "POST", `/v1/tracks/${trackIds[0]}/identity-decisions`, { state: "UNRESOLVED", player_id: null })).status).toBe(404);
    const survivor = (await create(a, "Same Player")).body.player_id as string;
    await register(a, survivor, "TGO");
    const dup = (await create(a, "Same Player dup")).body.player_id as string;
    await call(a, "POST", `/v1/players/${dup}/merge`, { into_player_id: survivor, reason: "duplicate import" });
    const r = await call(a, "POST", `/v1/tracks/${trackIds[0]}/identity-decisions`, { state: "CONFIRMED", player_id: dup });
    expect([r.status, r.body.code]).toEqual([409, "IDENTITY_DECISION_TARGET_NOT_LIVE"]);
  });
});

describe("player search for identity review", () => {
  it("finds registered players for everyone and provisional ones only for their organization; wildcards are literal", async () => {
    const tag = `Zq${key().slice(0, 6).replace(/[^A-Za-z0-9]/g, "x")}`;
    const mine = (await create(a, `${tag} Provisional`)).body.player_id as string;
    const shared = (await create(b, `${tag} Registered`)).body.player_id as string;
    const cid = (await register(b, shared, "GHA")).body.canonical_otsi_id as string;
    const hidden = (await create(b, `${tag} Hidden`)).body.player_id as string;
    const ids = (r: { body: { player_id: string }[] }) => r.body.map((p) => p.player_id);
    const forA = await call(a, "GET", `/v1/players?q=${encodeURIComponent(tag)}`);
    expect(forA.status).toBe(200);
    expect(ids(forA)).toEqual(expect.arrayContaining([mine, shared]));
    expect(ids(forA)).not.toContain(hidden);                                       // another organization's provisional record
    expect(ids(await call(a, "GET", `/v1/players?q=${cid}`))).toEqual([shared]);   // by OTSI Player ID
    expect((await call(a, "GET", `/v1/players?q=${encodeURIComponent("%%")}`)).body.length).toBe(0);
    expect((await call(a, "GET", "/v1/players?q=x")).body.code).toBe("QUERY_TOO_SHORT");
  });
});
