/**
 * On a linked desktop the token wallet, plans and orders, and the licence live on the central server (ADR-146 §3): this
 * interceptor answers those requests from central, with the person's central session. It runs after AuthGuard, so the
 * person is signed in here and a member of the organization; central checks again with its own rules. The local ledger
 * is never read on a linked desktop, so restoring old files or reinstalling cannot bring tokens back.
 *
 * Forwarded: /v1/wallet/..., /v1/billing/... (the organization's own pages, not /v1/admin) and GET /v1/licence. A receipt
 * upload (application/octet-stream) is passed on as bytes with its file headers. Nothing is forwarded on a local-only
 * engine or on the central server itself.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { from, type Observable } from "rxjs";
import type { Principal } from "../../core/auth";
import { PROOF_MAX_BYTES } from "@otsi-vie/contracts";
import { readRawBody } from "../billing/billing";
import { CentralLinkService } from "./link";

const FORWARDED = /^\/v1\/(wallet|billing)(\/|$)/;

export function forwardedToCentral(method: string, path: string): boolean {
  return FORWARDED.test(path) || (method === "GET" && path === "/v1/licence");
}

@Injectable()
export class CentralForwardInterceptor implements NestInterceptor {
  constructor(private readonly central: CentralLinkService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.central.linked || ctx.getType() !== "http") return next.handle();
    const req = ctx.switchToHttp().getRequest<FastifyRequest & { principal?: Principal }>();
    const url = req.url;
    const path = url.split("?")[0]!;
    const p = req.principal;
    if (!p || !forwardedToCentral(req.method, path)) return next.handle();
    const res = ctx.switchToHttp().getResponse<FastifyReply>();
    return from((async () => {
      let raw: { body: Buffer; headers: Record<string, string> } | undefined;
      if (String(req.headers["content-type"] ?? "").startsWith("application/octet-stream")) {
        const headers: Record<string, string> = { "content-type": "application/octet-stream" };
        for (const h of ["x-content-type", "x-file-name"]) if (req.headers[h]) headers[h] = String(req.headers[h]);
        raw = { body: await readRawBody(req.body, PROOF_MAX_BYTES), headers };
      }
      const r = await this.central.forward(p.organizationId, p.userId, req.method, url, req.body, raw);
      void res.status(r.status);
      return r.body;
    })());
  }
}
