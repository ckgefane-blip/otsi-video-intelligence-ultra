/**
 * User-to-user Invite (owner decision 2026-11-14): the gift button in the top bar links to the invite
 * share view, which shows the caller's own invite link and code, a copy button, and what both sides get
 * in plain words — the friend gets +25 tokens on signup (on top of the 100-token free grant), and the
 * inviter gets +100 when the friend analyses their first match or buys their first pack. The sign-up page
 * reads ?invite=CODE, shows the bonus line, and passes the code through to the server.
 *
 * This is NOT the staff/team invite (/invite page): that one adds a member to an organisation, this one
 * brings a new user to OTSI.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { myInvite, setupOwner } = vi.hoisted(() => ({ myInvite: vi.fn(), setupOwner: vi.fn() }));
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
  authMode: async () => ({ mode: "local", central_url: null }),
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
  window.history.pushState({}, "", "/");
});

describe("the gift button in the top bar", () => {
  it("links to the invite share view", () => {
    render(<AppTopBar />);
    const gift = screen.getByRole("link", { name: "Invite friends" });
    expect(gift).toHaveAttribute("href", "/invite-share");
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
});
