/**
 * Company-organisation guard (ADR-140 §8, the bank-account/order fix): only a member of the organisation
 * named by the server setting (OTSI_VIE_COMPANY_ORG_ID) may do the company billing actions — change bank
 * accounts, confirm / part-pay / reject / refund a plan order, invoice or confirm a token pack, top up a
 * wallet, refund or adjust a wallet, expire credits, run the renewal job. Fail closed: a missing setting
 * refuses everybody, never every admin.
 *
 * Pure-function test: no database, no app. It runs here (SQLite global setup) as well as on the host.
 */
import { describe, expect, it } from "vitest";
import { requireCompanyOrg, type Principal } from "../src/core/auth";

const principal = (organizationId: string): Principal => ({
  userId: "user-1",
  subject: "sub-1",
  organizationId,
  role: "OWNER",
  requestId: "req-1",
});

function codeOf(fn: () => void): string | null {
  try {
    fn();
    return null;
  } catch (e) {
    return (e as { code?: string }).code ?? "?";
  }
}

describe("requireCompanyOrg", () => {
  it("allows the company organisation's owner", () => {
    expect(codeOf(() => requireCompanyOrg(principal("org-otsi"), "org-otsi"))).toBeNull();
  });

  it("refuses a customer organisation's owner with 403 COMPANY_ORG_ONLY", () => {
    const err = (() => {
      try {
        requireCompanyOrg(principal("org-customer"), "org-otsi");
        return null;
      } catch (e) {
        return e as { status: number; code: string };
      }
    })();
    expect(err?.status).toBe(403);
    expect(err?.code).toBe("COMPANY_ORG_ONLY");
  });

  it("refuses everybody when the setting is missing (fail closed)", () => {
    // the setting unset: even the company organisation's own owner is refused — a missing setting
    // never falls back to letting every admin do the company actions.
    expect(codeOf(() => requireCompanyOrg(principal("org-otsi"), undefined))).toBe("COMPANY_ORG_ONLY");
    expect(codeOf(() => requireCompanyOrg(principal("org-customer"), undefined))).toBe("COMPANY_ORG_ONLY");
  });

  it("refuses everybody when the setting is an empty string (fail closed)", () => {
    expect(codeOf(() => requireCompanyOrg(principal("org-otsi"), ""))).toBe("COMPANY_ORG_ONLY");
  });

  it("never defaults to the only organisation present", () => {
    // the desktop database has a single organisation ("Gefane United FC"). With the setting naming a
    // different (live) organisation, that single organisation must still be refused — the fix never
    // treats "the only org here" as the company org.
    expect(codeOf(() => requireCompanyOrg(principal("org-gefane"), "org-otsi-live"))).toBe("COMPANY_ORG_ONLY");
  });
});
