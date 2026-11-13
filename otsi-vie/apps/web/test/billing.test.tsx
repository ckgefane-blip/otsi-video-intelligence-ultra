/** The token payment circle (ADR-144, ultra-only): plan orders, the order invoice / proof / receipt, the
 *  pack payment details in the wallet, and the admin billing console. Prices, bank details and the invoice
 *  all come from the mocked API — nothing is typed in. */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
const api = vi.fn();
const apiBlob = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }), usePathname: () => "/settings/billing", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/lib/api", () => ({
  api: (...a: unknown[]) => api(...a),
  apiBlob: (...a: unknown[]) => apiBlob(...a),
  ApiProblem: class ApiProblem extends Error {
    status: number; code: string;
    constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
  },
}));

// The billing console is the company organisation's screen (OTSI): the tests sign in as its owner.
const mockAuth = vi.hoisted(() => ({ useAuth: vi.fn() }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: mockAuth.useAuth }));

import { PAY_REFERENCE_NOTE, planCatalogue, tokenPackCatalogue } from "@otsi-vie/contracts";
import { AdminBillingView } from "@/components/wallet/AdminBillingView";
import { OrderDetailView } from "@/components/wallet/OrderDetailView";
import { PlanOrdersView } from "@/components/wallet/PlanOrdersView";
import { WalletView } from "@/components/wallet/WalletView";

const ORG = "0190a000-0000-7000-8000-000000000001";
const USER = "0190a000-0000-7000-8000-000000000002";
const ORDER_ID = "0190a000-0000-7000-8000-000000000003";
const BANK_ID = "0190a000-0000-7000-8000-000000000004";
const SUB_ID = "0190a000-0000-7000-8000-000000000005";

const bankAccount = {
  id: BANK_ID, currency: "NGN", account_name: "Osio & Tee Solutions International Ltd",
  bank_name: "Zenith Bank", account_number: "1012345678", swift_iban: "ZEIBNGLA", is_active: true,
  created_by: USER, created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z",
};

const order = (overrides: Record<string, unknown> = {}) => ({
  id: ORDER_ID, organization_id: ORG, organization_name: "Osio & Tee", plan_code: "CLUB", period_months: 1,
  amount_minor: 6_000_000, currency: "NGN", reference: "OTSI-INV-2026-000001", bank_account_id: BANK_ID,
  status: "ORDERED", amount_received_minor: 0, amount_refunded_minor: null, tokens_granted: 500,
  subscription_id: null, renews_subscription_id: null, expires_at: "2026-11-27T00:00:00.000Z",
  proof_filename: null, proof_content_type: null, proof_size_bytes: null, proof_sha256: null,
  proof_uploaded_at: null, proof_note: null, confirmed_by: null, confirmed_at: null,
  bank_reference: null, reject_reason: null, refund_reason: null, created_by: USER,
  created_at: "2026-11-13T00:00:00.000Z", updated_at: "2026-11-13T00:00:00.000Z", ...overrides,
});

const invoice = {
  reference: "OTSI-INV-2026-000001", plan_code: "CLUB", period_months: 1,
  amount_minor: 6_000_000, currency: "NGN", expires_at: "2026-11-27T00:00:00.000Z",
  pay_reference_note: PAY_REFERENCE_NOTE,
  bank_account: {
    account_name: bankAccount.account_name, bank_name: bankAccount.bank_name,
    account_number: bankAccount.account_number, swift_iban: bankAccount.swift_iban, currency: "NGN",
  },
};

const subscription = {
  id: SUB_ID, plan_code: "CLUB", period_start: "2026-11-13T00:00:00.000Z",
  period_end: "2026-12-13T00:00:00.000Z", state: "ACTIVE",
};

const revenue = {
  totals: [{ currency: "NGN", received_minor: 7_000_000, refunded_minor: 0, net_minor: 7_000_000, this_month_minor: 7_000_000, last_month_minor: 0,
    last_12_months_minor: 7_000_000, plans_minor: 7_000_000, packs_minor: 0, awaiting_minor: 11_000_000 },
    { currency: "USD", received_minor: 0, refunded_minor: 0, net_minor: 0, this_month_minor: 0, last_month_minor: 0,
    last_12_months_minor: 0, plans_minor: 0, packs_minor: 0, awaiting_minor: 0 }],
  months: [], orders: { ordered: 0, awaiting: 1, partial: 1, confirmed: 1, rejected: 0, refunded: 0 },
  packs: { requested: 0, invoiced: 0, paid: 0, cancelled: 0 }, active_plans: [{ plan_code: "CLUB", count: 1 }],
  renewals_due_7d: 0, generated_at: "2026-11-13T00:00:00.000Z",
};

const packRequest = (overrides: Record<string, unknown> = {}) => ({
  id: "0190a000-0000-7000-8000-000000000006", organization_id: ORG, organization_name: "Osio & Tee", pack_code: "CLUB",
  currency: "NGN", amount_minor: 6_000_000, tokens: 500, status: "INVOICED",
  invoice_ref: "INV-2026-001", requested_by: USER,
  created_at: "2026-11-13T00:00:00.000Z", updated_at: "2026-11-13T00:00:00.000Z", ...overrides,
});

const walletBalance = { organization_id: ORG, balance: 10, spendable_balance: 10, expired_unwritten_off: 0, low_balance: true };

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api.mockReset(); apiBlob.mockReset(); push.mockReset(); });

describe("Plans & billing (user)", () => {
  it("shows the catalogue from the server, both prices, the subscription and the orders", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/billing/plans") return Promise.resolve(planCatalogue());
      if (url === "/v1/billing/orders") return Promise.resolve([order({ status: "AWAITING_CONFIRMATION" })]);
      if (url === "/v1/billing/subscription") return Promise.resolve(subscription);
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<PlanOrdersView />);
    await waitFor(() => expect(screen.getByText("Plans & billing")).toBeInTheDocument());
    // the catalogue's own labels and prices, never typed in: Club is 500 tokens a month, ₦60,000 monthly,
    // ₦600,000 for 12 months (10 monthly payments, 2 months free)
    expect(screen.getByText("Club")).toBeInTheDocument();
    expect(screen.getAllByText("₦60,000").length).toBeGreaterThan(0);
    expect(screen.getByText("₦600,000")).toBeInTheDocument();
    expect(screen.getAllByText("12 months (2 months free)")).toHaveLength(5);
    expect(screen.getByText(/Plan active until 12\/13\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/OTSI-INV-2026-000001/)).toBeInTheDocument();
    expect(screen.getByText("Awaiting confirmation")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Pay online — coming soon/ })).toHaveLength(4);
    screen.getAllByRole("button", { name: /Pay online — coming soon/ }).forEach((b) => expect(b).toBeDisabled());
  });

  it("places an order by bank transfer and opens the order's invoice page", async () => {
    api.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === "/v1/billing/plans") return Promise.resolve(planCatalogue());
      if (url === "/v1/billing/orders" && !init?.method) return Promise.resolve([]);
      if (url === "/v1/billing/subscription") return Promise.resolve(null);
      if (url === "/v1/billing/orders" && init?.method === "POST") return Promise.resolve({ order: order(), invoice });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<PlanOrdersView />);
    await waitFor(() => expect(screen.getByText("Club")).toBeInTheDocument());
    const orderButtons = screen.getAllByRole("button", { name: /Order by bank transfer/ });
    expect(orderButtons).toHaveLength(4);
    fireEvent.click(orderButtons[1]!);
    await waitFor(() => expect(api).toHaveBeenCalledWith("/v1/billing/orders", expect.objectContaining({
      method: "POST",
      json: { plan_code: "CLUB", period_months: 1, currency: "NGN" },
    })));
    expect(push).toHaveBeenCalledWith(`/settings/billing/orders/${ORDER_ID}`);
  });

  it("shows the invoice with the bank details, the proof section, and the receipt once confirmed", async () => {
    api.mockImplementation((url: string) => {
      if (url === `/v1/billing/orders/${ORDER_ID}`) {
        return Promise.resolve({ order: order({ status: "CONFIRMED", amount_received_minor: 6_000_000, confirmed_at: "2026-11-14T10:00:00.000Z" }), invoice });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<OrderDetailView orderId={ORDER_ID} />);
    await waitFor(() => expect(screen.getByText("Your invoice")).toBeInTheDocument());
    expect(screen.getAllByText("OTSI-INV-2026-000001")).toHaveLength(3);
    expect(screen.getByText("Zenith Bank")).toBeInTheDocument();
    expect(screen.getByText("1012345678")).toBeInTheDocument();
    expect(screen.getByText(PAY_REFERENCE_NOTE)).toBeInTheDocument();
    expect(screen.getByText("Receipt")).toBeInTheDocument();
    expect(screen.getByText("Payment received")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print invoice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print receipt" })).toBeInTheDocument();
    // a confirmed order is closed: no proof section actions
    expect(screen.getByText("This order is closed.")).toBeInTheDocument();
  });

  it("marks an open order paid without a receipt", async () => {
    api.mockImplementation((url: string, init?: { method?: string }) => {
      if (url === `/v1/billing/orders/${ORDER_ID}` && !init?.method) return Promise.resolve({ order: order(), invoice });
      if (url === `/v1/billing/orders/${ORDER_ID}/proof` && init?.method === "POST") return Promise.resolve(order({ status: "AWAITING_CONFIRMATION" }));
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<OrderDetailView orderId={ORDER_ID} />);
    await waitFor(() => expect(screen.getByText("Your invoice")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Mark paid without a receipt" }));
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/billing/orders/${ORDER_ID}/proof`, expect.objectContaining({
      method: "POST", json: {},
    })));
    await waitFor(() => expect(screen.getByText("Marked paid. The owner will confirm the transfer.")).toBeInTheDocument());
  });
});

describe("Wallet pack payment details", () => {
  it("shows the bank details and invoice reference for an invoiced pack request", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/wallet") return Promise.resolve(walletBalance);
      if (url === "/v1/wallet/ledger?limit=200") return Promise.resolve({ balance: walletBalance, entries: [] });
      if (url === "/v1/wallet/packs") return Promise.resolve(tokenPackCatalogue());
      if (url === "/v1/wallet/packs/requests") return Promise.resolve([packRequest()]);
      if (url === `/v1/wallet/packs/requests/${packRequest().id}`) {
        return Promise.resolve({ request: packRequest(), bank_account: bankAccount, pay_reference_note: PAY_REFERENCE_NOTE });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<WalletView />);
    await waitFor(() => expect(screen.getByText("Pack requests")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Show payment details" }));
    await waitFor(() => expect(screen.getByText("Zenith Bank")).toBeInTheDocument());
    expect(screen.getByText("1012345678")).toBeInTheDocument();
    expect(screen.getByText("INV-2026-001")).toBeInTheDocument();
    expect(screen.getByText(PAY_REFERENCE_NOTE)).toBeInTheDocument();
  });

  it("tells the user the invoice is being prepared for a requested pack", async () => {
    api.mockImplementation((url: string) => {
      if (url === "/v1/wallet") return Promise.resolve(walletBalance);
      if (url === "/v1/wallet/ledger?limit=200") return Promise.resolve({ balance: walletBalance, entries: [] });
      if (url === "/v1/wallet/packs") return Promise.resolve(tokenPackCatalogue());
      if (url === "/v1/wallet/packs/requests") return Promise.resolve([packRequest({ status: "REQUESTED", invoice_ref: null })]);
      if (url === `/v1/wallet/packs/requests/${packRequest().id}`) {
        return Promise.resolve({ request: packRequest({ status: "REQUESTED", invoice_ref: null }), bank_account: null, pay_reference_note: PAY_REFERENCE_NOTE });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<WalletView />);
    await waitFor(() => expect(screen.getByText("Pack requests")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Show payment details" }));
    await waitFor(() => expect(screen.getByText("The invoice is being prepared. Bank details will appear here once issued.")).toBeInTheDocument());
  });
});

describe("Admin billing console", () => {
  // the console is the company organisation's screen: the tests sign in as its owner, so the
  // view renders (a customer admin gets the access panel instead — see the last test here).
  beforeEach(() => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: ORG, organization_name: "OTSI", role: "OWNER", is_company_org: true },
    });
  });

  function mockAdmin(
    orders: unknown[] = [order({ status: "AWAITING_CONFIRMATION" })],
    requests: unknown[] = [],
    wallets: unknown[] = [{ organization_id: ORG, organization_name: "Osio & Tee", balance: 10, spendable_balance: 10, low_balance: true, last_activity_at: null }],
  ) {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: ORG, organization_name: "OTSI", role: "OWNER", is_company_org: true },
    });
    api.mockImplementation((url: string) => {
      if (url === "/v1/admin/wallet") return Promise.resolve(wallets);
      if (url === "/v1/admin/wallet/pack-requests") return Promise.resolve(requests);
      if (url === "/v1/admin/billing/orders") return Promise.resolve(orders);
      if (url === "/v1/admin/billing/bank-accounts") return Promise.resolve([bankAccount]);
      if (url === "/v1/admin/billing/revenue") return Promise.resolve(revenue);
      if (url === "/v1/billing/subscription") return Promise.resolve(subscription);
      if (url.startsWith("/v1/admin/wallet/") && url.endsWith("/ledger")) return Promise.resolve({ entries: [] });
      return Promise.reject(new Error(`unexpected ${url}`));
    });
  }

  it("shows the revenue summary, the orders, the bank accounts and the renewals", async () => {
    mockAdmin();
    render(<AdminBillingView />);
    await waitFor(() => expect(screen.getByText("Billing orders")).toBeInTheDocument());
    expect(screen.getByText("Billing orders")).toBeInTheDocument();
    expect(screen.getByText("Bank accounts")).toBeInTheDocument();
    expect(screen.getByText("Renewals")).toBeInTheDocument();
    // the one revenue panel (company-wide), filled from /v1/admin/billing/revenue
    await waitFor(() => expect(document.querySelector("[data-revenue]")).not.toBeNull());
    expect(api).toHaveBeenCalledWith("/v1/admin/billing/revenue");
    // the order, pending first, and the saved bank account (in the form's inputs)
    expect(screen.getByText(/OTSI-INV-2026-000001/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("Zenith Bank")).toBeInTheDocument();
    expect(screen.getByDisplayValue("1012345678")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run renewals now" })).toBeInTheDocument();
  });

  it("opens an order with its invoice and a confirm form prefilled with the remaining amount", async () => {
    mockAdmin([order({ status: "PARTIAL", amount_received_minor: 1_000_000 })]);
    render(<AdminBillingView />);
    await waitFor(() => expect(screen.getByText("Billing orders")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "View order" }));
    await waitFor(() => expect(screen.getByText("Your invoice")).toBeInTheDocument());
    expect(screen.getByText("Zenith Bank")).toBeInTheDocument();
    const confirmBtn = screen.getByRole("button", { name: "Confirm payment" });
    const confirmForm = confirmBtn.closest("form") as HTMLElement;
    const amount = within(confirmForm).getByLabelText("Amount received") as HTMLInputElement;
    expect(amount.value).toBe("5000000");
    expect(screen.getByRole("button", { name: "Record part-payment" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject order" })).toBeInTheDocument();
  });

  it("confirms a payment with the remaining amount and the bank reference", async () => {
    api.mockImplementation((url: string, init?: { method?: string; json?: unknown }) => {
      if (url === "/v1/admin/wallet") return Promise.resolve([{ organization_id: ORG, organization_name: "Osio & Tee", balance: 10, spendable_balance: 10, low_balance: true, last_activity_at: null }]);
      if (url === "/v1/admin/wallet/pack-requests") return Promise.resolve([]);
      if (url === "/v1/admin/billing/orders") return Promise.resolve([order({ status: "AWAITING_CONFIRMATION" })]);
      if (url === "/v1/admin/billing/bank-accounts") return Promise.resolve([bankAccount]);
      if (url === "/v1/admin/billing/revenue") return Promise.resolve(revenue);
      if (url === "/v1/billing/subscription") return Promise.resolve(subscription);
      if (url === `/v1/admin/wallet/${ORG}/ledger`) return Promise.resolve({ entries: [] });
      if (url === `/v1/admin/billing/orders/${ORDER_ID}/confirm` && init?.method === "POST") {
        return Promise.resolve(order({ status: "CONFIRMED", amount_received_minor: 6_000_000 }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    render(<AdminBillingView />);
    await waitFor(() => expect(screen.getByText("Billing orders")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "View order" }));
    await waitFor(() => expect(screen.getByText("Your invoice")).toBeInTheDocument());
    const confirmBtn = screen.getByRole("button", { name: "Confirm payment" });
    const confirmForm = confirmBtn.closest("form") as HTMLElement;
    fireEvent.change(within(confirmForm).getByLabelText("Bank reference"), { target: { value: "ZEN-REF-778" } });
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/admin/billing/orders/${ORDER_ID}/confirm`, expect.objectContaining({
      method: "POST",
      json: expect.objectContaining({ amount_received_minor: 6_000_000, bank_reference: "ZEN-REF-778" }),
    })));
    await waitFor(() => expect(screen.getByText("Payment confirmed. The plan is active.")).toBeInTheDocument());
  });

  it("hides the console from a customer admin: the access panel shows and no admin endpoint is called", async () => {
    mockAuth.useAuth.mockReturnValue({
      organization: { organization_id: ORG, organization_name: "A Customer Club", role: "OWNER", is_company_org: false },
    });
    render(<AdminBillingView />);
    await waitFor(() => expect(screen.getByText("Administrator access required")).toBeInTheDocument());
    expect(screen.queryByText("Billing orders")).not.toBeInTheDocument();
    expect(api).not.toHaveBeenCalled();
  });

  it("shows each customer's name on its orders and pack requests (ADR-140 §8, the visibility fix)", async () => {
    const CUSTOMER = "0190a000-0000-7000-8000-000000000007";
    mockAdmin(
      [order({ organization_id: CUSTOMER, organization_name: "A Customer Club", status: "AWAITING_CONFIRMATION" })],
      [packRequest({ organization_id: CUSTOMER, organization_name: "A Customer Club", status: "REQUESTED", invoice_ref: null })],
    );
    render(<AdminBillingView />);
    await waitFor(() => expect(screen.getByText("Billing orders")).toBeInTheDocument());
    // the customer's name is on the order row and on the pack request row — that is how the
    // company org tells whose payment it is confirming.
    expect(screen.getAllByText(/A Customer Club/)).toHaveLength(2);
    // opening the order shows the same name in the detail, so the company org confirms the
    // right customer's payment. (The customer side — a customer sees only their own order —
    // is proven by the API test; on the web a customer admin never reaches this console at
    // all, see the access-panel test above.)
    fireEvent.click(screen.getByRole("button", { name: "View order" }));
    await waitFor(() => expect(screen.getByText("Your invoice")).toBeInTheDocument());
    expect(screen.getAllByText(/A Customer Club/)).toHaveLength(3);
  });

  it("lets the admin pick which customer's wallet the manual actions and ledger act on", async () => {
    const CUSTOMER = "0190a000-0000-7000-8000-000000000007";
    const walletRow = (id: string, name: string, balance: number) => ({
      organization_id: id, organization_name: name, balance, spendable_balance: balance, low_balance: false, last_activity_at: null,
    });
    mockAdmin(
      [order({ status: "AWAITING_CONFIRMATION", organization_name: null })],
      [],
      [walletRow(ORG, "Osio & Tee", 10), walletRow(CUSTOMER, "A Customer Club", 500)],
    );
    render(<AdminBillingView />);
    await waitFor(() => expect(screen.getByText("Billing orders")).toBeInTheDocument());
    // both customers' wallets are listed, each under its own name
    expect(screen.getAllByText("Osio & Tee").length).toBeGreaterThan(0);
    expect(screen.getAllByText("A Customer Club").length).toBeGreaterThan(0);
    // the manual actions act on the first wallet until the admin picks another one
    const select = screen.getByRole("combobox", { name: "Wallet" }) as HTMLSelectElement;
    expect(select.value).toBe(ORG);
    expect(api).toHaveBeenCalledWith(`/v1/admin/wallet/${ORG}/ledger`);
    fireEvent.change(select, { target: { value: CUSTOMER } });
    await waitFor(() => expect(api).toHaveBeenCalledWith(`/v1/admin/wallet/${CUSTOMER}/ledger`));
  });
});
