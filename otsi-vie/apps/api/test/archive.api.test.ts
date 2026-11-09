/**
 * v3 Phase C.4 (ADR-104, migration 0060): Archive bundle (`otsi-archive/v1`) with manifest and audit extract;
 * rights (`archive-v1`) are checked at pack time and re-checked at every open or download (`policy_decisions`).
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member, editor: Member, viewer: Member, b: Member;

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload, headers: r.headers };
}

function unzip(buf: Buffer): Map<string, Buffer> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const n = buf.readUInt16LE(end + 10), cd = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0, at = cd; i < n; i++) {
    expect(buf.readUInt32LE(at)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(at + 16), size = buf.readUInt32LE(at + 24), nl = buf.readUInt16LE(at + 28), off = buf.readUInt32LE(at + 42);
    const name = buf.subarray(at + 46, at + 46 + nl).toString("utf8");
    const lnl = buf.readUInt16LE(off + 26), data = buf.subarray(off + 30 + lnl, off + 30 + lnl + size);
    expect(crc32(data) >>> 0).toBe(crc);
    out.set(name, Buffer.from(data));
    at += 46 + nl;
  }
  return out;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function seedFixture(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'Archive Project', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size, sha256) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 2048, ?)",
    [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`, "aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff66667777888899990000"]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, title, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'NPFL Final Feed', 'UPLOAD', 'INGESTED', 60000000, ?, ?)",
    [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 10, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Archive Captain" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player, basis: "JERSEY_NUMBER" });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player, name: "Captain — Archive Reel" })).body.id as string;
  await call(m, "POST", `/v1/reels/${reel}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED", label: "Captain goal" });

  // Seed a finished MP4 render on disk so the reel archive includes reel.mp4 too
  const render = (await call(m, "POST", `/v1/reels/${reel}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
  const out = uuidv7(), man = uuidv7(), keyOut = `org/${m.orgId}/reels/${reel}/render.mp4`;
  await mkdir(path.join(dir, "org", m.orgId, "reels", reel), { recursive: true });
  await writeFile(path.join(dir, ...keyOut.split("/")), Buffer.alloc(1024, 9));
  await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 1024, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
    [out, m.orgId, keyOut, man, m.orgId, `${keyOut}.json`]);
  await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [render]);
  await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, render]);

  const home = (await call(m, "POST", "/v1/clubs", { name: "Archive Home FC" })).body.id as string;
  const away = (await call(m, "POST", "/v1/clubs", { name: "Archive Away FC" })).body.id as string;
  const match = (await call(m, "POST", "/v1/matches", { home_club_id: home, away_club_id: away, competition: "NPFL" })).body.id as string;
  return { project, video, track, player, reel, match };
}

let f: Awaited<ReturnType<typeof seedFixture>>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-archive-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  editor = await seedMember(root, "EDITOR", a.orgId);
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
  f = await seedFixture(a);
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("Archive bundle: manifest, audit extract, and pack/open rights re-checks (C.4)", () => {
  let reelArchiveId: string;

  it("refuses packing when rights are unrecorded and records a DENY policy decision", async () => {
    const st = await call(viewer, "GET", `/v1/archives/status?subject_kind=REEL&subject_id=${f.reel}`);
    expect(st.status).toBe(200);
    expect(st.body.rights_now.allowed).toBe(false);
    expect(st.body.rights_now.reason_codes).toEqual(["NO_RIGHTS_RECORDED"]);

    // Viewer cannot POST /v1/archives (403)
    expect((await call(viewer, "POST", "/v1/archives", { subject_kind: "REEL", subject_id: f.reel })).status).toBe(403);

    // Editor attempts to pack -> 409 ARCHIVE_RIGHTS_BLOCKED, recorded in policy_decisions + audit_events
    const denied = await call(editor, "POST", "/v1/archives", { subject_kind: "REEL", subject_id: f.reel });
    expect(denied.status).toBe(409);
    expect(denied.body.code).toBe("ARCHIVE_RIGHTS_BLOCKED");

    const [pds] = await root.query<RowDataPacket[]>(
      "SELECT action, decision, rule_version, reason_codes FROM policy_decisions WHERE organization_id = ? AND resource_id = ? ORDER BY checked_at DESC LIMIT 1",
      [a.orgId, f.reel]);
    expect(pds[0]).toMatchObject({ action: "PRODUCE", decision: "DENY", rule_version: "archive-v1" });
  });

  it("packs a valid ZIP archive once rights allow PRODUCE, including manifest.json, audit-extract.json, .otsi-reel, .otio, and reel.mp4", async () => {
    await call(a, "POST", `/v1/videos/${f.video}/rights`, {
      rights_state: "INTERNAL",
      allowed_uses: ["VIEW", "ANALYZE", "PRODUCE"],
      guardian_consent_state: "VERIFIED",
      reason: "club internal archive agreement",
    });

    const packed = await call(editor, "POST", "/v1/archives", { subject_kind: "REEL", subject_id: f.reel });
    expect(packed.status).toBe(201);
    reelArchiveId = packed.body.id as string;
    expect(packed.body.manifest.schema).toBe("otsi-archive/v1");
    expect(packed.body.manifest.rights_at_pack.allowed).toBe(true);
    expect(packed.body.manifest.videos[0]).toMatchObject({
      video_id: f.video,
      title: "NPFL Final Feed",
      analysed: true,
      tracks: 1,
      confirmed_tracks: 1,
    });
    expect(packed.body.manifest.reel_interchange.manifest.schema).toBe("otsi-reel/v1");
    expect(packed.body.manifest.reel_interchange.otio.OTIO_SCHEMA).toBe("Timeline.1");
    expect(packed.body.audit_extract.length).toBeGreaterThanOrEqual(4);
    expect(packed.body.audit_extract.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(["track.identity_decided", "reel.created", "reel.clip_added", "video.rights_recorded"]),
    );

    // Download the ZIP and verify every entry's SHA-256 and contents against manifest.json
    const dl = await call(viewer, "GET", `/v1/archives/${reelArchiveId}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers["content-disposition"]).toContain(".otsi-archive.zip");
    const zipBuf = dl.body as Buffer;
    expect(sha256(zipBuf)).toBe(packed.body.sha256);

    const entries = unzip(zipBuf);
    expect([...entries.keys()].sort()).toEqual(["audit-extract.json", "manifest.json", "reel.mp4", "reel.otsi-reel", "timeline.otio"]);
    const man = JSON.parse(entries.get("manifest.json")!.toString("utf8"));
    expect(man.schema).toBe("otsi-archive/v1");
    for (const fileEntry of man.files) {
      const data = entries.get(fileEntry.name)!;
      expect(data.length).toBe(fileEntry.bytes);
      expect(sha256(data)).toBe(fileEntry.sha256);
    }
  });

  it("re-checks rights at every open and download, blocking when rights are withdrawn or identities become stale", async () => {
    // 1. Withdraw PRODUCE rights (record ANALYSIS_ONLY with only VIEW/ANALYZE)
    await call(a, "POST", `/v1/videos/${f.video}/rights`, {
      rights_state: "ANALYSIS_ONLY",
      allowed_uses: ["VIEW", "ANALYZE"],
      guardian_consent_state: "VERIFIED",
      reason: "guardian requested pause on production",
    });

    // Status reflects that the existing archive is now blocked
    const st = (await call(viewer, "GET", `/v1/archives/status?subject_kind=REEL&subject_id=${f.reel}`)).body;
    expect(st.rights_now.allowed).toBe(false);
    expect(st.archives[0].rights_now.allowed).toBe(false);
    expect(st.archives[0].download_url).toBeNull();

    // Opening and downloading the already-packed archive both fail with 409 ARCHIVE_RIGHTS_BLOCKED
    const openDenied = await call(viewer, "GET", `/v1/archives/${reelArchiveId}`);
    expect(openDenied.status).toBe(409);
    expect(openDenied.body.code).toBe("ARCHIVE_RIGHTS_BLOCKED");

    const dlDenied = await call(viewer, "GET", `/v1/archives/${reelArchiveId}/download`);
    expect(dlDenied.status).toBe(409);
    expect(dlDenied.body.code).toBe("ARCHIVE_RIGHTS_BLOCKED");

    // Verify both VIEW (open) and DOWNLOAD DENY decisions were recorded in policy_decisions
    const [decisions] = await root.query<RowDataPacket[]>(
      "SELECT action, decision FROM policy_decisions WHERE organization_id = ? AND resource_id = ? ORDER BY checked_at DESC LIMIT 2",
      [a.orgId, reelArchiveId]);
    expect(decisions.map((d) => `${d.action}:${d.decision}`).sort()).toEqual(["DOWNLOAD:DENY", "VIEW:DENY"]);

    // 2. Restore PRODUCE rights -> opening succeeds again and records ARCHIVE_OPEN:ALLOW
    await call(a, "POST", `/v1/videos/${f.video}/rights`, {
      rights_state: "EXPORT_ALLOWED",
      allowed_uses: ["VIEW", "ANALYZE", "PRODUCE", "EXPORT"],
      guardian_consent_state: "VERIFIED",
      reason: "consent re-confirmed",
    });
    const openOk = await call(viewer, "GET", `/v1/archives/${reelArchiveId}`);
    expect(openOk.status).toBe(200);
    expect(openOk.body.rights_now.allowed).toBe(true);
  });

  it("supports Match and Video archives, refuses empty matches, and enforces tenant and restricted-project isolation", async () => {
    // Match with no linked videos is refused with NO_VIDEOS_IN_MATCH
    const emptyMatch = await call(editor, "POST", "/v1/archives", { subject_kind: "MATCH", subject_id: f.match });
    expect(emptyMatch.status).toBe(409);
    expect(emptyMatch.body.code).toBe("ARCHIVE_RIGHTS_BLOCKED");

    // Link the video to the match -> Match and Video archives both pack cleanly
    await call(editor, "POST", `/v1/videos/${f.video}/match`, { match_id: f.match });
    const matchArch = await call(editor, "POST", "/v1/archives", { subject_kind: "MATCH", subject_id: f.match });
    expect(matchArch.status).toBe(201);
    expect(matchArch.body.manifest.subject.kind).toBe("MATCH");
    expect(matchArch.body.manifest.videos).toHaveLength(1);

    const videoArch = await call(editor, "POST", "/v1/archives", { subject_kind: "VIDEO", subject_id: f.video });
    expect(videoArch.status).toBe(201);
    expect(videoArch.body.manifest.subject.kind).toBe("VIDEO");

    // Another organization gets 404 on status, open, download, and pack
    expect((await call(b, "GET", `/v1/archives/status?subject_kind=REEL&subject_id=${f.reel}`)).status).toBe(404);
    expect((await call(b, "GET", `/v1/archives/${reelArchiveId}`)).status).toBe(404);
    expect((await call(b, "GET", `/v1/archives/${reelArchiveId}/download`)).status).toBe(404);
    expect((await call(b, "POST", "/v1/archives", { subject_kind: "REEL", subject_id: f.reel })).status).toBe(404);

    // Restricting the project hides the archive from an editor not on the project ACL
    await call(a, "PUT", `/v1/projects/${f.project}/access`, { access: "RESTRICTED" });
    expect((await call(editor, "GET", `/v1/archives/${reelArchiveId}`)).status).toBe(404);
    expect((await call(editor, "GET", `/v1/archives/status?subject_kind=REEL&subject_id=${f.reel}`)).status).toBe(404);
    expect((await call(a, "GET", `/v1/archives/${reelArchiveId}`)).status).toBe(200);
  });
});
