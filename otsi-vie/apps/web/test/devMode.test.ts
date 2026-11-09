import { afterEach, describe, expect, it, vi } from "vitest";

describe("Dev mode (ADR-080, S09): what is not built is said only to developers", () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it("a customer reads Not available yet, with no internal detail", async () => {
    vi.stubEnv("NEXT_PUBLIC_OTSI_DEV_MODE", "");
    const m = await import("@/lib/devMode");
    expect(m.DEV_MODE).toBe(false);
    expect(m.notBuilt("season statistics")).toBe("Not available yet");
    expect(m.NOT_YET).toBe("not available yet");
  });
  it("in Dev mode the reason names what is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_OTSI_DEV_MODE", "1");
    const m = await import("@/lib/devMode");
    expect(m.notBuilt("season statistics")).toBe("Not built yet: season statistics");
    expect(m.notBuilt()).toBe("Not built yet");
    expect(m.NOT_YET).toBe("not built yet");
  });
});
