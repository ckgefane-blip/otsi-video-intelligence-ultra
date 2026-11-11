/**
 * WebAuthn passkeys (ADR-143, ultra-only): sign in with Windows Hello (fingerprint, face or PIN) instead of
 * typing email + password every time.
 *
 * The browser's answer to a WebAuthn ceremony is a JSON object the WebAuthn library validates on the API; this
 * file only requires the fields the API reads before handing it over (the credential id and the client data).
 * The options the API returns are the library's creation/request options JSON, which the web app passes straight
 * to `startRegistration` / `startAuthentication` — the response schemas below name the fields the client relies
 * on and pass the rest through.
 *
 * What is never in here: a private key. The server stores only the public half (credential id, COSE public key,
 * counter) — see migration 0074. A passkey is possession + a biometric/PIN, so a passkey login does not ask for
 * a two-step code, and it only succeeds for a verified (non-provisional) user, the same bar password sign-in sets.
 */
import { z } from "zod";

/** The browser's answer to a WebAuthn ceremony, as the browser sends it. */
export const WebAuthnResponseJson = z.object({
  id: z.string().min(1),
  rawId: z.string().min(1),
  response: z.object({
    clientDataJSON: z.string().min(1),
    attestationObject: z.string().min(1).optional(),
    authenticatorData: z.string().min(1).optional(),
    signature: z.string().min(1).optional(),
    userHandle: z.string().optional(),
  }).passthrough(),
  type: z.literal("public-key"),
  authenticatorAttachment: z.string().optional(),
  clientExtensionResults: z.record(z.unknown()).optional(),
}).passthrough();
export type WebAuthnResponseJson = z.infer<typeof WebAuthnResponseJson>;

/** POST /v1/auth/webauthn/register/options — the signed-in user starts adding a passkey. No body. */
export const WebAuthnRegisterOptionsRequest = z.object({});
export type WebAuthnRegisterOptionsRequest = z.infer<typeof WebAuthnRegisterOptionsRequest>;

/** What register/options returns: the creation options the browser's `create()` call needs. */
export const WebAuthnRegisterOptionsResponse = z.object({
  challenge: z.string().min(1),
  rp: z.object({ name: z.string(), id: z.string() }),
  user: z.object({ id: z.string(), name: z.string(), displayName: z.string() }),
  pubKeyCredParams: z.array(z.unknown()),
  timeout: z.number().optional(),
  attestation: z.string().optional(),
  excludeCredentials: z.array(z.unknown()).optional(),
  authenticatorSelection: z.unknown().optional(),
  extensions: z.unknown().optional(),
}).passthrough();
export type WebAuthnRegisterOptionsResponse = z.infer<typeof WebAuthnRegisterOptionsResponse>;

/** POST /v1/auth/webauthn/register/verify — the browser's attestation, plus the name the person gave the passkey. */
export const WebAuthnRegisterVerifyRequest = z.object({
  response: WebAuthnResponseJson,
  device_name: z.string().trim().min(1).max(80).optional(),
});
export type WebAuthnRegisterVerifyRequest = z.infer<typeof WebAuthnRegisterVerifyRequest>;

/** POST /v1/auth/webauthn/login/options — start a passkey sign-in for an email. */
export const WebAuthnLoginOptionsRequest = z.object({
  email: z.string().trim().email().max(255),
});
export type WebAuthnLoginOptionsRequest = z.infer<typeof WebAuthnLoginOptionsRequest>;

/** What login/options returns: the request options the browser's `get()` call needs. */
export const WebAuthnLoginOptionsResponse = z.object({
  challenge: z.string().min(1),
  rpId: z.string().min(1),
  allowCredentials: z.array(z.unknown()).optional(),
  timeout: z.number().optional(),
  userVerification: z.string().optional(),
  extensions: z.unknown().optional(),
}).passthrough();
export type WebAuthnLoginOptionsResponse = z.infer<typeof WebAuthnLoginOptionsResponse>;

/** POST /v1/auth/webauthn/login/verify — the browser's assertion. On success the API sets the refresh cookie and
 *  returns the same session a password sign-in returns. */
export const WebAuthnLoginVerifyRequest = z.object({
  response: WebAuthnResponseJson,
});
export type WebAuthnLoginVerifyRequest = z.infer<typeof WebAuthnLoginVerifyRequest>;

/** One passkey as the API lists it — never the public key. */
export const WebAuthnCredential = z.object({
  id: z.string().uuid(),
  device_name: z.string().nullable(),
  created_at: z.string(),
  last_used_at: z.string().nullable(),
});
export type WebAuthnCredential = z.infer<typeof WebAuthnCredential>;

/** GET /v1/auth/webauthn/credentials — the signed-in person's passkeys. */
export const WebAuthnCredentialListResponse = z.object({
  credentials: z.array(WebAuthnCredential),
});
export type WebAuthnCredentialListResponse = z.infer<typeof WebAuthnCredentialListResponse>;
