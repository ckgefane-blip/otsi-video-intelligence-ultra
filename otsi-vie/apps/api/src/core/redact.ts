/**
 * Redaction for anything the platform keeps for later reading: audit before/after states and dispatcher error text (ADR-019).
 * Secrets never reach audit_events or outbox_events.last_error: credential-like keys are replaced, and secrets embedded in free text
 * (bearer tokens, JWTs, passwords inside connection URLs, key=value secrets) are masked.
 */
export const REDACTED = "[REDACTED]";

const SECRET_KEY = new RegExp(
  "^(password|passwd|pwd|secret|client_secret|token|access_token|refresh_token|id_token|authorization|cookie|set_cookie|api_key|apikey|" +
  "private_key|signing_key|webhook_secret|card_number|pan|cvv|cvc|iban|account_number|otp|mfa_code)$" +
  "|(_password|_secret|_token|_api_key|_private_key)$",
  "i");

const TEXT_RULES: [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/g, `Bearer ${REDACTED}`],
  [/\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g, REDACTED],                    // compact JWS / JWT
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, `$1${REDACTED}@`],                       // scheme://user:password@host
  [/\b(password|passwd|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, `$1$2${REDACTED}`],
];

export function redactText(s: string): string {
  return TEXT_RULES.reduce((acc, [re, rep]) => acc.replace(re, rep), s);
}

/** A deep copy of `value` with credential-like keys replaced and secrets in strings masked. Cycles become "[CYCLE]". */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return "[CYCLE]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? REDACTED : redact(v, seen);
  return out;
}
