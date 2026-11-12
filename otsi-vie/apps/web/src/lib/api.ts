/**
 * The web app's only way to reach the API: same-origin `/api/*` (proxied by Next.js), a Bearer access token kept in memory (never in
 * localStorage), the selected organization in `X-Organization-Id`, and one silent refresh through the HttpOnly cookie when the token
 * has expired. Errors arrive as the API's Problem shape ({code, message, request_id}).
 */
import type { AcceptInvitationRequest, InvitationPreview, LoginResponse, Me, MfaChallenge, SessionResponse, SetupRequest, WebAuthnCredential, WebAuthnCredentialListResponse } from "@otsi-vie/contracts";
import type { AuthenticationResponseJSON, PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON, RegistrationResponseJSON } from "@simplewebauthn/browser";

export class ApiProblem extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly requestId?: string) {
    super(message);
  }
}

const ORG_KEY = "otsi-vie-org";
let accessToken: string | null = null;
let refreshing: Promise<SessionResponse | null> | null = null;

export const session = {
  set(token: string | null) { accessToken = token; },
  get token() { return accessToken; },
  get organizationId(): string | null {
    try { return localStorage.getItem(ORG_KEY); } catch { return null; }
  },
  set organizationId(id: string | null) {
    try { if (id) localStorage.setItem(ORG_KEY, id); else localStorage.removeItem(ORG_KEY); } catch { /* storage unavailable */ }
  },
};

async function problemOf(r: Response): Promise<ApiProblem> {
  let body: { code?: string; message?: string; request_id?: string } = {};
  try { body = await r.json(); } catch { /* not JSON (proxy error) */ }
  return new ApiProblem(r.status, body.code ?? `HTTP_${r.status}`, body.message ?? (r.status >= 500 ? "The server could not answer. Try again." : "The request failed."), body.request_id);
}

/** Cookie endpoints: same origin, the CSRF header the API requires, never cached. */
async function cookieCall(path: string, body?: unknown): Promise<Response> {
  return fetch(`/api/v1/auth/${path}`, {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "x-otsi-csrf": "1", ...(body === undefined ? {} : { "content-type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** step 1: the password. With two-step sign-in on, the answer is a challenge and no session exists yet. */
export async function login(email: string, password: string): Promise<SessionResponse | MfaChallenge> {
  const r = await cookieCall("login", { email, password });
  if (!r.ok) throw await problemOf(r);
  const s = (await r.json()) as LoginResponse;
  if ("mfa_required" in s) return s;
  session.set(s.access_token);
  return s;
}

async function sessionCall(path: string, body: unknown): Promise<SessionResponse> {
  const r = await cookieCall(path, body);
  if (!r.ok) throw await problemOf(r);
  const s = (await r.json()) as SessionResponse;
  session.set(s.access_token);
  return s;
}

/** step 2: the code from the authenticator app (or a recovery code) */
export const loginTwoStep = (mfaToken: string, code: string) => sessionCall("login/two-step", { mfa_token: mfaToken, code });

/** passkey sign-in, step 1: the request options for an email. */
export async function webauthnLoginOptions(email: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const r = await cookieCall("webauthn/login/options", { email });
  if (!r.ok) throw await problemOf(r);
  return (await r.json()) as PublicKeyCredentialRequestOptionsJSON;
}

/** passkey sign-in, step 2: the browser's assertion. On success the session is set, like password sign-in. */
export const webauthnLoginVerify = (response: AuthenticationResponseJSON) => sessionCall("webauthn/login/verify", { response });

/** passkey registration, step 1: the creation options. */
export const webauthnRegisterOptions = () =>
  api<PublicKeyCredentialCreationOptionsJSON>("/v1/auth/webauthn/register/options", { method: "POST", organization: false });

/** passkey registration, step 2: the browser's attestation, plus the name the person gave the passkey. */
export const webauthnRegisterVerify = (response: RegistrationResponseJSON, device_name?: string) =>
  api<WebAuthnCredential>("/v1/auth/webauthn/register/verify", { method: "POST", organization: false, json: { response, ...(device_name ? { device_name } : {}) } });

/** the person's passkeys (never the public key). */
export const webauthnCredentials = () => api<WebAuthnCredentialListResponse>("/v1/auth/webauthn/credentials", { organization: false });

/** remove one passkey. */
export const webauthnDeleteCredential = (id: string) =>
  api<{ deleted: boolean }>(`/v1/auth/webauthn/credentials/${encodeURIComponent(id)}`, { method: "DELETE", organization: false });

/** a new person accepts an invitation with their name and password, and is signed in */
export const acceptInvitation = (body: AcceptInvitationRequest) => sessionCall("invitations/accept", body);

/** first-run owner setup (SOT page 10): create the owner account and sign them in */
export const setupOwner = (body: SetupRequest) => sessionCall("setup", body);

/** what an invitation link is for (no sign-in needed) */
export async function invitationPreview(token: string): Promise<InvitationPreview> {
  const r = await fetch(`/api/v1/public/invitations/${encodeURIComponent(token)}`, { cache: "no-store", credentials: "omit" });
  if (!r.ok) throw await problemOf(r);
  return (await r.json()) as InvitationPreview;
}

/** Exchange the refresh cookie for a new access token; null when there is no live session. Concurrent callers share one request. */
export function refresh(): Promise<SessionResponse | null> {
  refreshing ??= (async () => {
    try {
      const r = await cookieCall("refresh");
      if (!r.ok) { session.set(null); return null; }
      const s = (await r.json()) as SessionResponse;
      session.set(s.access_token);
      return s;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function logout(): Promise<void> {
  session.set(null);
  await cookieCall("logout").catch(() => undefined);
}

export interface ApiInit extends Omit<RequestInit, "body"> {
  json?: unknown;
  body?: BodyInit;
  /** false for account-level calls (GET /v1/me) */
  organization?: boolean;
}

export async function api<T>(path: string, init: ApiInit = {}): Promise<T> {
  const r = await raw(path, init);
  return (r.status === 204 ? undefined : await r.json()) as T;
}

/** Binary responses (thumbnails, later media and reports) with the same authentication and refresh as `api`. */
export async function apiBlob(path: string, init: ApiInit = {}): Promise<Blob> {
  return (await raw(path, init)).blob();
}

async function raw(path: string, init: ApiInit): Promise<Response> {
  const send = () => {
    const headers = new Headers(init.headers);
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    const org = session.organizationId;
    if (init.organization !== false && org) headers.set("x-organization-id", org);
    if (init.json !== undefined) headers.set("content-type", "application/json");
    const { json, organization: _o, ...rest } = init;
    return fetch(`/api${path}`, { ...rest, headers, credentials: "same-origin", ...(json !== undefined ? { body: JSON.stringify(json) } : {}) });
  };
  let r = await send();
  if (r.status === 401 && (await refresh())) r = await send();
  if (!r.ok) throw await problemOf(r);
  return r;
}

export const getMe = () => api<Me>("/v1/me", { organization: false });
