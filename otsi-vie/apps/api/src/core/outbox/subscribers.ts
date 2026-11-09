/**
 * The subscribers the outbox dispatcher runs in production (ADR-018). Each has a stable name (stored in receipts) and the event types it
 * needs. A subscriber that creates work does it with the delivery transaction, so the work item and the receipt commit together.
 *
 *   jobs.ingest   video.upload_completed -> one INGEST_UPLOAD job per upload; video.import_requested -> one INGEST_URL job per import
 *                 (ADR-022/023); the Python ingest worker downloads (imports), verifies, probes and test-decodes the file
 *   jobs.proxy    video.ingested -> one PROXY job per video: the browser playback copy (Block 04)
 *   jobs.analyze  analysis.requested -> one ANALYZE job per processing run: detection and tracking (Blocks 05-06)
 *   jobs.auto_analysis  video.ingested -> "Send to Analysis": one analysis run for a verified video whose upload or import asked for it (Page 02);
 *                 decided once per video and recorded on its options row, so a retry or a second delivery never starts another.
 *                 With the profile "Recommended" (A.10, ADR-076) it first queues a footage check (ASSESS) and waits for it:
 *   jobs.auto_analysis_checked  video.assessed -> the footage check of such a video finished: the analysis starts with the profile it recommends
 *   jobs.render   reel.render_requested -> one RENDER job per render job: spotlight compositing and MP4 encoding (Block 11)
 *   jobs.assess   video.assessment_requested -> one ASSESS job per footage-quality assessment (ADR-034)
 *   jobs.pitch    video.pitch_calibration_requested -> one CALIBRATE_PITCH job per pitch calibration request
 *   jobs.ball     video.ball_track_requested -> one TRACK_BALL job per ball track a person asked for
 *   jobs.lineups  video.lineups_requested -> one READ_LINEUPS job per lineup read a person asked for (ADR-039)
 *   jobs.auto_lineups  analysis.completed -> the engine reads the video's lineup cards by itself, once per video
 *   jobs.snapshot video.snapshot_requested -> one SNAPSHOT job per snapshot (B.5, ADR-083)
 *   jobs.beat_grid brand_asset.beat_grid_requested -> one BEAT_GRID job per beat grid (C.5, ADR-105)
 *   search.index  every event of an organization whose search index is built: re-index what it is about (B.10, ADR-086)
 *   jobs.auto_ball  analysis.completed -> the engine follows the ball in every finished analysis by itself (ADR-037): one ball track and its
 *                 TRACK_BALL job per run, never a second for a repeated delivery
 */
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db";
import { serviceActor } from "../audit";
import { insertRun } from "../../modules/analysis/run";
import { analysisRightsBlock } from "../../modules/sharing/rights";
import type { Subscriber } from "./dispatcher";
import { indexEvent } from "../../modules/search/indexer";

export function ingestJobStarter(): Subscriber {
  return {
    name: "jobs.ingest",
    eventTypes: ["video.upload_completed", "video.import_requested"],
    async handle(e, { tx }) {
      if (e.eventType === "video.import_requested") {
        const p = e.payload as { video_id?: string; url?: string };
        if (!e.organizationId || !p.video_id || !p.url) throw new Error("video.import_requested without organization, video or url");
        await tx.query(
          `INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, max_attempts)
           VALUES (?, ?, 'INGEST_URL', 'video', ?, ?, ?, 5) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,
          [uuidv7(), e.organizationId, p.video_id, `import:${p.video_id}`, JSON.stringify({ ...p, outbox_event_id: e.id })]);
        // a sealed access token lives on in the job only (deleted there after use), never in the event history
        if ("credential" in p) await tx.query("UPDATE outbox_events SET event_payload = JSON_REMOVE(event_payload, '$.credential') WHERE id = ?", [e.id]);
        return;
      }
      const p = e.payload as { video_id?: string; upload_id?: string };
      if (!e.organizationId || !p.video_id || !p.upload_id) throw new Error("video.upload_completed without organization, video or upload id");
      await tx.query(
        `INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload)
         VALUES (?, ?, 'INGEST_UPLOAD', 'video', ?, ?, ?)
         ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,                       // the same upload never gets a second job
        [uuidv7(), e.organizationId, p.video_id, `ingest:${p.upload_id}`, JSON.stringify({ video_id: p.video_id, upload_id: p.upload_id, outbox_event_id: e.id })]);
    },
  };
}

/** One job per subject for a simple event: kind, dedupe prefix, payload field naming the subject. */
function jobStarter(name: string, eventType: string, kind: "PROXY" | "ANALYZE" | "RENDER" | "ASSESS" | "CALIBRATE_PITCH" | "TRACK_BALL" | "READ_LINEUPS" | "SNAPSHOT" | "BEAT_GRID", subjectType: string, field: "video_id" | "run_id" | "render_id" | "assessment_id" | "request_id" | "ball_track_id" | "lineup_read_id" | "snapshot_id" | "beat_grid_id", maxAttempts: number): Subscriber {
  return {
    name,
    eventTypes: [eventType],
    async handle(e, { tx }) {
      const p = e.payload as Record<string, string | undefined>;
      const subject = p[field];
      if (!e.organizationId || !subject) throw new Error(`${eventType} without organization or ${field}`);
      await tx.query(
        `INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, max_attempts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,
        [uuidv7(), e.organizationId, kind, subjectType, subject, `${kind.toLowerCase()}:${subject}`, JSON.stringify({ ...p, outbox_event_id: e.id }), maxAttempts]);
    },
  };
}

/**
 * "Send to Analysis" (Page 02). When a video becomes INGESTED and its saved options ask for analysis, the SERVER starts the run, in the delivery
 * transaction: the run, its steps, the audit row, the analysis.requested event and the decision on the options row commit together. Stabilize
 * on = the High accuracy profile, off = Standard. A video without an options row (added any other way) is left alone.
 */
type Row = import("mysql2/promise").RowDataPacket;
type Tx = Parameters<Subscriber["handle"]>[1]["tx"];
const PROFILE_LABEL: Record<string, string> = { STANDARD: "Standard", HIGH_ACCURACY: "High accuracy", ULTRA_SENSITIVE: "Ultra-sensitive grassroots" };

/** the options row of a video still waiting for its automatic analysis (locked), or null when nothing is to be done */
async function pendingAuto(tx: Tx, org: string, videoId: string): Promise<Row | null> {
  const [rows] = await tx.query<Row[]>(
    "SELECT stabilize_video, send_to_analysis, analysis_profile, auto_outcome, created_by FROM video_ingest_options WHERE video_id = ? AND organization_id = ? FOR UPDATE", [videoId, org]);
  const o = rows[0];
  return !o || !o.send_to_analysis || o.auto_outcome ? null : o;                                // nothing asked, or already decided
}

/** starts the automatic analysis with `profile`, or records why not; `why` is kept with the decision (shown on Upload) */
async function startAuto(tx: Tx, org: string, videoId: string, profile: "STANDARD" | "HIGH_ACCURACY" | "ULTRA_SENSITIVE", why: string | null) {
  const [vs] = await tx.query<Row[]>("SELECT state FROM video_sources WHERE id = ? AND organization_id = ? AND removed_at IS NULL", [videoId, org]);
  const skip = async (detail: string) => { await tx.query("UPDATE video_ingest_options SET auto_outcome = 'SKIPPED', auto_detail = ?, auto_decided_at = CURRENT_TIMESTAMP(6) WHERE video_id = ?", [detail, videoId]); };
  if (vs[0]?.state !== "INGESTED") return skip("The video was not verified when the analysis was due.");
  const [open] = await tx.query<Row[]>("SELECT id FROM pipeline_runs WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1", [videoId, org]);
  if (open[0]) return skip("An analysis of this video was already running.");
  const rights = await analysisRightsBlock(tx, org, videoId);                                 // A.11: the rights decide, never the switch alone
  if (rights) return skip(rights.text);
  const runId = await insertRun(tx, serviceActor("auto-analysis", org, `auto-analysis:${videoId}`), org, videoId, { profile });
  await tx.query("UPDATE video_ingest_options SET auto_outcome = 'STARTED', auto_run_id = ?, auto_profile = ?, auto_detail = ?, auto_decided_at = CURRENT_TIMESTAMP(6) WHERE video_id = ?",
    [runId, profile, why, videoId]);
}

export function autoAnalysisStarter(): Subscriber {
  return {
    name: "jobs.auto_analysis",
    eventTypes: ["video.ingested"],
    async handle(e, { tx }) {
      const videoId = (e.payload as { video_id?: string }).video_id;
      if (!e.organizationId || !videoId) throw new Error("video.ingested without organization or video");
      const o = await pendingAuto(tx, e.organizationId, videoId);
      if (!o) return;
      if (o.analysis_profile === "RECOMMENDED") {
        // A.10: check the footage first; jobs.auto_analysis_checked starts the analysis when the check has finished
        const [had] = await tx.query<Row[]>("SELECT id FROM video_quality_assessments WHERE video_id = ? AND organization_id = ? AND status IN ('QUEUED', 'RUNNING') LIMIT 1", [videoId, e.organizationId]);
        if (had[0]) return;
        const id = uuidv7();
        await tx.query("INSERT INTO video_quality_assessments (id, organization_id, video_id, requested_by) VALUES (?, ?, ?, ?)", [id, e.organizationId, videoId, o.created_by]);
        await tx.query(
          `INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, max_attempts)
           VALUES (?, ?, 'ASSESS', 'quality_assessment', ?, ?, ?, 2) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,
          [uuidv7(), e.organizationId, id, `assess:${id}`, JSON.stringify({ assessment_id: id, video_id: videoId, outbox_event_id: e.id })]);
        return;
      }
      const chosen = o.analysis_profile as "STANDARD" | "HIGH_ACCURACY" | "ULTRA_SENSITIVE" | null;
      await startAuto(tx, e.organizationId, videoId, chosen ?? (o.stabilize_video ? "HIGH_ACCURACY" : "STANDARD"), chosen ? `${PROFILE_LABEL[chosen]}, as chosen on Upload.` : null);
    },
  };
}

/** A.10 (ADR-076): the footage check of a video whose upload chose "Recommended" finished; analyse with what it recommends */
export function autoAnalysisAfterCheck(): Subscriber {
  return {
    name: "jobs.auto_analysis_checked",
    eventTypes: ["video.assessed"],
    async handle(e, { tx }) {
      const p = e.payload as { video_id?: string; status?: string; recommended_profile?: string | null };
      if (!e.organizationId || !p.video_id) throw new Error("video.assessed without organization or video");
      const o = await pendingAuto(tx, e.organizationId, p.video_id);
      if (!o || o.analysis_profile !== "RECOMMENDED") return;
      const rec = p.status === "SUCCEEDED" && p.recommended_profile && p.recommended_profile in PROFILE_LABEL ? p.recommended_profile as "STANDARD" | "HIGH_ACCURACY" | "ULTRA_SENSITIVE" : null;
      const floor = o.stabilize_video ? "HIGH_ACCURACY" : "STANDARD";
      if (!rec) return startAuto(tx, e.organizationId, p.video_id, floor, `The footage check did not finish, so ${PROFILE_LABEL[floor]} was used${o.stabilize_video ? " (Stabilize Video is on)" : ""}.`);
      if (rec === "STANDARD" && o.stabilize_video) return startAuto(tx, e.organizationId, p.video_id, "HIGH_ACCURACY", "The footage check recommended Standard; Stabilize Video is on, so High accuracy was used.");
      return startAuto(tx, e.organizationId, p.video_id, rec, `The footage check recommended ${PROFILE_LABEL[rec]}.`);
    },
  };
}

export const proxyJobStarter = () => jobStarter("jobs.proxy", "video.ingested", "PROXY", "video", "video_id", 3);
export const analyzeJobStarter = () => jobStarter("jobs.analyze", "analysis.requested", "ANALYZE", "analysis_run", "run_id", 2);
export const renderJobStarter = () => jobStarter("jobs.render", "reel.render_requested", "RENDER", "render_job", "render_id", 2);
export const assessJobStarter = () => jobStarter("jobs.assess", "video.assessment_requested", "ASSESS", "quality_assessment", "assessment_id", 2);
export const pitchJobStarter = () => jobStarter("jobs.pitch", "video.pitch_calibration_requested", "CALIBRATE_PITCH", "pitch_calibration", "request_id", 2);
export const ballJobStarter = () => jobStarter("jobs.ball", "video.ball_track_requested", "TRACK_BALL", "ball_track", "ball_track_id", 2);

export const lineupsJobStarter = () => jobStarter("jobs.lineups", "video.lineups_requested", "READ_LINEUPS", "lineup_read", "lineup_read_id", 2);
/** v3 B.5 (ADR-083): one SNAPSHOT job per snapshot a person asked for */
export const snapshotJobStarter = () => jobStarter("jobs.snapshot", "video.snapshot_requested", "SNAPSHOT", "snapshot", "snapshot_id", 2);
/** v3 C.5 (ADR-105): one BEAT_GRID job per beat grid a person asked for */
export const beatGridJobStarter = () => jobStarter("jobs.beat_grid", "brand_asset.beat_grid_requested", "BEAT_GRID", "beat_grid", "beat_grid_id", 2);

export function autoLineupsStarter(): Subscriber {
  return {
    name: "jobs.auto_lineups",
    eventTypes: ["analysis.completed"],
    async handle(e, { tx }) {
      const p = e.payload as { run_id?: string; video_id?: string };
      if (!e.organizationId || !p.video_id) throw new Error("analysis.completed without organization or video");
      const [had] = await tx.query("SELECT id FROM lineup_reads WHERE video_id = ? LIMIT 1", [p.video_id]);      // a video's cards do not change
      if ((had as unknown[]).length) return;
      const id = uuidv7();
      await tx.query("INSERT INTO lineup_reads (id, organization_id, video_id) VALUES (?, ?, ?)", [id, e.organizationId, p.video_id]);
      await tx.query(
        `INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, max_attempts)
         VALUES (?, ?, 'READ_LINEUPS', 'lineup_read', ?, ?, ?, 2) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,
        [uuidv7(), e.organizationId, id, `read_lineups:${id}`, JSON.stringify({ lineup_read_id: id, video_id: p.video_id, outbox_event_id: e.id })]);
    },
  };
}

export function autoBallStarter(): Subscriber {
  return {
    name: "jobs.auto_ball",
    eventTypes: ["analysis.completed"],
    async handle(e, { tx }) {
      const p = e.payload as { run_id?: string; video_id?: string };
      if (!e.organizationId || !p.run_id || !p.video_id) throw new Error("analysis.completed without organization, run or video");
      const [had] = await tx.query("SELECT id FROM ball_tracks WHERE run_id = ? AND requested_by IS NULL LIMIT 1", [p.run_id]);
      if ((had as unknown[]).length) return;
      const id = uuidv7();
      await tx.query("INSERT INTO ball_tracks (id, organization_id, video_id, run_id) VALUES (?, ?, ?, ?)", [id, e.organizationId, p.video_id, p.run_id]);
      await tx.query(
        `INSERT INTO worker_jobs (id, organization_id, kind, subject_type, subject_id, dedupe_key, payload, max_attempts)
         VALUES (?, ?, 'TRACK_BALL', 'ball_track', ?, ?, ?, 2) ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,
        [uuidv7(), e.organizationId, id, `track_ball:${id}`, JSON.stringify({ ball_track_id: id, video_id: p.video_id, outbox_event_id: e.id })]);
    },
  };
}

/** B.10 (ADR-086): the search index follows every event of the organization (the search's own catch-up covers anything without one) */
export function searchIndexer(): Subscriber {
  return {
    name: "search.index",
    eventTypes: "*",
    async handle(e, { tx }) {
      if (!e.organizationId) return;
      await indexEvent(tx, e.organizationId, e.aggregateType, e.aggregateId, e.payload);
    },
  };
}

export function productionSubscribers(_db: Db): Subscriber[] {
  return [ingestJobStarter(), proxyJobStarter(), autoAnalysisStarter(), autoAnalysisAfterCheck(), analyzeJobStarter(), renderJobStarter(), assessJobStarter(), pitchJobStarter(), ballJobStarter(), autoBallStarter(), lineupsJobStarter(), autoLineupsStarter(), snapshotJobStarter(), beatGridJobStarter(), searchIndexer()];
}
