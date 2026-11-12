/** Jobs Center drawer (SOT, Page 12): the header, the tabs, the Job | State | Tokens | Elapsed table and the empty state */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: class ApiProblem extends Error {} }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signed-in", organization: { organization_id: "org-1" } }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));

import { JobTray } from "@/components/shell/JobTray";

const styles = { abs: "abs", jobs: "jobs", jobsCount: "jobs-count" };
const base = {
  id: "job-1", kind: "ANALYZE" as const, kind_label: "Analysis", subject_title: "Nart v Ercakhu – round 2", video_id: "v1",
  href: "/analysis", priority: "NORMAL" as const, progress: 40, stage: "Detecting players", error: null, attempts: 1,
  requested_by: "Edmond", worker: "worker-1", estimate_s: 3600, created_at: "2026-11-12T10:00:00Z",
  started_at: "2026-11-12T10:01:00Z", finished_at: null, actions: [] as never[],
};
const running = { ...base, id: "job-1", state: "RUNNING" as const };
const queued = { ...base, id: "job-2", kind: "RENDER" as const, kind_label: "Render", subject_title: "Chinazom Godwin — highlights", state: "QUEUED" as const, progress: 0, stage: null, started_at: null };
const failed = { ...base, id: "job-3", kind: "INGEST_UPLOAD" as const, kind_label: "Upload", subject_title: "FC Dynamo v Nart", state: "FAILED" as const, progress: 0, stage: null, error: "The file could not be read.", started_at: "2026-11-12T09:00:00Z", finished_at: "2026-11-12T09:05:00Z" };

function mockJobs(jobs: unknown[]) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/jobs") return Promise.resolve({ jobs, active: jobs.filter((j: any) => ["QUEUED", "RUNNING", "PAUSED"].includes(j.state)).length, running: jobs.filter((j: any) => j.state === "RUNNING").length, failed_recent: jobs.filter((j: any) => j.state === "FAILED").length });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

async function openDrawer() {
  render(<JobTray styles={styles} />);
  const trigger = screen.getByRole("button", { name: /Jobs/ });
  fireEvent.click(trigger);
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Jobs Center" })).toBeInTheDocument());
  return screen.getByRole("dialog", { name: "Jobs Center" });
}

beforeEach(() => { api.mockReset(); });

describe("Jobs Center drawer (SOT)", () => {
  it("shows the header, the tabs, the column headers, the empty state and the footer", async () => {
    mockJobs([]);
    const drawer = await openDrawer();
    expect(within(drawer).getByText("Jobs Center")).toBeInTheDocument();
    expect(within(drawer).getByText("0 active")).toBeInTheDocument();
    for (const label of ["All", "Queued", "Running", "Done", "Failed"]) {
      expect(within(drawer).getByRole("tab", { name: label })).toBeInTheDocument();
    }
    expect(within(drawer).getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");
    for (const h of ["Job", "State", "Tokens", "Elapsed"]) expect(within(drawer).getByText(h)).toBeInTheDocument();
    expect(within(drawer).getByText("No jobs yet")).toBeInTheDocument();
    expect(within(drawer).getByText("Footage checks, analyses and renders with state, cost and time.")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Upload a match video" })).toHaveAttribute("href", "/upload?mode=file");
    expect(within(drawer).getByText("The badge shows only while jobs run.")).toBeInTheDocument();
    expect(within(drawer).getByText("Ctrl J")).toBeInTheDocument();
  });

  it("lists jobs with state and elapsed, and the tabs filter them", async () => {
    mockJobs([running, queued, failed]);
    const drawer = await openDrawer();
    expect(within(drawer).getByText("2 active")).toBeInTheDocument();
    expect(within(drawer).getByText(/Analysis · Nart v Ercakhu/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Render · Chinazom Godwin/)).toBeInTheDocument();
    expect(within(drawer).getByText(/Upload · FC Dynamo/)).toBeInTheDocument();
    expect(within(drawer).getByText("The file could not be read.")).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Running" }));
    expect(within(drawer).getByText(/Analysis · Nart v Ercakhu/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/Render · Chinazom Godwin/)).not.toBeInTheDocument();
    expect(within(drawer).queryByText(/Upload · FC Dynamo/)).not.toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("tab", { name: "Failed" }));
    expect(within(drawer).getByText(/Upload · FC Dynamo/)).toBeInTheDocument();
    expect(within(drawer).queryByText(/Analysis · Nart v Ercakhu/)).not.toBeInTheDocument();
  });

  it("names a failed read instead of showing an empty list", async () => {
    api.mockRejectedValue(new Error("down"));
    const drawer = await openDrawer();
    await waitFor(() => expect(within(drawer).getByRole("alert")).toBeInTheDocument());
  });
});
