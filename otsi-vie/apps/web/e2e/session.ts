import { expect, type Page } from "@playwright/test";

/** The scratch stack's test owner (tools/dev/e2e.py creates it with a password generated for this run). */
export const OWNER = { email: process.env.OTSI_E2E_EMAIL ?? "", password: process.env.OTSI_E2E_PASSWORD ?? "" };

/**
 * Sign in through the real API (same endpoint and CSRF header as the login form). Each test signs in itself: refresh tokens rotate, and a
 * shared stored cookie would be detected as reuse and revoke the session — which is the intended security behaviour.
 */
export async function signIn(page: Page): Promise<void> {
  expect(OWNER.email, "run the e2e tests through tools/dev/e2e.py").not.toBe("");
  const r = await page.request.post("/api/v1/auth/login", { headers: { "x-otsi-csrf": "1", origin: "http://127.0.0.1:4310" }, data: OWNER });
  expect(r.status()).toBe(200);
}
