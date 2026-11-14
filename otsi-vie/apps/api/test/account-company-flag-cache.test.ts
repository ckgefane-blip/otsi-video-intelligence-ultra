/**
 * The company-organisation flag cache (GET /v1/me, AccountService.companyOrgIdFor): when central
 * cannot be reached, the last known answer is kept — the company organisation keeps its Admin /
 * Billing screens offline, and a customer keeps seeing only its own. Only a successful answer
 * refreshes the cache; with nothing cached yet, an unreachable central still means nobody is the
 * company organisation (fail closed). The 5-minute fresh window is unchanged.
 *
 * Direct unit test: AccountService is built with a stub Db, a stub config (no local company-org
 * setting, so the central path is taken) and a stub central link. Fake timers move past the
 * 5-minute cache window. No HTTP stack, no database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/core/config";
import type { Db } from "../src/core/db";
import { AccountService } from "../src/modules/account/account";
import type { CentralLinkService } from "../src/modules/central/link";

const USER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const SIX_MINUTES = 6 * 60_1000;

const userRow = { id: USER_ID, email: "owner@example.test", display_name: "Owner", avatar_updated_at: null, onboarded_at: null };
const membershipRows = [
  { organization_id: ORG_A, organization_name: "Gefane United FC", role: "OWNER" },
  { organization_id: ORG_B, organization_name: "Riverside Youth FC", role: "OWNER" },
];

/** central's /v1/me answer: which org (if any) is the company org */
const centralMe = (companyOrgId: string | undefined) => ({
  user: { id: USER_ID, email: "owner@example.test", display_name: "Owner", avatar_updated_at: null, onboarded_at: null },
  memberships: membershipRows.map((m) => ({ ...m, is_company_org: m.organization_id === companyOrgId })),
});

function makeService(call: ReturnType<typeof vi.fn>) {
  const db = { one: vi.fn().mockResolvedValue(userRow), rows: vi.fn().mockResolvedValue(membershipRows) } as unknown as Db;
  const cfg = { companyOrganizationId: undefined } as unknown as Config;
  const central = { linked: true, call } as unknown as CentralLinkService;
  return new AccountService(db, cfg, central);
}

const flagOf = (me: { memberships: { organization_id: string; is_company_org: boolean }[] }, orgId: string) =>
  me.memberships.find((m) => m.organization_id === orgId)?.is_company_org;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("company-org flag cache (central unreachable)", () => {
  it("(a) cached company-org=true survives an unreachable central past the 5 minutes", async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, body: centralMe(ORG_A) });
    const svc = makeService(call);
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
    expect(call).toHaveBeenCalledTimes(1); // second read inside the 5 minutes: fresh cache, no second ask
    vi.advanceTimersByTime(SIX_MINUTES);
    call.mockRejectedValue(new Error("central unreachable"));
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
    // repeated failures keep serving the same last known answer
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
  });

  it("(b) cached company-org=false survives an unreachable central past the 5 minutes", async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, body: centralMe(undefined) });
    const svc = makeService(call);
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(false);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
    vi.advanceTimersByTime(SIX_MINUTES);
    call.mockRejectedValue(new Error("central unreachable"));
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(false);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
  });

  it("(c) no cached value and an unreachable central means nobody is the company org (fail closed)", async () => {
    const call = vi.fn().mockRejectedValue(new Error("central unreachable"));
    const svc = makeService(call);
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(false);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
  });

  it("(d) when central answers, the cache refreshes to the new value", async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, body: centralMe(ORG_A) });
    const svc = makeService(call);
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
    vi.advanceTimersByTime(SIX_MINUTES);
    call.mockResolvedValue({ status: 200, body: centralMe(ORG_B) });
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(false);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(true);
    expect(call).toHaveBeenCalledTimes(2); // expired cache asked again, then the fresh answer is cached
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(true);
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("an expired cache plus a non-200 answer from central keeps the last known answer", async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, body: centralMe(ORG_A) });
    const svc = makeService(call);
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    vi.advanceTimersByTime(SIX_MINUTES);
    call.mockResolvedValue({ status: 500, body: { code: "CENTRAL_ERROR" } });
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
  });

  it("an expired cache plus an unparsable answer from central keeps the last known answer", async () => {
    const call = vi.fn().mockResolvedValue({ status: 200, body: centralMe(ORG_A) });
    const svc = makeService(call);
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    vi.advanceTimersByTime(SIX_MINUTES);
    call.mockResolvedValue({ status: 200, body: { nonsense: true } });
    expect(flagOf(await svc.me(USER_ID), ORG_A)).toBe(true);
    expect(flagOf(await svc.me(USER_ID), ORG_B)).toBe(false);
  });
});
