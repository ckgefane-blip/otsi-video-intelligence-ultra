import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rootDb, seedMember, seedTracks, startApi, type Member } from "./helpers";

let app: NestFastifyApplication;
let db: mysql.Connection;
let owner: Member, viewer: Member, outsider: Member;
const path = "/v1/assistant/plans";

beforeAll(async () => {
  app = await startApi();
  db = await rootDb();
  owner = await seedMember(db, "OWNER");
  viewer = await seedMember(db, "VIEWER", owner.orgId);
  outsider = await seedMember(db, "OWNER");
});
afterAll(async () => { await app?.close(); await db?.end(); });

const post = (member: Member, url: string, payload?: object) => app.inject({
  method: "POST", url, headers: member.headers, ...(payload === undefined ? {} : { payload }),
});
async function preview(member: Member, command: string): Promise<string> {
  const res = await post(member, path, { command });
  expect(res.statusCode).toBe(201);
  return res.json().id;
}
async function audits(id: string) {
  const [rows] = await db.query<RowDataPacket[]>(
    "SELECT action, actor_id, organization_id, after_state FROM audit_events WHERE entity_type = 'assistant_plan' AND entity_id = ? ORDER BY id", [id],
  );
  return rows;
}

describe("C.1 local assistant", () => {
  it("keeps preview separate from execution and accepts exactly one approval by its creator", async () => {
    const id = await preview(owner, "open library");
    const approve = `${path}/${id}/approve`;
    expect(await audits(id)).toEqual([]);
    expect((await post(viewer, approve)).statusCode).toBe(404);
    expect((await post(outsider, approve)).statusCode).toBe(404);
    expect((await post(owner, approve, { page: "studio" })).statusCode).toBe(422);
    const attempts = await Promise.all([post(owner, approve), post(owner, approve)]);
    expect(attempts.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(attempts.find((r) => r.statusCode === 200)!.json()).toEqual({ kind: "open", page: "library" });
    expect((await audits(id)).map((r) => [r.action, r.actor_id, r.organization_id])).toEqual([
      ["assistant.plan_approved", owner.userId, owner.orgId],
      ["assistant.step_completed", owner.userId, owner.orgId],
    ]);
  });

  it("refuses unrecognized commands, changed roles, and expired previews", async () => {
    const member = await seedMember(db, "EDITOR", owner.orgId);
    const id = await preview(member, "show jobs");
    await db.query("UPDATE memberships SET role = 'VIEWER' WHERE user_id = ? AND organization_id = ?", [member.userId, member.orgId]);
    expect((await post(member, `${path}/${id}/approve`)).statusCode).toBe(409);
    const expired = await preview(owner, "show jobs");
    await db.query("UPDATE assistant_plans SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?", [expired]);
    expect((await post(owner, `${path}/${expired}/approve`)).statusCode).toBe(409);
    for (const command of ["confirm identity", "approve export", "grant rights", "search type:unknown"]) {
      expect((await post(owner, path, { command })).statusCode).toBe(422);
    }
    expect((await app.inject({ method: "POST", url: path, payload: { command: "jobs" } })).statusCode).toBe(401);
    expect(await audits(id)).toEqual([]);
    expect(await audits(expired)).toEqual([]);
  });

  it("uses current project access for search results and leaves query text out of audit", async () => {
    const { videoId } = await seedTracks(db, owner, 0);
    await db.query("UPDATE video_sources SET title = 'Assistant fixture' WHERE id = ?", [videoId]);
    const [[video]] = await db.query<RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [videoId]);
    const hidden = await preview(viewer, "search Assistant fixture");
    const restricted = await app.inject({ method: "PUT", url: `/v1/projects/${video!.project_id}/access`, headers: owner.headers, payload: { access: "RESTRICTED" } });
    expect(restricted.statusCode).toBeLessThan(300);
    const response = await post(viewer, `${path}/${hidden}/approve`);
    expect(response.statusCode).toBe(200);
    expect(response.json().result.hits).toEqual([]);
    const visible = await preview(owner, "search Assistant fixture");
    const search = await post(owner, `${path}/${visible}/approve`);
    expect(search.statusCode).toBe(200);
    expect(search.json().result.hits).toEqual([expect.objectContaining({ id: videoId })]);
    expect(JSON.stringify(await audits(visible))).not.toContain("Assistant fixture");
    const jobs = await preview(viewer, "show jobs");
    expect((await post(viewer, `${path}/${jobs}/approve`)).json()).toMatchObject({ kind: "jobs", result: { jobs: [] } });
  });
});
