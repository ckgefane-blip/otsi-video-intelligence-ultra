/**
 * Time-based one-time codes for two-step sign-in (RFC 6238 over RFC 4226: HMAC-SHA1, 30-second steps, 6 digits), written with Node's
 * crypto only, so it costs nothing and has no third-party code in the security path. Every free authenticator app (Google
 * Authenticator, Microsoft Authenticator, Aegis, 2FAS, FreeOTP...) reads the otpauth:// key this produces.
 *
 * The shared secret is sealed with AES-256-GCM before it is stored: the key is derived from the installation's sign-in signing key and
 * the user id is bound in as associated data, so a copied row cannot be moved to another account and a database copy alone reveals
 * nothing. Recovery codes are random, shown once and stored only as SHA-256 hashes.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** codes from one step before and after are accepted too (clock drift of a phone, the time it takes to type) */
export const DRIFT_STEPS = 1;
export const SECRET_BYTES = 20;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(b: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of b) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("not base32");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const stepAt = (unixMs: number) => Math.floor(unixMs / 1000 / STEP_SECONDS);

/** the code for one time step (RFC 4226 dynamic truncation) */
export function codeAt(secret: Buffer, step: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1]! & 0x0f;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 10 ** DIGITS).padStart(DIGITS, "0");
}

/** the step the code belongs to (newest first within the drift window), or null; constant-time per comparison */
export function matchStep(secret: Buffer, code: string, nowMs: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepAt(nowMs);
  let found: number | null = null;
  for (let d = DRIFT_STEPS; d >= -DRIFT_STEPS; d--) {
    const s = now + d;
    if (timingSafeEqual(Buffer.from(codeAt(secret, s)), Buffer.from(code)) && found === null) found = s;
  }
  return found;
}

export const newSecret = () => randomBytes(SECRET_BYTES);

export function otpauthUrl(secretB32: string, account: string, issuer = "OTSI VIE"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

const sealKey = (signingKeyPem: string) => createHash("sha256").update("otsi-vie totp v1\0").update(signingKeyPem).digest();

export function sealSecret(secret: Buffer, userId: string, signingKeyPem: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(signingKeyPem), iv);
  c.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([c.update(secret), c.final(), c.getAuthTag()]);
  return `v1.${iv.toString("base64url")}.${ct.toString("base64url")}`;
}

export function openSecret(sealed: string, userId: string, signingKeyPem: string): Buffer {
  const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(sealed);
  if (!m) throw new Error("unknown sealed secret format");
  const raw = Buffer.from(m[2]!, "base64url");
  const d = createDecipheriv("aes-256-gcm", sealKey(signingKeyPem), Buffer.from(m[1]!, "base64url"));
  d.setAAD(Buffer.from(userId));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([d.update(raw.subarray(0, raw.length - 16)), d.final()]);
}

// ---- recovery codes -------------------------------------------------------------------------------------------------------------------

const RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";          // no 0/o, 1/l/i: read off paper without mistakes
export const RECOVERY_CODE_COUNT = 10;

export function newRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => RC_ALPHABET[x % RC_ALPHABET.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export const normalizeRecoveryCode = (c: string) => c.trim().toLowerCase().replace(/-/g, "");
export const recoveryCodeHash = (c: string) => createHash("sha256").update(normalizeRecoveryCode(c)).digest("hex");
export const isRecoveryCode = (c: string) => /^[a-z0-9]{8}$/.test(normalizeRecoveryCode(c));
