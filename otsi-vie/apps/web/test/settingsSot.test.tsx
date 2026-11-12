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

const ORG = "0190a000-0000-7000-8000-000000000001";
const licence = { organization_id: ORG, plan: "FREE", features: [], tokens: 10, expires_at: "2027-01-01T00:00:00.000Z", valid_until: null, grace_until: null };
const team = {
  members: [{ user_id: "0190a000-0000-7000-8000-000000000002", display_name: "Karo", email: "gefaneunitedfc@gmail.com", role: "OWNER", two_step: false, is_you: true }],
  invitations: [],
};
const walletBalance = { organization_id: ORG, balance: 10, spendable_balance: 10, expired_unwritten_off: 0, low_balance: true };

function mockApi() {
  api.mockImplementation((url: string) => {
    if (url === "/v1/licence") return Promise.resolve(licence);
    if (url === "/v1/team") return Promise.resolve(team);
    if (url === "/v1/me/two-step") return Promise.resolve({ enabled: false, recovery_codes_left: 10 });
    if (url === "/v1/wallet") return Promise.resolve(walletBalance);
    if (url === "/v1/wallet/ledger?limit=100") return Promise.resolve({ balance: walletBalance, entries: [] });
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
    // the licence chip and the Status row both show the licence line (free tier: no expiry)
    await waitFor(() => expect(screen.getAllByText("Free tier, no expiry")).toHaveLength(2));
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
  });

  it("flipping a notification switch saves it and un-flipping restores the default", async () => {
    mockApi();
    render(<PreferencesView />);
    await waitFor(() => expect(screen.getAllByText("Free tier, no expiry")).toHaveLength(2));
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
    expect(screen.getByRole("button", { name: "Send invite" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy invite link" })).toBeDisabled();
    expect(screen.getByText("Members")).toBeInTheDocument();
    const ownerRow = screen.getByText("Karo").closest("[data-member]") as HTMLElement;
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
  it("shows the two-step panel with its steps and the passkeys panel with the biometric switch", async () => {
    mockApi();
    render(<SecurityView />);
    await waitFor(() => expect(screen.getByText("No passkeys yet")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    const twoStep = screen.getByText("Two-step authentication").closest("section")!;
    expect(within(twoStep).getByText("Off")).toBeInTheDocument();
    expect(within(twoStep).getByText("A 6-digit code from an authenticator app after your password.")).toBeInTheDocument();
    expect(within(twoStep).getByText("Scan the QR code with your authenticator app.")).toBeInTheDocument();
    expect(within(twoStep).getByText("Enter the code it shows to confirm.")).toBeInTheDocument();
    expect(within(twoStep).getByText("Save your recovery codes somewhere safe.")).toBeInTheDocument();
    expect(within(twoStep).getByRole("button", { name: "Enable two-step" })).toBeInTheDocument();
    expect(within(twoStep).getByText("Recovery codes")).toBeInTheDocument();
    expect(within(twoStep).getByText("Shown once, after enabling")).toBeInTheDocument();
    expect(within(twoStep).getAllByText("•••• ••••")).toHaveLength(4);
    const passkeys = screen.getByText("Passkeys").closest("section")!;
    expect(within(passkeys).getByText("Windows Hello")).toBeInTheDocument();
    expect(within(passkeys).getByRole("switch", { name: "Biometric sign-in" })).toHaveAttribute("aria-checked", "false");
    expect(within(passkeys).getByText("Sign in with Windows Hello on this computer.")).toBeInTheDocument();
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
    await waitFor(() => expect(screen.getByText("Buy a token pack")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Token Wallet & plan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "₦ Naira" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Balance")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("1 token / min")).toBeInTheDocument();
    expect(screen.getByText("10 tokens")).toBeInTheDocument();
    expect(screen.getByText("Free grant")).toBeInTheDocument();
    expect(screen.getByText("25")).toBeInTheDocument();
    expect(screen.getByText("Valid 30 days. One per organisation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Claim free grant" })).toBeInTheDocument();
    expect(screen.getByText("Free · 2 GB in total")).toBeInTheDocument();
    expect(screen.getByText("Pro · 24 GB")).toBeInTheDocument();
    expect(screen.getByText("Enterprise · 64 GB")).toBeInTheDocument();
    expect(screen.getByText("Upload limits apply per MP4 or MOV file.")).toBeInTheDocument();
    expect(screen.getByText("Request a pack")).toBeInTheDocument();
    expect(screen.getByText("Invoice sent")).toBeInTheDocument();
    expect(screen.getByText("Pay by transfer")).toBeInTheDocument();
    expect(screen.getByText("Owner confirms")).toBeInTheDocument();
    expect(screen.getByText("Wallet topped up")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Request" })).toHaveLength(4);
    expect(screen.getByText("Pack requests")).toBeInTheDocument();
    expect(screen.getByText("No pack requests")).toBeInTheDocument();
    expect(screen.getByText("Requests wait here until paid.")).toBeInTheDocument();
    expect(screen.getByText("Ledger")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
    expect(screen.getByText("No ledger entries yet")).toBeInTheDocument();
    expect(screen.getByText("Grants, purchases and spends appear here.")).toBeInTheDocument();
  });

  it("switching the currency seg reprices the packs in dollars", async () => {
    mockApi();
    render(<WalletView />);
    await waitFor(() => expect(screen.getByText("Buy a token pack")).toBeInTheDocument());
    expect(screen.getByText("₦15,000")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "$ Dollar" }));
    expect(screen.getByText("$49.00")).toBeInTheDocument();
    expect(screen.queryByText("₦15,000")).not.toBeInTheDocument();
  });
});
