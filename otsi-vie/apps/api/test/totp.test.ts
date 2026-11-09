/** Two-step sign-in codes against the published RFC 6238 test vectors (SHA-1 secret "12345678901234567890"; 6 digits = the last 6 of the 8). */
import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeAt, matchStep, newRecoveryCodes, openSecret, sealSecret, stepAt } from "../src/core/totp";

const SECRET = Buffer.from("12345678901234567890");
const VECTORS: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];

describe("TOTP", () => {
  it("matches RFC 6238 at every published time", () => {
    for (const [t, eight] of VECTORS) expect(codeAt(SECRET, stepAt(t * 1000))).toBe(eight.slice(2));
  });
  it("accepts one step of drift either way and nothing further", () => {
    const now = 1_700_000_000_000, s = stepAt(now);
    expect(matchStep(SECRET, codeAt(SECRET, s), now)).toBe(s);
    expect(matchStep(SECRET, codeAt(SECRET, s - 1), now)).toBe(s - 1);
    expect(matchStep(SECRET, codeAt(SECRET, s + 1), now)).toBe(s + 1);
    expect(matchStep(SECRET, codeAt(SECRET, s - 2), now)).toBeNull();
    expect(matchStep(SECRET, "12345", now)).toBeNull();
  });
  it("round-trips base32 (RFC 4648) and seals the secret to one user", () => {
    expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    expect(base32Decode("mzxw 6ytb oi").toString()).toBe("foobar");
    const sealed = sealSecret(SECRET, "user-a", "key-pem");
    expect(openSecret(sealed, "user-a", "key-pem").equals(SECRET)).toBe(true);
    expect(() => openSecret(sealed, "user-b", "key-pem")).toThrow();
    expect(() => openSecret(sealed, "user-a", "other-key")).toThrow();
  });
  it("makes ten distinct recovery codes in the xxxx-xxxx form", () => {
    const c = newRecoveryCodes();
    expect(new Set(c).size).toBe(10);
    for (const x of c) expect(x).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
});
