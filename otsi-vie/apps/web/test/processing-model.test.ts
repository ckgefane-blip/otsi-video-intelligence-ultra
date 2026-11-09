/** Page 03: the five pictured stages show only what the engine recorded; unbuilt stages never pretend to wait or progress. */
import type { AnalysisRun, Job } from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";
import { lines, visibleLines } from "@/components/processing/LogPanel";
import { isActive, ribbon, runLabel, runProgress, STAGE_STEP, stageView } from "@/components/processing/model";

const run = (status: AnalysisRun["status"], steps: [string, AnalysisRun["status"], number][], job: number | null = null): AnalysisRun => ({
  id: "00000000-0000-4000-8000-000000000001", video_id: "00000000-0000-4000-8000-000000000002", status,
  config: { sample_fps: 2, tiles: 0, detector: null, profile: "STANDARD", grids: [2] },
  steps: steps.map(([name, s, progress]) => ({ name, status: s, progress, error_code: null })),
  result: null, failure_code: null, failure_detail: null, job: job === null ? null : { state: "RUNNING", progress: job, stage_message: null },
  created_at: "2026-10-28T00:00:00Z", started_at: null, finished_at: null,
});

describe("processing stages", () => {
  it("wait with no run; the fifth stage is the video's ball track, 'Not started' until someone follows the ball (v3 Phase 0)", () => {
    expect(STAGE_STEP.map((s) => stageView(null, s).label)).toEqual(["Waiting", "Waiting", "Waiting", "Waiting", "Not started"]);
    const done = run("SUCCEEDED", [["SHOTS", "SUCCEEDED", 100], ["DETECT", "SUCCEEDED", 100], ["TRACK", "SUCCEEDED", 100], ["IDENTIFY", "SUCCEEDED", 100]]);
    expect(STAGE_STEP.map((s) => stageView(done, s).state)).toEqual(["DONE", "DONE", "DONE", "DONE", "WAITING"]);
    const ball = { status: "RUNNING", progress: 140 } as unknown as Parameters<typeof stageView>[2];
    expect(stageView(done, "TRACK_BALL", ball)).toEqual({ state: "ACTIVE", progress: 100, label: "Processing" });
    expect(stageView(done, "TRACK_BALL", { ...ball!, status: "SUCCEEDED" })).toMatchObject({ state: "DONE", label: "Completed" });
    expect(stageView(done, null).progress).toBeNull();
    expect(STAGE_STEP).not.toContain(null);
  });

  it("show the worker's own step progress while running, clamped to 0..100", () => {
    const r = run("RUNNING", [["DETECT", "RUNNING", 42.4], ["TRACK", "QUEUED", 0], ["IDENTIFY", "FAILED", 130]], 38);
    expect(stageView(r, "DETECT")).toEqual({ state: "ACTIVE", progress: 42.4, label: "Processing" });
    expect(stageView(r, "TRACK")).toEqual({ state: "WAITING", progress: null, label: "Waiting" });
    expect(stageView(r, "IDENTIFY")).toMatchObject({ state: "FAILED", progress: 100 });
    expect(runLabel(r)).toBe("Processing");
    expect(runProgress(r)).toBe(38);
    expect(isActive(r)).toBe(true);
  });

  it("report nothing for no run, 0 when queued, 100 when finished", () => {
    expect([runLabel(null), runProgress(null), isActive(null)]).toEqual(["Idle", null, false]);
    expect(runProgress(run("QUEUED", [["DETECT", "QUEUED", 0]]))).toBe(0);
    expect(runProgress(run("SUCCEEDED", []))).toBe(100);
  });
});

describe("engine-step ribbon (v3 Phase A.4)", () => {
  const done = run("SUCCEEDED", [["SHOTS", "SUCCEEDED", 100], ["DETECT", "SUCCEEDED", 100], ["TRACK", "SUCCEEDED", 100], ["IDENTIFY", "SUCCEEDED", 100]]);
  const ball = (status: string, run_id: string) => ({ status, progress: 100, run_id }) as unknown as Parameters<typeof ribbon>[0]["ball"];

  it("has the engine's eight steps; a step never asked for is 'Not run', not waiting", () => {
    const r = ribbon({ run: done, finishedRunId: done.id, ball: null, pitch: [], events: null, jobs: [] });
    expect(r.map((s) => s.key)).toEqual(["SHOTS", "DETECT", "TRACK", "IDENTIFY", "TRACK_BALL", "CALIBRATE_PITCH", "READ_LINEUPS", "FACTS"]);
    expect(r.map((s) => s.state)).toEqual(["DONE", "DONE", "DONE", "DONE", "SKIPPED", "SKIPPED", "SKIPPED", "SKIPPED"]);
    expect(r[3]!.line).toBe("No identity assigned");
  });

  it("marks the ball and its football facts out of date when they come from an older run", () => {
    const events = { state: "READY" as const, ball_track_id: "b" };
    const fresh = ribbon({ run: done, finishedRunId: done.id, ball: ball("SUCCEEDED", done.id), pitch: null, events, jobs: null });
    expect([fresh[4]!.state, fresh[7]!.state]).toEqual(["DONE", "DONE"]);
    const old = ribbon({ run: done, finishedRunId: done.id, ball: ball("SUCCEEDED", "00000000-0000-4000-8000-0000000000ff"), pitch: null, events, jobs: null });
    expect([old[4]!.state, old[4]!.label, old[7]!.state]).toEqual(["STALE", "Out of date", "STALE"]);
  });

  it("reads pitch and team sheets from their jobs and records", () => {
    const jobs = [{ kind: "READ_LINEUPS", state: "FAILED", progress: 0, created_at: "2026-11-06 10:00:00" },
      { kind: "READ_LINEUPS", state: "RUNNING", progress: 40, created_at: "2026-11-06 11:00:00" }];
    const r = ribbon({ run: done, finishedRunId: done.id, ball: null, pitch: [{ status: "SUCCEEDED" }], events: null, jobs });
    expect(r[5]).toMatchObject({ state: "DONE", progress: 100 });
    expect(r[6]).toMatchObject({ state: "ACTIVE", progress: 40, label: "Running" });     // the newest attempt counts
  });
});

describe("processing log filters (v3 Phase A.4)", () => {
  it("folds older runs, filters one step and errors, and lists the video's other jobs", () => {
    const older = { ...run("FAILED", [["DETECT", "FAILED", 10]]), id: "00000000-0000-4000-8000-00000000000a", created_at: "2026-11-01T00:00:00Z", finished_at: "2026-11-01T01:00:00Z" };
    const newer = { ...run("SUCCEEDED", [["DETECT", "SUCCEEDED", 100]]), created_at: "2026-11-05T00:00:00Z", started_at: "2026-11-05T00:01:00Z", finished_at: "2026-11-05T02:00:00Z" };
    const runs = [newer, older];
    const ballJob = { kind: "TRACK_BALL", kind_label: "Ball & events", state: "FAILED", error: "no detections", progress: 0, subject_title: null, stage: null,
      created_at: "2026-11-05 03:00:00", started_at: "2026-11-05 03:00:05", finished_at: "2026-11-05 03:10:00" } as unknown as Job;
    const render = { ...ballJob, kind: "RENDER", kind_label: "Render" } as Job;
    const all = lines(runs, [ballJob, render]);
    expect(all.some((l) => l.text.startsWith("Render"))).toBe(false);                     // renders live in the Jobs table only
    expect(visibleLines(all, runs, null, false, true).length).toBeGreaterThan(visibleLines(all, runs, null, false, false).length);
    expect(visibleLines(all, runs, "DETECT", false, true).map((l) => l.text)).toEqual(["Detection: failed", "Detection: completed"]);
    expect(visibleLines(all, runs, null, true, false).map((l) => l.text)).toEqual(["Ball & events: failed — no detections"]);
    expect(visibleLines(all, runs, "FACTS", false, false).every((l) => l.step === "TRACK_BALL")).toBe(true);
  });
});
