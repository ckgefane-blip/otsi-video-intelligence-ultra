/** Processing — Jobs & log (SOT, Page 19): the eight pipeline steps, the All jobs table, the History panel and the Job details inspector */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: class ApiProblem extends Error {} }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { ProcessingJobs } from "@/components/processing/ProcessingJobs";

const base = {
  id: "job-1", kind: "ANALYZE" as const, kind_label: "Analysis", subject_title: "Nart v Ercakhu – round 2", video_id: "v1",
  href: "/analysis", priority: "NORMAL" as const, progress: 40, stage: "Detecting players", error: null, attempts: 1,
  requested_by: "Edmond", worker: "worker-1", estimate_s: 3600, created_at: "2026-11-12T10:00:00Z",
  started_at: "2026-11-12T10:01:00Z", finished_at: null, actions: [] as never[],
};
const running = { ...base, id: "job-1", state: "RUNNING" as const, actions: ["pause", "cancel"] as never[] };
const queued = { ...base, id: "job-2", kind: "RENDER" as const, kind_label: "Render", subject_title: "Chinazom Godwin — highlights",
  state: "QUEUED" as const, progress: 0, stage: null, started_at: null, actions: ["cancel"] as never[] };
const failed = { ...base, id: "job-3", kind: "INGEST_UPLOAD" as const, kind_label: "Upload", subject_title: "FC Dynamo v Nart",
  state: "FAILED" as const, progress: 0, stage: null, error: "The file could not be read.", started_at: "2026-11-12T09:00:00Z",
  finished_at: "2026-11-12T09:05:00Z", actions: ["retry"] as never[] };
const finished = { ...base, id: "job-4", kind: "CALIBRATE_PITCH" as const, kind_label: "Pitch calibration", subject_title: "FC Ercakhu v FC Dynamo",
  state: "SUCCEEDED" as const, progress: 100, stage: null, started_at: "2026-11-12T08:00:00Z", finished_at: "2026-11-12T08:02:00Z", actions: [] as never[] };

function mockJobs(jobs: unknown[]) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/jobs") return Promise.resolve({ jobs, active: jobs.filter((j: any) => ["QUEUED", "RUNNING", "PAUSED"].includes(j.state)).length,
      running: jobs.filter((j: any) => j.state === "RUNNING").length, failed_recent: jobs.filter((j: any) => j.state === "FAILED").length });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

async function openPage(jobs: unknown[]) {
  mockJobs(jobs);
  render(<ProcessingJobs />);
  await waitFor(() => expect(screen.getByText("How each video is processed")).toBeInTheDocument());
}

beforeEach(() => { api.mockReset(); });

describe("Processing jobs (SOT)", () => {
  it("shows the eight steps, the All jobs table and the empty states with no jobs", async () => {
    await openPage([]);
    for (const step of ["Footage check", "Playback copy", "Detection", "Tracking", "Ball", "Lineups", "Events", "Pitch calibration"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getAllByText("Waits for a video")).toHaveLength(8);
    for (const label of ["All", "Active", "Failed", "Finished"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByText("All jobs")).toBeInTheDocument();
    expect(screen.getByText("Footage check, playback copy, analysis.")).toBeInTheDocument();
    for (const h of ["Job", "Subject", "Priority", "State", "Progress", "Actions"]) expect(screen.getByText(h)).toBeInTheDocument();
    expect(screen.getByText("No jobs")).toBeInTheDocument();
    expect(screen.getByText("Upload a match video to start.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Upload a match video" })).toHaveAttribute("href", "/upload");
    // SOT Jobs Center: the empty state is centred vertically in its area
    const empty = screen.getByText("No jobs").closest("div.empty");
    expect(empty).not.toBeNull();
    expect((empty as HTMLElement).style.minHeight).toBe("240px");
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("No finished jobs yet")).toBeInTheDocument();
    expect(screen.getByText("Finished and failed jobs appear here.")).toBeInTheDocument();
    expect(screen.getByText("Job details")).toBeInTheDocument();
    expect(screen.getByText("No job selected")).toBeInTheDocument();
    expect(screen.getByText("Pause, resume, retry or cancel it.")).toBeInTheDocument();
    expect(screen.getByText("No log output yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
    // SOT: the eyebrow reads "Processing" (not "JOBS"), the legend is plain text with dots (no chips),
    // "Upload a match video" is a secondary button, and "Log" is sentence case
    expect(screen.getByText("Processing")).toBeInTheDocument();
    expect(document.querySelector(".vie-chip")).toBeNull();
    const upload = screen.getByRole("link", { name: "Upload a match video" });
    expect(upload).toHaveClass("vie-btn");
    expect(upload.className).not.toMatch(/bg-primary/);
    expect(screen.getByText("Log")).toBeInTheDocument();
  });

  it("lists jobs with state and progress, and the filter narrows them", async () => {
    await openPage([running, queued, failed, finished]);
    const table = screen.getByLabelText("All jobs").closest("section")!;
    expect(within(table).getByText("Nart v Ercakhu – round 2")).toBeInTheDocument();
    expect(within(table).getByText("Chinazom Godwin — highlights")).toBeInTheDocument();
    expect(within(table).getByText("FC Dynamo v Nart")).toBeInTheDocument();
    expect(within(table).getByText("40%")).toBeInTheDocument();
    // the pitch step is done: the finished calibration job ran
    const steps = screen.getByLabelText("How each video is processed").closest("section")!;
    const pitch = within(steps).getByText("Pitch calibration").closest("li");
    expect(pitch).toHaveAttribute("data-step-state", "done");
    // Failed filter shows only the failed job
    fireEvent.click(screen.getByRole("button", { name: "Failed" }));
    expect(within(table).queryByText("Chinazom Godwin — highlights")).not.toBeInTheDocument();
    expect(within(table).getByText("FC Dynamo v Nart")).toBeInTheDocument();
    // Finished filter shows only the finished job
    fireEvent.click(screen.getByRole("button", { name: "Finished" }));
    expect(within(table).queryByText("FC Dynamo v Nart")).not.toBeInTheDocument();
    expect(within(table).getByText("FC Ercakhu v FC Dynamo")).toBeInTheDocument();
  });

  it("selecting a job shows its details and log in the inspector", async () => {
    await openPage([running, failed, finished]);
    const table = screen.getByLabelText("All jobs").closest("section")!;
    const row = within(table).getByText("FC Dynamo v Nart").closest("[role='button']")!;
    fireEvent.click(row);
    const insp = screen.getByLabelText("Job details");
    expect(within(insp).getByText("Upload")).toBeInTheDocument();
    expect(within(insp).getByText("The file could not be read.")).toBeInTheDocument();
    expect(within(insp).getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(within(insp).getByText("Upload: failed — The file could not be read.")).toBeInTheDocument();
    expect(within(insp).getByRole("button", { name: "Copy" })).not.toBeDisabled();
  });

  it("pauses a running job from its row", async () => {
    await openPage([running]);
    api.mockImplementation((url: string, opts?: { method?: string }) => {
      if (url === "/v1/jobs" && !opts) return Promise.resolve({ jobs: [running], active: 1, running: 1, failed_recent: 0 });
      if (url === "/v1/jobs/job-1/pause") return Promise.resolve({ ...running, state: "PAUSED" });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/jobs/job-1/pause", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(screen.getByText("Analysis: done.")).toBeInTheDocument());
  });
});
