/**
 * Passkeys (ADR-143): the sign-in page shows the Windows Hello button only when the browser supports passkeys
 * (and a clear message when it does not), and Settings/Security lists the person's passkeys with an add form and
 * a remove button per passkey.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const replace = vi.fn();
const signInWithPasskey = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/login",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    status: "signed-out",
    me: null,
    organization: null,
    signIn: vi.fn(),
    signInWithCode: vi.fn(),
    signInWithPasskey,
    adoptSession: vi.fn(),
    signOut: vi.fn(),
    chooseOrganization: vi.fn(),
    updateMe: vi.fn(),
  }),
}));

const { browserSupportsWebAuthn, startRegistration, webauthnCredentials, webauthnDeleteCredential, webauthnRegisterOptions, webauthnRegisterVerify } = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startRegistration: vi.fn(),
  webauthnCredentials: vi.fn(),
  webauthnDeleteCredential: vi.fn(),
  webauthnRegisterOptions: vi.fn(),
  webauthnRegisterVerify: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn, startRegistration, startAuthentication: vi.fn() }));
vi.mock("@/lib/api", () => ({
  ApiProblem: class ApiProblem extends Error {
    constructor(readonly status: number, readonly code: string, message: string) { super(message); }
  },
  webauthnCredentials,
  webauthnDeleteCredential,
  webauthnRegisterOptions,
  webauthnRegisterVerify,
}));

import LoginPage from "@/app/login/page";
import { PasskeySettings } from "@/components/account/PasskeySettings";

beforeEach(() => {
  vi.clearAllMocks();
  browserSupportsWebAuthn.mockReturnValue(true);
});

describe("sign-in page passkey button", () => {
  it("shows the Windows Hello button when passkeys are supported", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sign in with Windows Hello/ })).toBeInTheDocument());
  });

  it("shows a clear message (and no button) when passkeys are not supported", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByText(/does not support passkeys here/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Sign in with Windows Hello/ })).not.toBeInTheDocument();
  });

  it("asks for the email first when the button is used with no email", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sign in with Windows Hello/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sign in with Windows Hello/ }));
    await waitFor(() => expect(screen.getByText(/Enter your email first/)).toBeInTheDocument());
    expect(signInWithPasskey).not.toHaveBeenCalled();
  });
});

describe("Settings passkeys", () => {
  const one = {
    credentials: [
      { id: "11111111-1111-1111-1111-111111111111", device_name: "My Windows laptop", created_at: "2026-11-01T10:00:00.000Z", last_used_at: "2026-11-10T09:00:00.000Z" },
      { id: "22222222-2222-2222-2222-222222222222", device_name: null, created_at: "2026-11-02T10:00:00.000Z", last_used_at: null },
    ],
  };

  it("lists passkeys with their names, dates and a remove button each", async () => {
    webauthnCredentials.mockResolvedValue(one);
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByText("My Windows laptop")).toBeInTheDocument());
    expect(screen.getByText("Unnamed passkey")).toBeInTheDocument();
    expect(screen.getByText(/Added Nov 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last used Nov 10, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Never used/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Remove" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: /Add a passkey/ })).toBeInTheDocument();
  });

  it("says so when there are no passkeys yet", async () => {
    webauthnCredentials.mockResolvedValue({ credentials: [] });
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByText("No passkeys yet.")).toBeInTheDocument());
  });

  it("removes a passkey and says so", async () => {
    webauthnCredentials.mockResolvedValueOnce(one).mockResolvedValueOnce({ credentials: [one.credentials[1]!] });
    webauthnDeleteCredential.mockResolvedValue({ deleted: true });
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByText("My Windows laptop")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[0]!);
    await waitFor(() => expect(webauthnDeleteCredential).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111"));
    await waitFor(() => expect(screen.getByText("Passkey removed.")).toBeInTheDocument());
  });
});
