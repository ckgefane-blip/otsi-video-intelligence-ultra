/** Members, saved searches and reel notes: tenant-scoped, per person where personal, audited where shared. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member;
let a2: Member;          // same organization as a, different person
let b: Member;           // another organization

async function call(m: Member, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

async function seedReel(m: Member): Promise<string> {
  const { videoId } = await seedTracks(root, m);
  const [[v]] = await root.query<RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [videoId]);
  const id = uuidv7();
  await root.query("INSERT INTO reel_projects (id, organization_id, project_id, video_id, name, created_by) VALUES (?, ?, ?, ?, 'Reel', ?)", [id, m.orgId, v!.project_id, videoId, m.userId]);
  return id;
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  a2 = await seedMember(root, "ANALYST", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("members", () => {
  it("lists the caller's organization only", async () => {
    const r = await call(a, "GET", "/v1/members");
    expect(r.status).toBe(200);
    expect(r.body.map((m: { user_id: string }) => m.user_id).sort()).toEqual([a.userId, a2.userId].sort());
    expect((await call(b, "GET", "/v1/members")).body.map((m: { user_id: string }) => m.user_id)).toEqual([b.userId]);
  });
});

describe("saved searches", () => {
  it("are personal, replace by name, and can only be deleted by their owner", async () => {
    const s = await call(a, "POST", "/v1/saved-searches", { name: "Recent reels", query: { tab: 1, f: { q: "", range: "30d" } } });
    expect(s.status).toBe(201);
    const again = await call(a, "POST", "/v1/saved-searches", { name: "Recent reels", query: { tab: 1, f: { q: "x" } } });
    expect(again.body.id).toBe(s.body.id);
    expect((await call(a, "GET", "/v1/saved-searches")).body).toEqual([expect.objectContaining({ name: "Recent reels", query: { tab: 1, f: { q: "x" } } })]);
    expect((await call(a2, "GET", "/v1/saved-searches")).body).toEqual([]);
    expect((await call(a2, "DELETE", `/v1/saved-searches/${s.body.id}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/saved-searches/${s.body.id}`)).status).toBe(204);
    expect((await call(a, "GET", "/v1/saved-searches")).body).toEqual([]);
  });

  it("refuse an oversized or nameless search", async () => {
    expect((await call(a, "POST", "/v1/saved-searches", { name: "", query: {} })).status).toBe(422);
    expect((await call(a, "POST", "/v1/saved-searches", { name: "big", query: { x: "y".repeat(5000) } })).status).toBe(422);
  });
});

describe("reel notes", () => {
  it("are added at a timestamp, audited, hidden from other organizations, and deleted by their author or an owner", async () => {
    const reel = await seedReel(a);
    const n = await call(a2, "POST", `/v1/reels/${reel}/notes`, { body: "Good run behind the line", at_pts_us: 12_000_000 });
    expect(n.status).toBe(201);
    expect(n.body).toMatchObject({ body: "Good run behind the line", at_pts_us: 12_000_000, author: { user_id: a2.userId } });
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id", [reel]);
    expect(audit.map((r) => r.action)).toContain("reel.note_added");
    expect((await call(b, "GET", `/v1/reels/${reel}/notes`)).status).toBe(404);
    expect((await call(b, "POST", `/v1/reels/${reel}/notes`, { body: "x" })).status).toBe(404);
    expect((await call(a, "GET", `/v1/reels/${reel}/notes`)).body).toHaveLength(1);
    expect((await call(a, "DELETE", `/v1/reels/${reel}/notes/${n.body.id}`)).status).toBe(204);    // an owner may
    expect((await call(a, "GET", `/v1/reels/${reel}/notes`)).body).toEqual([]);
  });

  it("refuse an empty or over-long note", async () => {
    const reel = await seedReel(a);
    expect((await call(a, "POST", `/v1/reels/${reel}/notes`, { body: " " })).status).toBe(422);
    expect((await call(a, "POST", `/v1/reels/${reel}/notes`, { body: "x".repeat(256) })).status).toBe(422);
  });
});

describe("created by", () => {
  it("projects and videos name the member who created them", async () => {
    const proj = await call(a2, "POST", "/v1/projects", { name: "Created-by check" });
    expect(proj.status).toBe(201);
    const list = (await call(a, "GET", "/v1/projects")).body as { id: string; created_by: string }[];
    expect(list.find((x) => x.id === proj.body.id)?.created_by).toBe(a2.userId);
    const { videoId } = await seedTracks(root, a);
    const v = (await call(a, "GET", `/v1/videos/${videoId}`)).body as { created_by: string };
    expect(v.created_by).toBe(a.userId);
  });
});

describe("video rename", () => {
  it("changes the title only, is audited, and is refused across organizations and for an empty title", async () => {
    const { videoId } = await seedTracks(root, a);
    const r = await app.inject({ method: "PATCH", url: `/v1/videos/${videoId}`, headers: a.headers, payload: { title: "  Final vs Rivals  " } });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body)).toMatchObject({ id: videoId, title: "Final vs Rivals" });
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id", [videoId]);
    expect(audit.map((x) => x.action)).toContain("video.renamed");
    expect((await app.inject({ method: "PATCH", url: `/v1/videos/${videoId}`, headers: b.headers, payload: { title: "x" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PATCH", url: `/v1/videos/${videoId}`, headers: a.headers, payload: { title: " " } })).statusCode).toBe(422);
  });
});

describe("upload limits", () => {
  it("report the server's configured limit and accepted extensions to signed-in members", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "otsi-limits-"));
    const withStorage = await startApi({ storageDir: dir, maxUploadBytes: 5_000_000 });
    try {
      const r = await withStorage.inject({ method: "GET", url: "/v1/upload-limits", headers: a.headers });
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.max_upload_bytes).toBe(5_000_000);
      expect(body.accepted_extensions).toEqual(expect.arrayContaining(["mp4", "mov", "mkv", "webm"]));
      expect((await withStorage.inject({ method: "GET", url: "/v1/upload-limits" })).statusCode).toBe(401);
    } finally {
      await withStorage.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
