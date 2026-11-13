/**
 * On a linked desktop the token wallet, plans and orders, and the licence live on the central server (ADR-146 §3): this
 * interceptor answers those requests from central, with the person's central session. It runs after AuthGuard, so the
 * person is signed in here and a member of the organization; central checks again with its own rules. The local ledger
 * is never read on a linked desktop, so restoring old files or reinstalling cannot bring tokens back.
 *
 * Forwarded: /v1/wallet/..., /v1/billing/... (the organization's own pages), /v1/admin/billing/... (the company
 * organisation's pages — bank details, every customer's orders, confirmations and refunds; central enforces the
 * company rule, so a customer asking here gets central's 403) and GET /v1/licence. A receipt upload
 * (application/octet-stream) is passed on as bytes with its file headers, and a receipt download
 * (GET /v1/admin/billing/orders/:id/proof) comes back as bytes with central's file headers. While central cannot be
 * reached, GET /v1/licence answers from the signed licence kept on this computer (the person still has a licence
 * offline, in its grace); the wallet and billing say plainly that the account cannot be reached. Nothing is forwarded
 * on a local-only engine or on the central server itself.
 */
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import { from, type Observable } from "rxjs";
import type { Principal } from "../../core/auth";
import { PROOF_MAX_BYTES } from "@otsi-vie/contracts";
import { ApiError } from "../../core/problem";
import { readRawBody } from "../billing/billing";
import { CentralLinkService } from "./link";

const FORWARDED = /^\/v1\/(wallet|billing|admin\/billing)(\/|$)/;
/** A receipt download: a file, not JSON — its bytes and file headers pass through. */
const PROOF_DOWNLOAD = /^\/v1\/admin\/billing\/orders\/[^/]+\/proof$/;

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
    if (req.method === "GET" && PROOF_DOWNLOAD.test(path)) {
      // A receipt download is a file, not JSON. Its handler answers with @Res(), so the framework would not
      // send an interceptor's return value for it — the bytes are sent here, and the Observable emits nothing
      // the framework could send (its value is ignored for @Res() handlers; the emission itself only keeps
      // Nest's lastValueFrom from failing on an empty sequence).
      return from((async () => {
        const f = await this.central.forwardBytes(p.organizationId, p.userId, req.method, url);
        void res.status(f.status);
        if (f.contentType) void res.header("content-type", f.contentType);
        if (f.contentDisposition) void res.header("content-disposition", f.contentDisposition);
        void res.header("content-length", f.body.length);
        void res.send(f.body);
      })());
    }
    return from((async () => {
      let raw: { body: Buffer; headers: Record<string, string> } | undefined;
      if (String(req.headers["content-type"] ?? "").startsWith("application/octet-stream")) {
        const headers: Record<string, string> = { "content-type": "application/octet-stream" };
        for (const h of ["x-content-type", "x-file-name"]) if (req.headers[h]) headers[h] = String(req.headers[h]);
        raw = { body: await readRawBody(req.body, PROOF_MAX_BYTES), headers };
      }
      try {
        const r = await this.central.forward(p.organizationId, p.userId, req.method, url, req.body, raw);
        void res.status(r.status);
        return r.body;
      } catch (e) {
        if (path === "/v1/licence" && e instanceof ApiError && e.code === "CENTRAL_UNREACHABLE") {
          const snap = await this.central.offlineSnapshot(p.organizationId);
          if (snap) return snap;
        }
        throw e;
      }
    })());
  }
}
