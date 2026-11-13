/**
 * Live job readout (billing blueprint §4.2(3)), built AS the ActivityLine narration: while a job
 * runs, the status bar narrates what the engine is doing in the worker's own words, with the tokens
 * the job committed alongside — and for an analysis, the footage minutes covered against the total.
 * When a charged job fails, the line stays up and says what happened to its tokens: refunded, with
 * the amount from the ledger, or committed with no refund recorded yet. The jobs list is published
 * the way the Jobs Center publishes it; the API (video duration, ledger) is mocked.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Job, JobList } from "@otsi-vie/contracts";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error { constructor(readonly status: number, code: string, message: string) { super(message); } } }));

import { ActivityLine } from "@/components/shell/ActivityLine";
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

beforeEach(() => {
  api.mockReset();
  api.mockImplementation((url: string) => {
    if (url === `/v1/videos/${V1}`) return Promise.resolve({ duration_us: 90 * 60 * 1_000_000 });
    if (url === "/v1/wallet/ledger?limit=200") return Promise.resolve({ entries: [] });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  publishJobs(list([]));
});

describe("ActivityLine — live job readout", () => {
  it("says nothing when no job runs", () => {
    const { container } = render(<ActivityLine />);
    expect(container).toBeEmptyDOMElement();
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
    publishJobs(list([job({
      kind: "RENDER", kind_label: "Render", subject_title: "Chinazom Godwin — highlights",
      video_id: null, progress: 55, stage: "Rendering reel…",
    })]));
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
    publishJobs(list([job({
      kind: "RENDER", kind_label: "Render", subject_title: "Chinazom Godwin — highlights",
      video_id: null, state: "FAILED", progress: 0, stage: null, error: "Render failed",
      started_at: minutesAgo(6), finished_at: finished,
    })]));
    render(<ActivityLine />);
    expect(await screen.findByText("Render failed. 10 tokens refunded.")).toBeTruthy();
  });

  it("says plainly when a failed render's tokens were committed with no refund recorded", async () => {
    publishJobs(list([job({
      kind: "RENDER", kind_label: "Render", subject_title: "Chinazom Godwin — highlights",
      video_id: null, state: "FAILED", progress: 0, stage: null, error: "Render failed",
      started_at: minutesAgo(6), finished_at: minutesAgo(5),
    })]));
    render(<ActivityLine />);
    expect(await screen.findByText("Render failed. 10 tokens were committed — no refund recorded yet.")).toBeTruthy();
  });

  it("forgets a failure older than 15 minutes", () => {
    publishJobs(list([job({
      kind: "RENDER", kind_label: "Render", subject_title: "Chinazom Godwin — highlights",
      video_id: null, state: "FAILED", progress: 0, stage: null, error: "Render failed",
      started_at: minutesAgo(20), finished_at: minutesAgo(16),
    })]));
    const { container } = render(<ActivityLine />);
    expect(container).toBeEmptyDOMElement();
  });
});
