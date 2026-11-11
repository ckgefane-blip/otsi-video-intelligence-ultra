/**
 * Billing daily renewal job (Finding 4): the scheduler starts only in central mode, runs once at
 * start-up and then on its interval, never overlaps itself, survives a failed run, and stops cleanly.
 * Pure unit test — no database: runRenewals is stubbed, so it runs here (SQLite backend) and on the
 * host. The end-to-end proof (a real run creating exactly one renewal order, and a second run creating
 * none) lives in bank-transfer.api.test.ts, which needs host MySQL.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../src/core/config";
import type { Db } from "../src/core/db";
import { BillingService } from "../src/modules/billing/billing";
import type { WalletService } from "../src/modules/wallet/wallet";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const started: BillingService[] = [];
afterEach(() => {
  for (const s of started.splice(0)) s.stopRenewalScheduler();
});

function service(centralMode: boolean): BillingService {
  const cfg = { central: centralMode ? { centralMode: true, licenceGraceDays: 14 } : undefined } as unknown as Config;
  const s = new BillingService({} as unknown as Db, {} as unknown as WalletService, cfg);
  started.push(s);
  return s;
}

describe("billing daily renewal job", () => {
  it("never starts in local mode: onModuleInit runs nothing", async () => {
    const s = service(false);
    const run = vi.spyOn(s, "runRenewals").mockResolvedValue({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 });
    await s.onModuleInit();
    await sleep(60);
    expect(run).not.toHaveBeenCalled();
    s.onModuleDestroy();
  });

  it("runs once at start-up in central mode, then stops cleanly", async () => {
    const s = service(true);
    const run = vi.spyOn(s, "runRenewals").mockResolvedValue({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 });
    await s.onModuleInit();
    expect(run).toHaveBeenCalledTimes(1);
    s.onModuleDestroy();
    await sleep(60);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ticks on its interval and stops when asked", async () => {
    const s = service(true);
    const run = vi.spyOn(s, "runRenewals").mockResolvedValue({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 });
    s.startRenewalScheduler(20);
    await sleep(120);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(3);
    s.stopRenewalScheduler();
    const stoppedAt = run.mock.calls.length;
    await sleep(80);
    expect(run.mock.calls.length).toBe(stoppedAt);
  });

  it("never overlaps itself: no second run starts while one is still in flight", async () => {
    const s = service(true);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const run = vi.spyOn(s, "runRenewals")
      .mockImplementationOnce(() => gate.then(() => ({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 })))
      .mockResolvedValue({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 });
    s.startRenewalScheduler(15);
    await sleep(90);
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await sleep(60);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("a failed run is logged and the next run still happens", async () => {
    const s = service(true);
    const run = vi.spyOn(s, "runRenewals")
      .mockRejectedValueOnce(new Error("database down"))
      .mockResolvedValue({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 });
    s.startRenewalScheduler(20);
    await sleep(100);
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("starting twice does not double-schedule", async () => {
    const s = service(true);
    const run = vi.spyOn(s, "runRenewals").mockResolvedValue({ renewals_created: 0, renewal_order_ids: [], past_due: 0, downgraded_to_free: 0 });
    s.startRenewalScheduler(20);
    s.startRenewalScheduler(20);
    await sleep(110);
    // one chain: start-up run + about five ticks; two chains would be about twice that
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(run.mock.calls.length).toBeLessThanOrEqual(8);
  });
});
