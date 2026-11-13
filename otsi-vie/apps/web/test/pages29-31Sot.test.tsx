/**
 * SOT Pages 29-31: the Tactical page, the token counter and the welcome tour, rebuilt to the SOT.
 * Tactical is the three-column page (views + what Team shape needs | the view | Layers, Shape metrics, Compare);
 * the token counter is the top-bar .tok — a plain link to the Wallet, no popover (SOT rebuild 2026-11-13); the welcome tour
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
// the possession titles are staged as an en value change in sot-rebuild-i18n/pages-b.json (not in
// dictionaries.ts yet): patch them in here so the sentence-case labels can be asserted; remove when reconciled.
vi.mock("@/lib/i18n", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/i18n")>();
  return {
    ...orig,
    useLocale: () => {
      const state = orig.useLocale();
      return {
        ...state,
        t: {
          ...state.t,
          body: {
            ...state.t.body,
            tactics: { ...state.t.body.tactics, inPossessionTitle: "In possession", outOfPossessionTitle: "Out of possession" },
          },
        },
      };
    },
  };
});
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

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.mockImplementation(async (url: string) => {
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
  it("is a plain link to the Wallet with the live balance, and opens no popover", async () => {
    walletState.wallet = WALLET;
    walletState.tier = { tier: "Free", plan: "FREE", maxBytes: null };
    render(<TokenCounter />);
    const link = await screen.findByRole("link", { name: /tokens: 10/i });
    expect(link).toHaveAttribute("href", "/settings/wallet");
    expect(link).toHaveTextContent("10");
    fireEvent.click(link);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Last movements")).toBeNull();
    expect(screen.queryByText("Total balance")).toBeNull();
  });

  it("shows plain digits, never grouped", async () => {
    walletState.wallet = { ...WALLET, balance: 1000, spendable_balance: 1000 };
    walletState.tier = { tier: "Free", plan: "FREE", maxBytes: null };
    render(<TokenCounter />);
    const link = await screen.findByRole("link", { name: /tokens: 1000/i });
    expect(link).toHaveTextContent("1000");
    expect(link).not.toHaveTextContent("1,000");
  });

  it("marks a low balance with the low class", async () => {
    walletState.wallet = { ...WALLET, balance: 3, spendable_balance: 3, low_balance: true };
    walletState.tier = { tier: "Free", plan: "FREE", maxBytes: null };
    render(<TokenCounter />);
    const link = await screen.findByRole("link", { name: /tokens: 3/i });
    expect(link.className).toContain("low");
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
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
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
    // "Team shape needs" sits at the bottom of the left column, and Done/Required is plain text, not a tag
    expect(screen.getByText("Team shape needs").closest(".mt-auto")).not.toBeNull();
    expect(needs.querySelector(".tag")).toBeNull();
    // the three columns are fixed-width edge columns, full height (data-stage drops the shell gutter)
    expect(document.querySelector('[data-stage="tactics"]')).toBeInTheDocument();
    expect(needs.style.flex).toBe("0 0 248px");
    // one-line header: the title and its subtitle share one row
    const title = screen.getByRole("heading", { name: "Team shape" });
    expect(title.parentElement!.textContent).toContain("Average positions in and out of possession");
    expect(title.parentElement!.className).toContain("items-baseline");
    // the segs have no TEAM/PHASE/PERIOD labels; the phase seg reads "In possession" / "Out of possession"
    expect(screen.queryByText("Team")).toBeNull();
    expect(screen.queryByText("Phase")).toBeNull();
    expect(screen.queryByText("Period")).toBeNull();
    expect(screen.getByRole("button", { name: "In possession" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Out of possession" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Period" }).className).toContain("shrink-0");
    // the pitch fills the centre (flex-1 container) and the window ruler sits at the bottom of the column
    expect(await screen.findByText("No tactical data yet")).toBeInTheDocument();
    const main = screen.getByText("No tactical data yet").closest("main")!;
    expect(main.lastElementChild!.textContent).toContain("Window");
    expect(screen.getByText("Needs pitch calibration and confirmed lineups.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Analysis" })).toBeInTheDocument();
    // the inspector: four layers, four "Not measured" metrics, "Add to report" disabled (the SOT has it
    // disabled — Tactical.dc.html lines 135–136, no underlying action exists) and "Export image" live;
    // the two buttons sit side by side in one flex row
    for (const l of ["Average positions", "Team lines", "Width & depth", "Shirt numbers"]) {
      expect(screen.getByRole("switch", { name: l })).toBeInTheDocument();
    }
    expect(screen.getAllByText("Not measured")).toHaveLength(4);
    const addBtn = screen.getByRole("button", { name: "Add to report" });
    const exportBtn = screen.getByRole("button", { name: "Export image" });
    expect(addBtn).toBeDisabled();
    expect(exportBtn).toBeEnabled();
    expect(addBtn.parentElement).toBe(exportBtn.parentElement);
    expect(addBtn.parentElement!.className).toContain("flex-row");
  });

  it("Export image downloads the pitch as a PNG (and is disabled off the Team shape view)", async () => {
    // jsdom has no image loading or canvas: stub them
    const origImage = global.Image;
    const origCreateObjectURL = URL.createObjectURL;
    const origToBlob = HTMLCanvasElement.prototype.toBlob;
    const origGetContext = HTMLCanvasElement.prototype.getContext;
    const clicks: { href: string; download: string }[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push({ href: this.href, download: this.download });
    });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_v: string) { queueMicrotask(() => this.onload?.()); }
    }
    global.Image = FakeImage as unknown as typeof Image;
    URL.createObjectURL = vi.fn(() => "blob:fake") as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = vi.fn();
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.toBlob = function (cb: (b: Blob | null) => void) { cb(new Blob(["png"], { type: "image/png" })); } as unknown as typeof HTMLCanvasElement.prototype.toBlob;
    try {
      render(<TacticsStage />);
      await screen.findByText("No tactical data yet");
      fireEvent.click(screen.getByRole("button", { name: "Export image" }));
      await waitFor(() => expect(clicks.length).toBeGreaterThan(0));
      expect(clicks[0]!.download).toBe("team-shape.png");
      expect(clicks[0]!.href).toBe("blob:fake");
      // off the Team shape view there is no pitch to export
      fireEvent.click(screen.getByRole("button", { name: "Pass networks" }));
      expect(await screen.findByText("Pass network")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Export image" })).toBeDisabled();
    } finally {
      global.Image = origImage;
      URL.createObjectURL = origCreateObjectURL;
      HTMLCanvasElement.prototype.toBlob = origToBlob;
      HTMLCanvasElement.prototype.getContext = origGetContext;
      clickSpy.mockRestore();
    }
  });

  it("switching views shows that view's panel", async () => {
    render(<TacticsStage />);
    await screen.findByText("No tactical data yet");
    fireEvent.click(screen.getByRole("button", { name: "Pass networks" }));
    expect(await screen.findByText("Pass network")).toBeInTheDocument();
    expect(screen.queryByText("No tactical data yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Compare two players" }));
    expect(await screen.findByText("Player comparison")).toBeInTheDocument();
  });
});
