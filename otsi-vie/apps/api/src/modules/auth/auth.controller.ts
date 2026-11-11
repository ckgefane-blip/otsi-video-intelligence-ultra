/**
 * Sign-in endpoints (ADR-021). Cookie-authenticated endpoints (refresh, logout) and login require the `X-OTSI-CSRF: 1` header — a custom
 * header a cross-site form cannot send and cross-site scripts cannot add without a CORS preflight the API never grants — and, when the
 * browser sends an Origin, an allowed origin. The refresh cookie is HttpOnly, SameSite=Strict, Path=/, and Secure (`__Host-` prefixed)
 * everywhere except a plain-HTTP local machine — also when the same installation is reached both over HTTPS (a tunnel) and directly on
 * this machine's loopback over plain HTTP: requests from an http://127.0.0.1 or http://localhost origin get the non-Secure cookie, which
 * a browser keeps only for that loopback origin; every other origin keeps Secure.
 */
import { Body, Controller, Headers, HttpCode, Post, Req, Res } from "@nestjs/common";
import { AcceptInvitationRequest, LoginRequest, MfaLoginRequest } from "@otsi-vie/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { ApiError } from "../../core/problem";
import { AuthService, ClientInfo } from "./auth.service";

export const CSRF_HEADER = "x-otsi-csrf";

function readCookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return undefined;   // a malformed cookie is no session, not a server error (was: URIError -> 500)
      }
    }
  }
  return undefined;
}

@Controller("v1")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private secure(req: FastifyRequest): boolean {
    const origin = req.headers.origin ?? "";
    return this.auth.settings.secureCookies && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
  }

  private cookieName(req: FastifyRequest): string {
    return this.secure(req) ? "__Host-otsi_vie_refresh" : "otsi_vie_refresh";
  }

  private guard(req: FastifyRequest, csrf: string | undefined): void {
    if (csrf !== "1") throw new ApiError(403, "CSRF_HEADER_REQUIRED", "This request must come from the OTSI VIE app.");
    const origin = req.headers.origin;
    const allowed = this.auth.settings.allowedOrigins;
    if (origin && allowed.length > 0 && !allowed.includes(origin)) throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This request must come from the OTSI VIE app.");
  }

  private setCookie(req: FastifyRequest, res: FastifyReply, value: string, maxAge: number): void {
    const secure = this.secure(req) ? "; Secure" : "";
    void res.header("set-cookie", `${this.cookieName(req)}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`);
    void res.header("cache-control", "no-store");
  }

  private client(req: FastifyRequest): ClientInfo {
    return { userAgent: req.headers["user-agent"], ip: req.ip };
  }

  @Post("auth/login")
  @HttpCode(200)
  async login(@Body() body: unknown, @Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    this.guard(req, csrf);
    const { email, password } = LoginRequest.parse(body);
    const s = await this.auth.login(email, password, this.client(req));
    if ("challenge" in s) {                                            // two-step sign-in: no session yet
      void res.header("cache-control", "no-store");
      return s.challenge;
    }
    this.setCookie(req, res, s.refreshToken, s.refreshMaxAgeSeconds);
    return s.body;
  }

  /** sign-in step 2 (two-step sign-in on): the challenge token and a code from the authenticator app */
  @Post("auth/login/two-step")
  @HttpCode(200)
  async loginTwoStep(@Body() body: unknown, @Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    this.guard(req, csrf);
    const { mfa_token, code } = MfaLoginRequest.parse(body);
    const s = await this.auth.loginSecondStep(mfa_token, code, this.client(req));
    this.setCookie(req, res, s.refreshToken, s.refreshMaxAgeSeconds);
    return s.body;
  }

  /** a new person accepts an invitation with their name and a password, and is signed in */
  @Post("auth/invitations/accept")
  @HttpCode(200)
  async acceptInvitation(@Body() body: unknown, @Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    this.guard(req, csrf);
    const s = await this.auth.acceptInvitation(AcceptInvitationRequest.parse(body), this.client(req));
    this.setCookie(req, res, s.refreshToken, s.refreshMaxAgeSeconds);
    return s.body;
  }

  @Post("auth/refresh")
  @HttpCode(200)
  async refresh(@Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    this.guard(req, csrf);
    try {
      const s = await this.auth.refresh(readCookie(req, this.cookieName(req)), this.client(req));
      this.setCookie(req, res, s.refreshToken, s.refreshMaxAgeSeconds);
      return s.body;
    } catch (e) {
      this.setCookie(req, res, "", 0);                                  // a dead session's cookie is cleared
      throw e;
    }
  }

  @Post("auth/logout")
  @HttpCode(204)
  async logout(@Headers(CSRF_HEADER) csrf: string | undefined, @Req() req: FastifyRequest, @Res({ passthrough: true }) res: FastifyReply) {
    this.guard(req, csrf);
    await this.auth.logout(readCookie(req, this.cookieName(req)));
    this.setCookie(req, res, "", 0);
  }
}
