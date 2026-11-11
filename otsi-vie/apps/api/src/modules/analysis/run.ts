/**
 * Creating an analysis run (Blocks 05-06). One function, used by the "start analysis" request AND by the server's automatic start after an
 * upload ("Send to Analysis", subscriber jobs.auto_analysis), so both write exactly the same run, steps, audit row and event.
 */
import { analysisCostTokens, CreateAnalysisRequest, PROFILES } from "@otsi-vie/contracts";
import type { RowDataPacket } from "mysql2/promise";
import { v7 as uuidv7 } from "uuid";
import { recordChange, type Actor } from "../../core/audit";
import type { Executor } from "../../core/db";
import { ApiError } from "../../core/problem";
import { analysisRightsBlock } from "../sharing/rights";
import type { WalletService } from "../wallet/wallet";

export const RUN_STEPS = ["SHOTS", "DETECT", "TRACK", "IDENTIFY"] as const;

/** Inserts a QUEUED run with its steps in the caller's transaction and announces it (analysis.requested). Returns the run id.
 *  When a wallet is passed, the run's token cost (ADR-140: 1 token per started minute of the video's measured duration) is
 *  charged in this same transaction, so a run that fails to enqueue charges nothing. Callers without a wallet to pass — the
 *  outbox auto-analysis subscriber has no services — do not charge yet (ADR-140 §7, known gap). */
export async function insertRun(c: Executor, actor: Actor, organizationId: string, videoId: string, body: CreateAnalysisRequest, wallet?: WalletService): Promise<string> {
  // A.11 (ADR-077): only a video whose current rights allow analysis is analysed, whoever or whatever starts it
  const blocked = await analysisRightsBlock(c, organizationId, videoId);
  if (blocked) throw new ApiError(409, "RIGHTS_REQUIRED", blocked.text);
  const id = uuidv7();
  if (wallet) {
    // ADR-140: analysis is charged at enqueue. A video with no measured duration cannot be priced: the run is refused
    // rather than charged a guessed number.
    const [vrows] = await c.query<RowDataPacket[]>("SELECT duration_us FROM video_sources WHERE id = ? AND organization_id = ?", [videoId, organizationId]);
    const cost = analysisCostTokens(vrows[0]?.duration_us === null || vrows[0]?.duration_us === undefined ? null : Number(vrows[0].duration_us));
    if (cost === null) throw new ApiError(409, "VIDEO_DURATION_UNKNOWN", "This video has no measured duration, so its token cost cannot be worked out. The analysis did not start and nothing was charged.");
    await wallet.charge(c, organizationId, actor.kind === "USER" ? actor.userId : null, { type: "ANALYSIS", id, amount: cost, reason: `Analysis of video ${videoId}: ${cost} tokens for ${cost} minute(s) of footage.` });
  }
  // the profile's settings, written out in full: the worker obeys the run's config and the run records exactly how it was analysed
  const prof = PROFILES[body.profile];
  const grids = body.tiles === undefined ? prof.grids : body.tiles === 1 ? [] : [2];
  let config: Record<string, unknown> = { profile: body.profile, sample_fps: body.sample_fps ?? prof.sample_fps, grids, tiles: grids.length ? Math.max(...grids) : 1,
    detector: body.detector ?? null, score_floor: prof.score_floor, tracker: prof.tracker, confirm: prof.confirm, pitch: prof.pitch, stabilize: prof.stabilize };
  if (body.retrack_from) {
    // the earlier run must be this video's own FINISHED run with saved detections: its sampling and settings are kept (the frames must line up)
    const [src] = await c.query<RowDataPacket[]>(
      "SELECT r.config FROM pipeline_runs r WHERE r.id = ? AND r.video_id = ? AND r.organization_id = ? AND r.status = 'SUCCEEDED' AND EXISTS (SELECT 1 FROM detection_batches b WHERE b.run_id = r.id)",
      [body.retrack_from, videoId, organizationId]);
    if (!src[0]) throw new ApiError(409, "RETRACK_SOURCE_INVALID", "Only a finished analysis of this same video, with saved detections, can be tracked again.");
    const old = (typeof src[0].config === "string" ? JSON.parse(src[0].config) : src[0].config) as Record<string, unknown>;
    delete old.result;
    delete old.reuse_detections_from;
    // the pitch filter is the current engine's (touchline-aware); everything that decides which frames and detections exist stays as it was
    config = { ...old, pitch: "TOUCHLINE", tracker: { ...(old.tracker as object ?? {}), kit_gate: 0.7 }, reuse_detections_from: body.retrack_from };
  }
  if (body.team_seed_pts_us !== undefined) config.team_seed_pts_us = body.team_seed_pts_us;          // taught at the kickoff; a re-track without a new moment keeps the one of the run it came from
  await c.query("INSERT INTO pipeline_runs (id, video_id, organization_id, pipeline_version, status, config) VALUES (?, ?, ?, 'v2-detect-track-1', 'QUEUED', ?)",
    [id, videoId, organizationId, JSON.stringify(config)]);
  for (const s of RUN_STEPS) await c.query("INSERT INTO pipeline_steps (id, run_id, step_name) VALUES (?, ?, ?)", [uuidv7(), id, s]);
  await recordChange(c, actor, {
    action: "analysis.requested", entityType: "analysis_run", entityId: id, after: { video_id: videoId, ...config },
    event: { eventType: "analysis.requested", payload: { run_id: id, video_id: videoId }, dedupeKey: `analysis-requested:${id}` },
  });
  return id;
}
