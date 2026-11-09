/** v3 Phase A.10 (ADR-076): Upload's analysis profile card */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("@/lib/api", () => {
  class ApiProblem extends Error { constructor(readonly status: number, readonly code: string, message: string) { super(message); } }
  return { ApiProblem, api: (...a: unknown[]) => { const v = api(...a); return v === "404" ? Promise.reject(new ApiProblem(404, "NOT_ASSESSED", "no")) : v; } };
});
const page = { prefs: {} as Record<string, unknown>, setPrefs: vi.fn(), say: vi.fn() };
vi.mock("@/components/upload/page02", () => ({ usePage02: () => page }));
const up = { selected: null as Record<string, unknown> | null, canWrite: true };
vi.mock("@/components/upload/UploadWorkspace", () => ({ useUpload: () => up }));

import { duration, estimateText, ProfileCard } from "@/components/upload/ProfileCard";
import { DEFAULT_PREFS, ingestOptions } from "@/lib/uploadPrefs";

const ASSESSED = {
  id: "a1", video_id: "v1", status: "SUCCEEDED", recommended_profile: "HIGH_ACCURACY", metrics: {}, failure_code: null, failure_detail: null, created_at: "", finished_at: "",
  issues: [{ code: "BLUR", text: "Many frames are blurred." }],
  estimates: [{ profile: "STANDARD", frames: 100, passes_per_frame: 5, seconds: 300, peak_memory_mb: 2500 }, { profile: "HIGH_ACCURACY", frames: 300, passes_per_frame: 5, seconds: 4900, peak_memory_mb: 3072 },
    { profile: "ULTRA_SENSITIVE", frames: 300, passes_per_frame: 14, seconds: null, peak_memory_mb: null }],
};
const video = (opt: Record<string, unknown> | null = null) => ({ id: "v1", title: "Bell Match", state: "INGESTED", ingest_options: opt });

beforeEach(() => {
  api.mockReset(); page.setPrefs.mockReset(); page.say.mockReset();
  page.prefs = { ...DEFAULT_PREFS };
  up.selected = null; up.canWrite = true;
});

describe("analysis profile card", () => {
  it("Recommended by default and sent with the upload; estimates read as estimates", () => {
    expect(DEFAULT_PREFS.profile).toBe("RECOMMENDED");
    expect(ingestOptions(DEFAULT_PREFS)).toMatchObject({ analysis_profile: "RECOMMENDED", stabilize_video: true });
    expect([duration(30), duration(300), duration(4900)]).toEqual(["under a minute", "about 5 min", "about 1 h 22 min"]);
    expect(estimateText(ASSESSED as never, "HIGH_ACCURACY")).toBe("about 1 h 22 min on this computer · up to 3.0 GB memory (estimate)");
    expect(estimateText(ASSESSED as never, "ULTRA_SENSITIVE")).toBeNull();
  });

  it("choosing a profile sets Stabilize to match; Recommended keeps it", () => {
    render(<ProfileCard y={800} />);
    expect(screen.getByRole("radio", { name: /Recommended/ })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: /^Standard/ }));
    expect(page.setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ profile: "STANDARD", stabilize: false }));
    fireEvent.click(screen.getByRole("radio", { name: /Ultra-sensitive/ }));
    expect(page.setPrefs).toHaveBeenLastCalledWith(expect.objectContaining({ profile: "ULTRA_SENSITIVE", stabilize: true }));
    expect(screen.getByText(/Choose a video in Recent Uploads/)).toBeInTheDocument();
    expect(screen.getByText(/never below High accuracy/)).toBeInTheDocument();
  });

  it("the selected video: the profile used and why, the check's recommendation, reason and estimate", async () => {
    up.selected = video({ send_to_analysis: true, analysis_profile: "RECOMMENDED", analysis: { outcome: "STARTED", run_id: "r1", profile: "HIGH_ACCURACY", detail: "The footage check recommended High accuracy." } });
    api.mockResolvedValue(ASSESSED);
    render(<ProfileCard y={800} />);
    expect(api).toHaveBeenCalledWith("/v1/videos/v1/assessments/latest");
    await waitFor(() => expect(document.querySelector("[data-footage-check]")).toHaveAttribute("data-footage-check", "SUCCEEDED"));
    expect(document.querySelector("[data-auto-profile]")).toHaveTextContent("Analysed with High accuracy. The footage check recommended High accuracy.");
    expect(document.querySelector("[data-issue=BLUR]")).toHaveTextContent("Many frames are blurred.");
    expect(document.querySelector("[data-estimate]")).toHaveTextContent("High accuracy: about 1 h 22 min on this computer · up to 3.0 GB memory (estimate)");
  });

  it("a video never checked: a writer can check it; a viewer is told why not", async () => {
    up.selected = video({ send_to_analysis: false, analysis_profile: "STANDARD", analysis: null });
    api.mockImplementation((url: string, init?: { method?: string }) => (init?.method === "POST" ? Promise.resolve({ ...ASSESSED, status: "QUEUED" }) : "404"));
    const { unmount } = render(<ProfileCard y={800} />);
    fireEvent.click(await screen.findByRole("button", { name: "Check footage" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/videos/v1/assessments", { method: "POST" }));
    expect(await screen.findByText(/Checking the footage/)).toBeInTheDocument();
    expect(screen.getByText(/Send to Analysis was off/)).toBeInTheDocument();
    unmount();
    up.canWrite = false;
    render(<ProfileCard y={800} />);
    expect(await screen.findByText(/Your role cannot start it/)).toBeInTheDocument();
  });
});
