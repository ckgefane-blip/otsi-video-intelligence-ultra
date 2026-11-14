/**
 * Biometric sign-in (ADR-143): the sign-in page shows the Windows Hello button only when the browser supports
 * passkeys (and a clear message when it does not), and Settings/Security has one switch — on = Windows Hello
 * signs you in, off = it doesn't. Turning it on enrols a passkey; turning it off removes every passkey.
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

const { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration, webauthnCredentials, webauthnDeleteCredential, webauthnRegisterOptions, webauthnRegisterVerify } = vi.hoisted(() => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  platformAuthenticatorIsAvailable: vi.fn(() => Promise.resolve(true)),
  startRegistration: vi.fn(),
  webauthnCredentials: vi.fn(),
  webauthnDeleteCredential: vi.fn(),
  webauthnRegisterOptions: vi.fn(),
  webauthnRegisterVerify: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startRegistration, startAuthentication: vi.fn() }));
vi.mock("@/lib/api", () => ({
  authMode: async () => ({ mode: "local", central_url: null }),
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
  platformAuthenticatorIsAvailable.mockResolvedValue(true);
});

describe("sign-in page passkey button", () => {
  it("shows the Windows Hello button when passkeys are supported", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sign in with a passkey/ })).toBeInTheDocument());
  });

  // SOT: the passkey button is always shown. Where passkeys do not work (Windows Hello unavailable)
  // the press itself says so, instead of the button hiding.
  it("shows the passkey button even when passkeys are not supported, and says so when pressed", async () => {
    browserSupportsWebAuthn.mockReturnValue(false);
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sign in with a passkey/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sign in with a passkey/ }));
    await waitFor(() => expect(screen.getByText(/does not support passkeys here/)).toBeInTheDocument());
    expect(signInWithPasskey).not.toHaveBeenCalled();
  });

  it("asks for the email first when the button is used with no email", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sign in with a passkey/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Sign in with a passkey/ }));
    await waitFor(() => expect(screen.getByText(/Enter your email first/)).toBeInTheDocument());
    expect(signInWithPasskey).not.toHaveBeenCalled();
  });

  // The Electron app window has no platform authenticator (Windows Hello): the button says so instead of
  // starting a ceremony that cannot offer "This device".
  it("says passkeys are unavailable when there is no platform authenticator, and does not sign in", async () => {
    platformAuthenticatorIsAvailable.mockResolvedValue(false);
    render(<LoginPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Sign in with a passkey/ })).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("you@club.com"), { target: { value: "karo@gefane.invalid" } });
    fireEvent.click(screen.getByRole("button", { name: /Sign in with a passkey/ }));
    await waitFor(() => expect(screen.getByText(/does not support passkeys here/)).toBeInTheDocument());
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

  it("shows the switch on and lists passkeys with their names and dates", async () => {
    webauthnCredentials.mockResolvedValue(one);
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByText("My Windows laptop")).toBeInTheDocument());
    expect(screen.getByRole("switch", { name: "Biometric sign-in" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Unnamed passkey")).toBeInTheDocument();
    expect(screen.getByText(/Added Nov 1, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Last used Nov 10, 2026/)).toBeInTheDocument();
    expect(screen.getByText(/Never used/)).toBeInTheDocument();
    expect(screen.getByText(/On — Windows Hello signs you in/)).toBeInTheDocument();
  });

  it("shows the switch off when there are no passkeys yet", async () => {
    webauthnCredentials.mockResolvedValue({ credentials: [] });
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Biometric sign-in" })).toHaveAttribute("aria-checked", "false"));
    expect(screen.getByText(/Off — sign in with your password/)).toBeInTheDocument();
  });

  it("turning the switch on names the new passkey from the authenticator", async () => {
    webauthnCredentials.mockResolvedValue({ credentials: [] });
    webauthnRegisterOptions.mockResolvedValue({ challenge: "c", rp: { name: "OTSI VIE", id: "localhost" }, user: { id: "u", name: "karo@gefane.invalid", displayName: "Karo" }, pubKeyCredParams: [] });
    startRegistration.mockResolvedValue({ id: "abc", rawId: "abc", response: {}, type: "public-key", authenticatorAttachment: "platform" });
    webauthnRegisterVerify.mockResolvedValue({ id: "33333333-3333-3333-3333-333333333333", device_name: "Windows Hello", created_at: "2026-11-14T10:00:00.000Z", last_used_at: null });
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Biometric sign-in" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Biometric sign-in" }));
    await waitFor(() => expect(webauthnRegisterVerify).toHaveBeenCalledWith(expect.anything(), "Windows Hello"));
    await waitFor(() => expect(screen.getByText("Passkey added.")).toBeInTheDocument());
  });

  it("says passkeys are unavailable when there is no platform authenticator, and does not start a ceremony", async () => {
    platformAuthenticatorIsAvailable.mockResolvedValue(false);
    webauthnCredentials.mockResolvedValue({ credentials: [] });
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Biometric sign-in" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Biometric sign-in" }));
    await waitFor(() => expect(screen.getByText(/does not support passkeys here/)).toBeInTheDocument());
    expect(startRegistration).not.toHaveBeenCalled();
    expect(webauthnRegisterVerify).not.toHaveBeenCalled();
  });

  it("turning the switch off removes every passkey and says so", async () => {
    webauthnCredentials.mockResolvedValueOnce(one).mockResolvedValueOnce({ credentials: [] });
    webauthnDeleteCredential.mockResolvedValue({ deleted: true });
    render(<PasskeySettings />);
    await waitFor(() => expect(screen.getByText("My Windows laptop")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("switch", { name: "Biometric sign-in" }));
    await waitFor(() => expect(webauthnDeleteCredential).toHaveBeenCalledWith("11111111-1111-1111-1111-111111111111"));
    expect(webauthnDeleteCredential).toHaveBeenCalledWith("22222222-2222-2222-2222-222222222222");
    await waitFor(() => expect(screen.getByText("Passkey removed.")).toBeInTheDocument());
  });
});
