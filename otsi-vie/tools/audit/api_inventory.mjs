// Machine-readable inventory of the IMPLEMENTED API (living: docs/api/API_CONTRACT_INVENTORY.json; audited snapshot: --snapshot).
// Request/response schemas are converted from the compiled zod contracts (packages/contracts/dist), so they are what the API validates;
// the route table below is checked against the controllers' decorators (every implemented route must be listed, nothing extra).
// Planned endpoints come from the approved page specifications and are listed separately, never mixed with implemented ones.
//   node otsi-vie/tools/audit/api_inventory.mjs            (run `corepack pnpm build` in packages/contracts first)
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const C = require(path.join(APP, "packages", "contracts", "dist", "index.js"));

// ------------------------------------------------------------------ zod 3 -> JSON Schema (the subset the contracts use)
function js(s) {
  const d = s._def, t = d.typeName;
  const desc = d.description ? { description: d.description } : {};
  switch (t) {
    case "ZodString": {
      const o = { type: "string", ...desc };
      for (const c of d.checks ?? []) {
        if (c.kind === "min") o.minLength = c.value; else if (c.kind === "max") o.maxLength = c.value; else if (c.kind === "length") { o.minLength = o.maxLength = c.value; }
        else if (c.kind === "regex") o.pattern = c.regex.source; else if (c.kind === "uuid") o.format = "uuid"; else if (c.kind === "email") o.format = "email";
        else if (c.kind === "date") o.format = "date"; else if (c.kind === "datetime") o.format = "date-time"; else if (c.kind === "url") o.format = "uri";
      }
      return o;
    }
    case "ZodNumber": {
      const o = { type: (d.checks ?? []).some((c) => c.kind === "int") ? "integer" : "number", ...desc };
      for (const c of d.checks ?? []) { if (c.kind === "min") o[c.inclusive ? "minimum" : "exclusiveMinimum"] = c.value; if (c.kind === "max") o[c.inclusive ? "maximum" : "exclusiveMaximum"] = c.value; }
      return o;
    }
    case "ZodBoolean": return { type: "boolean", ...desc };
    case "ZodLiteral": return { const: d.value, ...desc };
    case "ZodEnum": return { type: "string", enum: d.values, ...desc };
    case "ZodNativeEnum": return { enum: Object.values(d.values), ...desc };
    case "ZodNullable": { const i = js(d.innerType); return { anyOf: [i, { type: "null" }], ...desc }; }
    case "ZodOptional": return { ...js(d.innerType), ...desc, "x-optional": true };
    case "ZodDefault": return { ...js(d.innerType), default: d.defaultValue(), ...desc };
    case "ZodArray": { const o = { type: "array", items: js(d.type), ...desc }; if (d.minLength) o.minItems = d.minLength.value; if (d.maxLength) o.maxItems = d.maxLength.value; return o; }
    case "ZodUnion": return { anyOf: d.options.map(js), ...desc };
    case "ZodRecord": return { type: "object", additionalProperties: js(d.valueType), ...desc };
    case "ZodUnknown": case "ZodAny": return { ...desc };
    case "ZodEffects": return js(d.schema);
    case "ZodObject": {
      const shape = d.shape(), props = {}, required = [];
      for (const [k, v] of Object.entries(shape)) {
        const p = js(v);
        if (p["x-optional"]) delete p["x-optional"]; else if (!("default" in p)) required.push(k);
        props[k] = p;
      }
      return { type: "object", properties: props, ...(required.length ? { required } : {}), ...desc };
    }
    default: return { "x-zod": t, ...desc };
  }
}
const schema = (name) => (name ? js(C[name]) : null);
const arrayOf = (name) => ({ type: "array", items: js(C[name]) });

// ------------------------------------------------------------------ the implemented routes
const W = ["OWNER", "ADMIN", "ANALYST", "EDITOR"];
const A = ["OWNER", "ADMIN", "ANALYST"];
const ALL = "any ACTIVE member";
const T = (f, names) => ({ file: `apps/api/test/${f}`, cases: names });
const routes = [
  // auth (ADR-021)
  { m: "POST", p: "/v1/auth/login", auth: "none (CSRF header x-otsi-csrf: 1, allowed Origin)", tenant: "none", roles: "—", req: "LoginRequest", res: "SessionResponse", status: 200,
    sets: "HttpOnly SameSite=Strict refresh cookie", errors: ["CSRF_HEADER_REQUIRED 403", "ORIGIN_NOT_ALLOWED 403", "INVALID_REQUEST 422", "INVALID_CREDENTIALS 401", "ACCOUNT_LOCKED 429"],
    file: "src/modules/auth/auth.controller.ts + auth.service.ts", tests: [T("auth.api.test.ts", 11), "apps/web/e2e/shell.spec.ts (sign-in, reload, sign-out)"] },
  { m: "POST", p: "/v1/auth/refresh", auth: "refresh cookie + CSRF header", tenant: "none", roles: "—", req: null, res: "SessionResponse", status: 200, sets: "rotated refresh cookie (reuse detection ends the session family)",
    errors: ["CSRF_HEADER_REQUIRED 403", "NO_SESSION 401", "SESSION_REVOKED 401"], file: "src/modules/auth/auth.controller.ts", tests: [T("auth.api.test.ts", "rotation, replay")] },
  { m: "POST", p: "/v1/auth/logout", auth: "refresh cookie + CSRF header", tenant: "none", roles: "—", req: null, res: null, status: 204, errors: ["CSRF_HEADER_REQUIRED 403"],
    file: "src/modules/auth/auth.controller.ts", tests: [T("auth.api.test.ts", "logout")] },
  { m: "GET", p: "/v1/me", auth: "Bearer", tenant: "none (account-level)", roles: "—", req: null, res: "Me", status: 200, errors: ["UNAUTHENTICATED 401", "INVALID_TOKEN 401", "UNKNOWN_ACCOUNT 401"],
    file: "src/modules/account/account.ts", tests: [T("auth.api.test.ts", "/me")] },
  // audit (ADR-019)
  { m: "GET", p: "/v1/audit-events", auth: "Bearer", tenant: "X-Organization-Id", roles: ["OWNER", "ADMIN"], query: "AuditQuery", res: "AuditPage", status: 200, errors: ["ROLE_NOT_ALLOWED 403", "INVALID_REQUEST 422"],
    file: "src/modules/audit/audit.controller.ts + audit.service.ts", tests: [T("audit.api.test.ts", 7)] },
  // projects (F04)
  { m: "GET", p: "/v1/projects", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "Project" }, status: 200, errors: [], file: "src/modules/projects/projects.ts", tests: [T("media.api.test.ts", "projects")] },
  { m: "POST", p: "/v1/projects", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "CreateProjectRequest", res: "Project", status: 201, errors: ["ROLE_NOT_ALLOWED 403", "INVALID_REQUEST 422"], file: "src/modules/projects/projects.ts", tests: [T("media.api.test.ts", "projects"), "apps/web/e2e/upload.spec.ts"] },
  { m: "GET", p: "/v1/projects/:projectId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "Project", status: 200, errors: ["NOT_FOUND 404 (also for another organization's project)"], file: "src/modules/projects/projects.ts", tests: [T("media.api.test.ts", "projects")] },
  { m: "PATCH", p: "/v1/projects/:projectId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "UpdateProjectRequest", res: "Project", status: 200, errors: ["NOT_FOUND 404", "STALE_VERSION 409"], file: "src/modules/projects/projects.ts", tests: [T("media.api.test.ts", "optimistic concurrency")] },
  // media: videos, uploads, imports (ADR-022, ADR-023, ADR-027)
  { m: "GET", p: "/v1/videos", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, query: "project_id (uuid, optional)", res: { array: "Video" }, status: 200, errors: ["NOT_FOUND 404 (bad project_id)"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "videos"), "apps/web/e2e/upload.spec.ts"] },
  { m: "GET", p: "/v1/videos/:videoId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "Video", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "videos")] },
  { m: "GET", p: "/v1/videos/:videoId/thumbnail", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "image/jpeg (binary)", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "thumbnail"), "apps/web/e2e/upload.spec.ts"] },
  { m: "POST", p: "/v1/uploads", auth: "Bearer", tenant: "X-Organization-Id", roles: W, headers: "Idempotency-Key (required)", req: "CreateUploadRequest", res: "UploadSession", status: "201 new / 200 same key",
    errors: ["IDEMPOTENCY_KEY_REQUIRED 400", "IDEMPOTENCY_KEY_REUSED 409", "UNSUPPORTED_FILE_TYPE 422", "FILE_TOO_LARGE 413", "PROJECT_ARCHIVED 409", "NOT_FOUND 404", "STORAGE_NOT_CONFIGURED 503"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "upload sessions"), "apps/web/e2e/upload.spec.ts"] },
  { m: "GET", p: "/v1/uploads/:uploadId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "UploadSession", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "resume")] },
  { m: "PUT", p: "/v1/uploads/:uploadId/parts/:n", auth: "Bearer", tenant: "X-Organization-Id", roles: W, headers: "Content-Type: application/octet-stream; X-Part-SHA256 (optional, verified)", req: "binary part (exact planned size)",
    res: { type: "object", properties: { part_number: { type: "integer" }, bytes: { type: "integer" }, sha256: { type: "string" } } }, status: 200,
    errors: ["OCTET_STREAM_REQUIRED 415", "UPLOAD_NOT_OPEN 409", "UPLOAD_EXPIRED 410", "INVALID_PART 422", "PART_SIZE_MISMATCH 422", "PART_CHECKSUM_MISMATCH 422", "PART_TOO_LARGE 413"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "parts")] },
  { m: "POST", p: "/v1/uploads/:uploadId/complete", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: "Video", status: 200, effect: "outbox video.uploaded -> INGEST_UPLOAD worker job",
    errors: ["UPLOAD_INCOMPLETE 409", "UPLOAD_NOT_OPEN 409"], file: "src/modules/media/media.ts + core/outbox/subscribers.ts", tests: [T("media.api.test.ts", "exactly one ingest job"), "services/worker/tests/test_ingest.py"] },
  { m: "DELETE", p: "/v1/uploads/:uploadId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: null, status: 204, errors: ["UPLOAD_NOT_OPEN 409"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "aborts")] },
  { m: "GET", p: "/v1/import-providers", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "provider policy list (providers.json without host lists)", status: 200, errors: [], file: "src/modules/media/media.ts + packages/contracts/src/providers.json", tests: [T("media.api.test.ts", "import policy")] },
  { m: "POST", p: "/v1/imports", auth: "Bearer", tenant: "X-Organization-Id", roles: W, headers: "Idempotency-Key (required)", req: "CreateImportRequest", res: "Video", status: 201, effect: "outbox video.import_requested -> INGEST_URL worker job (sealed token only in the job)",
    errors: ["INVALID_URL 422", "UNSUPPORTED_PROVIDER 422", "AUTH_REQUIRED 422", "BLOCKED_DESTINATION 422", "CREDENTIALS_NOT_CONFIGURED 503", "IDEMPOTENCY_KEY_REQUIRED 400"], file: "src/modules/media/media.ts", tests: [T("media.api.test.ts", "imports"), "services/worker/tests/test_url_import.py", "services/worker/tests/test_providers.py", "apps/web/e2e/upload.spec.ts"] },
  // analysis (ADR-024, ADR-025, ADR-028)
  { m: "POST", p: "/v1/videos/:videoId/analysis-runs", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: "CreateAnalysisRequest", res: "AnalysisRun", status: 201, effect: "outbox analysis.requested -> ANALYZE worker job",
    errors: ["VIDEO_NOT_READY 409", "ANALYSIS_ALREADY_RUNNING 409", "NOT_FOUND 404", "ROLE_NOT_ALLOWED 403"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "start"), "services/worker/tests/test_analyze.py", "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/videos/:videoId/analysis-runs", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "AnalysisRun" }, status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "runs"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "POST", p: "/v1/videos/:videoId/assessments", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: "QualityAssessment", status: 202, effect: "outbox video.assessment_requested -> ASSESS worker job (footage quality, player size, detector cost)", errors: ["VIDEO_NOT_READY 409", "NOT_FOUND 404"], file: "src/modules/analysis/assessment.ts", tests: [T("profiles.api.test.ts", "assessments"), "services/worker/tests/test_grassroots.py"] },
  { m: "GET", p: "/v1/videos/:videoId/assessments/latest", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "QualityAssessment", status: 200, errors: ["NOT_ASSESSED 404", "NOT_FOUND 404"], file: "src/modules/analysis/assessment.ts", tests: [T("profiles.api.test.ts", "assessments")] },
  { m: "GET", p: "/v1/analysis-runs/:runId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "AnalysisRun", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "run")] },
  { m: "POST", p: "/v1/analysis-runs/:runId/cancel", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: null, res: "AnalysisRun", status: 200, errors: ["RUN_NOT_ACTIVE 409", "NOT_FOUND 404"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "cancel")] },
  { m: "GET", p: "/v1/analysis-runs/:runId/tracks", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "TrackSummary" }, status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "honest labels"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/analysis-runs/:runId/observations", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, query: "from_us, to_us (integers, microseconds, window <= 20 s)", res: "ObservationWindow", status: 200,
    errors: ["INVALID_WINDOW 422", "WINDOW_TOO_LONG 422", "NOT_FOUND 404"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "observation window"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/videos/:videoId/playback", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "Playback", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "signed URL"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/media/:assetId", auth: "HMAC-signed URL (org, exp, sig) issued by /playback; no Bearer", tenant: "org in the signature", roles: "—", query: "org, exp, sig", headers: "Range (optional)", res: "video/webm (binary, 200 or 206)", status: "200/206",
    errors: ["INVALID_SIGNATURE 403", "LINK_EXPIRED 403", "NOT_FOUND 404", "STORAGE_NOT_CONFIGURED 503", "416 range not satisfiable"], file: "src/modules/analysis/analysis.ts", tests: [T("analysis.api.test.ts", "Range, tampered/foreign/expired")] },
  // players and identity (ADR-016, ADR-017)
  { m: "POST", p: "/v1/players", auth: "Bearer", tenant: "X-Organization-Id", roles: ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT"], headers: "Idempotency-Key (required)", req: "CreatePlayerRequest", res: "PlayerIdentity", status: "201 new / 200 same key",
    errors: ["IDEMPOTENCY_KEY_REQUIRED 400", "ROLE_NOT_ALLOWED 403"], file: "src/modules/players/players.controller.ts + players.service.ts", tests: [T("identity.api.test.ts", "test 5"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/players", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, query: "q (2-100 chars: name prefix or exact OTSI Player ID)", res: { array: "PlayerIdentity" }, status: 200, errors: ["QUERY_TOO_SHORT 422"],
    file: "src/modules/players/players.service.ts", tests: [T("identity.api.test.ts", "player search")] },
  { m: "GET", p: "/v1/players/by-otsi-id/:canonicalId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "PlayerIdentity", status: 200, errors: ["INVALID_OTSI_PLAYER_ID 422", "NOT_FOUND 404"], file: "src/modules/players/players.service.ts", tests: [T("identity.api.test.ts", "lookup")] },
  { m: "GET", p: "/v1/players/:playerId", auth: "Bearer", tenant: "X-Organization-Id (provisional records visible only to their organization)", roles: ALL, res: "PlayerIdentity", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/players/players.service.ts", tests: [T("identity.api.test.ts", "visibility")] },
  { m: "POST", p: "/v1/players/:playerId/registration", auth: "Bearer", tenant: "X-Organization-Id", roles: ["OWNER", "ADMIN"], headers: "Idempotency-Key (required)", req: "RegisterPlayerRequest", res: "PlayerIdentity", status: 200, effect: "issues the permanent OTSI-CCC-YYYY-NNNNNN once",
    errors: ["INVALID_COUNTRY_CODE 422", "PLAYER_NOT_ELIGIBLE_FOR_ISSUANCE 409", "CANONICAL_SEQUENCE_EXHAUSTED 409", "REQUEST_KEY_ALREADY_USED_FOR_ANOTHER_PLAYER 409"], file: "src/modules/players/players.service.ts + migration 0007 allocator", tests: [T("identity.api.test.ts", "tests 4, 11-13"), "tests/db/test_identity.py"] },
  { m: "POST", p: "/v1/players/:playerId/merge", auth: "Bearer", tenant: "X-Organization-Id", roles: ["OWNER", "ADMIN"], req: "MergePlayersRequest", res: "PlayerIdentity", status: 200,
    errors: ["PLATFORM_ADMIN_REQUIRED 403", "SURVIVOR_MUST_BE_REGISTERED 409", "PLAYER_ALREADY_MERGED 409", "MERGE_REASON_REQUIRED 422", "CANNOT_MERGE_A_PLAYER_INTO_ITSELF 422"], file: "src/modules/players/players.service.ts", tests: [T("identity.api.test.ts", "test 14")] },
  { m: "GET", p: "/v1/tracks/:trackId/identity", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "TrackIdentity", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/tracks/track-identity.controller.ts + service", tests: [T("identity.api.test.ts", "tests 15, 20"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "POST", p: "/v1/tracks/:trackId/identity-decisions", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: "IdentityDecisionRequest", res: "TrackIdentity", status: 201, effect: "append-only decision + audit + outbox track.identity_decided/corrected",
    errors: ["PLAYER_REQUIRED 422", "STALE_DECISION 409", "CORRECTION_REASON_REQUIRED 422", "IDENTITY_DECISION_TARGET_NOT_LIVE 409", "NOT_FOUND 404"], file: "src/modules/tracks/track-identity.service.ts", tests: [T("identity.api.test.ts", "decisions"), T("audit.api.test.ts", "audit"), "apps/web/e2e/workspace.spec.ts"] },
  // same-person links and track appearance (ADR-031)
  { m: "GET", p: "/v1/tracks/:trackId/thumbnail", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "image/jpeg (binary): the track's largest crop", status: 200,
    errors: ["NOT_FOUND 404", "STORAGE_NOT_CONFIGURED 503"], file: "src/modules/tracks/track-links.ts", tests: [T("links.api.test.ts", "thumbnail")] },
  { m: "GET", p: "/v1/tracks/:trackId/links", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "TrackLink" }, status: 200,
    errors: ["NOT_FOUND 404"], file: "src/modules/tracks/track-links.ts", tests: [T("links.api.test.ts", "suggestions"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/tracks/:trackId/person-group", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "PersonGroup", status: 200,
    errors: ["NOT_FOUND 404"], file: "src/modules/tracks/track-links.ts", tests: [T("links.api.test.ts", "groups")] },
  { m: "POST", p: "/v1/track-links/:linkId/decisions", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: "LinkDecisionRequest", res: { array: "TrackLink" }, status: 201,
    effect: "append-only link decision + audit + outbox track.link_decided; never changes an identity",
    errors: ["STALE_DECISION 409", "CORRECTION_REASON_REQUIRED 422", "NOT_FOUND 404", "ROLE_NOT_ALLOWED 403"], file: "src/modules/tracks/track-links.ts",
    tests: [T("links.api.test.ts", "decisions"), "apps/web/e2e/workspace.spec.ts"] },
  // clubs, matches, rosters (ADR-033)
  { m: "GET", p: "/v1/clubs", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, query: "q (name prefix, optional)", res: { array: "Club" }, status: 200, errors: [], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "clubs")] },
  { m: "POST", p: "/v1/clubs", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "CreateClubRequest", res: "Club", status: 201, errors: ["CLUB_EXISTS 409"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "clubs")] },
  { m: "POST", p: "/v1/matches", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "CreateMatchRequest", res: "Match", status: 201, effect: "audit + outbox match.created; optional video link", errors: ["NOT_FOUND 404 (club/video)"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "matches")] },
  { m: "GET", p: "/v1/matches", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "Match" }, status: 200, errors: [], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "matches")] },
  { m: "GET", p: "/v1/matches/:matchId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "Match", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "matches")] },
  { m: "PATCH", p: "/v1/matches/:matchId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "UpdateMatchRequest", res: "Match", status: 200, errors: ["STALE_VERSION 409", "NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "matches")] },
  { m: "POST", p: "/v1/videos/:videoId/match", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: { type: "object", properties: { match_id: { type: "string", format: "uuid" } }, required: ["match_id"] }, res: "Match", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "matches")] },
  { m: "POST", p: "/v1/matches/:matchId/roster", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "RosterUpsertRequest", res: "Match", status: 201, effect: "roster entry + append-only roster change + audit; a change un-verifies the entry",
    errors: ["SHIRT_NUMBER_TAKEN 409", "CLUB_NOT_IN_MATCH 422", "CORRECTION_REASON_REQUIRED 422", "PLAYER_NOT_LIVE 409", "NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "rosters")] },
  { m: "DELETE", p: "/v1/matches/:matchId/roster/:playerId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, query: "reason (required once verified)", req: null, res: "Match", status: 200, errors: ["CORRECTION_REASON_REQUIRED 422", "NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "rosters")] },
  { m: "POST", p: "/v1/matches/:matchId/roster/verify", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: { type: "object", properties: { verified: { type: "boolean" } }, required: ["verified"] }, res: "Match", status: 200,
    effect: "verification + player club/number history from the match date; the OTSI Player ID never changes", errors: ["ROSTER_EMPTY 409", "NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "rosters, transfer")] },
  { m: "GET", p: "/v1/matches/:matchId/roster/history", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "RosterChange" }, status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/matches/matches.ts", tests: [T("matches.api.test.ts", "rosters")] },
  // team identity, shirt numbers, identity candidates (ADR-033)
  { m: "GET", p: "/v1/analysis-runs/:runId/kit-groups", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "RunTeams", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/tracks/identity-evidence.ts", tests: [T("matches.api.test.ts", "kit groups")] },
  { m: "POST", p: "/v1/analysis-runs/:runId/kit-groups/:group/assignment", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: "TeamAssignmentRequest", res: "RunTeams", status: 201, effect: "append-only team assignment + audit + outbox run.team_assigned",
    errors: ["NO_MATCH 409", "CLUB_NOT_IN_MATCH 422", "TEAM_ALREADY_ASSIGNED 409", "STALE_DECISION 409", "CORRECTION_REASON_REQUIRED 422", "NOT_FOUND 404"], file: "src/modules/tracks/identity-evidence.ts", tests: [T("matches.api.test.ts", "kit groups")] },
  { m: "GET", p: "/v1/tracks/:trackId/jersey", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "JerseyEvidence", status: 200, errors: ["NOT_MEASURED 404", "NOT_FOUND 404"], file: "src/modules/tracks/identity-evidence.ts", tests: [T("matches.api.test.ts", "shirt numbers")] },
  { m: "POST", p: "/v1/tracks/:trackId/jersey-decisions", auth: "Bearer", tenant: "X-Organization-Id", roles: A, req: "JerseyDecisionRequest", res: "JerseyEvidence", status: 201, effect: "append-only shirt-number verdict + audit + outbox track.jersey_decided; never an identity",
    errors: ["STALE_DECISION 409", "CORRECTION_REASON_REQUIRED 422", "NOT_FOUND 404"], file: "src/modules/tracks/identity-evidence.ts", tests: [T("matches.api.test.ts", "shirt numbers")] },
  { m: "GET", p: "/v1/tracks/:trackId/candidates", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "TrackCandidates", status: 200, effect: "read-only suggestions with evidence and conflicts; decides nothing", errors: ["NOT_FOUND 404"], file: "src/modules/tracks/identity-evidence.ts", tests: [T("matches.api.test.ts", "candidates")] },
  // reels (ADR-032)
  { m: "POST", p: "/v1/reels", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "CreateReelRequest", res: "Reel", status: 201, errors: ["NO_ANALYSIS 409", "NO_CONFIRMED_TRACKS 409", "NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "create"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "GET", p: "/v1/reels", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, query: "video_id (uuid, optional)", res: { array: "Reel" }, status: 200, errors: [], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "list")] },
  { m: "GET", p: "/v1/reels/:reelId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "Reel", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "get")] },
  { m: "PATCH", p: "/v1/reels/:reelId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "UpdateReelRequest", res: "Reel", status: 200, errors: ["STALE_VERSION 409"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "settings")] },
  { m: "POST", p: "/v1/reels/:reelId/refresh-targets", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: "Reel", status: 200, errors: ["NO_CONFIRMED_TRACKS 409"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "stale")] },
  { m: "GET", p: "/v1/reels/:reelId/moments", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { array: "ReelMoment" }, status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "moments"), "apps/web/e2e/workspace.spec.ts"] },
  { m: "POST", p: "/v1/reels/:reelId/clips", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "AddClipRequest", res: "Reel", status: 201, errors: ["CLIP_TOO_LONG 422", "CLIP_OUTSIDE_VIDEO 422", "REEL_TOO_LONG 422"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "clips")] },
  { m: "POST", p: "/v1/reels/:reelId/clips/order", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "ReorderClipsRequest", res: "Reel", status: 200, errors: ["CLIPS_MISMATCH 422"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "reorder")] },
  { m: "PATCH", p: "/v1/reels/:reelId/clips/:clipId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "UpdateClipRequest", res: "Reel", status: 200, errors: ["NOT_FOUND 404", "CLIP_TOO_LONG 422"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "trim")] },
  { m: "GET", p: "/v1/players/:playerId/profile", auth: "Bearer", tenant: "X-Organization-Id", roles: "any member", res: "PlayerProfile", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/players/players.controller.ts", tests: [T("reels.api.test.ts", "player profile")] },
  { m: "PATCH", p: "/v1/players/:playerId/profile", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: "UpdatePlayerProfileRequest", res: "PlayerProfile", status: 200, errors: ["NOT_FOUND 404", "PROFILE_NOT_YOURS 403", "INVALID_BIRTH_DATE 422", "UNKNOWN_COUNTRY 422"], file: "src/modules/players/players.controller.ts", tests: [T("reels.api.test.ts", "player profile")] },
  { m: "GET", p: "/v1/player-list", auth: "Bearer", tenant: "X-Organization-Id", roles: "any member", res: "PlayerListEntry[]", status: 200, errors: [], file: "src/modules/players/players.controller.ts", tests: [T("reels.api.test.ts", "player profile")] },
  { m: "GET", p: "/v1/countries", auth: "Bearer", tenant: "X-Organization-Id", roles: "any member", res: "Country[]", status: 200, errors: [], file: "src/modules/players/players.controller.ts", tests: [T("reels.api.test.ts", "player profile")] },
  { m: "POST", p: "/v1/reels/:reelId/clips/add-moments", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: "Reel", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "bulk")] },
  { m: "DELETE", p: "/v1/reels/:reelId/clips", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: "Reel", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "bulk")] },
  { m: "DELETE", p: "/v1/reels/:reelId/clips/:clipId", auth: "Bearer", tenant: "X-Organization-Id", roles: W, req: null, res: "Reel", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "remove")] },
  { m: "POST", p: "/v1/reels/:reelId/renders", auth: "Bearer", tenant: "X-Organization-Id", roles: W, headers: "Idempotency-Key (required)", req: "CreateRenderRequest", res: "RenderJob", status: 201, effect: "outbox reel.render_requested -> RENDER worker job", errors: ["REEL_EMPTY 409", "REEL_TARGETS_STALE 409", "RENDER_ALREADY_RUNNING 409", "IDEMPOTENCY_KEY_REQUIRED 400"], file: "src/modules/reels/reels.ts + core/outbox/subscribers.ts", tests: [T("reels.api.test.ts", "render"), "services/worker/tests/test_render_reel.py", "apps/web/e2e/workspace.spec.ts"] },
  { m: "POST", p: "/v1/renders/:renderId/cancel", auth: "Bearer", tenant: "X-Organization-Id", roles: W, res: "RenderJob", status: 200, errors: ["NOT_FOUND 404", "RENDER_NOT_RUNNING 409"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "cancel")] },
  { m: "GET", p: "/v1/renders/:renderId", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: "RenderJob", status: 200, errors: ["NOT_FOUND 404"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "render")] },
  { m: "GET", p: "/v1/renders/:renderId/playback", auth: "Bearer", tenant: "X-Organization-Id", roles: ALL, res: { type: "object", properties: { url: { type: "string" }, download_url: { type: "string" }, mime: { type: "string" }, expires_at: { type: "string" }, notice: { type: "string" } } }, status: 200, errors: ["NOT_FOUND 404 (no rendered file)"], file: "src/modules/reels/reels.ts", tests: [T("reels.api.test.ts", "playback"), "apps/web/e2e/workspace.spec.ts"] },
];
const COMMON_ERRORS = ["UNAUTHENTICATED 401", "INVALID_TOKEN 401", "ORGANIZATION_REQUIRED 400", "NOT_A_MEMBER 403", "ROLE_NOT_ALLOWED 403 (routes with roles)", "INVALID_REQUEST 422 (body/query fails the contract)", "INTERNAL_ERROR 500"];

// ------------------------------------------------------------------ cross-check with the controllers' decorators
const found = new Set();
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
for (const f of walk(path.join(APP, "apps", "api", "src", "modules")).filter((f) => f.endsWith(".ts"))) {
  const src = readFileSync(f, "utf8");
  for (const cm of src.matchAll(/@Controller\("([^"]*)"\)[\s\S]*?(?=@Controller\(|$)/g)) {
    for (const r of cm[0].matchAll(/@(Get|Post|Put|Patch|Delete)\(("([^"]*)")?\)/g)) {
      const sub = r[3] ?? "";
      found.add(`${r[1].toUpperCase()} /${[cm[1], sub].filter(Boolean).join("/")}`.replace(/\/+/g, "/"));
    }
  }
}
const listed = new Set(routes.map((r) => `${r.m} ${r.p}`));
const missing = [...found].filter((x) => !listed.has(x)), extra = [...listed].filter((x) => !found.has(x));
if (missing.length || extra.length) { console.error("route table out of date", { missing, extra }); process.exit(1); }

// ------------------------------------------------------------------ planned endpoints from the approved page specs
const specs = JSON.parse(readFileSync(path.join(APP, "apps", "web", "src", "lib", "page-specs.generated.json"), "utf8")).pages;
const planned = specs.flatMap((pg) => pg.sections.filter((s) => s.contract).map((s) => ({
  page: pg.page ?? null, page_title: pg.title, section: s.n, section_title: s.title,
  spec_contract: s.contract.split(";").map((x) => x.trim()).filter(Boolean),
})));

const out = {
  generated_at: new Date().toISOString(),
  git_commit: execSync("git rev-parse --short HEAD", { cwd: APP }).toString().trim(),
  base_url: "http://127.0.0.1:4520 (direct) or same-origin /api/* through the Next.js web app (proxy)",
  conventions: {
    authentication: "Authorization: Bearer <RS256 access token> from POST /v1/auth/login or /v1/auth/refresh (local sign-in, ADR-021); external OIDC is configurable but not used yet",
    tenant_context: "X-Organization-Id: <uuid> on every organization route; the API checks an ACTIVE membership in MySQL on every request and takes the role from it, never from the token",
    roles: ["OWNER", "ADMIN", "ANALYST", "EDITOR", "SCOUT", "VIEWER"],
    errors: "every failure is {code, message, request_id} (contract Problem); codes are stable; X-Request-Id is returned on every response",
    common_errors: COMMON_ERRORS,
    idempotency: "POST /v1/uploads, /v1/imports, /v1/players and player registration require an Idempotency-Key header (8-128 safe characters)",
    time: "media times are integer microseconds since the video's first frame (pts_us); boxes are normalised 0..1 to the decoded frame (x, y = top-left)",
    identity: "track_number is a temporary per-run reference; canonical_otsi_id appears only for REGISTERED/RETIRED players and only after a CONFIRMED human decision",
  },
  implemented: routes.map((r) => ({
    method: r.m, path: r.p, authentication: r.auth, tenant_context: r.tenant, roles: r.roles,
    request: r.req ? (typeof r.req === "string" && C[r.req] ? { contract: r.req, schema: schema(r.req) } : { description: r.req }) : null,
    query: r.query ? (C[r.query] ? { contract: r.query, schema: schema(r.query) } : { description: r.query }) : null,
    headers: r.headers ?? null,
    response: r.res == null ? null : typeof r.res === "string" ? (C[r.res] ? { status: r.status, contract: r.res, schema: schema(r.res) } : { status: r.status, description: r.res })
      : r.res.array ? { status: r.status, contract: `${r.res.array}[]`, schema: arrayOf(r.res.array) } : { status: r.status, schema: r.res },
    side_effects: r.effect ?? null, sets: r.sets ?? null,
    errors: r.errors, service_files: r.file.split(" + ").map((x) => (x.startsWith("src/") ? `apps/api/${x}` : x)),
    tests: r.tests,
  })),
  not_http_endpoints: [
    { name: "bootstrap-owner", how: "CLI: python otsi-vie/tools/dev/local_stack.py bootstrap-owner (apps/api/src/cli)", note: "creates the first organization and owner; there is no public registration endpoint" },
    { name: "outbox dispatcher", how: "worker process apps/api/dist/workers/outbox-dispatcher.js", note: "turns events into worker jobs (ingest, proxy, analyze)" },
    { name: "Python worker", how: "python -m vie_worker.main (services/worker)", note: "jobs INGEST_UPLOAD, INGEST_URL, PROXY, ANALYZE" },
  ],
  planned_from_page_specs: { note: "Contracts named in the approved page specifications. NONE of these paths exist yet unless an implemented route above covers the same need (see FRONTEND_PAGE_MATRIX.md). Figma Make must not call them until they are implemented.", sections: planned },
};
// the audited snapshot (docs/integration-audit/, commit d3ef2f5) is kept as reviewed; the living inventory is docs/api/
const target = process.argv.includes("--snapshot") ? path.join(APP, "docs", "integration-audit", "API_CONTRACT_INVENTORY.json") : path.join(APP, "docs", "api", "API_CONTRACT_INVENTORY.json");
mkdirSync(path.dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(out, null, 1) + "\n");
console.log(`implemented ${routes.length} routes (matches the controllers), planned contract sections ${planned.length}`);
