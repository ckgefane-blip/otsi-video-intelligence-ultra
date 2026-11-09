/**
 * One error shape for the whole API ({code, message, request_id}, contracts `Problem`). Database guard errors raised by the
 * schema (SIGNAL '45000', CHECK 3819, FK 1452, UNIQUE 1062) are translated to stable codes and HTTP statuses here, so a rule the
 * database enforces is reported the same way as one the service enforces. Unexpected errors never leak SQL or stack traces.
 */
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ZodIssue } from "zod";

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found`);
export const forbidden = (code: string, message: string) => new ApiError(403, code, message);

/** schema guard message -> [HTTP status, plain message] */
const SIGNALS: Record<string, [number, string]> = {
  CANONICAL_ID_IMMUTABLE: [409, "An issued OTSI Player ID can never change."],
  CANONICAL_ID_ONLY_BY_ALLOCATOR: [409, "OTSI Player IDs are issued only by registration."],
  CANONICAL_ID_NOT_ISSUED_TO_THIS_PLAYER: [409, "That OTSI Player ID was not issued to this player."],
  NEW_PLAYERS_ARE_PROVISIONAL: [409, "A new player starts as provisional; registration issues the ID."],
  INVALID_COUNTRY_CODE: [422, "Unknown country code (use a 3-letter ISO 3166-1 code or ENG/SCO/WAL/NIR)."],
  PLAYER_NOT_FOUND: [404, "Player not found."],
  PLAYER_NOT_ELIGIBLE_FOR_ISSUANCE: [409, "Only a provisional player can be registered."],
  CANONICAL_SEQUENCE_EXHAUSTED: [409, "No OTSI Player IDs are left for this country and year."],
  REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER: [409, "This request key was already used to register another player."],
  PLAYER_ALREADY_MERGED: [409, "One of these players was already merged."],
  SURVIVOR_MUST_BE_REGISTERED: [409, "A duplicate can only be merged into a registered player."],
  MERGE_REASON_REQUIRED: [422, "Say why these records are the same player."],
  CANNOT_MERGE_A_PLAYER_INTO_ITSELF: [422, "A player cannot be merged into itself."],
  MERGE_NEEDS_A_RECORDED_DECISION: [409, "A merge needs a recorded merge decision."],
  MERGE_IS_FINAL: [409, "A merge is final."],
  REGISTERED_PLAYERS_ARE_NEVER_DELETED: [409, "A registered player is never deleted."],
  REGISTERED_PLAYER_CANNOT_BECOME_PROVISIONAL: [409, "A registered player cannot become provisional again."],
  IDENTITY_DECISION_TARGET_NOT_LIVE: [409, "That player record is merged or retired; use the current player."],
  CORRECTION_REASON_REQUIRED: [422, "A correction needs a reason."],
};

export function fromDatabase(e: unknown): ApiError | undefined {
  const err = e as { errno?: number; sqlMessage?: string; message?: string };
  if (err.errno === 1644 && err.sqlMessage) {
    const key = err.sqlMessage.split(":")[0]!.trim();
    const hit = SIGNALS[key];
    return hit ? new ApiError(hit[0], key, hit[1]) : new ApiError(409, key, "The request breaks a data rule.");
  }
  if (err.errno === 1062) return new ApiError(409, "ALREADY_EXISTS", "That record already exists.");
  if (err.errno === 1452) return new ApiError(422, "REFERENCE_NOT_FOUND", "A referenced record does not exist or belongs elsewhere.");
  if (err.errno === 3819) return new ApiError(422, "INVALID_VALUE", "A value is outside what is allowed.");
  return undefined;
}

/** By shape, not instanceof: the contracts package may be loaded with its own copy of zod (ESM vs CommonJS), and a validation
 *  failure must never surface as a 500. */
const isZodError = (e: unknown): e is { issues: ZodIssue[] } =>
  e instanceof Error && e.name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(e: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    let p: ApiError;
    if (e instanceof ApiError) p = e;
    else if (isZodError(e)) p = new ApiError(422, "INVALID_REQUEST", e.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; "));
    else if (e instanceof HttpException) p = new ApiError(e.getStatus(), e.getStatus() === 404 ? "NOT_FOUND" : "HTTP_ERROR", e.message);
    else p = fromDatabase(e) ?? new ApiError(500, "INTERNAL_ERROR", "Something went wrong; it was logged.");
    if (p.status >= 500 && !(e instanceof ApiError)) req.log.error({ err: e }, "unhandled error");   // an ApiError 5xx (e.g. 503) is a decided answer
    void reply.status(p.status).send({ code: p.code, message: p.message, request_id: String(req.id) });
  }
}
