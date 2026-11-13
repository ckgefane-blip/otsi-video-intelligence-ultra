/** GET /v1/overview/inbox (v3 Phase A.13, ADR-062): the Home next action and Review inbox, from recorded rows only. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { lineupsJobStarter } from "../src/core/outbox/subscribers";
import { appDb, key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

beforeAll(async () => {
  app = await startApi();
  db = appDb();
  root = await rootDb();
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
});

describe("home inbox", () => {
  it("is empty for a new organization: no next action, first-run guidance stays", async () => {
    const m = await seedMember(root, "OWNER");
    expect((await call(m, "GET", "/v1/overview/inbox")).body).toEqual({ next: null, items: [], completed_match: false });
  });

  it("follows the real state: watch a running analysis, then review a suggestion, then pick a player; another organization sees none", async () => {
    const m = await seedMember(root, "OWNER");
    const { runId, videoId, trackIds: [track] } = await seedTracks(root, m);
    await root.query("UPDATE video_sources SET title = 'Inbox Match' WHERE id = ?", [videoId]);
    let r = (await call(m, "GET", "/v1/overview/inbox")).body;
    expect(r.next).toMatchObject({ kind: "WATCH_PROCESSING", detail: "Inbox Match", href: `/processing?video=${videoId}` });   // run queued

    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = UTC_TIMESTAMP(6) WHERE id = ?", [runId]);
    r = (await call(m, "GET", "/v1/overview/inbox")).body;
    expect(r).toMatchObject({ completed_match: true, items: [], next: { kind: "PICK_PLAYER", href: `/analysis?video=${videoId}` } });

    const player = await call(m, "POST", "/v1/players", { display_name: "Inbox Player" }, { "idempotency-key": key() });
    expect((await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CANDIDATE", player_id: player.body.player_id })).status).toBe(201);
    r = (await call(m, "GET", "/v1/overview/inbox")).body;
    expect(r.items).toEqual([{ id: `IDENTITY:${videoId}`, kind: "IDENTITY", title: "Check 1 identity suggestion", detail: "Inbox Match", count: 1, href: `/analysis?video=${videoId}`, video_id: videoId }]);
    expect(r.next).toMatchObject({ kind: "REVIEW", label: "Check 1 identity suggestion" });

    const other = await seedMember(root, "OWNER");
    expect((await call(other, "GET", "/v1/overview/inbox")).body).toEqual({ next: null, items: [], completed_match: false });
  });

  it("lists a failed job until it is run again, and a team sheet waiting for approval", async () => {
    const m = await seedMember(root, "OWNER");
    const { videoId } = await seedTracks(root, m);
    const job = uuidv7();
    await root.query(`INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, state, error_code, finished_at)
                      VALUES (?, ?, 'PROXY', 'video', ?, ?, '{}', 'FAILED', 'X', UTC_TIMESTAMP(6))`, [job, m.orgId, videoId, `proxy:${videoId}`]);
    const read = uuidv7();
    await root.query("INSERT INTO lineup_reads (id, organization_id, video_id, requested_by, status) VALUES (?, ?, ?, ?, 'SUCCEEDED')", [read, m.orgId, videoId, m.userId]);
    await root.query("INSERT INTO lineup_cards (id, organization_id, read_id, video_id, pts_us, entries) VALUES (?, ?, ?, ?, 0, '[]')", [uuidv7(), m.orgId, read, videoId]);
    const kinds = ((await call(m, "GET", "/v1/overview/inbox")).body.items as { kind: string; href: string; video_id: string | null }[]).map((i) => [i.kind, i.href, i.video_id]);
    expect(kinds).toEqual([["TEAM_SHEET", `/analysis?video=${videoId}`, videoId], ["FAILED_JOB", `/processing?video=${videoId}`, videoId]]);

    await root.query("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (?, ?, 'PROXY', 'video', ?, ?, '{}')",
      [uuidv7(), m.orgId, videoId, `proxy-again:${videoId}`]);
    const after = ((await call(m, "GET", "/v1/overview/inbox")).body.items as { kind: string }[]).map((i) => i.kind);
    expect(after).toEqual(["TEAM_SHEET"]);                                                     // the retry clears the failure
  });
});

/** POST /v1/overview/inbox/decisions: one row, decided where the work happens, and the updated inbox back. */
describe("inbox decisions", () => {
  /** an ingested video with two proposed team sheets, as the worker leaves them */
  async function seedTeamSheets(m: Member, home: string, away: string) {
    const project = uuidv7(), video = uuidv7(), source = uuidv7();
    await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
    await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
    await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
    const read = uuidv7(), h = uuidv7(), w = uuidv7();
    await root.query("INSERT INTO lineup_reads (id, organization_id, video_id, status) VALUES (?, ?, ?, 'SUCCEEDED')", [read, m.orgId, video]);
    const rows = (names: string[]) => JSON.stringify(names.map((n, i) => ({ number: String(i + 1), name: n, role: i < 2 ? "STARTER" : "SUBSTITUTE", confidence: 0.98 })));
    await root.query("INSERT INTO lineup_cards (id, organization_id, read_id, video_id, pts_us, team_name, coach_name, entries) VALUES (?, ?, ?, ?, 1000000, ?, 'COACH A', ?), (?, ?, ?, ?, 9000000, ?, 'COACH B', ?)",
      [h, m.orgId, read, video, home, rows(["ALPHA ONE", "ALPHA TWO", "ALPHA THREE"]), w, m.orgId, read, video, away, rows(["BETA ONE", "BETA TWO"])]);
    return { video, h, w };
  }

  const decide = (m: Member, itemId: string, decision: string, reason?: string) =>
    call(m, "POST", "/v1/overview/inbox/decisions", { item_id: itemId, decision, ...(reason ? { reason } : {}) });

  it("confirms suggested identities on approve, rejects them on reject, and the row clears", async () => {
    const m = await seedMember(root, "OWNER");
    const viewer = await seedMember(root, "VIEWER", m.orgId);
    const { videoId, trackIds: [track] } = await seedTracks(root, m);
    const player = await call(m, "POST", "/v1/players", { display_name: "Decide Player" }, { "idempotency-key": key() });
    expect((await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CANDIDATE", player_id: player.body.player_id })).status).toBe(201);
    expect((await decide(viewer, `IDENTITY:${videoId}`, "APPROVE")).status).toBe(403);      // a viewer reviews nothing
    expect((await decide(m, "not-an-item", "APPROVE")).body.code).toBe("INBOX_ITEM_NOT_FOUND");
    expect((await decide(m, `IDENTITY:${uuidv7()}`, "APPROVE")).body.code).toBe("INBOX_ITEM_GONE");
    const r = await decide(m, `IDENTITY:${videoId}`, "APPROVE", "looks right");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ item_id: `IDENTITY:${videoId}`, kind: "IDENTITY", decision: "APPROVE", applied: 1, failures: [] });
    expect(r.body.inbox.items).toEqual([]);
    expect((await call(m, "GET", `/v1/tracks/${track}/identity`)).body.state).toBe("CONFIRMED");
    expect((await decide(m, `IDENTITY:${videoId}`, "APPROVE")).body.code).toBe("INBOX_ITEM_GONE");   // decided once: the row is gone
    const { videoId: v2, trackIds: [t2] } = await seedTracks(root, m);
    expect((await call(m, "POST", `/v1/tracks/${t2}/identity-decisions`, { state: "CANDIDATE", player_id: player.body.player_id })).status).toBe(201);
    const rej = await decide(m, `IDENTITY:${v2}`, "REJECT", "wrong player");
    expect(rej.body).toMatchObject({ decision: "REJECT", applied: 1, failures: [] });
    expect((await call(m, "GET", `/v1/tracks/${t2}/identity`)).body.state).toBe("REJECTED");
    expect(rej.body.inbox.items).toEqual([]);
  });

  it("applies proposed team sheets on approve and dismisses them on reject", async () => {
    const m = await seedMember(root, "OWNER");
    const s = await seedTeamSheets(m, `Home ${uuidv7().slice(-6)}`, `Away ${uuidv7().slice(-6)}`);
    const r = await decide(m, `TEAM_SHEET:${s.video}`, "APPROVE", "sheets read right");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "TEAM_SHEET", decision: "APPROVE", applied: 5, failures: [] });
    expect(r.body.inbox.items).toEqual([]);
    expect((await call(m, "GET", `/v1/videos/${s.video}/lineups`)).body.cards.map((x: { state: string }) => x.state)).toEqual(["APPLIED", "APPLIED"]);
    const s2 = await seedTeamSheets(m, `Home ${uuidv7().slice(-6)}`, `Away ${uuidv7().slice(-6)}`);
    const rej = await decide(m, `TEAM_SHEET:${s2.video}`, "REJECT", "not this match");
    expect(rej.body).toMatchObject({ decision: "REJECT", applied: 2, failures: [] });
    expect(rej.body.inbox.items).toEqual([]);
    expect((await call(m, "GET", `/v1/videos/${s2.video}/lineups`)).body.cards.map((x: { state: string }) => x.state)).toEqual(["DISMISSED", "DISMISSED"]);
  });

  it("runs the failed jobs again on approve; a stale reel or a failed job cannot be rejected from here", async () => {
    const m = await seedMember(root, "OWNER");
    const { videoId } = await seedTracks(root, m);
    await root.query("UPDATE video_sources SET state = 'INGESTED' WHERE id = ?", [videoId]);
    const read = uuidv7();
    await root.query("INSERT INTO lineup_reads (id, organization_id, video_id, requested_by, status) VALUES (?, ?, ?, ?, 'SUCCEEDED')", [read, m.orgId, videoId, m.userId]);
    await root.query(`INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, state, error_code, finished_at)
                      VALUES (?, ?, 'READ_LINEUPS', 'lineup_read', ?, ?, '{}', 'FAILED', 'X', UTC_TIMESTAMP(6))`, [uuidv7(), m.orgId, read, `rl:${read}`]);
    expect(((await call(m, "GET", "/v1/overview/inbox")).body.items as { kind: string }[]).map((i) => i.kind)).toEqual(["FAILED_JOB"]);
    expect((await decide(m, `FAILED_JOB:${videoId}`, "REJECT")).body.code).toBe("DECISION_NOT_SUPPORTED");
    const r = await decide(m, `FAILED_JOB:${videoId}`, "APPROVE");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "FAILED_JOB", decision: "APPROVE", applied: 1, failures: [] });
    // the retry is queued through the outbox: the new job row (and the cleared inbox row) appear once it fires
    const d = new OutboxDispatcher(db, [lineupsJobStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    expect(((await call(m, "GET", "/v1/overview/inbox")).body.items as { kind: string }[])).toEqual([]);
  });

  it("refreshes a stale reel on approve and refuses to reject it", async () => {
    const m = await seedMember(root, "OWNER");
    const { runId, videoId, trackIds: [track] } = await seedTracks(root, m);
    await root.query("UPDATE pipeline_runs SET status = 'SUCCEEDED', finished_at = UTC_TIMESTAMP(6) WHERE id = ?", [runId]);
    const p1 = (await call(m, "POST", "/v1/players", { display_name: "Stale One" }, { "idempotency-key": key() })).body.player_id as string;
    const p2 = (await call(m, "POST", "/v1/players", { display_name: "Stale Two" }, { "idempotency-key": key() })).body.player_id as string;
    expect((await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: p1 })).status).toBe(201);
    const reel = (await call(m, "POST", "/v1/reels", { video_id: videoId, player_id: p1 })).body;
    const cur = (await call(m, "GET", `/v1/tracks/${track}/identity`)).body;
    expect((await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: p2, supersedes_id: cur.decision_id })).status).toBe(201);
    const stale = ((await call(m, "GET", "/v1/overview/inbox")).body.items as { id: string; kind: string }[]).find((i) => i.kind === "STALE_REEL");
    expect(stale?.id).toBe(`STALE_REEL:${reel.id}`);
    expect((await decide(m, stale!.id, "REJECT")).body.code).toBe("DECISION_NOT_SUPPORTED");
    const r = await decide(m, stale!.id, "APPROVE");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kind: "STALE_REEL", decision: "APPROVE", applied: 1, failures: [] });
    expect(r.body.inbox.items).toEqual([]);
  });
});
