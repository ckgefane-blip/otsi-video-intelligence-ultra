/** Job system v2 (v3 Phase A.2, ADR-060): GET /v1/jobs and the pause / resume / priority / cancel / retry actions. */
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type mysql from "mysql2/promise";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Member, rootDb, seedMember, seedRights, seedTracks, startApi } from "./helpers";

let app: NestFastifyApplication;
let root: mysql.Connection;
let a: Member;

async function call(m: Member, method: "GET" | "POST", url: string, body?: unknown) {
  const r = await app.inject({ method, url, headers: m.headers, ...(body === undefined ? {} : { payload: body as object }) });
  return { status: r.statusCode, body: r.body ? JSON.parse(r.body) : undefined };
}
const jobOf = async (m: Member, id: string) => ((await call(m, "GET", "/v1/jobs")).body.jobs as { id: string }[]).find((j) => j.id === id) as Record<string, unknown> | undefined;

/** a verified video with one analysis run and its waiting ANALYZE job */
async function analysisJob(m: Member) {
  const { runId, videoId } = await seedTracks(root, m);
  const [[v]] = await root.query<RowDataPacket[]>("SELECT project_id FROM video_sources WHERE id = ?", [videoId]);
  const asset = uuidv7();
  await root.query("INSERT INTO assets (id, organization_id, project_id, kind, object_key, storage_bucket, byte_size) VALUES (?, ?, ?, 'SOURCE', ?, 'local', 2048)",
    [asset, m.orgId, v!.project_id, `org/${m.orgId}/videos/${videoId}/source.mp4`]);
  await root.query(`UPDATE video_sources SET title = 'Jobs Match', state = 'INGESTED', source_asset_id = ?, duration_us = 60000000, width = 1280, height = 720,
                    avg_frame_rate_num = 25, avg_frame_rate_den = 1, container_format = 'mp4', video_codec = 'h264' WHERE id = ?`, [asset, videoId]);
  await seedRights(root, m.orgId, videoId);
  const jobId = uuidv7();
  await root.query("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (?, ?, 'ANALYZE', 'analysis_run', ?, ?, '{}')",
    [jobId, m.orgId, runId, `analyze:${runId}`]);
  return { runId, videoId, jobId };
}

beforeAll(async () => {
  app = await startApi();
  root = await rootDb();
  a = await seedMember(root, "OWNER");
});
afterAll(async () => {
  await app?.close();
  await root?.end();
});

describe("job tray", () => {
  it("lists a waiting job with its video, page and the actions possible now; another organization sees nothing", async () => {
    const { videoId, jobId } = await analysisJob(a);
    const r = await call(a, "GET", "/v1/jobs");
    expect(r.status).toBe(200);
    const j = r.body.jobs.find((x: { id: string }) => x.id === jobId);
    expect(j).toMatchObject({ kind: "ANALYZE", kind_label: "Analysis", subject_title: "Jobs Match", href: `/analysis?video=${videoId}`, state: "QUEUED",
      priority: "NORMAL", actions: ["pause", "priority", "cancel"] });
    expect(r.body.active).toBeGreaterThanOrEqual(1);

    const b = await seedMember(root, "OWNER");
    expect((await call(b, "GET", "/v1/jobs")).body).toEqual({ jobs: [], active: 0, running: 0, failed_recent: 0 });
    expect((await call(b, "POST", `/v1/jobs/${jobId}/pause`)).status).toBe(404);
  });

  it("pauses, re-prioritises and resumes a waiting job; the worker queue order follows the priority", async () => {
    const { jobId } = await analysisJob(a);
    const p = await call(a, "POST", `/v1/jobs/${jobId}/pause`);
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ state: "PAUSED", actions: ["resume", "priority", "cancel"] });
    expect((await call(a, "POST", `/v1/jobs/${jobId}/pause`)).status).toBe(409);            // already held
    const hi = await call(a, "POST", `/v1/jobs/${jobId}/priority`, { priority: "HIGH" });
    expect(hi.body.priority).toBe("HIGH");
    const [[row]] = await root.query<RowDataPacket[]>("SELECT priority, paused_by FROM worker_jobs WHERE id = ?", [jobId]);
    expect(row).toMatchObject({ priority: 2, paused_by: a.userId });
    const res = await call(a, "POST", `/v1/jobs/${jobId}/resume`);
    expect(res.body.state).toBe("QUEUED");
    expect((await call(a, "POST", `/v1/jobs/${jobId}/priority`, { priority: "URGENT" })).status).toBe(422);
  });

  it("cancels through the job's own module (the run says cancelled) and retries as a NEW run, keeping the old one", async () => {
    const { runId, videoId, jobId } = await analysisJob(a);
    await call(a, "POST", `/v1/jobs/${jobId}/pause`);
    const c = await call(a, "POST", `/v1/jobs/${jobId}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ state: "CANCELLED", actions: ["retry"] });
    const [[run]] = await root.query<RowDataPacket[]>("SELECT status FROM pipeline_runs WHERE id = ?", [runId]);
    expect(run!.status).toBe("CANCELLED");

    const again = await call(a, "POST", `/v1/jobs/${jobId}/retry`);
    expect(again.status).toBe(200);
    const [runs] = await root.query<RowDataPacket[]>("SELECT id, status FROM pipeline_runs WHERE video_id = ? ORDER BY created_at", [videoId]);
    expect(runs.map((x) => x.status)).toEqual(["CANCELLED", "QUEUED"]);                        // the old run is kept as it was
    expect((await call(a, "POST", `/v1/jobs/${jobId}/retry`)).status).toBe(409);               // a run is already open
  });

  it("a short running job cannot be stopped; a waiting one closes its own row as cancelled", async () => {
    const { videoId } = await analysisJob(a);
    const run = uuidv7(), wait = uuidv7(), qa = uuidv7(), qa2 = uuidv7();
    await root.query("INSERT INTO video_quality_assessments (id, organization_id, video_id, requested_by, status) VALUES (?, ?, ?, ?, 'RUNNING'), (?, ?, ?, ?, 'QUEUED')",
      [qa, a.orgId, videoId, a.userId, qa2, a.orgId, videoId, a.userId]);
    await root.query(`INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, state, claim_token, lease_expires_at)
                      VALUES (?, ?, 'ASSESS', 'quality_assessment', ?, ?, '{}', 'RUNNING', ?, UTC_TIMESTAMP(6) + INTERVAL 1 HOUR)`, [run, a.orgId, qa, `assess:${qa}`, uuidv7()]);
    await root.query("INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload) VALUES (?, ?, 'ASSESS', 'quality_assessment', ?, ?, '{}')",
      [wait, a.orgId, qa2, `assess:${qa2}`]);
    expect((await jobOf(a, run))?.actions).toEqual([]);
    expect((await call(a, "POST", `/v1/jobs/${run}/cancel`)).status).toBe(409);
    expect((await call(a, "POST", `/v1/jobs/${wait}/cancel`)).body.state).toBe("CANCELLED");
    const [[row]] = await root.query<RowDataPacket[]>("SELECT status, failure_code FROM video_quality_assessments WHERE id = ?", [qa2]);
    expect(row).toMatchObject({ status: "FAILED", failure_code: "CANCELLED" });
  });

  it("a viewer sees the jobs but has no actions and cannot change them", async () => {
    const { jobId } = await analysisJob(a);
    const viewer = await seedMember(root, "VIEWER", a.orgId);
    expect((await jobOf(viewer, jobId))?.actions).toEqual([]);
    expect((await call(viewer, "POST", `/v1/jobs/${jobId}/pause`)).status).toBe(403);
  });
});

describe("a video's jobs (Processing job table, A.4)", () => {
  it("lists every job of one video, old ones too, with the worker's machine; another video's jobs are left out", async () => {
    const m = await seedMember(root, "OWNER");
    const one = await analysisJob(m), two = await analysisJob(m);
    await root.query("UPDATE worker_jobs SET state = 'SUCCEEDED', worker_id = 'worker-ARCBOX-1a2b3c', created_at = UTC_TIMESTAMP(6) - INTERVAL 3 DAY, started_at = UTC_TIMESTAMP(6) - INTERVAL 3 DAY, finished_at = UTC_TIMESTAMP(6) - INTERVAL 2 DAY WHERE id = ?", [one.jobId]);
    const r = await call(m, "GET", `/v1/jobs?video_id=${one.videoId}`);
    expect(r.status).toBe(200);
    expect(r.body.jobs.map((j: { id: string }) => j.id)).toEqual([one.jobId]);               // two days old, still listed; the other video's job is not
    expect(r.body.jobs[0]).toMatchObject({ worker: "ARCBOX", estimate_s: null, state: "SUCCEEDED" });
    expect(((await call(m, "GET", "/v1/jobs")).body.jobs as { id: string }[]).map((j) => j.id)).toEqual([two.jobId]);   // the tray: active and last 24 h only
    expect((await call(m, "GET", "/v1/jobs?video_id=nope")).status).toBe(404);
  });
});

describe("finished jobs (Home, tray)", () => {
  it("leave out a video in Trash and show no leftover step", async () => {
    const m = await seedMember(root, "OWNER");
    const one = await analysisJob(m), two = await analysisJob(m);
    await root.query("UPDATE worker_jobs SET state = 'SUCCEEDED', stage_message = 'Saving results', finished_at = UTC_TIMESTAMP(6) WHERE id IN (?, ?)", [one.jobId, two.jobId]);
    await root.query("UPDATE video_sources SET removed_at = UTC_TIMESTAMP(6), removed_by = ? WHERE id = ?", [m.userId, two.videoId]);
    const jobs = (await call(m, "GET", "/v1/jobs")).body.jobs as { id: string; stage: string | null }[];
    expect(jobs.map((j) => j.id)).toEqual([one.jobId]);
    expect(jobs[0]!.stage).toBeNull();
  });
});

describe("a charged job that fails is refunded (ADR-140 §7)", () => {
  it("reading the job list refunds a failed analysis in full, once, so the ActivityLine can say refunded", async () => {
    const { runId, jobId } = await analysisJob(a);
    // the charge at enqueue, as the real analysis run writes it: the 60-second video costs 1 token.
    // (the charge path itself is covered by the analysis and wallet tests; here the ledger state is the fixture.)
    const purchaseId = uuidv7();
    await root.query("INSERT INTO wallet_ledger (id, organization_id, kind, amount, balance_after, idempotency_key, invoice_ref, reason) VALUES (?, ?, 'PURCHASE', 100, 100, ?, 'INV-TEST-REFUND', 'Test funding')",
      [purchaseId, a.orgId, `test-purchase:${purchaseId}`]);
    await root.query("INSERT INTO wallet_ledger (id, organization_id, kind, amount, balance_after, job_type, job_id, idempotency_key, reason) VALUES (?, ?, 'SPEND', -1, 99, 'ANALYSIS', ?, ?, 'Test analysis charge')",
      [uuidv7(), a.orgId, runId, `spend:ANALYSIS:${runId}`]);
    // the worker marks the run FAILED directly in the database and never calls the API. A failed
    // job MUST carry an error code (worker_jobs.ck_worker_jobs_failed_has_error): marking it failed
    // without one is refused by the database, so the test sets it, as the real worker does.
    await root.query("UPDATE worker_jobs SET state = 'FAILED', error_code = 'TEST_FAILURE', error_detail = 'Test failure for the refund test', finished_at = UTC_TIMESTAMP(6) WHERE id = ?", [jobId]);
    await root.query("UPDATE pipeline_runs SET status = 'FAILED', failure_code = 'TEST_FAILURE', failure_detail = 'Test failure for the refund test' WHERE id = ?", [runId]);

    const r = await call(a, "GET", "/v1/jobs");
    expect(r.status).toBe(200);
    const [refunds] = await root.query<RowDataPacket[]>(
      "SELECT kind, amount, balance_after, job_type, job_id, idempotency_key, created_at FROM wallet_ledger WHERE organization_id = ? AND kind = 'REFUND'",
      [a.orgId]);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ kind: "REFUND", amount: 1, balance_after: 100, job_type: "ANALYSIS", job_id: runId, idempotency_key: `refund:ANALYSIS:${runId}` });
    // the refund must land after the failure and within the 5-minute window the ActivityLine reads
    // (tokenCost.refundForJob), or the line could not say "refunded".
    const [[job]] = await root.query<RowDataPacket[]>("SELECT finished_at FROM worker_jobs WHERE id = ?", [jobId]);
    const finished = new Date(job!.finished_at as string).getTime();
    const refunded = new Date(refunds[0]!.created_at as string).getTime();
    expect(refunded).toBeGreaterThanOrEqual(finished);
    expect(refunded).toBeLessThanOrEqual(finished + 5 * 60 * 1000);

    // a second read does not refund twice.
    await call(a, "GET", "/v1/jobs");
    const [again] = await root.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM wallet_ledger WHERE organization_id = ? AND kind = 'REFUND'", [a.orgId]);
    expect(again[0]!.n).toBe(1);
  });
});
