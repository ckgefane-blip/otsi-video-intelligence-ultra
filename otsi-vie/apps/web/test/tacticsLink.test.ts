/** v3 Phase B.8 (ADR-085): the Analysis → Tactical link carries the same context, and Tactical reads it back */
import { describe, expect, it } from "vitest";
import { ANALYSIS_TO_TACTIC, readTacticsContext, TACTIC_TABS, tacticsHref } from "@/lib/tacticsLink";

const V = "01a18837-dbfd-719b-93e0-2916132bac92", T = "0190a000-0000-7000-8000-000000000001";

describe("Analysis to Tactical link", () => {
  it("names the video, the matching tab, the moment and the selected track", () => {
    expect(tacticsHref({ videoId: V, tab: ANALYSIS_TO_TACTIC[3]!, timeUs: 95_430_000, trackId: T }))
      .toBe(`/tactics?video=${V}&tab=pass-network&t=95.4&track=${T}`);
    expect(tacticsHref({ videoId: V, tab: "heat-zones", timeUs: 0, trackId: null })).toBe(`/tactics?video=${V}&tab=heat-zones`);
  });
  it("every Analysis tab after the video maps to a Tactical tab", () => {
    for (const i of [1, 2, 3, 4]) expect(TACTIC_TABS).toContain(ANALYSIS_TO_TACTIC[i]);
  });
  it("reads it back; malformed values are ignored", () => {
    const q = (s: string) => readTacticsContext(new URLSearchParams(s));
    expect(q(`tab=player-comparison&t=95.4&track=${T}`)).toEqual({ tabIndex: 5, timeUs: 95_400_000, trackId: T });
    expect(q("tab=nope&t=abc&track=x")).toEqual({ tabIndex: null, timeUs: null, trackId: null });
    expect(q("")).toEqual({ tabIndex: null, timeUs: null, trackId: null });
  });
});
