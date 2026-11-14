/**
 * Offline Token Wallet (staging walkthrough 2026-11-14): when central cannot be reached the page
 * shows the last data the app actually saw — balance, plan, ledger and pack requests — and when
 * nothing was ever read it says plainly that it cannot load them offline, instead of the wrong
 * "No ledger entries yet" / "No pack requests". Only values the server really returned are shown.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/settings/wallet", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/api", () => ({
  api: (...a: unknown[]) => api(...a),
  apiBlob: vi.fn(),
  ApiProblem: class ApiProblem extends Error {
    status: number; code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
  },
}));

const ORG = "0190a000-0000-7000-8000-000000000001";
const entry = (overrides: Record<string, unknown> = {}) => ({
  id: "0190a000-0000-7000-8000-000000000002",
  organization_id: ORG,
  kind: "FREE_GRANT",
  balance_after: 100,
  job_type: null,
  job_id: null,
  idempotency_key: "test-grant",
  invoice_ref: null,
  reason: "One-time free grant: 100 tokens, expiring 30 days after signup.",
  actor_id: null,
  expires_at: null,
  created_at: "2026-11-14T01:42:52.000Z",
  amount: 100,
  ...overrides,
});
const packRequest = (overrides: Record<string, unknown> = {}) => ({
  id: "0190a000-0000-7000-8000-000000000006",
  organization_id: ORG,
  organization_name: "Gefane United",
  pack_code: "PLAYER",
  currency: "NGN",
  amount_minor: 300_000,
  tokens: 100,
  status: "PAID",
  invoice_ref: "OTSI-INV-2026-000001",
  requested_by: "0190a000-0000-7000-8000-000000000003",
  created_at: "2026-11-14T04:41:59.000Z",
  updated_at: "2026-11-14T05:00:00.000Z",
  ...overrides,
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  api.mockReset();
  vi.resetModules();
});

async function renderWallet() {
  const { WalletView } = await import("@/components/wallet/WalletView");
  render(<WalletView />);
  await waitFor(() => expect(screen.getByText("Token Wallet & plan")).toBeInTheDocument());
}

describe("offline Token Wallet", () => {
  it("shows the last known plan, balance, ledger and pack requests when every API call fails", async () => {
    // the app was online before (on any page): balance 200, plan "Free", the grant + purchase
    // ledger rows and the paid pack request were persisted
    localStorage.setItem("otsi-wallet-last-known", JSON.stringify({ organization_id: ORG, balance: 200, spendable_balance: 200, expired_unwritten_off: 0, low_balance: false }));
    localStorage.setItem("otsi-wallet-last-known-plan", "Free");
    localStorage.setItem("otsi-wallet-last-known-ledger", JSON.stringify([
      entry(),
      entry({ id: "0190a000-0000-7000-8000-000000000004", kind: "PURCHASE", balance_after: 200, invoice_ref: "OTSI-INV-2026-000001", reason: null, created_at: "2026-11-14T05:00:00.000Z", idempotency_key: "test-purchase" }),
    ]));
    localStorage.setItem("otsi-wallet-last-known-requests", JSON.stringify([packRequest()]));
    // offline: every API call fails
    api.mockImplementation(() => Promise.reject(new Error("offline")));
    await renderWallet();
    // balance and plan: the last known values, not "—" and not blank
    expect(document.querySelector(".metric")!.textContent).toBe("200");
    const planLine = document.querySelector("[data-current-plan]");
    expect(planLine).not.toBeNull();
    expect(planLine!.textContent).toContain("Free");
    // the cached rows are shown, with the note that they are the last data seen
    expect(screen.getAllByText("You're offline — showing the last data this app saw.")).toHaveLength(2);
    // the paid pack request (row) and the purchase ledger row (note) both carry the invoice ref
    expect(screen.getAllByText(/OTSI-INV-2026-000001/)).toHaveLength(2);
    expect(screen.getByText("Free grant")).toBeInTheDocument();
    // and the wrong empty states are NOT shown
    expect(screen.queryByText("No ledger entries yet")).toBeNull();
    expect(screen.queryByText("No pack requests")).toBeNull();
  }, 30_000);

  it("says it cannot load the ledger and pack requests offline when nothing was ever cached", async () => {
    // nothing in localStorage at all: no balance, no plan, no rows
    api.mockImplementation(() => Promise.reject(new Error("offline")));
    await renderWallet();
    expect(screen.getByText("Can't load the ledger while offline.")).toBeInTheDocument();
    expect(screen.getByText("Can't load pack requests while offline.")).toBeInTheDocument();
    expect(screen.queryByText("No ledger entries yet")).toBeNull();
    expect(screen.queryByText("No pack requests")).toBeNull();
  }, 30_000);

  it("persists the ledger and pack requests on a successful load, so a later offline visit shows them", async () => {
    const { planCatalogue, tokenPackCatalogue } = await import("@otsi-vie/contracts");
    api.mockImplementation((url: string) => {
      if (url === "/v1/wallet") return Promise.resolve({ organization_id: ORG, balance: 200, spendable_balance: 200, expired_unwritten_off: 0, low_balance: false });
      if (url === "/v1/wallet/ledger?limit=200") return Promise.resolve({ balance: { organization_id: ORG, balance: 200, spendable_balance: 200, expired_unwritten_off: 0, low_balance: false }, entries: [entry(), entry({ id: "0190a000-0000-7000-8000-000000000004", kind: "PURCHASE", balance_after: 200, invoice_ref: "OTSI-INV-2026-000001", reason: null, created_at: "2026-11-14T05:00:00.000Z", idempotency_key: "test-purchase" })] });
      if (url === "/v1/wallet/packs") return Promise.resolve(tokenPackCatalogue());
      if (url === "/v1/wallet/packs/requests") return Promise.resolve([packRequest()]);
      if (url === "/v1/licence") return Promise.resolve({ organization_id: ORG, plan: "FREE", features: [], tokens: 200, offline_allowance: 200, valid_until: null, grace_until: null });
      if (url === "/v1/billing/plans") return Promise.resolve(planCatalogue());
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    await renderWallet();
    await waitFor(() => expect(screen.getAllByText(/OTSI-INV-2026-000001/).length).toBeGreaterThan(0));
    expect(JSON.parse(localStorage.getItem("otsi-wallet-last-known-ledger") ?? "[]")).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem("otsi-wallet-last-known-requests") ?? "[]")).toHaveLength(1);
    expect(localStorage.getItem("otsi-wallet-last-known-plan")).toBe("Free");
  }, 30_000);
});
