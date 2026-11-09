/**
 * Player Report T rows through the real API and MySQL (ADR-056, migration 0042): notes and tags, the assessment (draft, publish, stale
 * version, withdraw), scouting dossiers, the comparison and the sentences from measured values (pure rules and the routes), and the PDF
 * report made by the local headless Chromium, downloaded through a signed URL and shared only when every source video's rights allow it.
 * Roles and other organizations are kept out everywhere.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlayerMeasures } from "@otsi-vie/contracts";
import { centralShare, compare, insightsOf, lineOf, rates } from "../src/modules/playerreport/playerreport";
import { key, Member, rootDb, seedMember, startApi } from "./helpers";

// the local headless Chromium that prints the PDF (installed under the repository's .local, nothing on C:)
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.resolve(process.cwd(), "../../../.local/browsers");

let app: NestFastifyApplication;
let root: mysql.Connection;
let dir: string;
let a: Member, editor: Member, viewer: Member, b: Member;

async function call(m: Member | null, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...(m?.headers ?? {}), ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.headers["content-type"]?.toString().includes("json") ? JSON.parse(r.body) : r.rawPayload, headers: r.headers };
}

/** a player with one confirmed track seen at 2-6 s in one video */
async function seedPlayer(m: Member, name = "Report Player") {
  const project = uuidv7(), video = uuidv7(), run = uuidv7(), source = uuidv7(), shot = uuidv7(), track = uuidv7();
  await root.query("INSERT INTO projects (id, organization_id, name, created_by) VALUES (?, ?, 'P', ?)", [project, m.orgId, m.userId]);
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 1)", [source, m.orgId, project, `org/${m.orgId}/videos/${video}/source.mp4`]);
  await root.query("INSERT INTO video_sources (id, organization_id, project_id, ingest_mode, state, duration_us, created_by, source_asset_id, title) VALUES (?, ?, ?, 'UPLOAD', 'INGESTED', 60000000, ?, ?, 'Match')", [video, m.orgId, project, m.userId, source]);
  await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, finished_at) VALUES (?, ?, ?, 't', 'SUCCEEDED', CURRENT_TIMESTAMP(6))", [run, video, m.orgId]);
  await root.query("INSERT INTO video_shots (id, video_id, run_id, shot_number, start_pts_us, end_pts_us) VALUES (?, ?, ?, 1, 0, 60000000)", [shot, video, run]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT IGNORE INTO video_frame_index (video_id, frame_index, pts_us) VALUES (?, ?, ?)", [video, s * 25, s * 1_000_000]);
  await root.query(`INSERT INTO tracks (id, run_id, video_id, shot_id, internal_track_number, class_name, first_pts_us, last_pts_us, status, observation_count) VALUES (?, ?, ?, ?, 1, 'PERSON', 2000000, 6000000, 'ENDED', 5)`, [track, run, video, shot]);
  for (const s of [2, 3, 4, 5, 6]) await root.query("INSERT INTO track_observations (video_id, frame_index, track_id, pts_us, bbox_x, bbox_y, bbox_w, bbox_h, detector_confidence, observation_state) VALUES (?, ?, ?, ?, 0.4, 0.4, 0.05, 0.15, 0.9, 'DETECTED')", [video, s * 25, track, s * 1_000_000]);
  const player = (await call(m, "POST", "/v1/players", { display_name: name }, { "idempotency-key": key() })).body.player_id as string;
  await call(m, "POST", `/v1/tracks/${track}/identity-decisions`, { state: "CONFIRMED", player_id: player });
  return { video, player };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-report-"));
  app = await startApi({ storageDir: dir });
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  editor = await seedMember(root, "EDITOR", a.orgId);
  viewer = await seedMember(root, "VIEWER", a.orgId);
  b = await seedMember(root, "OWNER");
});
afterAll(async () => { await app?.close(); await root?.end(); await rm(dir, { recursive: true, force: true }); });

const M = (o: Partial<PlayerMeasures>): PlayerMeasures => ({ player_id: uuidv7(), tracks: 1, videos: 1, seen_s: 0, measured_s: 0, distance_m: null, top_speed_kmh: null, dropped_steps: 0,
  high_speed_m: null, sprint_m: null, sprints: 0, mean_confidence: null, heat: null, events: null, half: null, ...o }) as PlayerMeasures;

describe("comparison and sentences (pure rules)", () => {
  it("rates per 90 seen, a group without short appearances, sentences only from what was measured", () => {
    const ev = (p: number, k: number, w: number) => ({ passes: p, key_passes: k, passes_received: 3, balls_won: w, pressures: 2, shots: 0, videos: 1 });
    const him = M({ seen_s: 2700, measured_s: 1800, distance_m: 3000, top_speed_kmh: 30.1, events: ev(20, 2, 4), sprints: 5, sprint_m: 120 });
    expect(rates(him)).toEqual({ passes_p90: 40, key_passes_p90: 4, balls_won_p90: 8, distance_p90: 9000, top_speed: 30.1 });
    const c = compare("MID", ["MID", "ALL"], him, [M({ seen_s: 5400, events: ev(30, 1, 2), top_speed_kmh: 28 }), M({ seen_s: 600, events: ev(99, 9, 9), top_speed_kmh: 35 })]);
    expect(c).toMatchObject({ group: "MID", group_name: "Midfielders", n: 1, player_below_minimum: false });
    expect(c.metrics.find((x) => x.key === "passes_p90")).toMatchObject({ player: 40, group_mean: 30, group_n: 1, max: 40 });
    expect(c.metrics.find((x) => x.key === "distance_p90")).toMatchObject({ player: 9000, group_mean: null, group_n: 0 });
    expect(compare("ALL", ["ALL"], M({ seen_s: 60 }), []).player_below_minimum).toBe(true);
    expect(lineOf({ position: "CB", latest_team: { team: "X", jersey_number: 4, position: "dm" } } as never)).toBe("MID");
    expect(lineOf({ position: null, latest_team: null } as never)).toBeNull();
    // the middle third of the width, the same whichever way the teams attack
    const heat = { subject: { kind: "TRACK" as const, id: "x" }, length_m: 105, width_m: 68, cols: 3, rows: 3, seconds: [0, 0, 0, 1, 6, 1, 0, 0, 2], seen_s: 600, measured_s: 600, ends_as_filmed: true as const };
    expect(centralShare(heat)).toBeCloseTo(0.8);
    const s = insightsOf({ ...him, heat }, [31, 25]);
    expect(s.items.map((x) => x.kind)).toEqual(["SPEED", "PASSING", "POSITION", "WORK_RATE"]);
    expect(s.items[0]!.text).toBe("Top speed 30.1 km/h, held for 2 seconds, 2nd of 3 players measured in your organization.");
    expect(s.items[1]!.text).toBe("20 passes found, 2 of them key (10 %); 3 received.");
    expect(s.items[2]!.text).toContain("Mostly central: 80 %");
    expect(s.items.every((x) => x.source.length > 0)).toBe(true);
    expect(insightsOf(M({}), []).items).toEqual([]);                                     // nothing measured: nothing said
  });
});

describe("notes, tags and the assessment", () => {
  it("members write and read; a viewer reads; another organization sees nothing; stale versions refused; published only when published", async () => {
    const s = await seedPlayer(a);
    const base = `/v1/players/${s.player}`;
    expect((await call(b, "GET", `${base}/notes`)).status).toBe(404);
    expect((await call(viewer, "POST", `${base}/notes`, { body: "x" })).status).toBe(403);
    let n = (await call(editor, "POST", `${base}/notes`, { body: "Strong in the air" })).body;
    n = (await call(a, "POST", `${base}/notes`, { body: "Watch him again on Saturday" })).body;
    expect(n.notes.map((x: { body: string }) => x.body)).toEqual(["Watch him again on Saturday", "Strong in the air"]);
    const editorsNote = n.notes[1].id, ownersNote = n.notes[0].id;
    const asViewer = (await call(viewer, "GET", `${base}/notes`)).body;
    expect([asViewer.can_write, asViewer.notes.length, asViewer.notes[0].can_delete]).toEqual([false, 2, false]);
    expect((await call(editor, "DELETE", `${base}/notes/${ownersNote}`)).body.code).toBe("NOT_YOUR_NOTE");
    expect((await call(a, "DELETE", `${base}/notes/${editorsNote}`)).body.notes).toHaveLength(1);            // an Owner may delete anyone's
    n = (await call(editor, "PUT", `${base}/tags`, { tags: ["Shortlist", "left-footed", "shortlist"] })).body;
    expect(n.tags).toEqual(["left-footed", "shortlist"]);
    expect((await call(viewer, "PUT", `${base}/tags`, { tags: [] })).status).toBe(403);
    expect((await call(b, "GET", `${base}/assessment`)).status).toBe(404);

    // the assessment: editors cannot write it, the owner can; a viewer sees only what is published
    const draft = { role: "Box-to-box midfielder", summary: "Covers ground.", traits: ["Engine", "Pressing"], rating: 7.5, criteria: [{ name: "Passing", score: 7 }], notes: "Seen twice" };
    expect((await call(editor, "PUT", `${base}/assessment`, { version: 0, draft })).status).toBe(403);
    let x = (await call(a, "PUT", `${base}/assessment`, { version: 0, draft })).body;
    expect([x.version, x.published, x.unpublished_changes, x.draft.role]).toEqual([1, null, true, "Box-to-box midfielder"]);
    expect((await call(viewer, "GET", `${base}/assessment`)).body).toMatchObject({ published: null, draft: null, can_write: false });
    expect((await call(a, "PUT", `${base}/assessment`, { version: 0, draft })).body.code).toBe("STALE_VERSION");
    expect((await call(a, "PUT", `${base}/assessment`, { version: 1, draft: { ...draft, rating: 7.3 } })).status).toBe(422);
    x = (await call(a, "PUT", `${base}/assessment`, { version: 1, draft, publish: true })).body;
    expect([x.version, x.unpublished_changes, x.published.rating]).toEqual([2, false, 7.5]);
    expect((await call(viewer, "GET", `${base}/assessment`)).body).toMatchObject({ published: { role: "Box-to-box midfielder" }, draft: null, published_by_name: expect.any(String) });
    x = (await call(a, "DELETE", `${base}/assessment/published`)).body;
    expect([x.published, x.draft.role]).toEqual([null, "Box-to-box midfielder"]);
    const [audit] = await root.query<RowDataPacket[]>("SELECT action FROM audit_events WHERE entity_id = ? AND action LIKE 'player%' AND action <> 'player.created' ORDER BY id", [s.player]);
    expect(audit.map((r) => r.action)).toEqual(["player_note.added", "player_note.added", "player_note.deleted", "player_tags.set", "player_assessment.saved", "player_assessment.published", "player_assessment.withdrawn"]);
  });
});

describe("scouting dossiers", () => {
  it("named lists of players for the organization only", async () => {
    const s = await seedPlayer(a, "Dossier Player");
    expect((await call(viewer, "POST", "/v1/dossiers", { name: "Summer targets" })).status).toBe(403);
    const d = (await call(editor, "POST", "/v1/dossiers", { name: "Summer targets" })).body;
    expect((await call(a, "POST", "/v1/dossiers", { name: "Summer targets" })).body.code).toBe("NAME_TAKEN");
    expect((await call(a, "PUT", `/v1/dossiers/${d.id}/players/${s.player}`)).body.players.map((p: { display_name: string }) => p.display_name)).toEqual(["Dossier Player"]);
    expect((await call(a, "PUT", `/v1/dossiers/${d.id}/players/${s.player}`)).body.players).toHaveLength(1);      // twice: once
    expect((await call(viewer, "GET", "/v1/dossiers")).body.find((x: { id: string }) => x.id === d.id).players).toHaveLength(1);
    expect((await call(b, "GET", "/v1/dossiers")).body).toEqual([]);
    expect((await call(b, "PUT", `/v1/dossiers/${d.id}/players/${s.player}`)).status).toBe(404);
    expect((await call(a, "DELETE", `/v1/dossiers/${d.id}/players/${s.player}`)).body.players).toEqual([]);
    expect((await call(a, "DELETE", `/v1/dossiers/${d.id}`)).status).toBe(204);
    expect((await call(a, "GET", "/v1/dossiers")).body.find((x: { id: string }) => x.id === d.id)).toBeUndefined();
  });
});

describe("comparison and insight routes", () => {
  it("offer his line only when his position is recorded; answer for another organization with 404", async () => {
    const s = await seedPlayer(a, "Compared Player");
    const c = (await call(viewer, "GET", `/v1/players/${s.player}/comparison`)).body;
    expect(c).toMatchObject({ group: "ALL", groups: ["ALL"], player_below_minimum: true });
    expect(c.metrics).toHaveLength(5);
    expect((await call(a, "GET", `/v1/players/${s.player}/comparison?group=MID`)).body.code).toBe("GROUP_NOT_HIS");
    await call(a, "PATCH", `/v1/players/${s.player}/profile`, { position: "CM" });
    expect((await call(a, "GET", `/v1/players/${s.player}/comparison`)).body).toMatchObject({ group: "MID", groups: ["MID", "ALL"] });
    expect((await call(a, "GET", `/v1/players/${s.player}/comparison?group=nope`)).status).toBe(400);
    expect((await call(b, "GET", `/v1/players/${s.player}/comparison`)).status).toBe(404);
    expect((await call(viewer, "GET", `/v1/players/${s.player}/insights`)).body.items).toBeInstanceOf(Array);
    expect((await call(b, "GET", `/v1/players/${s.player}/insights`)).status).toBe(404);
  });
});

describe("the PDF report", () => {
  it("is printed locally, downloaded through a signed URL, and shared only when the source video's rights allow it", async () => {
    const s = await seedPlayer(a, "Pdf Игрок");
    await call(a, "POST", `/v1/players/${s.player}/notes`, { body: "INTERNAL-NOTE-NOT-IN-PDF" });
    expect((await call(viewer, "POST", `/v1/players/${s.player}/reports`)).status).toBe(403);
    expect((await call(b, "POST", `/v1/players/${s.player}/reports`)).status).toBe(404);
    const job = await call(editor, "POST", `/v1/players/${s.player}/reports`);
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ state: "SUCCEEDED", videos: 1, failure: null, download_url: expect.stringMatching(/^\/api\/v1\/media\//) });
    const [[asset]] = await root.query<RowDataPacket[]>("SELECT a.object_key, a.mime_type, a.kind FROM report_jobs j JOIN assets a ON a.id = j.output_asset_id WHERE j.id = ?", [job.body.id]);
    expect([asset!.kind, asset!.mime_type]).toEqual(["REPORT", "application/pdf"]);
    const pdf = await readFile(path.join(dir, ...String(asset!.object_key).split("/")));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.includes(Buffer.from("INTERNAL-NOTE-NOT-IN-PDF"))).toBe(false);
    const got = await call(null, "GET", job.body.download_url.replace(/^\/api/, ""));
    expect([got.status, got.headers["content-type"], String(got.headers["content-disposition"]).startsWith("attachment")]).toEqual([200, "application/pdf", true]);
    expect((await call(viewer, "GET", `/v1/players/${s.player}/reports`)).body[0]).toMatchObject({ id: job.body.id, state: "SUCCEEDED", requested_by_name: expect.any(String) });
    expect((await call(b, "GET", `/v1/players/${s.player}/reports`)).status).toBe(404);

    // sharing: refused without rights; allowed once the source video's rights allow sharing; re-checked at opening; revoked
    const url = `/v1/reports/${job.body.id}/share-links`;
    expect((await call(a, "POST", url, {})).body).toMatchObject({ code: "SHARING_NOT_ALLOWED" });
    expect((await call(viewer, "POST", url, {})).status).toBe(403);
    expect((await call(b, "POST", url, {})).status).toBe(404);
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence from the league" });
    expect((await call(a, "POST", url, { can_download: true })).body.code).toBe("SHARING_NOT_ALLOWED");          // downloads not allowed
    const link = await call(a, "POST", url, { expires_in_days: 3 });
    expect(link.status).toBe(201);
    expect(link.body).toMatchObject({ report_id: job.body.id, state: "ACTIVE", can_comment: false });
    const token = String(link.body.url).split("/s/")[1]!;
    const view = await call(null, "GET", `/v1/public/share/${token}`);
    expect(view.body).toMatchObject({ kind: "REPORT", title: "Player report", player_name: "Pdf Игрок", mime: "application/pdf", download_url: null, can_comment: false });
    const inline = await call(null, "GET", view.body.url.replace(/^\/api/, ""));
    expect([inline.status, String(inline.headers["content-disposition"]).startsWith("inline")]).toEqual([200, true]);
    expect((await call(null, "POST", `/v1/public/share/${token}/comments`, { name: "X", body: "hi", at_s: null, password: null })).body.code).toBe("COMMENTS_OFF");
    expect((await call(a, "GET", url)).body[0]).toMatchObject({ id: link.body.id, opened: 2 });           // the comment attempt opened it too
    // the rights change: the open link stops
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "INTERNAL", allowed_uses: ["VIEW"], reason: "licence ended" });
    expect((await call(null, "GET", `/v1/public/share/${token}`)).status).toBe(410);
    await call(a, "POST", `/v1/videos/${s.video}/rights`, { rights_state: "EXPORT_ALLOWED", allowed_uses: ["VIEW", "SHARE"], reason: "licence renewed" });
    expect((await call(a, "DELETE", `/v1/share-links/${link.body.id}`)).status).toBe(204);
    expect((await call(null, "GET", `/v1/public/share/${token}`)).body.code).toBe("SHARE_UNAVAILABLE");
    const [dec] = await root.query<RowDataPacket[]>("SELECT decision FROM policy_decisions WHERE resource_type = 'report' AND resource_id = ? ORDER BY checked_at", [job.body.id]);
    expect(dec.map((r) => r.decision)).toEqual(["DENY", "DENY", "ALLOW"]);
  }, 60_000);
});

describe("B.24: report designer and the publish gate (ADR-099)", () => {
  const draft = { role: "Box-to-box", summary: "Covers ground.", traits: [], rating: null, criteria: [], notes: "" };
  it("nothing leaves the page while no track is confirmed as him: no PDF, no published assessment; a draft and the preview work", async () => {
    const player = (await call(a, "POST", "/v1/players", { display_name: "Unconfirmed Player" }, { "idempotency-key": key() })).body.player_id as string;
    const pv = await call(viewer, "POST", `/v1/players/${player}/reports/preview`, {});
    expect(pv.status).toBe(200);
    expect(pv.body.gate.ok).toBe(false);
    expect(pv.body.gate.reasons[0]).toContain("No track is confirmed");
    const made = await call(a, "POST", `/v1/players/${player}/reports`, {});
    expect([made.status, made.body.code]).toEqual([409, "IDENTITY_UNCONFIRMED"]);
    const [[n]] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM report_jobs WHERE player_id = ?", [player]);
    expect(Number(n!.n)).toBe(0);
    expect((await call(a, "PUT", `/v1/players/${player}/assessment`, { version: 0, draft, publish: false })).status).toBe(200);
    const pub = await call(a, "PUT", `/v1/players/${player}/assessment`, { version: 1, draft, publish: true });
    expect([pub.status, pub.body.code]).toEqual([409, "IDENTITY_UNCONFIRMED"]);
    expect((await call(b, "POST", `/v1/players/${player}/reports/preview`, {})).status).toBe(404);
  });

  it("the design chooses the sections, the title and a cover note; the preview is the page the PDF prints; nothing saved by a preview", async () => {
    const s = await seedPlayer(a, "Design Player");
    const design = { sections: ["measures", "assessment"], title: "Autumn <visit>", note: "Seen twice in person." };
    const before = (await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM report_jobs"))[0][0]!.n;
    const pv = await call(viewer, "POST", `/v1/players/${s.player}/reports/preview`, { design });
    expect(pv.body.gate).toEqual({ ok: true, reasons: [] });
    const html = String(pv.body.html);
    expect(html).toContain("Autumn &lt;visit&gt;");
    expect(html).toContain("Seen twice in person.");
    expect(html).toContain('data-part="measures"');
    expect(html).not.toContain('data-part="comparison"');
    expect(html).not.toContain('data-part="heat"');
    expect((await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM report_jobs"))[0][0]!.n).toBe(before);
    expect((await call(a, "POST", `/v1/players/${s.player}/reports/preview`, { design: { sections: [] } })).status).toBe(422);
    expect((await call(a, "POST", `/v1/players/${s.player}/reports/preview`, { design: { sections: ["heat", "heat"] } })).status).toBe(422);
    const job = await call(editor, "POST", `/v1/players/${s.player}/reports`, { design });
    expect(job.status).toBe(201);
    expect(job.body).toMatchObject({ state: "SUCCEEDED", title: "Autumn <visit>", sections: 2 });
    const full = await call(editor, "POST", `/v1/players/${s.player}/reports`);
    expect(full.body).toMatchObject({ state: "SUCCEEDED", title: null, sections: 6 });
  });
});
