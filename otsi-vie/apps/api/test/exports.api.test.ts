/**
 * Page 10 Output & Reports, Download All and Deliver to Client (ADR-058, migration 0044) through the real API and MySQL: each companion is
 * made on its own (a heatmap without measured positions is NOT_MEASURED and does not stop the others), files carry size and SHA-256 and
 * open through signed links, Download All is a real ZIP whose manifest matches the files, and a delivery is refused without sharing
 * rights (recorded as BLOCKED), made with a share link when allowed, refused twice to the same address within minutes, and refused for a
 * team member who cannot see a restricted project. Roles and other organizations are kept out.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32 } from "node:zlib";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlayerEvent, PlayerMeasures } from "@otsi-vie/contracts";
import { NO_EFFECT, NO_FX } from "@otsi-vie/contracts";
import { eventsCsv, eventsInClips, heatSvg, writeZip } from "../src/modules/exports/exports";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(process.cwd(), "../../../.local/browsers");

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member, editor: Member, viewer: Member, analyst: Member, b: Member;

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload, headers: r.headers };
}
const fetchSigned = async (url: string) => { const r = await app.inject({ method: "GET", url: url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/api/, "") }); return { status: r.statusCode, body: r.rawPayload, headers: r.headers }; };

/** a finished render of a confirmed player's reel, recorded the way the worker records it */
async function seedRender(m: Member) {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?)", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: "Export Player" }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  const reel = (await call(m, "POST", "/v1/reels", { video_id: video, player_id: player })).body;
  await call(m, "POST", `/v1/reels/${reel.id}/clips`, { in_pts_us: 1_000_000, out_pts_us: 7_000_000, origin: "SUGGESTED" });
  const render = (await call(m, "POST", `/v1/reels/${reel.id}/renders`, { codec: "h264", bitrate_mbps: 8 }, { "idempotency-key": key() })).body.id as string;
  const out = uuidv7(), man = uuidv7(), keyOut = `org/${m.orgId}/reels/${reel.id}/render.mp4`;
  await mkdir(path.join(dir, "org", m.orgId, "reels", reel.id), { recursive: true });
  await writeFile(path.join(dir, ...keyOut.split("/")), Buffer.alloc(4000, 7));
  await root.query("INSERT INTO assets (id, organization_id, kind, object_key, storage_bucket, byte_size, mime_type) VALUES (?, ?, 'REEL', ?, 'local', 4000, 'video/mp4'), (?, ?, 'MANIFEST', ?, 'local', 2, 'application/json')",
    [out, m.orgId, keyOut, man, m.orgId, `${keyOut}.json`]);
  await root.query("UPDATE render_jobs SET state = 'RUNNING' WHERE id = ?", [render]);
  await root.query("UPDATE render_jobs SET state = 'SUCCEEDED', output_asset_id = ?, manifest_asset_id = ?, completed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [out, man, render]);
  return { project, video, render, reel: reel.id as string, player };
}

/** the entries of a stored ZIP, read from its central directory */
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

let s: Awaited<ReturnType<typeof seedRender>>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-export-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  editor = await seedMember(root, "EDITOR", a.orgId);
  viewer = await seedMember(root, "VIEWER", a.orgId);
  analyst = await seedMember(root, "ANALYST", a.orgId);
  b = await seedMember(root, "OWNER");
  s = await seedRender(a);
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

describe("companions (pure)", () => {
  const ev = (kind: string, us: number, o: Partial<PlayerEvent> = {}) => ({ id: uuidv7(), video_id: "v", video_title: "V", kind, start_us: us, end_us: us + 500_000, evidence: "ball rule", key: false,
    how: null, set_piece: null, regain: null, partner_player_id: null, partner_name: null, ...o }) as PlayerEvent;
  const reel = { name: "R, one", video_id: "v", clips: [{ id: "c2", sequence_index: 1, in_pts_us: 10e6, out_pts_us: 12e6, origin: "MANUAL" as const, label: null, effect: NO_EFFECT, fx: NO_FX },
    { id: "c1", sequence_index: 0, in_pts_us: 1e6, out_pts_us: 5e6, origin: "SUGGESTED" as const, label: null, effect: NO_EFFECT, fx: NO_FX }] };
  it("events fall into the clips they happen in, in clip order; the CSV quotes and defuses formulas", () => {
    const evs = [ev("PASS", 2e6, { key: true, partner_name: "=HYPERLINK(x)" }), ev("SHOT", 11e6), ev("PASS", 30e6), ev("PASS", 2e6, { video_id: "other" })];
    const g = eventsInClips(reel, evs);
    expect(g.map((x) => [x.clip.id, x.events.length])).toEqual([["c1", 1], ["c2", 1]]);
    const csv = eventsCsv(reel, "Ann", evs);
    expect(csv.startsWith("﻿reel,player,clip")).toBe(true);
    expect(csv).toContain(`"R, one",Ann,1,1.00,5.00,Pass,2.00,2.50,yes,,"'=HYPERLINK(x)",ball rule`);
    expect(csv).toContain("Shot,11.00");
    expect(csv).not.toContain("30.00");
  });
  it("a heatmap only from measured seconds", () => {
    const m = { videos: 1, heat: { subject: { kind: "TRACK", id: "x" }, length_m: 105, width_m: 68, cols: 3, rows: 2, seconds: [0, 0, 0, 0, 0, 0], seen_s: 60, measured_s: 0, ends_as_filmed: true } } as unknown as PlayerMeasures;
    expect(heatSvg(m, "Ann")).toBeNull();
    expect(heatSvg({ ...m, heat: null } as PlayerMeasures, "Ann")).toBeNull();
    const svg = heatSvg({ ...m, heat: { ...m.heat!, seconds: [0, 4, 0, 0, 1, 0], measured_s: 5 } } as PlayerMeasures, "<Ann>")!;
    expect(svg).toContain("&lt;Ann&gt;");
    expect((svg.match(/fill="#ff5a1f"/g) ?? []).length).toBe(2);
  });
  it("writes a ZIP any reader opens", async () => {
    const f = path.join(dir, "t.zip");
    await writeZip(f, [{ name: "a.txt", data: Buffer.from("hello") }, { name: "ü.json", data: Buffer.from("{}") }]);
    const z = unzip(await (await import("node:fs/promises")).readFile(f));
    expect([...z.keys()]).toEqual(["a.txt", "ü.json"]);
    expect(z.get("a.txt")!.toString()).toBe("hello");
  });
});

describe("Output & Reports and Download All", () => {
  it("each item is made on its own; files open through signed links; the ZIP matches its manifest", async () => {
    expect((await call(viewer, "POST", `/v1/reels/${s.reel}/bundles`, { items: ["EVENTS_CSV"] })).status).toBe(403);
    expect((await call(b, "POST", `/v1/reels/${s.reel}/bundles`, { items: ["EVENTS_CSV"] })).status).toBe(404);
    expect((await call(a, "POST", `/v1/reels/${s.reel}/bundles`, { items: [] })).status).toBe(422);
    const r = await call(editor, "POST", `/v1/reels/${s.reel}/bundles`, { items: ["PERFORMANCE_PDF", "CLIP_SHEET_PDF", "EVENTS_CSV", "HEATMAP_PNG"] });
    expect(r.status).toBe(201);
    const by = Object.fromEntries((r.body.items as { kind: string }[]).map((i) => [i.kind, i])) as unknown as Record<string, { state: string; bytes: number; sha256: string; download_url: string; view_url: string; failure: string }>;
    expect(by.HEATMAP_PNG!.state).toBe("NOT_MEASURED");                    // no calibrated pitch: not a blank picture
    expect(by.HEATMAP_PNG!.download_url).toBeNull();
    for (const k of ["PERFORMANCE_PDF", "CLIP_SHEET_PDF", "EVENTS_CSV"]) expect([k, by[k]!.state]).toEqual([k, "SUCCEEDED"]);
    const pdf = await fetchSigned(by.CLIP_SHEET_PDF!.view_url);
    expect(pdf.status).toBe(200);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    expect(createHash("sha256").update(pdf.body).digest("hex")).toBe(by.CLIP_SHEET_PDF!.sha256);
    const csv = await fetchSigned(by.EVENTS_CSV!.download_url);
    expect(csv.headers["content-disposition"]).toContain("attachment; filename=\"otsi-event-list.csv\"");
    expect(csv.body.toString("utf8")).toContain("Export Player,1,1.00,7.00");
    // the viewer sees the bundle; the other organization does not
    expect((await call(viewer, "GET", `/v1/reels/${s.reel}/bundles`)).body).toHaveLength(1);
    expect((await call(b, "GET", `/v1/reels/${s.reel}/bundles`)).status).toBe(404);
    // Download All
    const z = await call(editor, "POST", `/v1/reels/${s.reel}/bundles/${r.body.id}/zip`);
    expect(z.status).toBe(200);
    const zip = await fetchSigned(z.body.zip.download_url);
    expect(zip.headers["content-type"]).toBe("application/zip");
    const files = unzip(zip.body);
    expect([...files.keys()]).toEqual(["reel.mp4", "performance-report.pdf", "clip-sheet.pdf", "event-list.csv", "manifest.json"]);
    const man = JSON.parse(files.get("manifest.json")!.toString());
    for (const f of man.files) expect([f.name, createHash("sha256").update(files.get(f.name)!).digest("hex")]).toEqual([f.name, f.sha256]);
    expect(man.not_included).toEqual([{ item: "Heatmap (PNG)", state: "NOT_MEASURED", why: by.HEATMAP_PNG!.failure }]);
    expect((await call(b, "POST", `/v1/reels/${s.reel}/bundles/${r.body.id}/zip`)).status).toBe(404);
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? AND action LIKE 'export_bundle.%' ORDER BY id", [s.reel]);
    expect(audit.map((x) => x.action)).toEqual(["export_bundle.created", "export_bundle.zipped"]);
  });

  it("a reel never rendered has no companions", async () => {
    const r2 = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player, name: "Not rendered" })).body;
    const x = await call(a, "POST", `/v1/reels/${r2.id}/bundles`, { items: ["EVENTS_CSV"] });
    expect([x.status, x.body.code]).toEqual([409, "NOT_RENDERED"]);
  });

  it("B.23: a rule-built report previews as its page before any render; nothing is saved", async () => {
    const r2 = (await call(a, "POST", "/v1/reels", { video_id: s.video, player_id: s.player, name: "Preview only" })).body;
    const count = async () => (await root.query<RowDataPacket[]>("SELECT (SELECT COUNT(*) FROM assets) AS a, (SELECT COUNT(*) FROM report_jobs) AS r"))[0][0];
    const before = await count();
    const sheet = await call(a, "GET", `/v1/reels/${r2.id}/bundles/preview/CLIP_SHEET_PDF`);
    expect([sheet.status, sheet.body.kind]).toEqual([200, "CLIP_SHEET_PDF"]);
    expect(sheet.body.html).toContain("Export Player");
    const perf = await call(viewer, "GET", `/v1/reels/${s.reel}/bundles/preview/PERFORMANCE_PDF`);
    expect([perf.status, perf.body.kind]).toEqual([200, "PERFORMANCE_PDF"]);
    expect(perf.body.html).toContain("Export Player");
    expect((await call(a, "GET", `/v1/reels/${r2.id}/bundles/preview/EVENTS_CSV`)).status).toBe(422);
    expect((await call(b, "GET", `/v1/reels/${r2.id}/bundles/preview/CLIP_SHEET_PDF`)).status).toBe(404);
    expect(await count()).toEqual(before);
  });
});

describe("Deliver to Client", () => {
  it("needs recipients, sharing rights, members who can see the project; records every attempt; refuses a quick repeat", async () => {
    const body = { notify_client: true, recipient_name: "Club Scout", recipient_email: "Scout@Example.org", message: "Here is the reel.", link: { expires_in_days: 7, can_download: false } };
    expect((await call(a, "POST", `/v1/reels/${s.reel}/deliveries`, { notify_client: false, notify_team: false })).body.code).toBe("NO_RECIPIENT");
    expect((await call(a, "POST", `/v1/reels/${s.reel}/deliveries`, { notify_client: true, recipient_email: "x@example.org" })).body.code).toBe("CLIENT_REQUIRED");
    expect((await call(a, "POST", `/v1/reels/${s.reel}/deliveries`, { ...body, recipient_email: "not-an-email" })).status).toBe(422);
    expect((await call(viewer, "POST", `/v1/reels/${s.reel}/deliveries`, body)).status).toBe(403);
    // no rights recorded: refused and recorded as BLOCKED
    const no = await call(a, "POST", `/v1/reels/${s.reel}/deliveries`, body);
    expect([no.status, no.body.code]).toEqual([409, "SHARING_NOT_ALLOWED"]);
    const listed = (await call(a, "GET", `/v1/reels/${s.reel}/deliveries`)).body;
    expect(listed[0]).toMatchObject({ state: "BLOCKED", failure: "SHARING_NOT_ALLOWED", link: null, recipient_email: "scout@example.org" });
    // rights allow sharing
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence from the league, clause 4" });
    const ok = await call(editor, "POST", `/v1/reels/${s.reel}/deliveries`, { ...body, notify_team: true, team_user_ids: [analyst.userId] });
    expect(ok.status).toBe(201);
    expect(ok.body.url).toMatch(/^\/s\/[A-Za-z0-9_-]{20,}$/);
    expect(ok.body.mail.to).toEqual(["scout@example.org"]);
    expect(ok.body.mail.bcc).toHaveLength(1);
    expect(ok.body.mail.body).toContain("Hello Club Scout");
    expect(ok.body.mail.body).toContain("Here is the reel.");
    expect(ok.body.delivery).toMatchObject({ state: "SUCCEEDED", channel: "OWN_MAIL_APP", team: [{ user_id: analyst.userId }], link: { opened: 0, revoked: false, expired: false } });
    // the link opens for the client, and the receipt counts it
    expect((await call(null, "POST", `/v1/public/share/${ok.body.url.slice(3)}/open`, {})).status).toBe(200);
    expect((await call(a, "GET", `/v1/reels/${s.reel}/deliveries`)).body[0].link.opened).toBe(1);
    // the same address again within minutes
    expect((await call(editor, "POST", `/v1/reels/${s.reel}/deliveries`, body)).body.code).toBe("DUPLICATE_DELIVERY");
    // a team member who cannot see the (now restricted) project
    expect((await call(a, "PUT", `/v1/projects/${s.project}/access`, { access: "RESTRICTED" })).status).toBe(200);
    const blind = await call(a, "POST", `/v1/reels/${s.reel}/deliveries`, { notify_team: true, team_user_ids: [analyst.userId] });
    expect([blind.status, blind.body.code]).toEqual([422, "TEAM_MEMBER_CANNOT_SEE"]);
    expect((await call(a, "POST", `/v1/reels/${s.reel}/deliveries`, { notify_team: true, team_user_ids: [b.userId] })).body.code).toBe("NOT_A_MEMBER");
    expect((await call(editor, "GET", `/v1/reels/${s.reel}/deliveries`)).status).toBe(404);           // he is not on the restricted project
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? AND action LIKE 'delivery.%' ORDER BY id", [s.reel]);
    expect(audit.map((x) => x.action)).toEqual(["delivery.blocked", "delivery.created"]);
  });
});
