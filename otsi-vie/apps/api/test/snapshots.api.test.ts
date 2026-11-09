/**
 * B.5 (ADR-083, migration 0054): snapshots through the real API and MySQL: asked for by writers when the video's rights allow PRODUCE,
 * queued as a SNAPSHOT job, served as a PNG (to save, with the video's name and time) once the worker has made it, removed by the person who
 * made it or an owner/admin; viewers read; another organization sees nothing.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { snapshotFileName } from "@otsi-vie/contracts";
import { Member, rootDb, seedMember, seedRights, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let owner: Member, analyst: Member, viewer: Member, other: Member;

async function call(m: Member, method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, headers: r.headers, raw: r.rawPayload, body: r.body && r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : null };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(process.env.TEMP ?? tmpdir(), "snap-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  owner = await seedMember(root, "OWNER");
  analyst = await seedMember(root, "ANALYST", owner.orgId);
  viewer = await seedMember(root, "VIEWER", owner.orgId);
  other = await seedMember(root, "OWNER");
});
/** a seeded video made verified: a source file, measured streams */
async function verified(m: Member, n: number, title = "Cup final") {
  const s = await seedTracks(root, m, n);
  const [[v]] = await root.query<mysql.RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [s.videoId]);
  const asset = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 2048)",
    [asset, m.orgId, v!.project_id, `org/${m.orgId}/videos/${s.videoId}/source.mp4`]);
  await root.query(`UPDATE video_sources SET title = ?, state = 'INGESTED', source_asset_id = ?, duration_us = 60000000, width = 1280, height = 720,
                    avg_frame_rate_num = 25, avg_frame_rate_den = 1, container_format = 'mp4', video_codec = 'h264' WHERE id = ?`, [title, asset, s.videoId]);
  return s;
}

afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("snapshotFileName", () => {
  it("names the file after the video and the frame's time", () => {
    expect(snapshotFileName("Cup final.mp4", 3_725_400_000)).toBe("Cup final 1h02m05s.png");
    expect(snapshotFileName("<>", 0)).toBe("video 0h00m00s.png");
  });
});

describe("snapshots (B.5)", () => {
  it("queues a snapshot job, serves the PNG once made, and keeps it inside the organization", async () => {
    const s = await verified(owner, 1);
    const s2 = await seedTracks(root, owner, 1);
    const url = `/v1/videos/${s.videoId}/snapshots`;
    // rights first: none recorded, then no PRODUCE
    expect((await call(analyst, "POST", url, { at_pts_us: 1_000_000 })).body.code).toBe("SNAPSHOT_NOT_ALLOWED");
    await seedRights(root, owner.orgId, s.videoId, ["VIEW"]);
    expect((await call(analyst, "POST", url, { at_pts_us: 1_000_000 })).body.message).toMatch(/do not allow making pictures/);
    await seedRights(root, owner.orgId, s.videoId);
    expect((await call(viewer, "POST", url, { at_pts_us: 1_000_000 })).status).toBe(403);
    expect((await call(analyst, "POST", url, { at_pts_us: 70_000_000 })).body.code).toBe("SNAPSHOT_OUTSIDE_VIDEO");
    expect((await call(analyst, "POST", url, { at_pts_us: 1_000_000, overlays: { boxes: true, selected_track_id: s2.trackIds[0] } })).body.code).toBe("TRACK_NOT_IN_VIDEO");
    const made = await call(analyst, "POST", url, { at_pts_us: 5_000_000, overlays: { boxes: true, labels: true, selected_track_id: s.trackIds[0] } });
    expect(made.status).toBe(202);
    expect(made.body).toMatchObject({ status: "QUEUED", pts_us: 5_000_000, overlays: { boxes: true, labels: true, selected_track_id: s.trackIds[0], caption: true }, requested_by: { user_id: analyst.userId } });
    const id = made.body.id as string;
    const [[audit]] = await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM audit_events WHERE action = 'video.snapshot_requested' AND entity_id = ?", [s.videoId]);
    expect(Number(audit!.n)).toBe(1);
    const [[ev]] = await root.query<mysql.RowDataPacket[]>("SELECT COUNT(*) AS n FROM outbox_events WHERE event_type = 'video.snapshot_requested' AND JSON_UNQUOTE(JSON_EXTRACT(event_payload, '$.snapshot_id')) = ?", [id]);
    expect(Number(ev!.n)).toBe(1);
    expect((await call(viewer, "GET", `/v1/snapshots/${id}/image`)).body.code).toBe("SNAPSHOT_NOT_READY");
    expect((await call(analyst, "DELETE", `/v1/snapshots/${id}`)).body.code).toBe("SNAPSHOT_BEING_MADE");
    // the worker's part, as it leaves it
    const asset = uuidv7(), key = `org/${owner.orgId}/videos/${s.videoId}/snapshots/${id}.png`;
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");
    await mkdir(path.dirname(path.join(dir, key)), { recursive: true });
    await writeFile(path.join(dir, key), png);
    await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'SNAPSHOT', ?, 'local', ?, 'image/png')",
      [asset, owner.orgId, key, png.length]);
    await root.query("UPDATE snapshots SET status = 'SUCCEEDED', asset_id = ?, frame_pts_us = 5000000, width = 1, height = 1, boxes_drawn = 0, finished_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [asset, id]);
    const list = (await call(viewer, "GET", url)).body;
    expect(list.map((x: { id: string; status: string }) => [x.id, x.status])).toEqual([[id, "SUCCEEDED"]]);
    const img = await call(viewer, "GET", `/v1/snapshots/${id}/image?download=1`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(img.raw, png)).toBe(0);
    expect(String(img.headers["content-disposition"])).toContain(encodeURIComponent("Cup final 0h00m05s.png"));
    // another organization
    expect((await call(other, "GET", `/v1/snapshots/${id}`)).status).toBe(404);
    expect((await call(other, "GET", `/v1/snapshots/${id}/image`)).status).toBe(404);
    expect((await call(other, "GET", url)).status).toBe(404);
    // removal: not by another member, by an owner; then gone
    const analyst2 = await seedMember(root, "ANALYST", owner.orgId);
    expect((await call(analyst2, "DELETE", `/v1/snapshots/${id}`)).body.code).toBe("NOT_YOUR_SNAPSHOT");
    expect((await call(owner, "DELETE", `/v1/snapshots/${id}`)).status).toBe(204);
    expect((await call(viewer, "GET", url)).body).toEqual([]);
    expect((await call(viewer, "GET", `/v1/snapshots/${id}`)).status).toBe(404);
  });

  it("limits how many snapshots one person has waiting", async () => {
    const s = await verified(owner, 0);
    await seedRights(root, owner.orgId, s.videoId);
    for (let i = 0; i < 5; i++) expect((await call(owner, "POST", `/v1/videos/${s.videoId}/snapshots`, { at_pts_us: i })).status).toBe(202);
    expect((await call(owner, "POST", `/v1/videos/${s.videoId}/snapshots`, { at_pts_us: 9 })).body.code).toBe("TOO_MANY_SNAPSHOTS");
  });
});
