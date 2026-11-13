/** Settings (SOT, Pages 21–24): Preferences, Security, Team and Token Wallet, rebuilt to the SOT's Settings pages */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/settings/preferences", useSearchParams: () => new URLSearchParams() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-in",
    me: { user: { email: "gefaneunitedfc@gmail.com", display_name: "Karo" }, organization_id: "0190a000-0000-7000-8000-000000000001" },
    organization: { organization_id: "0190a000-0000-7000-8000-000000000001", role: "OWNER" },
  }),
}));
const api = vi.fn();
const webauthnCredentials = vi.fn();
vi.mock("@/lib/api", () => ({
  api: (...a: unknown[]) => api(...a),
  ApiProblem: class ApiProblem extends Error {},
  webauthnCredentials: (...a: unknown[]) => webauthnCredentials(...a),
  webauthnDeleteCredential: vi.fn(),
  webauthnRegisterOptions: vi.fn(),
  webauthnRegisterVerify: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => true, startRegistration: vi.fn() }));

import { tokenPackCatalogue } from "@otsi-vie/contracts";
import { SecurityView } from "@/components/account/SecurityView";
import { TeamSettings } from "@/components/account/TeamSettings";
import { TwoStepSettings } from "@/components/account/TwoStepSettings";
import { PreferencesView } from "@/components/settings/PreferencesView";
import { WalletView } from "@/components/wallet/WalletView";
import { SettingsSideNav } from "@/components/settings/SettingsSideNav";

const ORG = "0190a000-0000-7000-8000-000000000001";
const licence = { organization_id: ORG, plan: "FREE", features: [], tokens: 10, expires_at: "2027-01-01T00:00:00.000Z", valid_until: null, grace_until: null };
const team = {
  members: [{ user_id: "0190a000-0000-7000-8000-000000000002", display_name: "Karo", email: "gefaneunitedfc@gmail.com", role: "OWNER", two_step: false, is_you: true }],
  invitations: [],
};
const walletBalance = { organization_id: ORG, balance: 10, spendable_balance: 10, expired_unwritten_off: 0, low_balance: true };

function mockApi(settings?: { library_folder?: string | null; cache_folder?: string | null } | null, licenceOk = true) {
  api.mockImplementation((url: string) => {
    if (url === "/v1/licence") return licenceOk ? Promise.resolve(licence) : Promise.reject(new Error("no licence yet"));
    if (url === "/v1/team") return Promise.resolve(team);
    if (url === "/v1/me/two-step") return Promise.resolve({ enabled: false, recovery_codes_left: 10 });
    if (url === "/v1/settings/storage") return settings === undefined ? Promise.reject(new Error("no settings yet")) : Promise.resolve(settings);
    if (url === "/v1/wallet") return Promise.resolve(walletBalance);
    if (url === "/v1/wallet/ledger?limit=200") return Promise.resolve({ balance: walletBalance, entries: [] });
    if (url === "/v1/wallet/packs") return Promise.resolve(tokenPackCatalogue());
    if (url === "/v1/wallet/packs/requests") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  webauthnCredentials.mockResolvedValue({ credentials: [] });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); api.mockReset(); webauthnCredentials.mockReset(); });

describe("Settings — Preferences (SOT, Page 21)", () => {
  it("shows the side nav and the four panels, with the SOT defaults", async () => {
    mockApi();
    render(<PreferencesView />);
    // the licence header shows the licence line after a status LED (green when verified); the Status row shows it bare
    await waitFor(() => expect(document.querySelector("[data-licence-line]")).toHaveTextContent("Free tier, no expiry"));
    expect(screen.getAllByText("Free tier, no expiry").length).toBe(2);
    expect(document.querySelector("[data-licence-line] .led.ok")).not.toBeNull();
    // no placeholder text: the grace period and version read "—" when the server or build gives no value
    expect(screen.queryByText("[n] days")).toBeNull();
    // "Release notes" is a button, not a link
    expect(screen.getByRole("button", { name: "Release notes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();
    expect(screen.getByText("Appearance & language")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toHaveValue("en");
    expect(screen.getByText("Player and club names are not translated.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "100%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Guided")).toBeInTheDocument();
    expect(screen.getByText("Advanced")).toBeInTheDocument();
    expect(screen.getByText("Notifications")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Job finished or failed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Identity review needed" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Comment on a shared link" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Token wallet" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Team changes" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("Licence & updates")).toBeInTheDocument();
    expect(screen.getByText("Storage on this computer")).toBeInTheDocument();
    expect(screen.getByText("Data stays on this computer unless exported or shared.")).toBeInTheDocument();
    expect(screen.queryByText("v[—]")).toBeNull();
  });

  it("with no licence from the server the status reads • Not verified", async () => {
    mockApi(undefined, false);
    render(<PreferencesView />);
    await waitFor(() => expect(document.querySelector("[data-licence-line]")).toHaveTextContent("Not verified"));
    expect(document.querySelector("[data-licence-line] .led.ok")).toBeNull();
  });

  it("shows the storage folders from GET /v1/settings/storage and enables Change… when a path is present", async () => {
    mockApi({ library_folder: "C:\\OTSI\\Library", cache_folder: "C:\\OTSI\\Cache" });
    render(<PreferencesView />);
    await waitFor(() => expect(screen.getByDisplayValue("C:\\OTSI\\Library")).toBeInTheDocument());
    expect(screen.getByDisplayValue("C:\\OTSI\\Cache")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change…" })).toBeEnabled();
    // the storage endpoint is read-only: Change… says the folder is set by the launcher
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByText("The library folder is set by the launcher on this computer.")).toBeInTheDocument();
  });

  it("with no paths from the server shows — and Change… stays disabled", async () => {
    mockApi(null);
    render(<PreferencesView />);
    await waitFor(() => expect(document.querySelector("[data-licence-line]")).toHaveTextContent("Free tier, no expiry"));
    expect(screen.getAllByDisplayValue("—")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Change…" })).toBeDisabled();
  });

  it("flipping a notification switch saves it and un-flipping restores the default", async () => {
    mockApi();
    render(<PreferencesView />);
    await waitFor(() => expect(document.querySelector("[data-licence-line]")).toHaveTextContent("Free tier, no expiry"));
    const team = screen.getByRole("switch", { name: "Team changes" });
    fireEvent.click(team);
    expect(team).toHaveAttribute("aria-checked", "true");
    expect(JSON.parse(localStorage.getItem("otsi-vie.notification-prefs") ?? "{}").team).toBe(true);
    fireEvent.click(team);
    expect(team).toHaveAttribute("aria-checked", "false");
  });
});

describe("Settings — Team (SOT, Page 23)", () => {
  it("shows the invite form, the owner member row and the empty pending list", async () => {
    mockApi();
    render(<TeamSettings />);
    await waitFor(() => expect(screen.getByText("gefaneunitedfc@gmail.com")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Team" })).toBeInTheDocument();
    expect(screen.getByText("Invite a member")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("placeholder", "name@club.com");
    // SOT (Team.dc.html): the invite Role is a seg with exactly four options — Analyst / Scout / Viewer /
    // Admin. Owner and Editor are not offered on an invite (open question: are they in scope?).
    const roleSeg = screen.getByRole("group", { name: "Role" });
    expect(within(roleSeg).getAllByRole("button").map((b) => b.textContent)).toEqual(["Analyst", "Scout", "Viewer", "Admin"]);
    expect(within(roleSeg).queryByText("Owner")).toBeNull();
    expect(within(roleSeg).queryByText("Editor")).toBeNull();
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    // "Copy invite link" is enabled (SOT): with no invite yet it says so instead of copying nothing
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Copy invite link" }));
    expect(screen.getByText("Send an invite first — the link appears here after the invite is created.")).toBeInTheDocument();
    // the extra Analyst helper line under the form is gone (the SOT has none)
    expect(screen.queryByText(/Analyst:/)).toBeNull();
    expect(screen.getByText("Members")).toBeInTheDocument();
    const ownerRow = screen.getByText("Karo").closest("[data-member]") as HTMLElement;
    // the member row is a real grid row, not a flex .lr: email, role and "Can't be removed" sit in their columns
    expect(ownerRow.classList.contains("grid")).toBe(true);
    expect(ownerRow.classList.contains("lr")).toBe(false);
    expect(within(ownerRow).getByText("You")).toBeInTheDocument();
    expect(within(ownerRow).getByText("Owner")).toBeInTheDocument();
    expect(within(ownerRow).getByText("Can't be removed")).toBeInTheDocument();
    expect(screen.getByText("Invited members appear here.")).toBeInTheDocument();
    expect(screen.getByText("Pending invitations")).toBeInTheDocument();
    expect(screen.getByText("No pending invitations")).toBeInTheDocument();
    expect(screen.getByText("Invitations wait here until accepted.")).toBeInTheDocument();
  });
});

describe("Settings — Security (SOT, Page 22)", () => {
  it("shows the two-step panel with its steps and the passkeys panel with one biometric switch (fingerprint), no second Register button", async () => {
    mockApi();
    render(<SecurityView />);
    await waitFor(() => expect(screen.getByText("No passkeys yet")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    const twoStep = screen.getByText("Two-step authentication").closest("section")!;
    // "Off" is plain text with a dot, not a chip (SOT §B)
    expect(within(twoStep).getByText("• Off")).toBeInTheDocument();
    expect(twoStep.querySelector(".chip")).toBeNull();
    expect(within(twoStep).getByText("A 6-digit code from an authenticator app after your password.")).toBeInTheDocument();
    expect(within(twoStep).getByText("Scan the QR code with your authenticator app.")).toBeInTheDocument();
    expect(within(twoStep).getByText("Enter the code it shows to confirm.")).toBeInTheDocument();
    expect(within(twoStep).getByText("Save your recovery codes somewhere safe.")).toBeInTheDocument();
    expect(within(twoStep).getByRole("button", { name: "Enable two-step" })).toBeInTheDocument();
    expect(within(twoStep).getByText("Recovery codes")).toBeInTheDocument();
    expect(within(twoStep).getByText("Shown once, after enabling")).toBeInTheDocument();
    // SOT (Security.dc.html line 88): FOUR masked spans, not 8 — the ab88053 change to 8 was backwards
    expect(within(twoStep).getAllByText("•••• ••••")).toHaveLength(4);
    const passkeys = screen.getByText("Passkeys").closest("section")!;
    expect(within(passkeys).getByText("Windows Hello")).toBeInTheDocument();
    expect(within(passkeys).getByRole("switch", { name: "Biometric sign-in" })).toHaveAttribute("aria-checked", "false");
    expect(within(passkeys).getByText("Sign in with Windows Hello on this computer.")).toBeInTheDocument();
    // no extra intro line; one control only, as in banking apps (owner 2026-11-13): the switch, no "Register this device" button
    expect(within(passkeys).queryByText(/Use Windows Hello \(fingerprint/)).toBeNull();
    expect(within(passkeys).queryByRole("button", { name: "Register this device" })).toBeNull();
  });

  it("the two-step panel opens the password form from Enable two-step", async () => {
    mockApi();
    render(<TwoStepSettings />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Enable two-step" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Enable two-step" }));
    expect(screen.getByLabelText("Your password")).toBeInTheDocument();
  });
});

describe("Settings — Token Wallet (SOT, Page 24)", () => {
  it("shows the balance, the free grant, the plan strip, the buy stepper with four packs, and the empty lists", async () => {
    mockApi();
    render(<WalletView />);
    await waitFor(() => expect(screen.getByText("Top up tokens")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Token Wallet & plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "₦ Naira" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("1 token / min")).toBeInTheDocument();
    expect(screen.getByText("10 tokens")).toBeInTheDocument();
    expect(screen.getByText("Free grant")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument(); // the approved free grant (owner 2026-11-13; was 25)
    expect(screen.getByText("Valid 30 days. One per organisation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim free grant" })).toBeInTheDocument();
    // the old invented "Free / Pro / Enterprise" strip is gone: the real plan and a link to Plans and pricing (owner 2026-11-13)
    expect(screen.queryByText("Pro · 24 GB")).toBeNull();
    expect(screen.getByRole("link", { name: "See plans and pricing" })).toHaveAttribute("href", "/settings/billing");
    expect(screen.getByText("Choose how many 100s")).toBeInTheDocument();
    // no plan: the Free / Player rate, ₦3,000 per 100 tokens, in blocks of 100
    expect(screen.getByText("Your rate: ₦3,000 per 100 tokens (Free plan)")).toBeInTheDocument();
    expect(screen.getByText("Pay details shown")).toBeInTheDocument();
    expect(screen.getByText("Pay by transfer")).toBeInTheDocument();
    expect(screen.getByText("OTSI confirms")).toBeInTheDocument();
    expect(screen.getByText("Wallet topped up")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Top up" })).toHaveLength(4);
    expect(screen.getByText("Pack requests")).toBeInTheDocument();
    expect(screen.getByText("No pack requests")).toBeInTheDocument();
    expect(screen.getByText("Requests wait here until paid.")).toBeInTheDocument();
    expect(screen.getByText("Ledger")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByText("No ledger entries yet")).toBeInTheDocument();
    expect(screen.getByText("Grants, purchases and spends appear here.")).toBeInTheDocument();
    // SOT: no "N tokens can be spent now" line, no amber low-balance box, and the pack cards show only
    // "[n] tokens / ₦[price] / Request" — no pack names and no extra paragraph
    expect(screen.queryByText(/tokens can be spent now/)).toBeNull();
    expect(screen.queryByText(/Low balance/)).toBeNull();
    for (const name of ["Starter", "Club", "Academy", "Season"]) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryByText(/Request a pack and the owner issues an invoice/)).toBeNull();
    // "One-time" is plain text, not a chip; the free grant is an open section, not a highlighted panel
    expect(screen.getByText("One-time")).toBeInTheDocument();
    expect(document.querySelector(".chip")).toBeNull();
  });

  it("switching the currency seg reprices the packs in dollars", async () => {
    mockApi();
    render(<WalletView />);
    await waitFor(() => expect(screen.getByText("Top up tokens")).toBeInTheDocument());
    expect(screen.getByText("₦9,000")).toBeInTheDocument();   // 300 tokens at the Free / Player rate
    fireEvent.click(screen.getByRole("button", { name: "$ Dollar" }));
    expect(screen.getByText("$6.00")).toBeInTheDocument();
    expect(screen.queryByText("₦9,000")).not.toBeInTheDocument();
  });

  it("Top up orders at once and shows the reference and OTSI's bank details straight away (pay on the spot)", async () => {
    mockApi();
    const base = api.getMockImplementation()!;
    const req = { id: "0190a000-0000-7000-8000-0000000000aa", organization_id: ORG, organization_name: null, pack_code: "FREE", currency: "NGN",
      amount_minor: 300_000, tokens: 100, status: "INVOICED", invoice_ref: "OTSI-INV-2026-000042", requested_by: "0190a000-0000-7000-8000-000000000002",
      created_at: "2026-11-13T10:00:00.000Z", updated_at: "2026-11-13T10:00:00.000Z" };
    api.mockImplementation((url: string, opts?: { method?: string; json?: unknown }) => {
      if (url === "/v1/wallet/packs/request" && opts?.method === "POST") return Promise.resolve(req);
      if (url === `/v1/wallet/packs/requests/${req.id}`) return Promise.resolve({ request: req, pay_reference_note: "Put this reference in your transfer description.",
        bank_account: { account_name: "OTSI Ltd", bank_name: "Test Bank", account_number: "1234567890", swift_iban: null, currency: "NGN" } });
      return base(url, opts);
    });
    render(<WalletView />);
    await waitFor(() => expect(screen.getByText("Top up tokens")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Top up" })[0]!);
    const box = await screen.findByRole("region", { name: "Pay now to finish your top-up" });
    expect(api).toHaveBeenCalledWith("/v1/wallet/packs/request", { method: "POST", json: { blocks: 1, currency: "NGN" } });
    expect(box).toHaveTextContent("OTSI-INV-2026-000042");
    expect(box).toHaveTextContent("₦3,000");
    expect(box).toHaveTextContent("Test Bank");
    expect(box).toHaveTextContent("1234567890");
    expect(screen.getByRole("status")).toHaveTextContent("Top-up ordered: Player pack (₦3,000). Pay to the account below, with your reference.");
  });
});

describe("Settings and Admin are separate places (owner 2026-11-13)", () => {
  it("a Settings page lists only Settings; an Admin page lists only the Admin Console", () => {
    const { unmount } = render(<SettingsSideNav current="wallet" />);
    let nav = screen.getByRole("navigation", { name: "Settings" });
    for (const name of ["Preferences", "Team and roles", "2-step sign-in", "Token Wallet", "Plans & billing"]) expect(nav).toHaveTextContent(name);
    expect(screen.queryByRole("link", { name: "Platform health" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Models & AI" })).toBeNull();
    unmount();
    render(<SettingsSideNav current="admin" />);
    nav = screen.getByRole("navigation", { name: "Admin console" });
    expect(screen.getByRole("link", { name: "Platform health" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Organization" })).toHaveAttribute("href", "/settings/admin/organization");
    expect(screen.queryByRole("link", { name: "Preferences" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Token Wallet" })).toBeNull();
  });
});
