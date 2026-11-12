/**
 * SOT Pages 29-31: the Tactical page, the token counter and the welcome tour, rebuilt to the SOT.
 * Tactical is the three-column page (views + what Team shape needs | the view | Layers, Shape metrics, Compare);
 * the token counter is the top-bar .tok with the popover (tier, total, expired, last movements); the welcome tour
 * is the six-step modal over Home, whose first step asks for the person's name.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, replaceMock, pushMock, walletState } = vi.hoisted(() => ({ apiMock: vi.fn(), replaceMock: vi.fn(), pushMock: vi.fn(),
  walletState: { wallet: undefined as unknown, tier: undefined as unknown } }));
const me = { user: { id: "u1", email: "owner@club.com", display_name: "", onboarded_at: null }, memberships: [] };

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
  usePathname: () => "/tactics",
  useSearchParams: () => new URLSearchParams("video=11111111-1111-1111-1111-111111111111"),
  useParams: () => ({}),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-in", me, organization: { organization_id: "o1" },
    signIn: vi.fn(), signInWithCode: vi.fn(), signInWithPasskey: vi.fn(),
    adoptSession: vi.fn(), signOut: vi.fn(), chooseOrganization: vi.fn(), updateMe: vi.fn(),
  }),
}));
vi.mock("@/lib/wallet", () => ({
  useWalletBalance: () => walletState.wallet,
  walletReadAt: () => Date.now() - 3000,
  walletChanged: vi.fn(),
  setWalletBusy: vi.fn(),
}));
vi.mock("@/lib/uploadTier", () => ({
  useTierLimit: () => walletState.tier,
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiProblem: class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  },
}));
vi.mock("@/components/analysis/AnalysisWorkspace", () => ({
  AnalysisWorkspace: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAnalysisWorkspace: () => ({
    video: { id: "11111111-1111-1111-1111-111111111111", match_id: "22222222-2222-2222-2222-222222222222", title: "Nart v Ercakhu" },
    run: { id: "33333333-3333-3333-3333-333333333333" },
    tracks: [],
    pitch: { list: [{ id: "c1", status: "SUCCEEDED" }], camera: null, reload: vi.fn() },
    seek: vi.fn(), select: vi.fn(),
  }),
}));

import { TacticsStage } from "@/components/tactics/TacticsStage";
import { TokenCounter } from "@/components/shell/TokenCounter";
import { WelcomeTour } from "@/components/auth/Onboarding";

const MATCH = { id: "22222222-2222-2222-2222-222222222222", home: { id: "h1", name: "Nart" }, away: { id: "a1", name: "Ercakhu" },
  roster: [{ player_id: "p1", display_name: "Chinazom Godwin", jersey_number: 4, position: "DM", verified: true }] };
const WALLET = { organization_id: "o1", balance: 10, spendable_balance: 10, expired_unwritten_off: 0, low_balance: false };
const LEDGER = { entries: [
  { id: "l1", kind: "SPEND", job_type: "ANALYSIS", amount: -90, balance_after: 10, created_at: "2026-11-12T10:00:00.000Z", job_id: "j1" },
  { id: "l2", kind: "FREE_GRANT", job_type: null, amount: 100, balance_after: 100, created_at: "2026-11-11T09:00:00.000Z", job_id: null },
] };

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.mockImplementation(async (url: string) => {
    if (url.startsWith("/v1/wallet/ledger")) return LEDGER;
    if (url.startsWith("/v1/wallet")) return WALLET;
    if (url.startsWith("/v1/licence")) return { plan: "FREE" };
    if (url.includes("/kit-groups")) return { groups: [] };
    if (url.startsWith("/v1/matches/")) return MATCH;
    if (url.includes("/team-shape")) return null;
    if (url.includes("/formations")) return { teams: [] };
    if (url === "/v1/me") return { user: { ...me.user, onboarded_at: "2026-11-12T23:00:00.000Z", display_name: "Awore" }, memberships: [] };
    throw new Error(`unexpected api call ${url}`);
  });
});

describe("Token counter (SOT page 30)", () => {
  it("shows the live balance and opens the popover with the tier, totals and last movements", async () => {
    walletState.wallet = WALLET;
    walletState.tier = { tier: "Free", plan: "FREE", maxBytes: null };
    render(<TokenCounter />);
    const btn = await screen.findByRole("button", { name: /tokens: 10/i });
    expect(btn).toHaveTextContent("10");
    fireEvent.click(btn);
    expect(await screen.findByText("Spendable now · Free tier")).toBeInTheDocument();
    expect(screen.getByText("Total balance")).toBeInTheDocument();
    expect(screen.getByText("Expired, not yet written off")).toBeInTheDocument();
    expect(screen.getByText("Last movements")).toBeInTheDocument();
    expect(await screen.findByText(/Spent · Analysis/)).toBeInTheDocument();
    expect(screen.getByText("Free grant")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Wallet" })).toHaveAttribute("href", "/settings/wallet");
  });

  it("marks a low balance with the low class", async () => {
    walletState.wallet = { ...WALLET, balance: 3, spendable_balance: 3, low_balance: true };
    walletState.tier = { tier: "Free", plan: "FREE", maxBytes: null };
    render(<TokenCounter />);
    const btn = await screen.findByRole("button", { name: /tokens: 3/i });
    expect(btn.className).toContain("low");
    fireEvent.click(btn);
    expect(await screen.findByText(/Low balance/)).toBeInTheDocument();
  });
});

describe("Welcome tour (SOT page 31)", () => {
  it("lists six steps, asks for the name first, and finishes with the name saved", async () => {
    render(<WelcomeTour />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    for (const step of ["Your name", "Work context", "Upload & processing", "Confirming identity", "Reels & reports", "Evidence labels"]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
    const input = screen.getByLabelText("Display name");
    fireEvent.change(input, { target: { value: "Awore" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("2 / 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("1 / 6")).toBeInTheDocument();
    // to the last step, then finish
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("6 / 6")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get Started" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/me", expect.objectContaining({ method: "PATCH",
      json: { display_name: "Awore", onboarding_done: true } })));
  });

  it("Skip tour ends the tour without saving a name", async () => {
    render(<WelcomeTour />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/me", expect.objectContaining({ method: "PATCH",
      json: { onboarding_done: true } })));
  });
});

describe("Tactical (SOT page 29)", () => {
  it("lists the seven views, the three needs as met, and the Team shape empty state", async () => {
    render(<TacticsStage />);
    for (const v of ["Team shape", "Pass networks", "Heat zones", "Pressing & defence", "Off-ball runs", "Transitions", "Compare two players"]) {
      expect(await screen.findByRole("button", { name: v })).toBeInTheDocument();
    }
    expect(screen.getByText("Team shape needs")).toBeInTheDocument();
    const needs = screen.getByText("Team shape needs").closest("aside")!;
    expect(within(needs).getAllByText("Done")).toHaveLength(3);
    expect(await screen.findByText("No tactical data yet")).toBeInTheDocument();
    expect(screen.getByText("Needs pitch calibration and confirmed lineups.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Analysis" })).toBeInTheDocument();
    // the inspector: four layers, four "Not measured" metrics, two disabled actions
    for (const l of ["Average positions", "Team lines", "Width & depth", "Shirt numbers"]) {
      expect(screen.getByRole("switch", { name: l })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Not measured")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "Add to report" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export image" })).toBeDisabled();
  });

  it("switching views shows that view's panel", async () => {
    render(<TacticsStage />);
    await screen.findByText("No tactical data yet");
    fireEvent.click(screen.getByRole("button", { name: "Pass networks" }));
    expect(await screen.findByText("Pass Network")).toBeInTheDocument();
    expect(screen.queryByText("No tactical data yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare two players" }));
    expect(await screen.findByText("Player Comparison")).toBeInTheDocument();
  });
});
