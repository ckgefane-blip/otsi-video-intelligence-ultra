import type { JobList } from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";
import { ago, badge, pollMs } from "@/lib/jobs";

const list = (active: number, failed = 0): JobList => ({ jobs: [], active, running: 0, failed_recent: failed });

describe("job tray rules (ADR-060)", () => {
  it("reads often only while something moves or the tray is open, never in a hidden tab", () => {
    expect(pollMs(list(2), false, false)).toBe(3000);
    expect(pollMs(list(0), true, false)).toBe(3000);
    expect(pollMs(list(0), false, false)).toBe(20000);
    expect(pollMs(list(5), true, true)).toBeNull();
  });
  it("counts active jobs, else warns of a failure, else shows nothing", () => {
    expect(badge(null)).toBeNull();
    expect(badge(list(3))).toEqual({ text: "3", alert: false });
    expect(badge(list(120))).toEqual({ text: "99+", alert: false });
    expect(badge(list(0, 1))).toEqual({ text: "!", alert: true });
    expect(badge(list(0))).toBeNull();
  });
  it("tells the age of a server time (UTC)", () => {
    const now = Date.parse("2026-11-06T12:00:00Z");
    expect(ago("2026-11-06 11:59:30.000000", now)).toBe("just now");
    expect(ago("2026-11-06 11:45:00.000000", now)).toBe("15 min ago");
    expect(ago("2026-11-06T09:00:00Z", now)).toBe("3 h ago");
    expect(ago(null, now)).toBe("");
  });
});
