/**
 * Team and access (roadmap Step 1, F01): the organization's members with their roles, invitations by one-time link, and two-step
 * sign-in with an authenticator app. Only an owner or an admin manages the team; an admin can never create, change or remove an owner.
 */
import { z } from "zod";
import { MembershipRole, SessionResponse } from "./auth";

/** what each role may do, as the API enforces it (shown next to the role picker) */
export const ROLE_SUMMARY: Record<z.infer<typeof MembershipRole>, string> = {
  OWNER: "Everything, including owners.",
  ADMIN: "Everything except owners: the team, video rights, player registration and merges, the audit log.",
  ANALYST: "Uploads and analyses video, confirms who is who, builds and renders reels.",
  EDITOR: "Uploads video, builds and renders reels, adds notes. Does not confirm who is who.",
  SCOUT: "Views everything; adds players and edits their profiles.",
  VIEWER: "Views matches, players, reports and reels.",
};

export const TeamMember = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
  role: MembershipRole,
  /** two-step sign-in is switched on for this person */
  two_step: z.boolean(),
  is_you: z.boolean(),
});
export type TeamMember = z.infer<typeof TeamMember>;

export const Invitation = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: MembershipRole,
  invited_by: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  /** OPEN until it is used, withdrawn or past its date */
  state: z.enum(["OPEN", "ACCEPTED", "REVOKED", "EXPIRED"]),
});
export type Invitation = z.infer<typeof Invitation>;

export const Team = z.object({ members: z.array(TeamMember), invitations: z.array(Invitation) });
export type Team = z.infer<typeof Team>;

export const CreateInvitationRequest = z.object({
  email: z.string().trim().toLowerCase().email("Enter an e-mail address.").max(255),
  role: MembershipRole,
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

/** the link's secret is returned once, here; only its hash is stored (inviting the same address again replaces the old link) */
export const CreatedInvitation = z.object({ invitation: Invitation, token: z.string() });
export type CreatedInvitation = z.infer<typeof CreatedInvitation>;

export const ChangeRoleRequest = z.object({ role: MembershipRole });
export type ChangeRoleRequest = z.infer<typeof ChangeRoleRequest>;

/** what the person opening an invitation link sees before they accept (GET /v1/public/invitations/:token) */
export const InvitationPreview = z.object({
  organization_name: z.string(),
  email: z.string(),
  role: MembershipRole,
  invited_by: z.string(),
  expires_at: z.string(),
  /** this address already has an account here: sign in to accept, instead of choosing a password */
  has_account: z.boolean(),
});
export type InvitationPreview = z.infer<typeof InvitationPreview>;

/** a new person accepts: their name and a password (an existing account signs in and accepts instead) */
export const AcceptInvitationRequest = z.object({
  token: z.string().min(20).max(128),
  display_name: z.string().trim().min(2, "Enter at least 2 characters.").max(80, "Use at most 80 characters."),
  password: z.string().min(1).max(256),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

export const JoinInvitationRequest = z.object({ token: z.string().min(20).max(128) });
export type JoinInvitationRequest = z.infer<typeof JoinInvitationRequest>;

// ---- two-step sign-in ---------------------------------------------------------------------------------------------------------------

export const TOTP_CODE = z.string().trim().regex(/^(\d{6}|[A-Za-z0-9]{4}-?[A-Za-z0-9]{4})$/, "Enter the 6-digit code (or a recovery code).");

/** sign-in step 2: the password was right and this account has two-step sign-in, so a code is needed */
export const MfaChallenge = z.object({ mfa_required: z.literal(true), mfa_token: z.string(), expires_in: z.number().int().positive() });
export type MfaChallenge = z.infer<typeof MfaChallenge>;
export const LoginResponse = z.union([SessionResponse, MfaChallenge]);
export type LoginResponse = z.infer<typeof LoginResponse>;
export const MfaLoginRequest = z.object({ mfa_token: z.string().min(1).max(4096), code: TOTP_CODE });
export type MfaLoginRequest = z.infer<typeof MfaLoginRequest>;

export const TwoStepStatus = z.object({ enabled: z.boolean(), recovery_codes_left: z.number().int().min(0) });
export type TwoStepStatus = z.infer<typeof TwoStepStatus>;

export const PasswordConfirm = z.object({ password: z.string().min(1).max(256) });
export type PasswordConfirm = z.infer<typeof PasswordConfirm>;

/** setting up: the key for the authenticator app, as a QR picture (PNG data URL) and as text to type in */
export const TwoStepSetup = z.object({ secret: z.string(), otpauth_url: z.string(), qr_data_url: z.string() });
export type TwoStepSetup = z.infer<typeof TwoStepSetup>;

export const TwoStepConfirmRequest = z.object({ code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the app.") });
export type TwoStepConfirmRequest = z.infer<typeof TwoStepConfirmRequest>;
/** shown once: each works one time if the phone is lost */
export const RecoveryCodes = z.object({ recovery_codes: z.array(z.string()) });
export type RecoveryCodes = z.infer<typeof RecoveryCodes>;

export const TwoStepDisableRequest = z.object({ password: z.string().min(1).max(256), code: TOTP_CODE });
export type TwoStepDisableRequest = z.infer<typeof TwoStepDisableRequest>;
