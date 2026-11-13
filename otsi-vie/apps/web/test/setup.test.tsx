/** First run — owner setup (SOT, Page 10): the form, the submit, and the already-set-up answer */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const adoptSession = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...p }: { href: string; children: React.ReactNode }) => <a href={href} {...p}>{children}</a> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({ status: "signed-out", adoptSession }) }));
const { setupOwner, ApiProblem } = vi.hoisted(() => {
  const setupOwner = vi.fn();
  class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  }
  return { setupOwner, ApiProblem };
});
vi.mock("@/lib/api", () => ({ setupOwner, ApiProblem }));

import SetupPage from "@/app/setup/page";

const me = { user: { id: "u1", email: "owner@club.com", display_name: "Edmond Osio", onboarded_at: null }, memberships: [] };
const session = { access_token: "tok", token_type: "Bearer" as const, expires_in: 900, me };

function fill() {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Edmond Osio" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@club.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "a-strong-passphrase-12" } });
}

beforeEach(() => { setupOwner.mockReset(); replace.mockReset(); adoptSession.mockReset(); });

describe("First run — owner setup (SOT)", () => {
  it("shows the brand panel and the owner form", () => {
    render(<SetupPage />);
    expect(screen.getByRole("heading", { name: "Prove what a player did on the pitch." })).toBeInTheDocument();
    expect(screen.getByText("First run")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create the owner account" })).toBeInTheDocument();
    expect(screen.getByLabelText("Full name")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create owner account" })).toBeInTheDocument();
    expect(screen.getByText("At least 12 characters. A passphrase works well.")).toBeInTheDocument();
  });

  it("'First run' is plain text, not a chip, and the password toggle reads 'Show'", () => {
    render(<SetupPage />);
    const firstRun = screen.getByText("First run");
    expect(firstRun.className).not.toContain("chip");
    expect(firstRun.className).toContain("text-muted");
    const show = screen.getByRole("button", { name: "Show password" });
    expect(show).toHaveTextContent("Show");
    expect(show).not.toHaveTextContent("Show password");
  });

  it("renders the four strength bars fully — a 3px row with four 3px bars — and fills them as the password strengthens", () => {
    render(<SetupPage />);
    const meter = document.querySelector("div.grid-cols-4");
    expect(meter).not.toBeNull();
    expect(meter!.className).toContain("h-[3px]");
    const bars = meter!.querySelectorAll("span");
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      expect(bar.className).toContain("h-[3px]");
      expect(bar.className).toContain("block");
      expect(bar.className).toContain("w-full");
    }
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "Str0ng!passphrase" } });
    for (const bar of meter!.querySelectorAll("span")) expect(bar.className).toContain("bg-primary");
  });

  it("creates the owner, signs them in and takes them to Home, where the welcome tour opens", async () => {
    setupOwner.mockResolvedValue(session);
    render(<SetupPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    await waitFor(() => expect(setupOwner).toHaveBeenCalledWith({ email: "owner@club.com", display_name: "Edmond Osio", password: "a-strong-passphrase-12" }));
    expect(adoptSession).toHaveBeenCalledWith(session);
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("refuses a short password without calling the API", async () => {
    render(<SetupPage />);
    fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Edmond Osio" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "owner@club.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "short" } });
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(setupOwner).not.toHaveBeenCalled();
  });

  it("names an installation that already has an owner and points to sign-in", async () => {
    setupOwner.mockRejectedValue(new ApiProblem(409, "ALREADY_SET_UP", "this installation already has an organization"));
    render(<SetupPage />);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Create owner account" }));
    await waitFor(() => expect(screen.getByText("This installation already has an owner. Sign in instead.")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
