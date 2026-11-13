/** Sign-in and account contracts (ADR-021). */
import { z } from "zod";

export const MembershipRole = z.enum(["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT", "VIEWER"]);

export const LoginRequest = z.object({
  email: z.string().trim().email().max(255),
  password: z.string().min(1).max(256),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

/**
 * First-run owner setup (SOT page 10): the owner creates their account — full name, email, password — and is signed in.
 * The SOT's form has no organization field: the organization takes the owner's name, and the owner can rename it in
 * Settings › Team after setup. Refused (409) once an organization already exists.
 */
export const SetupRequest = z.object({
  email: z.string().trim().email().max(255),
  display_name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use at most 80 characters."),
  password: z.string().min(1).max(256),
  /** a linked desktop's "Create account" (ADR-146 §2) names the club; a local first run leaves it out (owner's name) */
  organization_name: z.string().trim().min(2, "Enter at least 2 characters.").max(120, "Use at most 120 characters.").optional(),
});
export type SetupRequest = z.infer<typeof SetupRequest>;

/**
 * Public sign-up (ADR-146 §2, central server only): a person creates their OTSI account and their organization, and
 * becomes its OWNER — no invitation. The same password rules as everywhere else. The free grant stays a claim button.
 */
export const SignUpRequest = z.object({
  email: z.string().trim().email().max(255),
  display_name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use at most 80 characters."),
  organization_name: z.string().trim().min(2, "Enter at least 2 characters.").max(120, "Use at most 120 characters."),
  password: z.string().min(1).max(256),
});
export type SignUpRequest = z.infer<typeof SignUpRequest>;

export const Me = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string(), display_name: z.string(),
    /** when the profile photo was last set (GET /v1/me/avatar returns it); null = no photo */
    avatar_updated_at: z.string().nullable().default(null),
    /** when this person finished the first-run welcome (name and tour); null = not yet */
    onboarded_at: z.string().nullable().default(null) }),
  /** ACTIVE memberships only: the organizations this user can act for */
  memberships: z.array(z.object({ organization_id: z.string().uuid(), organization_name: z.string(), role: MembershipRole,
    /** true when this organisation is the company organisation (OTSI) — the only one whose owner/admin may
     *  do the company billing actions. Defaults to false (fail closed) when the server does not send it. */
    is_company_org: z.boolean().default(false) })),
});
export type Me = z.infer<typeof Me>;

/** The person's own welcome step: the name they want shown, and that the tour is done. */
export const UpdateMeRequest = z.object({
  display_name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use at most 80 characters.").optional(),
  onboarding_done: z.literal(true).optional(),
}).refine((b) => b.display_name !== undefined || b.onboarding_done === true, { message: "Nothing to change." });
export type UpdateMeRequest = z.infer<typeof UpdateMeRequest>;

/** The access token is returned in the body (kept in memory by the web app); the refresh token only ever travels in an HttpOnly cookie. */
export const SessionResponse = z.object({
  access_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  me: Me,
});
export type SessionResponse = z.infer<typeof SessionResponse>;
