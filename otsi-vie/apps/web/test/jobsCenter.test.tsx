/** Jobs Center link (SOT rebuild 2026-11-13): the top bar's Jobs Center is a link to the jobs page with the pulse icon, no count
 *  badge and no drawer. The jobs table itself lives on /processing (the All jobs table, with the same actions). */
import { render, screen, waitFor } from "@testing-library/react";
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

function mockJobs(jobs: unknown[]) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/jobs") return Promise.resolve({ jobs, active: jobs.filter((j: any) => ["QUEUED", "RUNNING", "PAUSED"].includes(j.state)).length, running: jobs.filter((j: any) => j.state === "RUNNING").length, failed_recent: jobs.filter((j: any) => j.state === "FAILED").length });
    return Promise.reject(new Error(`unexpected ${url}`));
  });
}

beforeEach(() => { api.mockReset(); });

describe("Jobs Center link (SOT)", () => {
  it("is a link to the jobs page, named with the active count, with the pulse icon and no badge", async () => {
    mockJobs([running, queued]);
    render(<JobTray styles={styles} />);
    const link = await screen.findByRole("link", { name: "Jobs Center, 2 active" });
    expect(link).toHaveAttribute("href", "/processing");
    expect(link).toHaveAttribute("data-job-tray");
    expect(document.querySelector("[data-job-count]")).toBeNull();   // no badge element at all
    expect(screen.queryByRole("dialog")).toBeNull();                 // no drawer
  });

  it("names 0 active when nothing runs, and keeps the link while the list is loading", async () => {
    mockJobs([]);
    render(<JobTray styles={styles} />);
    expect(await screen.findByRole("link", { name: "Jobs Center, 0 active" })).toHaveAttribute("href", "/processing");
  });

  it("a failed read keeps the link (named as loading) instead of showing an empty list", async () => {
    api.mockRejectedValue(new Error("down"));
    render(<JobTray styles={styles} />);
    const link = screen.getByRole("link", { name: "Jobs Center" });
    expect(link).toHaveAttribute("href", "/processing");
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/jobs"));
  });
});
