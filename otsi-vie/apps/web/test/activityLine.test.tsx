/**
 * Live job readout (billing blueprint §4.2(3)), built AS the ActivityLine narration: while a job
 * runs, the status bar narrates what the engine is doing in the worker's own words, with the tokens
 * the job committed alongside — and for an analysis, the footage minutes covered against the total.
 * When a charged job fails, the line stays up and says what happened to its tokens: refunded, with
 * the amount from the ledger, or committed with no refund recorded yet. The jobs list is published
 * the way the Jobs Center publishes it; the API (video duration, ledger) is mocked.
 *
 * App-wide ActivityLine: the same narration covers the client-side actions too (export pack, player
 * report, AI Analyst, Scouting Pack, file upload — lib/activities.ts), rotating through every
 * running action in turn; the last completed action is shown briefly, then a plain idle line.
 */
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobList } from "@otsi-vie/contracts";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error { constructor(readonly status: number, code: string, message: string) { super(message); } } }));

import { ActivityLine } from "@/components/shell/ActivityLine";
import { finishActivity, publishActivities, startActivity, startUploadActivity, type ClientActivity } from "@/lib/activities";
import { publishJobs } from "@/lib/jobsLive";

const V1 = "11111111-1111-4111-8111-111111111111";
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function job(over: Partial<Job>): Job {
  return {
    id: "job-1", kind: "ANALYZE", kind_label: "Analysis", subject_title: "Nart v Ercakhu",
    video_id: V1, href: "/processing", state: "RUNNING", priority: "NORMAL", progress: 38,
    stage: "Tracking players…", error: null, attempts: 1, requested_by: null, worker: "worker-1",
    estimate_s: null, started_at: minutesAgo(2), finished_at: null, created_at: minutesAgo(2),
    ...over,
  } as unknown as Job;
}
const list = (jobs: Job[]): JobList => ({
  jobs, active: jobs.filter((j) => j.state === "RUNNING" || j.state === "QUEUED").length,
  running: jobs.filter((j) => j.state === "RUNNING").length,
  failed_recent: jobs.filter((j) => j.state === "FAILED").length,
} as unknown as JobList);
const renderJob = (over: Partial<Job>): Job => job({
  kind: "RENDER", kind_label: "Render", subject_title: "Chinazom Godwin — highlights",
  video_id: null, progress: 55, stage: "Rendering reel…", ...over,
});
const activity = (over: Partial<ClientActivity>): ClientActivity => ({
  id: "act-1", kind: "EXPORT_PACK", subject: "Chinazom Godwin — highlights",
  startedAt: minutesAgo(1), progress: null, state: "RUNNING", finishedAt: null,
  chargedType: "EXPORT_PACK", cost: 10, ...over,
});

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((url: string) => {
    if (url === `/v1/videos/${V1}`) return Promise.resolve({ duration_us: 90 * 60 * 1_000_000 });
    if (url === "/v1/wallet/ledger?limit=200") return Promise.resolve({ entries: [] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  publishJobs(list([]));
  publishActivities([]);
});

describe("ActivityLine — live job readout", () => {
  it("says nothing is running when no job runs", () => {
    render(<ActivityLine />);
    expect(screen.getByText("Nothing running")).toBeTruthy();
  });

  it("narrates a running analysis in words, with the minute covered and the tokens committed", async () => {
    publishJobs(list([job({ progress: 38, stage: "Tracking players…" })]));
    render(<ActivityLine />);
    expect(await screen.findByText(/Tracking players/)).toBeTruthy();
    expect(screen.getByText("minute 34 of 90")).toBeTruthy();
    expect(screen.getByText("90 tokens")).toBeTruthy();
    expect(screen.getByText("38%")).toBeTruthy();
  });

  it("narrates a running render with its 10 committed tokens and no minute line", async () => {
    publishJobs(list([renderJob({})]));
    render(<ActivityLine />);
    expect(await screen.findByText(/Rendering reel/)).toBeTruthy();
    expect(screen.getByText("10 tokens")).toBeTruthy();
    expect(screen.queryByText(/minute/)).toBeNull();
    expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/v1/videos/"));
  });

  it("says a queued job is waiting to start", async () => {
    publishJobs(list([job({ state: "QUEUED", progress: 0, stage: null, started_at: null })]));
    render(<ActivityLine />);
    expect(await screen.findByText(/waiting to start/)).toBeTruthy();
  });

  it("says a failed render's tokens were refunded, with the amount from the ledger", async () => {
    const finished = minutesAgo(5);
    api.mockImplementation((url: string) => {
      if (url === "/v1/wallet/ledger?limit=200") {
        return Promise.resolve({ entries: [{
          id: "0190a000-0000-7000-8000-000000000101", organization_id: "0190a000-0000-7000-8000-000000000001",
          kind: "REFUND", amount: 10, balance_after: 500, job_type: "REEL_RENDER", job_id: null,
          idempotency_key: "refund:render-1", invoice_ref: null, reason: "Render failed", actor_id: null,
          expires_at: null, created_at: minutesAgo(4),
        }] });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    publishJobs(list([renderJob({
      state: "FAILED", progress: 0, stage: null, error: "Render failed",
      started_at: minutesAgo(6), finished_at: finished,
    })]));
    render(<ActivityLine />);
    expect(await screen.findByText("Render failed. 10 tokens refunded.")).toBeTruthy();
  });

  it("says plainly when a failed render's tokens were committed with no refund recorded", async () => {
    publishJobs(list([renderJob({
      state: "FAILED", progress: 0, stage: null, error: "Render failed",
      started_at: minutesAgo(6), finished_at: minutesAgo(5),
    })]));
    render(<ActivityLine />);
    expect(await screen.findByText("Render failed. 10 tokens were committed — no refund recorded yet.")).toBeTruthy();
  });

  it("forgets a failure older than 15 minutes", () => {
    publishJobs(list([renderJob({
      state: "FAILED", progress: 0, stage: null, error: "Render failed",
      started_at: minutesAgo(20), finished_at: minutesAgo(16),
    })]));
    render(<ActivityLine />);
    expect(screen.getByText("Nothing running")).toBeTruthy();
  });
});

describe("ActivityLine — rotation through every running action", () => {
  it("rotates through two running jobs, saying which one is shown", () => {
    vi.useFakeTimers();
    try {
      publishJobs(list([
        renderJob({ id: "job-1", subject_title: "Reel one", stage: "Rendering reel one…" }),
        renderJob({ id: "job-2", subject_title: "Reel two", stage: "Rendering reel two…", progress: 20 }),
      ]));
      render(<ActivityLine />);
      expect(screen.getByText(/Rendering reel one/)).toBeTruthy();
      expect(screen.getByText("1 of 2")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.getByText(/Rendering reel two/)).toBeTruthy();
      expect(screen.getByText("2 of 2")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.getByText(/Rendering reel one/)).toBeTruthy();
      expect(screen.getByText("1 of 2")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rotates through a worker job and a client activity in one cycle", () => {
    vi.useFakeTimers();
    try {
      publishJobs(list([renderJob({ stage: "Rendering reel one…" })]));
      publishActivities([activity({})]);
      render(<ActivityLine />);
      expect(screen.getByText(/Rendering reel one/)).toBeTruthy();
      expect(screen.getByText("1 of 2")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(4000); });
      expect(screen.getByText(/Making the export pack/)).toBeTruthy();
      expect(screen.getByText("2 of 2")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows no position when only one action runs", () => {
    publishJobs(list([renderJob({})]));
    render(<ActivityLine />);
    expect(screen.queryByText(/of 2/)).toBeNull();
    expect(screen.queryByText(/1 of 1/)).toBeNull();
  });
});

describe("ActivityLine — client activities (export, report, AI, pack, upload)", () => {
  it("narrates a running export pack with its 10 tokens and elapsed time, and no fake progress", async () => {
    startActivity("EXPORT_PACK", "Chinazom Godwin — highlights", "EXPORT_PACK", 10);
    render(<ActivityLine />);
    expect(await screen.findByText(/Making the export pack/)).toBeTruthy();
    expect(screen.getByText("10 tokens")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it("ticks the elapsed time of a client activity every second", () => {
    vi.useFakeTimers();
    try {
      startActivity("EXPORT_PACK", null, "EXPORT_PACK", 10);
      render(<ActivityLine />);
      expect(screen.getByText("0s")).toBeTruthy();
      act(() => { vi.advanceTimersByTime(5000); });
      expect(screen.getByText("5s")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("narrates an upload with its real progress %", async () => {
    startUploadActivity({ id: "t-1", name: "Nart v Ercakhu.mp4", state: "sending", progress: 42 });
    render(<ActivityLine />);
    expect(await screen.findByText(/Uploading Nart v Ercakhu.mp4/)).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    startUploadActivity({ id: "t-1", name: "Nart v Ercakhu.mp4", state: "sending", progress: 57 });
    expect(await screen.findByText("57%")).toBeTruthy();
  });

  it("says a failed export pack's tokens were committed with no refund recorded", async () => {
    const id = startActivity("EXPORT_PACK", "Reel one", "EXPORT_PACK", 10);
    finishActivity(id, false);
    render(<ActivityLine />);
    expect(await screen.findByText("Export pack failed. 10 tokens were committed — no refund recorded yet.")).toBeTruthy();
  });

  it("says a failed export pack's tokens were refunded, with the amount from the ledger", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/wallet/ledger?limit=200") {
        return Promise.resolve({ entries: [{
          id: "0190a000-0000-7000-8000-000000000101", organization_id: "0190a000-0000-7000-8000-000000000001",
          kind: "REFUND", amount: 10, balance_after: 500, job_type: "EXPORT_PACK", job_id: null,
          idempotency_key: "refund:pack-1", invoice_ref: null, reason: "Export pack failed", actor_id: null,
          expires_at: null, created_at: minutesAgo(1),
        }] });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    publishActivities([activity({ state: "FAILED", finishedAt: minutesAgo(2) })]);
    render(<ActivityLine />);
    expect(await screen.findByText("Export pack failed. 10 tokens refunded.")).toBeTruthy();
  });

  it("says a failed upload failed, with no token line and no ledger read", async () => {
    publishActivities([activity({
      id: "upload-t-1", kind: "UPLOAD", subject: "Nart v Ercakhu.mp4", progress: 42,
      state: "FAILED", finishedAt: minutesAgo(1), chargedType: null, cost: null,
    })]);
    render(<ActivityLine />);
    expect(await screen.findByText("Upload · Nart v Ercakhu.mp4 failed.")).toBeTruthy();
    expect(screen.queryByText(/tokens/)).toBeNull();
    expect(api).not.toHaveBeenCalledWith("/v1/wallet/ledger?limit=200");
  });
});

describe("ActivityLine — last completed, then idle", () => {
  it("says a job that just finished, briefly", async () => {
    publishJobs(list([job({ state: "SUCCEEDED", progress: 100, stage: null, started_at: minutesAgo(10), finished_at: minutesAgo(2) })]));
    render(<ActivityLine />);
    expect(await screen.findByText("Analysis finished — Nart v Ercakhu")).toBeTruthy();
  });

  it("says an export pack is ready after it finishes", async () => {
    const id = startActivity("EXPORT_PACK", "Reel one", "EXPORT_PACK", 10);
    finishActivity(id, true);
    render(<ActivityLine />);
    expect(await screen.findByText("Export pack ready")).toBeTruthy();
  });

  it("says an upload finished, with the file name", async () => {
    publishActivities([activity({
      id: "upload-t-1", kind: "UPLOAD", subject: "Nart v Ercakhu.mp4", progress: 100,
      state: "SUCCEEDED", finishedAt: minutesAgo(2), chargedType: null, cost: null,
    })]);
    render(<ActivityLine />);
    expect(await screen.findByText("Upload finished — Nart v Ercakhu.mp4")).toBeTruthy();
  });

  it("shows the idle line once the last completion is older than 5 minutes", () => {
    publishActivities([activity({ state: "SUCCEEDED", finishedAt: minutesAgo(6) })]);
    render(<ActivityLine />);
    expect(screen.getByText("Nothing running")).toBeTruthy();
    expect(screen.queryByText(/Export pack ready/)).toBeNull();
  });
});
