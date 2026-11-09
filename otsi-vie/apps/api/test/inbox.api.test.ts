/** GET /v1/overview/inbox (v3 Phase A.13, ADR-062): the Home next action and Review inbox, from recorded rows only. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
});
afterAll(async () => {
  await app?.close();
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
    expect(r.items).toEqual([{ kind: "IDENTITY", title: "Check 1 identity suggestion", detail: "Inbox Match", count: 1, href: `/analysis?video=${videoId}` }]);
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
    const kinds = ((await call(m, "GET", "/v1/overview/inbox")).body.items as { kind: string; href: string }[]).map((i) => [i.kind, i.href]);
    expect(kinds).toEqual([["TEAM_SHEET", `/analysis?video=${videoId}`], ["FAILED_JOB", `/processing?video=${videoId}`]]);

    await root.query("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (?, ?, 'PROXY', 'video', ?, ?, '{}')",
      [uuidv7(), m.orgId, videoId, `proxy-again:${videoId}`]);
    const after = ((await call(m, "GET", "/v1/overview/inbox")).body.items as { kind: string }[]).map((i) => i.kind);
    expect(after).toEqual(["TEAM_SHEET"]);                                                     // the retry clears the failure
  });
});
