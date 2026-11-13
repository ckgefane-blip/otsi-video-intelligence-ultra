/**
 * Projects and resumable uploads (Block 03) through the real HTTP stack, MySQL and real files on disk: validation, exact part sizes,
 * checksums, resume, idempotency, completion -> outbox -> exactly one ingest job, abort, tenant isolation and roles.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { ingestJobStarter } from "../src/core/outbox/subscribers";
import { appDb, key, Member, rootDb, seedMember, startApi } from "./helpers";

const MiB = 1024 * 1024;
let app: NestFastifyApplication;
let bare: NestFastifyApplication;            // the same API without storage configured
let db: Db;
let root: mysql.Connection;
let dir: string;
let a: Member;
let b: Member;
let projectA: string;

async function call(m: Member, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}, target = app) {
  const isRaw = Buffer.isBuffer(body);
  const r = await target.inject({
    method, url, headers: { ...m.headers, ...(isRaw ? { "content-type": "application/octet-stream" } : {}), ...extra },
    ...(body === undefined ? {} : { payload: isRaw ? (body as Buffer) : (body as object) }),
  });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}

const start = (m: Member, file: { name: string; size: number; project?: string; sha256?: string }, k = key()) =>
  call(m, "POST", "/v1/uploads", { project_id: file.project ?? projectA, file_name: file.name, byte_size: file.size, ...(file.sha256 ? { sha256: file.sha256 } : {}) }, { "idempotency-key": k });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-media-"));
  app = await startApi({ storageDir: dir, partBytes: MiB, maxUploadBytes: 8 * MiB, credentialKey: Buffer.alloc(32, 7).toString("base64") });
  bare = await startApi();
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
  projectA = (await call(a, "POST", "/v1/projects", { name: "Season 2026 matches" })).body.id;
});
afterAll(async () => {
  await app?.close();
  await bare?.close();
  await db?.onModuleDestroy();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await root.query("UPDATE outbox_events SET delivered_at = NOW(6), claim_token = NULL, lease_expires_at = NULL WHERE delivered_at IS NULL AND dead_lettered_at IS NULL");
});

describe("projects", () => {
  it("creates, lists, reads and edits with optimistic concurrency; audited", async () => {
    const created = await call(a, "POST", "/v1/projects", { name: "  Scouting trip  ", description: "U19 tournament" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: "Scouting trip", description: "U19 tournament", status: "ACTIVE", video_count: 0, version: 1 });
    const id = created.body.id;
    expect((await call(a, "GET", "/v1/projects")).body.map((x: { id: string }) => x.id)).toContain(id);
    const edited = await call(a, "PATCH", `/v1/projects/${id}`, { name: "Scouting trip (Lagos)", version: 1 });
    expect(edited.body).toMatchObject({ name: "Scouting trip (Lagos)", version: 2 });
    const stale = await call(a, "PATCH", `/v1/projects/${id}`, { status: "ARCHIVED", version: 1 });
    expect([stale.status, stale.body.code]).toEqual([409, "STALE_VERSION"]);
    const [aud] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? ORDER BY id", [id]);
    expect(aud.map((r) => r.action)).toEqual(["project.created", "project.updated"]);
  });

  it("are invisible to other organizations and closed to viewers", async () => {
    expect((await call(b, "GET", `/v1/projects/${projectA}`)).status).toBe(404);
    expect((await call(b, "GET", "/v1/projects")).body.map((x: { id: string }) => x.id)).not.toContain(projectA);
    const viewer = await seedMember(root, "VIEWER", a.orgId);
    expect((await call(viewer, "POST", "/v1/projects", { name: "Nope" })).body.code).toBe("ROLE_NOT_ALLOWED");
    expect((await call(viewer, "GET", `/v1/projects/${projectA}`)).status).toBe(200);
  });
});

describe("starting an upload", () => {
  it("creates a PENDING video and a session with the part plan; the same Idempotency-Key returns the same session", async () => {
    const k = key();
    const r = await start(a, { name: "Final - Lagos vs Abuja.MP4", size: 2.5 * MiB }, k);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: "INITIALIZED", part_bytes: MiB, part_count: 3, expected_bytes: 2.5 * MiB, received_parts: [] });
    const again = await start(a, { name: "Final - Lagos vs Abuja.MP4", size: 2.5 * MiB }, k);
    expect([again.status, again.body.upload_id]).toEqual([200, r.body.upload_id]);
    const other = await start(a, { name: "different.mp4", size: MiB }, k);
    expect([other.status, other.body.code]).toEqual([409, "IDEMPOTENCY_KEY_REUSED"]);
    const v = await call(a, "GET", `/v1/videos/${r.body.video_id}`);
    expect(v.body).toMatchObject({ state: "PENDING", ingest_mode: "UPLOAD", title: "Final - Lagos vs Abuja", original_filename: "Final - Lagos vs Abuja.MP4",
      duration_us: null, width: null, frame_rate: null, job: null, upload: { upload_id: r.body.upload_id, received_bytes: 0 } });
  });

  it("refuses non-video files, files over the limit, archived or foreign projects", async () => {
    expect((await start(a, { name: "report.pdf", size: MiB })).body.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect((await start(a, { name: "noextension", size: MiB })).body.code).toBe("UNSUPPORTED_FILE_TYPE");
    expect((await start(a, { name: "huge.mkv", size: 9 * MiB })).body.code).toBe("FILE_TOO_LARGE");
    expect((await start(b, { name: "x.mp4", size: MiB })).status).toBe(404);              // b cannot use a's project
    const archived = (await call(a, "POST", "/v1/projects", { name: "Old season" })).body;
    await call(a, "PATCH", `/v1/projects/${archived.id}`, { status: "ARCHIVED", version: 1 });
    expect((await start(a, { name: "x.mp4", size: MiB, project: archived.id })).body.code).toBe("PROJECT_ARCHIVED");
    expect((await call(a, "POST", "/v1/uploads", { project_id: projectA, file_name: "x.mp4", byte_size: MiB })).body.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  it("says plainly when storage is not configured", async () => {
    const r = await call(a, "POST", "/v1/uploads", { project_id: projectA, file_name: "x.mp4", byte_size: MiB }, { "idempotency-key": key() }, bare);
    expect([r.status, r.body.code]).toEqual([503, "STORAGE_NOT_CONFIGURED"]);
  });
});

describe("parts, resume and completion", () => {
  it("stores exact-size parts, refuses wrong sizes and damaged parts, and resumes from what arrived", async () => {
    const file = randomBytes(2.5 * MiB);
    const s = (await start(a, { name: "match.mp4", size: file.length })).body;
    const part = (n: number) => file.subarray((n - 1) * MiB, Math.min(n * MiB, file.length));
    const put = (n: number, data: Buffer, extra: Record<string, string> = {}) => call(a, "PUT", `/v1/uploads/${s.upload_id}/parts/${n}`, data, extra);

    expect((await put(1, part(1).subarray(0, 1000))).body.code).toBe("PART_SIZE_MISMATCH");
    expect((await put(3, Buffer.concat([part(3), Buffer.alloc(10)]))).body.code).toBe("PART_TOO_LARGE");
    expect((await put(4, part(3))).body.code).toBe("INVALID_PART");
    expect((await put(1, part(1), { "x-part-sha256": "0".repeat(64) })).body.code).toBe("PART_CHECKSUM_MISMATCH");
    const wrongType = await app.inject({ method: "PUT", url: `/v1/uploads/${s.upload_id}/parts/1`, headers: { ...a.headers, "content-type": "application/json" }, payload: {} });
    expect(JSON.parse(wrongType.body).code).toBe("OCTET_STREAM_REQUIRED");

    const ok1 = await put(1, part(1), { "x-part-sha256": createHash("sha256").update(part(1)).digest("hex") });
    expect(ok1.body).toEqual({ part_number: 1, bytes: MiB, sha256: createHash("sha256").update(part(1)).digest("hex") });
    expect((await put(3, part(3))).status).toBe(200);
    const resumed = await call(a, "GET", `/v1/uploads/${s.upload_id}`);
    expect(resumed.body).toMatchObject({ status: "UPLOADING", received_parts: [1, 3] });
    const early = await call(a, "POST", `/v1/uploads/${s.upload_id}/complete`);
    expect([early.status, early.body.code, early.body.message]).toEqual([409, "UPLOAD_INCOMPLETE", "Missing parts: 2."]);
    expect((await put(2, part(2))).status).toBe(200);
    expect((await put(2, part(2))).status).toBe(200);                                        // re-sending a part is harmless

    const files = (await readdir(path.join(dir, "uploads", s.upload_id))).sort();
    expect(files).toEqual(["part-000001", "part-000002", "part-000003"]);                     // no temp files left behind
    const stored = Buffer.concat(await Promise.all(files.map((f) => readFile(path.join(dir, "uploads", s.upload_id, f)))));
    expect(stored.equals(file)).toBe(true);

    const done = await call(a, "POST", `/v1/uploads/${s.upload_id}/complete`);
    expect(done.body).toMatchObject({ id: s.video_id, state: "VALIDATING", upload: null });
    expect((await call(a, "POST", `/v1/uploads/${s.upload_id}/complete`)).status).toBe(200);     // idempotent
    expect((await put(1, part(1))).body.code).toBe("UPLOAD_NOT_OPEN");
    const [ev] = await root.query<RowDataPacket[]>("SELECT event_type FROM outbox_events WHERE aggregate_id = ? ORDER BY id", [s.video_id]);
    expect(ev.map((r) => r.event_type)).toEqual(["video.upload_started", "video.upload_completed"]);
  });

  it("turns a completed upload into exactly one ingest job, even when two dispatchers race", async () => {
    const file = randomBytes(MiB);
    const s = (await start(a, { name: "short.mov", size: file.length })).body;
    await call(a, "PUT", `/v1/uploads/${s.upload_id}/parts/1`, file);
    await call(a, "POST", `/v1/uploads/${s.upload_id}/complete`);
    const d1 = new OutboxDispatcher(db, [ingestJobStarter()]), d2 = new OutboxDispatcher(db, [ingestJobStarter()]);
    // events of one video are delivered in order (upload_started, then upload_completed): race both dispatchers until idle
    const drain = async (d: OutboxDispatcher) => { for (let i = 0; i < 10; i++) if ((await d.runOnce()).claimed === 0) return; };
    await Promise.all([drain(d1), drain(d2)]);
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, state, subject_type, organization_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.upload_id')) AS u FROM worker_jobs WHERE subject_id = ?", [s.video_id]);
    expect(jobs).toEqual([{ kind: "INGEST_UPLOAD", state: "QUEUED", subject_type: "video", organization_id: a.orgId, u: s.upload_id }]);
    const v = await call(a, "GET", `/v1/videos/${s.video_id}`);
    expect(v.body.job).toEqual({ kind: "INGEST_UPLOAD", state: "QUEUED", progress: 0, stage_message: null, error_code: null });
  });

  it("aborts: the video is marked as cancelled (with the reason) and the parts are deleted", async () => {
    const s = (await start(a, { name: "wrong-file.mp4", size: MiB })).body;
    await call(a, "PUT", `/v1/uploads/${s.upload_id}/parts/1`, randomBytes(MiB));
    expect((await call(a, "DELETE", `/v1/uploads/${s.upload_id}`)).status).toBe(204);
    const v = await call(a, "GET", `/v1/videos/${s.video_id}`);
    expect(v.body).toMatchObject({ state: "FAILED", failure_code: "UPLOAD_ABORTED" });
    await expect(readdir(path.join(dir, "uploads", s.upload_id))).rejects.toThrow();
  });
});

describe("isolation", () => {
  it("never shows or accepts another organization's upload or video", async () => {
    const s = (await start(a, { name: "private.mp4", size: MiB })).body;
    expect((await call(b, "GET", `/v1/uploads/${s.upload_id}`)).status).toBe(404);
    expect((await call(b, "PUT", `/v1/uploads/${s.upload_id}/parts/1`, randomBytes(MiB))).status).toBe(404);
    expect((await call(b, "POST", `/v1/uploads/${s.upload_id}/complete`)).status).toBe(404);
    expect((await call(b, "GET", `/v1/videos/${s.video_id}`)).status).toBe(404);
    expect((await call(b, "GET", "/v1/videos")).body.map((v: { id: string }) => v.id)).not.toContain(s.video_id);
    expect((await call(a, "GET", `/v1/videos/${s.video_id}/thumbnail`)).status).toBe(404);           // nothing probed: no thumbnail
    const viewer = await seedMember(root, "VIEWER", a.orgId);
    expect((await call(viewer, "PUT", `/v1/uploads/${s.upload_id}/parts/1`, randomBytes(MiB))).body.code).toBe("ROLE_NOT_ALLOWED");
  });
});

describe("link imports", () => {
  const imp = (m: Member, url: string, k = key()) => call(m, "POST", "/v1/imports", { project_id: projectA, url }, { "idempotency-key": k });

  it("refuses token-less Vimeo/Drive, local or private addresses, other schemes and embedded credentials at once", async () => {
    for (const [url, code] of [
      ["https://vimeo.com/123456", "AUTH_REQUIRED"], ["https://drive.google.com/file/d/abcdefghijk/view", "AUTH_REQUIRED"],
      ["http://127.0.0.1/a.mp4", "BLOCKED_DESTINATION"], ["http://169.254.169.254/latest", "BLOCKED_DESTINATION"], ["http://[::1]/a.mp4", "BLOCKED_DESTINATION"],
      ["http://nas.local/a.mp4", "BLOCKED_DESTINATION"], ["http://localhost:8080/a.mp4", "BLOCKED_DESTINATION"],
      ["ftp://files.example.com/a.mp4", "INVALID_URL"], ["https://u:p@media.example.com/a.mp4", "INVALID_URL"], ["not a link at all", "INVALID_URL"],
    ] as const) {
      const r = await imp(a, url);
      expect([r.status, r.body.code], url).toEqual([422, code]);
    }
  });

  it("records the import (without the link's secret query), idempotently, and the subscriber queues one download job", async () => {
    const k = key();
    const r = await imp(a, "https://media.example.com/matches/Final%202026.mp4?X-Amz-Signature=secret123", k);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ state: "VALIDATING", ingest_mode: "DIRECT_URL", source_uri: "https://media.example.com/matches/Final%202026.mp4",
      original_filename: "Final 2026.mp4", title: "Final 2026", duration_us: null });
    expect(JSON.stringify(r.body)).not.toContain("secret123");
    // a link ending in a file id, not a file name, is never used as the title (v3 Phase 0, P10)
    const id = await imp(a, "https://cdn.example.com/v/0OMlDjg6NUvw0TVkOVYFQQ");
    expect(id.body).toMatchObject({ title: "Imported video · cdn.example.com", original_filename: "Imported video · cdn.example.com" });
    expect((await imp(a, "https://media.example.com/matches/Final%202026.mp4?X-Amz-Signature=secret123", k)).body.id).toBe(r.body.id);
    const d = new OutboxDispatcher(db, [ingestJobStarter()]);
    for (let i = 0; i < 5; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT kind, state, max_attempts, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.url')) AS url FROM worker_jobs WHERE subject_id = ?", [r.body.id]);
    expect(jobs).toEqual([{ kind: "INGEST_URL", state: "QUEUED", max_attempts: 5, url: "https://media.example.com/matches/Final%202026.mp4?X-Amz-Signature=secret123" }]);
    expect((await call(b, "GET", `/v1/videos/${r.body.id}`)).status).toBe(404);
    const viewer = await seedMember(root, "VIEWER", a.orgId);
    expect((await call(viewer, "POST", "/v1/imports", { project_id: projectA, url: "https://media.example.com/x.mp4" }, { "idempotency-key": key() })).body.code).toBe("ROLE_NOT_ALLOWED");
  });
});


describe("provider imports", () => {
  it("publish the import policy: what works, what needs the user's authorization, what is refused and the alternative", async () => {
    const r = await call(a, "GET", "/v1/import-providers");
    const byId = Object.fromEntries(r.body.map((p: { id: string }) => [p.id, p]));
    // owner 2026-11-13 (ADR-145): video sites are accepted through the extractor, YouTube and VK included
    expect(byId.youtube).toMatchObject({ status: "supported", via: "extractor" });
    expect(byId.vk).toMatchObject({ status: "supported", via: "extractor" });
    expect(r.body.filter((p: { status: string }) => p.status === "unsupported")).toEqual([]);
    expect(byId.vimeo.status).toBe("needs_authorization");
    expect(byId.wikimedia.status).toBe("supported");
    expect(r.body[0].hosts).toBeUndefined();
  });

  it("seal a user's access token into the job only, bound to the video, and scrub it from the event history", async () => {
    const r = await call(a, "POST", "/v1/imports", { project_id: projectA, url: "https://vimeo.com/123456789", access_token: "vimeo-personal-token-1234" }, { "idempotency-key": key() });
    expect(r.status).toBe(201);
    expect(r.body.ingest_mode).toBe("AUTHORIZED_PROVIDER");
    const d = new OutboxDispatcher(db, [ingestJobStarter()]);
    for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
    const [jobs] = await root.query<RowDataPacket[]>("SELECT JSON_EXTRACT(payload, '$.credential') AS c FROM worker_jobs WHERE subject_id = ?", [r.body.id]);
    const sealed = typeof jobs[0]!.c === "string" ? JSON.parse(jobs[0]!.c) : jobs[0]!.c;
    expect(sealed).toMatchObject({ v: 1, iv: expect.any(String), ct: expect.any(String) });
    const [all] = await root.query<RowDataPacket[]>("SELECT CAST(payload AS CHAR) AS j FROM worker_jobs WHERE subject_id = ?", [r.body.id]);
    expect(all[0]!.j).not.toContain("vimeo-personal-token-1234");                               // never in clear
    const [ev] = await root.query<RowDataPacket[]>("SELECT JSON_EXTRACT(event_payload, '$.credential') AS c FROM outbox_events WHERE aggregate_id = ? AND event_type = 'video.import_requested'", [r.body.id]);
    expect(ev[0]!.c).toBeNull();                                                                   // not kept in the event history
    const [aud] = await root.query<RowDataPacket[]>("SELECT CAST(after_state AS CHAR) AS j FROM audit_events WHERE entity_id = ? AND action = 'video.import_requested'", [r.body.id]);
    expect(aud[0]!.j).toContain('"user_authorization": true');
    expect(aud[0]!.j).not.toContain("vimeo-personal-token");
  });
});
