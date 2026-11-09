/**
 * Page 02 "Send to Analysis" and the saved switches, through the real HTTP stack, MySQL and the outbox subscriber (migration 0020).
 * The server, not the browser, starts the analysis once a video is verified.
 */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type mysql from "mysql2/promise";
import { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Db } from "../src/core/db";
import { OutboxDispatcher } from "../src/core/outbox/dispatcher";
import { autoAnalysisAfterCheck, autoAnalysisStarter } from "../src/core/outbox/subscribers";
import { publish } from "../src/core/outbox/publish";
import { appDb, Member, rootDb, seedMember, startApi } from "./helpers";

let app: NestFastifyApplication;
let db: Db;
let root: mysql.Connection;
let dir: string;
let a: Member;
let b: Member;
let project: string;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown, extra: Record<string, string> = {}) {
  const r = await app.inject({ method, url, headers: { ...m.headers, ...extra }, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: JSON.parse(r.body) };
}
/** A.11: the rights Upload declares; analysis needs them */
const RIGHTS = { analyse: true, share: false, download: false, guardian_consent: "NOT_APPLICABLE", confirm: true };
const upload = (m: Member, options?: unknown, name = "match.mp4", rights: unknown = RIGHTS) =>
  call(m, "POST", "/v1/uploads", { project_id: project, file_name: name, byte_size: 2048, ...(options === undefined ? {} : { options }), ...(rights === null ? {} : { rights }) },
    { "idempotency-key": `k-${uuidv7()}` });

/** the verified state the ingest worker leaves: source asset, probe facts, state INGESTED, and the video.ingested event */
async function verify(m: Member, videoId: string): Promise<void> {
  const asset = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 2048)",
    [asset, m.orgId, project, `org/${m.orgId}/videos/${videoId}/source.mp4`]);
  await root.query(
    `UPDATE video_sources SET state = 'INGESTED', source_asset_id = ?, duration_us = 60000000, width = 1280, height = 720, avg_frame_rate_num = 25, avg_frame_rate_den = 1,
            container_format = 'mp4', video_codec = 'h264' WHERE id = ?`, [asset, videoId]);
  await publish(root as never, { organizationId: m.orgId, aggregateType: "video", aggregateId: videoId, eventType: "video.ingested", payload: { video_id: videoId }, dedupeKey: `test-ingested:${videoId}:${uuidv7()}` });
}
async function deliver(): Promise<void> {
  const d = new OutboxDispatcher(db, [autoAnalysisStarter(), autoAnalysisAfterCheck()]);
  for (let i = 0; i < 6; i++) if ((await d.runOnce()).claimed === 0) break;
}
const runsOf = async (videoId: string) => (await root.query<RowDataPacket[]>("SELECT id, status, JSON_UNQUOTE(JSON_EXTRACT(config, '$.profile')) AS profile FROM pipeline_runs WHERE video_id = ?", [videoId]))[0];

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "otsi-vie-ingest-options-"));
  app = await startApi({ storageDir: dir });
  db = appDb();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
  b = await seedMember(root, "OWNER");
  project = (await call(a, "POST", "/v1/projects", { name: "Options" })).body.id;
});
afterAll(async () => {
  await app?.close();
  await db?.onModuleDestroy();
  await root?.end();
  await rm(dir, { recursive: true, force: true });
});

describe("saved ingest options", () => {
  it("are saved with the upload, returned on the video, and refused when malformed", async () => {
    const r = await upload(a, { stabilize_video: false, send_to_analysis: true });
    expect(r.status).toBe(201);
    const video = (await call(a, "GET", `/v1/videos/${r.body.video_id}`)).body;
    expect(video.ingest_options).toMatchObject({ stabilize_video: false, send_to_analysis: true, analysis: null, not_performed: [] });
    expect((await upload(a, { stabilize_video: "yes", send_to_analysis: true })).status).toBe(422);
    expect((await upload(a, { stabilize_video: true })).status).toBe(422);
  });

  it("the eight requests for steps the engine cannot perform yet are saved as asked and reported as not performed", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: false, auto_crop_pitch: true, generate_highlights: true, overlay_event_markers: false });
    const [rows] = await root.query<RowDataPacket[]>("SELECT * FROM video_ingest_options WHERE video_id = ?", [r.body.video_id]);
    expect(rows[0]).toMatchObject({ auto_crop_pitch: 1, generate_highlights: 1, enhance_quality: 0, remove_crowd_noise: 0, correct_aspect_ratio: 0, overlay_pitch_lines: 0,
      overlay_event_markers: 0, auto_create_match: 0, send_to_analysis: 0 });
    const video = (await call(a, "GET", `/v1/videos/${r.body.video_id}`)).body;
    expect(video.ingest_options.not_performed.sort()).toEqual(["auto_crop_pitch", "generate_highlights"]);
    expect(video.ingest_options).toMatchObject({ auto_crop_pitch: true, generate_highlights: true, enhance_quality: false });
  });

  it("the four steps every analysis does are always written as done, whatever the request says", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: true, overlay_players_teams: false, overlay_ball_tracking: false, overlay_jersey_numbers: false, extract_metadata: false });
    const [rows] = await root.query<RowDataPacket[]>("SELECT * FROM video_ingest_options WHERE video_id = ?", [r.body.video_id]);
    expect(rows[0]).toMatchObject({ overlay_players_teams: 1, overlay_ball_tracking: 1, overlay_jersey_numbers: 1, extract_metadata: 1 });
  });

  it("an upload without options saves nothing, and the video says so", async () => {
    const r = await upload(a);
    expect((await call(a, "GET", `/v1/videos/${r.body.video_id}`)).body.ingest_options).toBeNull();
    const [rows] = await root.query<RowDataPacket[]>("SELECT 1 FROM video_ingest_options WHERE video_id = ?", [r.body.video_id]);
    expect(rows).toHaveLength(0);
  });

  it("a retried upload (same key) keeps its first options", async () => {
    const key = `k-${uuidv7()}`;
    const body = { project_id: project, file_name: "again.mp4", byte_size: 2048 };
    const first = await call(a, "POST", "/v1/uploads", { ...body, options: { stabilize_video: true, send_to_analysis: true } }, { "idempotency-key": key });
    const second = await call(a, "POST", "/v1/uploads", { ...body, options: { stabilize_video: false, send_to_analysis: false } }, { "idempotency-key": key });
    expect(second.status).toBe(200);
    expect(second.body.video_id).toBe(first.body.video_id);
    expect((await call(a, "GET", `/v1/videos/${first.body.video_id}`)).body.ingest_options).toMatchObject({ stabilize_video: true, send_to_analysis: true });
  });

  it("are private to the organization", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: true });
    expect((await call(b, "GET", `/v1/videos/${r.body.video_id}`)).status).toBe(404);
  });
});

describe("the server starts the analysis (jobs.auto_analysis)", () => {
  it("starts one run with the High accuracy profile when Stabilize is on, and records it", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: true });
    const id = r.body.video_id as string;
    expect(await runsOf(id)).toHaveLength(0);                                  // not before the video is verified
    await verify(a, id);
    await deliver();
    const runs = await runsOf(id);
    expect(runs).toHaveLength(1);
    expect(runs![0]).toMatchObject({ status: "QUEUED", profile: "HIGH_ACCURACY" });
    const video = (await call(a, "GET", `/v1/videos/${id}`)).body;
    expect(video.ingest_options.analysis).toEqual({ outcome: "STARTED", run_id: runs![0]!.id, detail: null, profile: "HIGH_ACCURACY" });
    expect(video.ingest_options.analysis_profile).toBeNull();                 // saved without a profile: it follows Stabilize, as before A.10
    expect((await call(a, "GET", `/v1/videos/${id}/analysis-runs`)).body).toHaveLength(1);
    const [audit] = await root.query<RowDataPacket[]>("SELECT actor_kind, actor_service, request_id FROM audit_events WHERE action = 'analysis.requested' AND entity_id = ?", [runs![0]!.id]);
    expect(audit[0]).toMatchObject({ actor_kind: "SERVICE", actor_service: "auto-analysis", request_id: `auto-analysis:${id}` });
  });

  it("uses the Standard profile when Stabilize is off", async () => {
    const r = await upload(a, { stabilize_video: false, send_to_analysis: true });
    await verify(a, r.body.video_id);
    await deliver();
    expect((await runsOf(r.body.video_id))![0]).toMatchObject({ profile: "STANDARD" });
  });

  it("decides once: a second video.ingested for the same video starts nothing more", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: true });
    await verify(a, r.body.video_id);
    await deliver();
    await publish(root as never, { organizationId: a.orgId, aggregateType: "video", aggregateId: r.body.video_id, eventType: "video.ingested", payload: { video_id: r.body.video_id }, dedupeKey: `again:${uuidv7()}` });
    await deliver();
    expect(await runsOf(r.body.video_id)).toHaveLength(1);
  });

  it("starts nothing when Send to Analysis is off, or when the video has no saved options", async () => {
    const off = await upload(a, { stabilize_video: true, send_to_analysis: false });
    const none = await upload(a);
    await verify(a, off.body.video_id); await verify(a, none.body.video_id);
    await deliver();
    expect(await runsOf(off.body.video_id)).toHaveLength(0);
    expect(await runsOf(none.body.video_id)).toHaveLength(0);
    expect((await call(a, "GET", `/v1/videos/${off.body.video_id}`)).body.ingest_options.analysis).toBeNull();
  });

  it("skips, with the reason, when an analysis of the video is already running", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: true });
    const id = r.body.video_id as string;
    await verify(a, id);
    await root.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status) VALUES (?, ?, ?, 'test', 'RUNNING')", [uuidv7(), id, a.orgId]);
    await deliver();
    expect(await runsOf(id)).toHaveLength(1);
    expect((await call(a, "GET", `/v1/videos/${id}`)).body.ingest_options.analysis).toMatchObject({ outcome: "SKIPPED", run_id: null, detail: "An analysis of this video was already running." });
  });

  it("a link import saves its options too, and is analysed the same way", async () => {
    const r = await call(a, "POST", "/v1/imports", { project_id: project, url: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Example.webm", options: { stabilize_video: false, send_to_analysis: true }, rights: RIGHTS },
      { "idempotency-key": `imp-${uuidv7()}` });
    expect(r.status).toBe(201);
    expect(r.body.ingest_options).toMatchObject({ stabilize_video: false, send_to_analysis: true, analysis: null });
    await verify(a, r.body.id);
    await deliver();
    expect((await runsOf(r.body.id))![0]).toMatchObject({ profile: "STANDARD" });
  });
});

describe("the profile chosen on Upload (A.10, ADR-076)", () => {
  /** the ASSESS worker's result: the assessment settled, and its video.assessed event */
  async function settle(m: Member, videoId: string, status: "SUCCEEDED" | "FAILED", recommended: string | null) {
    const [q] = await root.query<RowDataPacket[]>("SELECT id FROM video_quality_assessments WHERE video_id = ? ORDER BY created_at DESC LIMIT 1", [videoId]);
    await root.query("UPDATE video_quality_assessments SET status = ?, recommended_profile = ?, metrics = ?, finished_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [status, recommended, status === "SUCCEEDED" ? "{}" : null, q[0]!.id]);
    await publish(root as never, { organizationId: m.orgId, aggregateType: "video", aggregateId: videoId, eventType: "video.assessed",
      payload: { assessment_id: q[0]!.id, video_id: videoId, status, recommended_profile: recommended }, dedupeKey: `assessed:${q[0]!.id}` });
  }

  it("a chosen profile is used as soon as the video is verified, and decides Stabilize; an unknown profile is refused", async () => {
    const r = await upload(a, { stabilize_video: false, send_to_analysis: true, analysis_profile: "ULTRA_SENSITIVE" });
    const id = r.body.video_id as string;
    await verify(a, id);
    await deliver();
    expect((await runsOf(id))![0]).toMatchObject({ profile: "ULTRA_SENSITIVE" });
    const o = (await call(a, "GET", `/v1/videos/${id}`)).body.ingest_options;
    expect(o).toMatchObject({ analysis_profile: "ULTRA_SENSITIVE", stabilize_video: true, analysis: { outcome: "STARTED", profile: "ULTRA_SENSITIVE", detail: "Ultra-sensitive grassroots, as chosen on Upload." } });
    expect((await upload(a, { stabilize_video: true, send_to_analysis: true, analysis_profile: "STANDARD" })).status).toBe(201);
    expect((await upload(a, { stabilize_video: true, send_to_analysis: true, analysis_profile: "FAST" })).status).toBe(422);
  });

  it("Recommended checks the footage first, then analyses with what the check recommends", async () => {
    const r = await upload(a, { stabilize_video: false, send_to_analysis: true, analysis_profile: "RECOMMENDED" });
    const id = r.body.video_id as string;
    await verify(a, id);
    await deliver();
    expect(await runsOf(id)).toHaveLength(0);                                  // waits for the check
    const [jobs] = await root.query<RowDataPacket[]>(
      "SELECT j.kind FROM worker_jobs j JOIN video_quality_assessments q ON q.id = j.subject_id WHERE q.video_id = ? AND j.subject_type = 'quality_assessment'", [id]);
    expect(jobs.map((j) => j.kind)).toEqual(["ASSESS"]);
    expect((await call(a, "GET", `/v1/videos/${id}`)).body.ingest_options.analysis).toBeNull();
    await deliver();                                                           // a second look starts no second check
    expect((await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM video_quality_assessments WHERE video_id = ?", [id]))[0][0]!.n).toBe(1);
    await settle(a, id, "SUCCEEDED", "ULTRA_SENSITIVE");
    await deliver();
    expect((await runsOf(id))![0]).toMatchObject({ profile: "ULTRA_SENSITIVE" });
    expect((await call(a, "GET", `/v1/videos/${id}`)).body.ingest_options.analysis).toMatchObject({ outcome: "STARTED", profile: "ULTRA_SENSITIVE",
      detail: "The footage check recommended Ultra-sensitive grassroots." });
    await settle(a, id, "SUCCEEDED", "STANDARD");                             // decided once
    await deliver();
    expect(await runsOf(id)).toHaveLength(1);
  });

  it("with Stabilize on, Recommended never goes below High accuracy; a failed check falls back and says so", async () => {
    const s1 = (await upload(a, { stabilize_video: true, send_to_analysis: true, analysis_profile: "RECOMMENDED" })).body.video_id as string;
    const s2 = (await upload(a, { stabilize_video: false, send_to_analysis: true, analysis_profile: "RECOMMENDED" })).body.video_id as string;
    await verify(a, s1); await verify(a, s2);
    await deliver();
    await settle(a, s1, "SUCCEEDED", "STANDARD");
    await settle(a, s2, "FAILED", null);
    await deliver();
    expect((await runsOf(s1))![0]).toMatchObject({ profile: "HIGH_ACCURACY" });
    expect((await call(a, "GET", `/v1/videos/${s1}`)).body.ingest_options.analysis.detail).toBe("The footage check recommended Standard; Stabilize Video is on, so High accuracy was used.");
    expect((await runsOf(s2))![0]).toMatchObject({ profile: "STANDARD" });
    expect((await call(a, "GET", `/v1/videos/${s2}`)).body.ingest_options.analysis.detail).toBe("The footage check did not finish, so Standard was used.");
  });

  it("a footage check of a video that did not ask for Recommended starts nothing", async () => {
    const id = (await upload(a, { stabilize_video: false, send_to_analysis: false, analysis_profile: "RECOMMENDED" })).body.video_id as string;
    await verify(a, id);
    await deliver();
    expect((await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM video_quality_assessments WHERE video_id = ?", [id]))[0][0]!.n).toBe(0);   // no analysis asked: no check
    expect(await runsOf(id)).toHaveLength(0);
  });
});
describe("the rights declared on Upload (A.11, ADR-077)", () => {
  it("are recorded with the upload as the video's grant, audited; malformed answers are refused", async () => {
    const r = await upload(a, { stabilize_video: true, send_to_analysis: false }, "rights.mp4", { ...RIGHTS, share: true, download: true, guardian_consent: "VERIFIED" });
    expect(r.status).toBe(201);
    const rights = (await call(a, "GET", `/v1/videos/${r.body.video_id}/rights`)).body;
    expect(rights.grant).toMatchObject({ rights_state: "EXPORT_ALLOWED", guardian_consent_state: "VERIFIED" });
    expect([...rights.grant.allowed_uses].sort()).toEqual(["ANALYZE", "DELIVER", "DOWNLOAD", "EXPORT", "PRODUCE", "SHARE", "VIEW"]);
    expect(rights.analysis_blocked).toBeNull();
    const [audit] = await root.query<RowDataPacket[]>("SELECT 1 FROM audit_events WHERE action = 'video.rights_declared' AND entity_id = ?", [r.body.video_id]);
    expect(audit).toHaveLength(1);
    expect((await upload(a, undefined, "x.mp4", { ...RIGHTS, download: true })).status).toBe(422);          // downloads need sharing
    expect((await upload(a, undefined, "x.mp4", { ...RIGHTS, confirm: false })).status).toBe(422);          // the person confirms
  });

  it("without rights a verified video is not analysed, and says why; once declared it can be", async () => {
    const r = await upload(a, { stabilize_video: false, send_to_analysis: true }, "norights.mp4", null);
    const id = r.body.video_id as string;
    await verify(a, id);
    await deliver();
    expect(await runsOf(id)).toHaveLength(0);
    expect((await call(a, "GET", `/v1/videos/${id}`)).body.ingest_options.analysis).toMatchObject({ outcome: "SKIPPED", detail: expect.stringMatching(/Record this video's rights first/) });
    const refused = await call(a, "POST", `/v1/videos/${id}/analysis-runs`, {});
    expect(refused).toMatchObject({ status: 409, body: { code: "RIGHTS_REQUIRED" } });
    expect((await call(a, "GET", `/v1/videos/${id}/rights`)).body.analysis_blocked).toMatch(/Record this video's rights first/);
    expect((await call(b, "POST", `/v1/videos/${id}/rights/declaration`, RIGHTS)).status).toBe(404);    // another organization
    const declared = await call(a, "POST", `/v1/videos/${id}/rights/declaration`, RIGHTS);
    expect(declared.status).toBe(201);
    expect(declared.body).toMatchObject({ analysis_blocked: null, grant: { rights_state: "INTERNAL" } });
    expect(await call(a, "POST", `/v1/videos/${id}/rights/declaration`, RIGHTS)).toMatchObject({ status: 409, body: { code: "RIGHTS_ALREADY_RECORDED" } });
    expect((await call(a, "POST", `/v1/videos/${id}/analysis-runs`, {})).status).toBe(201);
  });

  it("rights that do not allow analysis, or pending guardian consent, block it with the reason", async () => {
    const no = await upload(a, { stabilize_video: false, send_to_analysis: true }, "noanalyse.mp4", { ...RIGHTS, analyse: false });
    await verify(a, no.body.video_id);
    const minors = await upload(a, { stabilize_video: false, send_to_analysis: true }, "minors.mp4", { ...RIGHTS, guardian_consent: "PENDING" });
    await verify(a, minors.body.video_id);
    await deliver();
    expect(await runsOf(no.body.video_id)).toHaveLength(0);
    expect(await runsOf(minors.body.video_id)).toHaveLength(0);
    expect((await call(a, "GET", `/v1/videos/${no.body.video_id}`)).body.ingest_options.analysis.detail).toBe("This video's rights do not allow analysis.");
    expect((await call(a, "GET", `/v1/videos/${minors.body.video_id}/rights`)).body.analysis_blocked).toMatch(/Guardian consent/);
    expect((await call(a, "POST", `/v1/videos/${minors.body.video_id}/analysis-runs`, {})).status).toBe(409);
  });
});
