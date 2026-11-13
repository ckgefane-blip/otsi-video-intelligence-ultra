/** Platform health review-inbox decisions: POST /v1/overview/inbox/decisions with the row's stable id,
 *  APPROVE for every kind, REJECT disabled for STALE_REEL / FAILED_JOB (422 DECISION_NOT_SUPPORTED),
 *  and the inbox re-fetched after a decision. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PlatformHealth } from "@/components/admin/PlatformHealth";

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api, ApiProblem: Error }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ organization: { organization_id: "org-1", role: "OWNER" } }),
}));

const VIDEO_1 = "11111111-1111-4111-8111-111111111111";
const VIDEO_2 = "22222222-2222-4222-8222-222222222222";
const VIDEO_4 = "44444444-4444-4444-8444-444444444444";
const REEL_3 = "33333333-3333-4333-8333-333333333333";

const inbox = {
  next: null,
  completed_match: true,
  items: [
    { id: `IDENTITY:${VIDEO_1}`, kind: "IDENTITY", title: "Check 2 identity suggestions", detail: "Nart v Ercakhu", count: 2, href: `/analysis?video=${VIDEO_1}`, video_id: VIDEO_1 },
    { id: `TEAM_SHEET:${VIDEO_2}`, kind: "TEAM_SHEET", title: "Approve the proposed team sheet", detail: "Nart v Ercakhu", count: 1, href: `/analysis?video=${VIDEO_2}`, video_id: VIDEO_2 },
    { id: `STALE_REEL:${REEL_3}`, kind: "STALE_REEL", title: "Refresh the stale reel", detail: null, count: 1, href: "/reels", video_id: null },
    { id: `FAILED_JOB:${VIDEO_4}`, kind: "FAILED_JOB", title: "Run the failed job again", detail: null, count: 1, href: "/processing", video_id: VIDEO_4 },
  ],
};

const dashboard = {
  concurrency: { max_concurrent_analysis: 1, max_concurrent_renders: 2, max_concurrent_ingest: 2, queue_paused: false },
  models: [],
  workers: [],
};
const jobs = { jobs: [], running: 0, queued: 0, active: 0 };
const licence = { plan: "Starter", valid_until: "2027-01-01T00:00:00.000Z" };
const gates = { accuracy_measured: false };

const renderHealth = () => {
  // the inbox the server returns changes when a decision lands (the decided row is gone)
  let currentInbox = inbox;
  api.mockImplementation((url: unknown, opts?: { method?: string; json?: unknown }) => {
    if (url === "/v1/admin/dashboard") return Promise.resolve(dashboard);
    if (url === "/v1/overview/inbox") return Promise.resolve(currentInbox);
    if (url === "/v1/jobs") return Promise.resolve(jobs);
    if (url === "/v1/licence") return Promise.resolve(licence);
    if (url === "/v1/admin/release-gates") return Promise.resolve(gates);
    if (url === "/v1/overview/inbox/decisions" && opts?.method === "POST") {
      const body = opts.json as { item_id: string; decision: string; reason: string | null };
      const item = currentInbox.items.find((i) => i.id === body.item_id)!;
      currentInbox = { ...currentInbox, items: currentInbox.items.filter((i) => i.id !== body.item_id) };
      return Promise.resolve({
        item_id: body.item_id, kind: item.kind, decision: body.decision, applied: 1, failures: [], inbox: currentInbox,
      });
    }
    return Promise.reject(new Error(`unexpected ${String(url)}`));
  });
  render(<PlatformHealth />);
};

describe("Platform health review-inbox decisions", () => {
  // braces: a beforeEach that returns a function registers it as a cleanup — api.mockClear() returns the mock itself
  beforeEach(() => { api.mockClear(); });

  it("APPROVE posts the row's stable id and re-fetches the inbox", async () => {
    renderHealth();
    expect(await screen.findByText("Approve the proposed team sheet")).toBeInTheDocument();
    // Approve buttons are in row order: IDENTITY, TEAM_SHEET, STALE_REEL, FAILED_JOB
    const approve = screen.getAllByRole("button", { name: "Approve" });
    fireEvent.click(approve[1]!);
    await waitFor(() => expect(screen.queryByText("Approve the proposed team sheet")).toBeNull());
    const post = api.mock.calls.find((c) => c[0] === "/v1/overview/inbox/decisions");
    expect(post).toBeDefined();
    expect(post![1]).toEqual({
      method: "POST",
      json: { item_id: `TEAM_SHEET:${VIDEO_2}`, decision: "APPROVE", reason: null },
    });
    // initial load + the re-fetch after the decision (the delayed second re-fetch may follow)
    expect(api.mock.calls.filter((c) => c[0] === "/v1/overview/inbox").length).toBeGreaterThanOrEqual(2);
  });

  it("renders open sections, a plain-text inbox count and the teal slider thumb", async () => {
    renderHealth();
    expect(await screen.findByText("Check 2 identity suggestions")).toBeInTheDocument();
    // the SOT's count is plain text with a dot, not a pill chip; the stat cards and sections are open
    expect(screen.getByText("• 4 items")).toBeInTheDocument();
    expect(document.querySelector(".vie-panel")).toBeNull();
    expect(document.querySelector(".vie-chip")).toBeNull();
    const style = [...document.querySelectorAll("style")].map((el) => el.textContent).join("");
    expect(style).toContain("slider-thumb");
    expect(style).toContain("var(--primary)");
  });

  it("Reject is disabled for STALE_REEL and FAILED_JOB rows, enabled for the others", async () => {
    renderHealth();
    expect(await screen.findByText("Refresh the stale reel")).toBeInTheDocument();
    // rows render in fixture order: IDENTITY, TEAM_SHEET, STALE_REEL, FAILED_JOB
    const reject = screen.getAllByRole("button", { name: "Reject…" });
    expect(reject).toHaveLength(4);
    expect(reject[0]).toBeEnabled();
    // an identity is never approved in bulk: its Approve is off and says where to confirm
    const approve = screen.getAllByRole("button", { name: "Approve" });
    expect(approve[0]).toBeDisabled();
    expect(approve[0]).toHaveAttribute("title", "Confirm each moment in Analysis");
    expect(reject[1]).toBeEnabled();
    expect(reject[2]).toBeDisabled();
    expect(reject[3]).toBeDisabled();
  });

  it("REJECT posts with the reason, capped at 500 characters", async () => {
    renderHealth();
    expect(await screen.findByText("Check 2 identity suggestions")).toBeInTheDocument();
    const reject = screen.getAllByRole("button", { name: "Reject…" });
    fireEvent.click(reject[0]!);
    const input = screen.getByRole("textbox");
    expect(input).toHaveAttribute("maxlength", "500");
    fireEvent.change(input, { target: { value: "Wrong player" } });
    // the confirm Reject is the second Reject button once the form is open
    const confirm = screen.getAllByRole("button", { name: "Reject…" });
    fireEvent.click(confirm[1]!);
    await waitFor(() => expect(screen.queryByText("Check 2 identity suggestions")).toBeNull());
    const post = api.mock.calls.find((c) => c[0] === "/v1/overview/inbox/decisions");
    expect(post).toBeDefined();
    expect(post![1]).toEqual({
      method: "POST",
      json: { item_id: `IDENTITY:${VIDEO_1}`, decision: "REJECT", reason: "Wrong player" },
    });
  });
});
