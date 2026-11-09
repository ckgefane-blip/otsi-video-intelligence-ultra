import { describe, expect, it } from "vitest";
import { detectPeriods } from "@otsi-vie/contracts";

/** players per frame for each second: programme (0-2), play (10), short breaks inside play (1) */
function video(parts: [number, number][]): number[] { return parts.flatMap(([secs, v]) => new Array<number>(secs).fill(v)); }

describe("match time from players on the pitch", () => {
  it("finds two halves around a half-time programme, keeping replays inside play and leaving the programme out", () => {
    const v = video([[600, 1], [1500, 12], [60, 0], [1300, 12], [900, 0], [2700, 11], [600, 2]]);   // a 60 s replay inside the 1st half
    const r = detectPeriods(v);
    expect(r.note).toBeNull();
    expect(Math.abs(r.first!.start_us - 600e6)).toBeLessThanOrEqual(31e6);
    expect(Math.abs(r.first!.end_us - 3460e6)).toBeLessThanOrEqual(31e6);
    expect(Math.abs(r.second!.start_us - 4360e6)).toBeLessThanOrEqual(31e6);
    expect(Math.abs(r.second!.end_us - 7060e6)).toBeLessThanOrEqual(31e6);
  });

  it("a walk-out with a few players before kick-off is trimmed; nothing before the lineup card counts", () => {
    const v = video([[300, 0], [120, 5], [2700, 12], [900, 0], [2700, 12]]);
    expect(Math.abs(detectPeriods(v).first!.start_us - 420e6)).toBeLessThanOrEqual(40e6);         // the ends keep a 30 s margin
    expect(detectPeriods(v, 1000).first!.start_us).toBeGreaterThanOrEqual(1000e6);
  });

  it("no half-time break gives one stretch with a note; no long play gives nothing", () => {
    expect(detectPeriods(video([[300, 0], [5400, 12], [300, 0]]))).toMatchObject({ second: null, note: expect.stringMatching(/half-time/) });
    expect(detectPeriods(video([[600, 12], [300, 0], [600, 12]]))).toMatchObject({ first: null, second: null });
  });
});
