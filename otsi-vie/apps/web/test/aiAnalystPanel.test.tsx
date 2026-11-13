/**
 * AI Analyst panel (ADR-141): the Player report panel shows the assessment with evidence links and confidence,
 * labels recommendations as suggestions, gates publishing behind a person, and says plainly when the feature is
 * not configured or there is no assessment yet. The API is mocked; the guardrail logic itself is unit-tested in
 * aiAnalyst.test.ts.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiAnalystAssessment, AiAnalystProviderStatus } from "@otsi-vie/contracts";

vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
const api = vi.fn();
vi.mock("@/lib/api", () => ({ api: (...a: unknown[]) => api(...a), ApiProblem: class ApiProblem extends Error { constructor(readonly status: number, code: string, message: string) { super(message); } } }));

import { AiAnalystPanel } from "@/components/playerreport/AiAnalystPanel";
import { ApiProblem } from "@/lib/api";

const PLAYER = "44444444-4444-4444-8444-444444444444";
const V1 = "11111111-1111-4111-8111-111111111111";

const status = (over: Partial<AiAnalystProviderStatus> = {}): AiAnalystProviderStatus => ({
  configured: true, provider: "test-provider", model: "test-model", cost_tokens: 10,
  privacy_note: "Only this player's structured measured data is sent. No video.",
  ...over,
});

const assessment = (over: Partial<AiAnalystAssessment> = {}): AiAnalystAssessment => ({
  id: "55555555-5555-4555-8555-555555555555",
  player_id: PLAYER,
  otsi_pin: "OTSI-NGA-2026-000001",
  status: "DRAFT",
  language: "en",
  generated_at: "2026-11-11T06:00:00.000Z",
  model: "test-provider/test-model",
  prompt_version: "1.0",
  data_basis: { games_analysed: 3, minutes_seen: 270, events_count: 12, matches: [V1] },
  confidence_overall: "MEDIUM",
  strengths: [{
    text: "Wins the ball high — 2 balls won in 3 matches",
    confidence: "LOW",
    evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", match: "Nart v Ercakhu", minute: 67, event: "BALL_WON", count: 2, clip_ref: `/analysis?video=${V1}&t=4018` }],
  }],
  development_areas: [],
  recommendations: [{
    text: "Work on first touch under pressure",
    action: "First-touch drills under pressure",
    suggestion: true as const,
    confidence: "LOW",
    evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", match: "Nart v Ercakhu", minute: 23, event: "PRESSURE", count: 1, clip_ref: `/analysis?video=${V1}&t=1378` }],
  }],
  tactical_fit: { text: "Fits as a defensive midfielder", suggestion: true as const, confidence: "LOW", evidence: [{ video_id: V1, video_title: "Nart v Ercakhu", match: "Nart v Ercakhu", minute: 34, event: "BALL_WON", count: 1, clip_ref: `/analysis?video=${V1}&t=2038` }] },
  scout_brief: { strengths_summary: "Wins the ball.", fit_summary: "A defensive midfielder.", what_to_watch: "Watch his ball-winning.", key_clips: [] },
  not_measured: [{ topic: "Assists", reason: "Assists are not measured." }],
  evidence_links: [],
  post_check: { ok: true, dropped: [], failures: [], attempts: 1 },
  stale: false,
  not_enough_data_reason: null,
  requested_by: "66666666-6666-4666-8666-666666666666",
  requested_by_name: null,
  published_by: null,
  published_by_name: null,
  published_at: null,
  version: 1,
  failure: null,
  ...over,
});

function mockApi(a: AiAnalystAssessment | null, s: AiAnalystProviderStatus = status()) {
  api.mockImplementation((path: string, init?: { method?: string; json?: unknown }) => {
    if (path.endsWith("/ai-analysis/status")) return Promise.resolve(s);
    if (path.endsWith("/ai-analysis")) {
      if (init?.method === "POST") return Promise.resolve(assessment({ status: "DRAFT" }));
      return a ? Promise.resolve(a) : Promise.reject(new ApiProblem(404, "NOT_FOUND", "AI analysis not found"));
    }
    if (path.endsWith("/publish")) return Promise.resolve(assessment({ ...a, status: "PUBLISHED", published_by_name: "Owner", published_at: "2026-11-11T07:00:00.000Z" }));
    if (path.endsWith("/unpublish")) return Promise.resolve(assessment({ ...a, status: "DRAFT", published_by_name: null, published_at: null }));
    return Promise.reject(new Error(`unexpected ${path}`));
  });
}

beforeEach(() => { api.mockReset(); });

describe("AiAnalystPanel", () => {
  it("shows claims with evidence links, Low-confidence warnings, and suggestions labelled as suggestions", async () => {
    mockApi(assessment());
    render(<AiAnalystPanel playerId={PLAYER} canAssess />);
    expect(await screen.findByText("Wins the ball high — 2 balls won in 3 matches")).toBeTruthy();
    expect(screen.getByText("Thin evidence — treat this claim with care.")).toBeTruthy();
    // the label appears on the recommendation AND on the tactical fit: both are suggestions, not facts
    expect(screen.getAllByText("Suggestion, not a fact")).toHaveLength(2);
    const link = screen.getByText(/Nart v Ercakhu · 67/);
    expect(link.closest("a")?.getAttribute("href")).toBe(`/analysis?video=${V1}&t=4018`);
    expect(screen.getByText("Assists:")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
  });

  it("says plainly when the provider is not configured, with no generate button", async () => {
    mockApi(null, status({ configured: false, provider: null, model: null }));
    render(<AiAnalystPanel playerId={PLAYER} canAssess />);
    expect(await screen.findByText(/not set up on this server yet/)).toBeTruthy();
    expect(screen.queryByText("Generate AI assessment")).toBeNull();
  });

  it("asks for consent before generating, and sends it with the request", async () => {
    mockApi(null);
    render(<AiAnalystPanel playerId={PLAYER} canAssess />);
    expect(await screen.findByText(/No AI assessment yet/)).toBeTruthy();
    const button = screen.getByText("Generate AI assessment");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((button as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(button);
    await waitFor(() => expect(api).toHaveBeenCalledWith(
      `/v1/players/${PLAYER}/ai-analysis`,
      expect.objectContaining({ method: "POST", json: expect.objectContaining({ consent_acknowledged: true }) }),
    ));
  });

  it("publishes a draft only when a person presses Publish, and a stale draft cannot be published", async () => {
    mockApi(assessment());
    render(<AiAnalystPanel playerId={PLAYER} canAssess />);
    const publish = await screen.findByText("Publish");
    fireEvent.click(publish);
    await waitFor(() => expect(api).toHaveBeenCalledWith(expect.stringContaining("/publish"), expect.anything()));
    expect(await screen.findByText("Unpublish")).toBeTruthy();
  });

  it("disables Publish on a stale assessment and says why", async () => {
    mockApi(assessment({ stale: true }));
    render(<AiAnalystPanel playerId={PLAYER} canAssess />);
    const publish = await screen.findByText("Publish");
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(await screen.findByText(/Stale — a new match has been analysed/)).toBeTruthy();
  });

  it("shows the not-enough-data reason instead of an assessment", async () => {
    mockApi(assessment({ not_enough_data_reason: "Not enough data — only 2 measured events for this player (at least 5 are needed).", strengths: [], recommendations: [], tactical_fit: null, scout_brief: null, confidence_overall: "NOT_ENOUGH_DATA" }));
    render(<AiAnalystPanel playerId={PLAYER} canAssess />);
    expect(await screen.findByText(/only 2 measured events/)).toBeTruthy();
  });
});
