"use client";
/**
 * Who is signed in, and which organization they are acting for. On load the provider tries the refresh cookie; without a live session
 * the app pages send the visitor to /login. The organization choice is remembered per browser and always validated against /v1/me.
 */
import type { Me, MfaChallenge, SessionResponse } from "@otsi-vie/contracts";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { login as apiLogin, loginTwoStep, logout as apiLogout, refresh, session, webauthnLoginOptions, webauthnLoginVerify } from "@/lib/api";
import { browserSupportsWebAuthn, platformAuthenticatorIsAvailable, startAuthentication } from "@simplewebauthn/browser";

type Status = "loading" | "signed-out" | "signed-in";
interface AuthState {
  status: Status;
  me: Me | null;
  organization: Me["memberships"][number] | null;
  /** null: signed in. A challenge: two-step sign-in is on, call `signInWithCode` next. */
  signIn(email: string, password: string): Promise<MfaChallenge | null>;
  signInWithCode(mfaToken: string, code: string): Promise<void>;
  /** passkey sign-in (Windows Hello): the browser asks for the passkey, then the session is accepted. */
  signInWithPasskey(email: string): Promise<void>;
  /** a session obtained elsewhere (accepting an invitation) */
  adoptSession(s: SessionResponse): void;
  signOut(): Promise<void>;
  chooseOrganization(id: string): void;
  /** take a newer /v1/me (after the person changed their own photo) */
  updateMe(m: Me): void;
}

const Ctx = createContext<AuthState | null>(null);

function pickOrganization(me: Me): Me["memberships"][number] | null {
  const saved = session.organizationId;
  const m = me.memberships.find((x) => x.organization_id === saved) ?? me.memberships[0] ?? null;
  session.organizationId = m?.organization_id ?? null;
  return m;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");
  const [me, setMe] = useState<Me | null>(null);
  const [organization, setOrganization] = useState<Me["memberships"][number] | null>(null);

  const accept = useCallback((m: Me | null) => {
    setMe(m);
    setOrganization(m ? pickOrganization(m) : null);
    setStatus(m ? "signed-in" : "signed-out");
  }, []);

  useEffect(() => {
    let alive = true;
    void refresh().then((s) => { if (alive) accept(s?.me ?? null); }, () => { if (alive) accept(null); });
    return () => { alive = false; };
  }, [accept]);

  const value = useMemo<AuthState>(() => ({
    status, me, organization,
    async signIn(email, password) {
      const r = await apiLogin(email, password);
      if ("mfa_required" in r) return r;
      accept(r.me);
      return null;
    },
    async signInWithCode(mfaToken, code) { accept((await loginTwoStep(mfaToken, code)).me); },
    async signInWithPasskey(email) {
      if (!browserSupportsWebAuthn()) throw new Error("passkeys are not supported by this browser");
      // The Electron app window has no platform authenticator (Windows Hello), so a ceremony there cannot
      // offer "This device". Refuse plainly instead of opening a prompt without it.
      if (!(await platformAuthenticatorIsAvailable())) throw new Error("passkeys are not supported by this browser");
      const options = await webauthnLoginOptions(email);
      const assertion = await startAuthentication({ optionsJSON: options });
      accept((await webauthnLoginVerify(assertion)).me);
    },
    adoptSession(s) { accept(s.me); },
    async signOut() { await apiLogout(); accept(null); },
    updateMe(m) { setMe(m); },
    chooseOrganization(id) {
      const m = me?.memberships.find((x) => x.organization_id === id);
      if (m) { session.organizationId = id; setOrganization(m); }
    },
  }), [status, me, organization, accept]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
