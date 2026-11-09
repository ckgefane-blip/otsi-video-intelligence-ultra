/**
 * Password hashing for local sign-in (ADR-021): scrypt from Node's crypto (no third-party code), a random 16-byte salt per password,
 * parameters stored in the hash so they can be raised later, constant-time comparison. Passwords are never logged or stored.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";

const N = 2 ** 15, R = 8, P = 1, KEYLEN = 32;
const MAXMEM = 128 * N * R * 2;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password.normalize("NFKC"), salt, keylen, { N: n, r, p, maxmem: Math.max(MAXMEM, 128 * n * r * 2) }, (e, k) => (e ? reject(e) : resolve(k))));
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;

/** Policy: length only (NIST SP 800-63B); a blocklist of breached passwords is a Block 15 item. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  return null;
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const m = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5]!, "base64url");
  const key = await scrypt(pw, Buffer.from(m[4]!, "base64url"), Number(m[1]), Number(m[2]), Number(m[3]), expected.length);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A hash to verify against when the account does not exist, so the response time does not reveal which emails are registered. */
let dummy: Promise<string> | undefined;
export const dummyHash = (): Promise<string> => (dummy ??= hashPassword(randomBytes(24).toString("hex")));
