import { createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * Runtime configuration, read once from the environment. Missing or unsafe settings stop the process at start-up:
 * there is no default database, issuer or audience (a silent default would make tokens or tenants ambiguous).
 */
export interface Config {
  /** mysql://user:password@host:port/database — the least-privilege RUNTIME account (otsi_app), never the migrator */
  dbDsn: string;
  /** OIDC issuer and audience every access token must carry (validated on every request) */
  jwtIssuer: string;
  jwtAudience: string;
  /** where the issuer publishes its signing keys (production), or a PEM public key (local/test issuer) */
  jwksUrl?: string;
  jwtPublicKeyPem?: string;
  port: number;
  /** local sign-in (ADR-021): this API also issues the access tokens it verifies; absent when an external OIDC provider is used */
  localAuth?: LocalAuthConfig;
  /** media storage (Block 03); absent: uploads answer 503 STORAGE_NOT_CONFIGURED */
  storage?: StorageConfig;
  /** HMAC key of signed media URLs (playback); absent: a random key per process */
  mediaSigningKey?: string;
  /** base64 AES-256 key sealing users' provider access tokens until the worker uses them (shared with the worker) */
  credentialKey?: string;
  /** AI Analyst (ADR-141): the hosted reasoning model. Absent = the feature reports 'not configured' and never
   *  fabricates output. The provider name and model are recorded with each assessment; the API key is read from
   *  the environment only, never stored, never logged, never returned. */
  aiAnalyst?: AiAnalystConfig;
}

export interface AiAnalystConfig {
  /** human name of the provider (recorded with the assessment; the owner picks a provider that offers a
   *  no-training-on-data option - scope section 7) */
  provider: string;
  /** OpenAI-compatible chat-completions endpoint URL (the only provider shape this build speaks) */
  apiUrl: string;
  /** bearer key for the endpoint (environment only) */
  apiKey: string;
  /** model id the provider should run */
  model: string;
}

export interface StorageConfig {
  /** local object store root (an S3 adapter replaces it in deployment); the API and the workers must see the same directory */
  dir: string;
  /** bytes per upload part (resumable unit) */
  partBytes: number;
  /** largest accepted source file */
  maxUploadBytes: number;
}

export interface LocalAuthConfig {
  /** PKCS#8 PEM private key (RS256) the tokens are signed with; its public half is what the AuthGuard verifies */
  signingKeyPem: string;
  accessTtlSeconds: number;
  refreshTtlDays: number;
  /**
   * A rotated refresh token presented again within this many seconds is treated as a lost response (the browser aborted the request after
   * the server rotated), not theft: it gets a new token in the same family. After the window, reuse revokes the family.
   */
  refreshReuseGraceSeconds: number;
  /** Secure cookies (HTTPS). Only a plain-HTTP local machine may turn this off. */
  secureCookies: boolean;
  /** browser origins allowed to call the cookie endpoints (refresh, logout): CSRF defence together with SameSite=Strict */
  allowedOrigins: string[];
  /** WebAuthn (passkeys, ADR-143): the relying-party id — the loopback host the desktop app runs on
   *  (OTSI_VIE_WEBAUTHN_RP_ID, default "localhost"). A passkey created here cannot sign in to any other site. */
  webauthnRpId?: string;
  /** WebAuthn relying-party name shown to the person (OTSI_VIE_WEBAUTHN_RP_NAME, default "OTSI VIE"). */
  webauthnRpName?: string;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const v = env[name];
  if (!v || !v.trim()) throw new Error(`missing required setting ${name}`);
  return v.trim();
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cfg: Config = {
    dbDsn: required(env, "OTSI_VIE_DB_DSN"),
    jwtIssuer: required(env, "OTSI_VIE_JWT_ISSUER"),
    jwtAudience: required(env, "OTSI_VIE_JWT_AUDIENCE"),
    port: Number(env.OTSI_VIE_API_PORT ?? 4520),
  };
  if (env.OTSI_VIE_JWKS_URL) cfg.jwksUrl = env.OTSI_VIE_JWKS_URL;
  if (env.OTSI_VIE_JWT_PUBLIC_KEY_PEM) cfg.jwtPublicKeyPem = env.OTSI_VIE_JWT_PUBLIC_KEY_PEM;
  if (env.OTSI_VIE_LOCAL_SIGNING_KEY_FILE) {
    const signingKeyPem = readFileSync(env.OTSI_VIE_LOCAL_SIGNING_KEY_FILE, "utf8");
    cfg.localAuth = {
      signingKeyPem,
      accessTtlSeconds: Number(env.OTSI_VIE_ACCESS_TTL_SECONDS ?? 900),
      refreshTtlDays: Number(env.OTSI_VIE_REFRESH_TTL_DAYS ?? 14),
      refreshReuseGraceSeconds: Number(env.OTSI_VIE_REFRESH_REUSE_GRACE_SECONDS ?? 20),
      secureCookies: env.OTSI_VIE_INSECURE_COOKIES !== "yes",
      allowedOrigins: (env.OTSI_VIE_WEB_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
      webauthnRpId: (env.OTSI_VIE_WEBAUTHN_RP_ID ?? "localhost").trim(),
      webauthnRpName: (env.OTSI_VIE_WEBAUTHN_RP_NAME ?? "OTSI VIE").trim(),
    };
    cfg.jwtPublicKeyPem ??= publicKeyOf(signingKeyPem);
  }
  if (env.OTSI_VIE_STORAGE_DIR) {
    cfg.storage = {
      dir: env.OTSI_VIE_STORAGE_DIR,
      // 4 MiB a part: over a slow link (a browser away from this PC, through the tunnel) one part still lands in well under a minute, so
      // progress moves and no part outlives a proxy's time limit; on this PC parts are near-instant either way
      partBytes: Number(env.OTSI_VIE_UPLOAD_PART_BYTES ?? 4 * 1024 * 1024),
      maxUploadBytes: Number(env.OTSI_VIE_MAX_UPLOAD_BYTES ?? 64 * 1024 ** 3),
    };
    if (cfg.storage.partBytes < 1024 * 1024 || cfg.storage.partBytes > 256 * 1024 * 1024) throw new Error("OTSI_VIE_UPLOAD_PART_BYTES must be 1 MiB - 256 MiB");
  }
  if (env.OTSI_VIE_MEDIA_SIGNING_KEY) cfg.mediaSigningKey = env.OTSI_VIE_MEDIA_SIGNING_KEY;
  if (env.OTSI_VIE_CREDENTIAL_KEY) cfg.credentialKey = env.OTSI_VIE_CREDENTIAL_KEY;
  // AI Analyst (ADR-141): all three or none. A URL without a key or model fails at start-up rather than
  // half-configuring the feature; no URL at all means 'not configured' (the API answers 503, the UI says so).
  if (env.OTSI_VIE_AI_ANALYST_API_URL) {
    cfg.aiAnalyst = {
      provider: (env.OTSI_VIE_AI_ANALYST_PROVIDER ?? "hosted-llm").trim(),
      apiUrl: required(env, "OTSI_VIE_AI_ANALYST_API_URL"),
      apiKey: required(env, "OTSI_VIE_AI_ANALYST_API_KEY"),
      model: required(env, "OTSI_VIE_AI_ANALYST_MODEL"),
    };
  }
  if (!cfg.jwksUrl && !cfg.jwtPublicKeyPem) throw new Error("set OTSI_VIE_JWKS_URL or OTSI_VIE_JWT_PUBLIC_KEY_PEM");
  checkDsn(cfg.dbDsn, env);
  return cfg;
}

export function publicKeyOf(privatePem: string): string {
  return createPublicKey(privatePem).export({ type: "spki", format: "pem" }).toString();
}

function checkDsn(dsn: string, env: NodeJS.ProcessEnv): void {
  if (!/^mysql:\/\//.test(dsn)) throw new Error("OTSI_VIE_DB_DSN must be a mysql:// URL");
  if (new URL(dsn).port === "3306" && env.OTSI_VIE_ALLOW_PORT_3306 !== "yes") {
    // guard for this development machine: the owner's existing MySQL listens on 3306 and must never be touched by v2
    throw new Error("refusing to connect to port 3306 (the existing OTSI database) without OTSI_VIE_ALLOW_PORT_3306=yes");
  }
}

/** Background workers (outbox dispatcher, ...) need only the database: same runtime account, same 3306 guard. */
export interface WorkerConfig { dbDsn: string; pollMs: number }
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const dbDsn = required(env, "OTSI_VIE_DB_DSN");
  checkDsn(dbDsn, env);
  const pollMs = Number(env.OTSI_VIE_OUTBOX_POLL_MS ?? 500);
  if (!Number.isFinite(pollMs) || pollMs < 50) throw new Error("OTSI_VIE_OUTBOX_POLL_MS must be a number >= 50");
  return { dbDsn, pollMs };
}

export const CONFIG = Symbol("CONFIG");
