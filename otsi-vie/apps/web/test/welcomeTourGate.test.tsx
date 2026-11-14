/**
 * Welcome tour gate (owner decision 2026-11-14): a new account must be able to open any page before finishing
 * the welcome tour. The tour still opens over whatever page they are on, but it no longer sends them back to
 * Home, and finishing or skipping it leaves them on the page they were on.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { apiMock, replaceMock } = vi.hoisted(() => ({ apiMock: vi.fn(), replaceMock: vi.fn() }));
const authState = vi.hoisted(() => ({
  status: "signed-in" as "loading" | "signed-out" | "signed-in",
  me: { user: { id: "u1", email: "owner@club.com", display_name: "", onboarded_at: null as string | null }, memberships: [] as never[] },
  organization: { organization_id: "o1" } as { organization_id: string } | null,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: vi.fn() }),
  usePathname: () => "/media",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: authState.status, me: authState.me, organization: authState.organization,
    signIn: vi.fn(), signInWithCode: vi.fn(), signInWithPasskey: vi.fn(),
    adoptSession: vi.fn(), signOut: vi.fn(), chooseOrganization: vi.fn(), updateMe: vi.fn(),
  }),
}));
vi.mock("@/lib/api", () => ({
  api: apiMock,
  ApiProblem: class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  },
}));

import { RequireSession } from "@/components/auth/RequireSession";
import { WelcomeTour } from "@/components/auth/Onboarding";

beforeEach(() => {
  vi.clearAllMocks();
  authState.status = "signed-in";
  authState.me = { user: { id: "u1", email: "owner@club.com", display_name: "", onboarded_at: null }, memberships: [] };
  authState.organization = { organization_id: "o1" };
  apiMock.mockImplementation(async (url: string) => {
    if (url === "/v1/me") return { user: { ...authState.me.user, onboarded_at: "2026-11-14T13:00:00.000Z", display_name: "Awore" }, memberships: [] };
    throw new Error(`unexpected api call ${url}`);
  });
});

describe("Welcome tour gate", () => {
  it("a new account stays on the page it opened — no redirect back to Home", async () => {
    render(<RequireSession><h1>Media page</h1></RequireSession>);
    expect(await screen.findByRole("heading", { name: "Media page" })).toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("a signed-out visitor is still sent to sign in", async () => {
    authState.status = "signed-out";
    authState.me = { user: { id: "u1", email: "owner@club.com", display_name: "", onboarded_at: null }, memberships: [] };
    render(<RequireSession><h1>Media page</h1></RequireSession>);
    await waitFor(() => expect(replaceMock).toHaveBeenCalled());
    expect(replaceMock.mock.calls[0]![0] as string).toContain("/login");
    expect(screen.queryByRole("heading", { name: "Media page" })).toBeNull();
  });

  it("skipping the tour saves it as done and leaves the user on the page they were on", async () => {
    render(<WelcomeTour />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip tour" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/me", expect.objectContaining({ method: "PATCH",
      json: { onboarding_done: true } })));
    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard");
  });

  it("finishing the tour saves the name and leaves the user on the page they were on", async () => {
    render(<WelcomeTour />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Display name"), { target: { value: "Awore" } });
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Get started" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/me", expect.objectContaining({ method: "PATCH",
      json: { display_name: "Awore", onboarding_done: true } })));
    expect(replaceMock).not.toHaveBeenCalledWith("/dashboard");
  });
});
