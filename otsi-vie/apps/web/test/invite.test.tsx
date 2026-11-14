/**
 * User-to-user Invite (owner decision 2026-11-14): the gift button in the top bar opens the invite card
 * over the current page (it does not navigate away), which shows the caller's own invite code big with a
 * Copy code button, the localhost link small with a note that it only opens on this computer, and what
 * both sides get in plain words — the friend gets +25 tokens on signup (on top of the 100-token free
 * grant), and the inviter gets +100 when the friend analyses their first match or buys their first pack.
 * /invite-share stays as the address for direct links. The sign-up page reads ?invite=CODE, shows the
 * bonus line, and passes the code through to the server.
 *
 * This is NOT the staff/team invite (/invite page): that one adds a member to an organisation, this one
 * brings a new user to OTSI.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { myInvite, setupOwner, authMode } = vi.hoisted(() => ({ myInvite: vi.fn(), setupOwner: vi.fn(), authMode: vi.fn() }));
const replace = vi.fn();
const adoptSession = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => "/invite-share",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...p}>{children}</a>
  ),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ status: "signed-out", adoptSession }),
}));
vi.mock("@/lib/api", () => ({
  myInvite,
  setupOwner,
  ApiProblem: class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  },
  authMode: (...a: unknown[]) => authMode(...a),
}));
// The top bar's neighbours are not what this tests: stub them so the gift button renders on its own.
vi.mock("@/components/shell/ContextBar", () => ({ ContextBar: () => null }));
vi.mock("@/components/shell/TokenCounter", () => ({ TokenCounter: () => null }));
vi.mock("@/components/shell/JobTray", () => ({ JobTray: () => null }));
vi.mock("@/components/shell/NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/shell/ProfileChip", () => ({ ProfileChip: () => null }));
vi.mock("@/components/shell/ThemeSwitch", () => ({ ThemeSwitch: () => null }));
vi.mock("@/components/shell/CommandPalette", () => ({ CommandPalette: () => null }));
vi.mock("@/components/shell/KeyboardMap", () => ({ KeyboardMap: () => null }));

import SetupPage from "@/app/setup/page";
import { AppTopBar } from "@/components/shell/AppTopBar";
import { InviteSharePage } from "@/components/shell/InviteSharePage";

const CODE = "K7Q2X9M4P2"; // 10 characters, as the invite-code format requires

beforeEach(() => {
  vi.clearAllMocks();
  myInvite.mockReset();
  setupOwner.mockReset();
  // the mode is local unless a test says otherwise (it resolves at once, as before)
  authMode.mockResolvedValue({ mode: "local", central_url: null });
  window.history.pushState({}, "", "/");
});

describe("the gift button in the top bar", () => {
  it("opens the invite card over the current page, it does not navigate away", async () => {
    myInvite.mockResolvedValue({ code: CODE });
    render(<AppTopBar />);
    // a button, not a link: there is no navigation to /invite-share
    const gift = screen.getByRole("button", { name: "Invite friends" });
    expect(gift.tagName).toBe("BUTTON");
    expect(gift).not.toHaveAttribute("href");
    fireEvent.click(gift);
    const card = await screen.findByRole("dialog", { name: "Invite friends, earn tokens" });
    expect(card).toHaveAttribute("data-invite-card");
    // the code is first and big, with a Copy code button
    const codeEl = screen.getByText(CODE);
    expect(codeEl.tagName).toBe("CODE");
    expect(codeEl.className).toContain("text-2xl");
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
    // the localhost link is small, with the note that it only opens on this computer
    expect(screen.getByText(/Only opens on this computer/)).toBeInTheDocument();
    const linkInput = screen.getByLabelText("Your invite link") as HTMLInputElement;
    expect(linkInput.value).toContain(`/setup?invite=${CODE}`);
    expect(screen.getByText(/Your friend gets \+25 tokens on signup/)).toBeInTheDocument();
    expect(screen.getByText(/You get \+100 tokens when they analyse their first match or buy their first pack/)).toBeInTheDocument();
  });

  it("copies the code, and the confirmation shows at the Copy code button only", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    myInvite.mockResolvedValue({ code: CODE });
    render(<AppTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Invite friends" }));
    await screen.findByRole("dialog", { name: "Invite friends, earn tokens" });
    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(CODE));
    // the confirmation is at the button that was clicked; the link button is unchanged
    await waitFor(() => expect(screen.getByRole("button", { name: "Code copied" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("copies the link, and the confirmation shows at the Copy link button only", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    myInvite.mockResolvedValue({ code: CODE });
    render(<AppTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Invite friends" }));
    await screen.findByRole("dialog", { name: "Invite friends, earn tokens" });
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/setup?invite=${CODE}`)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Copy code" })).toBeInTheDocument();
  });

  it("closes with the ✕ button", async () => {
    myInvite.mockResolvedValue({ code: CODE });
    render(<AppTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Invite friends" }));
    await screen.findByRole("dialog", { name: "Invite friends, earn tokens" });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes with Esc", async () => {
    myInvite.mockResolvedValue({ code: CODE });
    render(<AppTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Invite friends" }));
    const card = await screen.findByRole("dialog", { name: "Invite friends, earn tokens" });
    fireEvent.keyDown(card, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("closes with a click outside it", async () => {
    myInvite.mockResolvedValue({ code: CODE });
    render(<AppTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Invite friends" }));
    await screen.findByRole("dialog", { name: "Invite friends, earn tokens" });
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says so when the code cannot be loaded", async () => {
    myInvite.mockRejectedValue(new Error("offline"));
    render(<AppTopBar />);
    fireEvent.click(screen.getByRole("button", { name: "Invite friends" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load your invite link."));
  });
});

describe("the invite share view", () => {
  it("shows the invite link and code, and what both sides get", async () => {
    myInvite.mockResolvedValue({ code: CODE });
    render(<InviteSharePage />);
    expect(screen.getByText(/Loading your invite link/)).toBeInTheDocument();
    const input = await waitFor(() => screen.getByLabelText("Your invite link"));
    expect((input as HTMLInputElement).value).toContain(`/setup?invite=${CODE}`);
    expect(screen.getByText(CODE)).toBeInTheDocument();
    expect(screen.getByText(/Your friend gets \+25 tokens on signup/)).toBeInTheDocument();
    expect(screen.getByText(/You get \+100 tokens when they analyse their first match or buy their first pack/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeInTheDocument();
  });

  it("copies the link to the clipboard", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    myInvite.mockResolvedValue({ code: CODE });
    render(<InviteSharePage />);
    await waitFor(() => screen.getByLabelText("Your invite link"));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/setup?invite=${CODE}`)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Link copied" })).toBeInTheDocument());
  });

  it("says so when the code cannot be loaded", async () => {
    myInvite.mockRejectedValue(new Error("offline"));
    render(<InviteSharePage />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Could not load your invite link."));
  });
});

describe("sign-up with an invite link", () => {
  const session = { access_token: "tok", refresh_token: "ref", user: { id: "u1", email: "owner@club.com", display_name: "Edmond Osio", onboarded_at: null }, memberships: [] };

  function fill() {
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Edmond Osio" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@club.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-passphrase-12" } });
  }

  it("shows the bonus line and passes the code through", async () => {
    window.history.pushState({}, "", `/setup?invite=${CODE}`);
    setupOwner.mockResolvedValue(session);
    render(<SetupPage />);
    await waitFor(() => expect(
      screen.getByText(/You were invited — you get \+25 tokens on signup/),
    ).toBeInTheDocument());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    await waitFor(() => expect(setupOwner).toHaveBeenCalledWith(expect.objectContaining({ invite_code: CODE })));
  });

  it("does not mention the bonus without an invite link", () => {
    render(<SetupPage />);
    expect(screen.queryByText(/You were invited/)).not.toBeInTheDocument();
  });

  it("blocks submit until the mode is known, then sends the invite code and the club name", async () => {
    // the "Jo" org (2026-11-14): the form rendered as a local first run and a submit made before
    // authMode() resolved sent no invite_code and no organization_name.
    let resolveMode!: (m: { mode: string; central_url: string | null }) => void;
    authMode.mockImplementation(() => new Promise((r) => { resolveMode = r; }));
    window.history.pushState({}, "", `/setup?invite=${CODE}`);
    setupOwner.mockResolvedValue(session);
    render(<SetupPage />);
    // the invite code is already read from the URL, but the mode is still unknown: the submit is
    // disabled, there is no club field, and no "First run" claim yet
    await waitFor(() => expect(screen.getByText(/You were invited — you get \+25 tokens on signup/)).toBeInTheDocument());
    const submit = screen.getByRole("button", { name: "Loading…" });
    expect(submit).toBeDisabled();
    expect(screen.queryByLabelText("Club or organisation name")).not.toBeInTheDocument();
    expect(screen.queryByText("First run")).not.toBeInTheDocument();
    fireEvent.click(submit);
    expect(setupOwner).not.toHaveBeenCalled();
    // the mode resolves as linked: the club field appears and the submit enables
    resolveMode({ mode: "linked", central_url: "https://accounts.otsi.cc" });
    const club = await screen.findByLabelText("Club or organisation name");
    fill();
    fireEvent.change(club, { target: { value: "Invite Test FC" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(setupOwner).toHaveBeenCalledWith(expect.objectContaining({
      invite_code: CODE, organization_name: "Invite Test FC",
    })));
  });

  it("the link code prefills the invite-code field", async () => {
    window.history.pushState({}, "", `/setup?invite=${CODE}`);
    render(<SetupPage />);
    const field = await screen.findByLabelText("Invite code (optional)") as HTMLInputElement;
    expect(field.value).toBe(CODE);
  });

  it("a code typed by hand is sent like a link code", async () => {
    // a localhost link can never open on a friend's own computer: the friend types the code here.
    setupOwner.mockResolvedValue(session);
    render(<SetupPage />);
    const field = await screen.findByLabelText("Invite code (optional)");
    fireEvent.change(field, { target: { value: CODE } });
    await waitFor(() => expect(screen.getByText(/You were invited — you get \+25 tokens on signup/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Create owner account" })).not.toBeDisabled());
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    await waitFor(() => expect(setupOwner).toHaveBeenCalledWith(expect.objectContaining({ invite_code: CODE })));
  });
});
