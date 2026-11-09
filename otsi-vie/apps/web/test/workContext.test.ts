import { describe, expect, it } from "vitest";
import { EMPTY_CTX, merge, navHref, samePageFor, showsBar, subjectOf } from "@/lib/workContext";

const V = "0190aaaa-0000-7000-8000-000000000001", W = "0190aaaa-0000-7000-8000-000000000002", R = "0190bbbb-0000-7000-8000-000000000001";
const sp = (s = "") => new URLSearchParams(s);

describe("work context (A.1, ADR-069)", () => {
  it("what each page is about, from its address", () => {
    expect(subjectOf("/analysis", sp(`video=${V}`))).toEqual({ kind: "video", video: V });
    expect(subjectOf(`/videos/${V}/tactics`, sp())).toEqual({ kind: "video", video: V });
    expect(subjectOf(`/reels/${R}`, sp())).toEqual({ kind: "reel", reel: R });
    expect(subjectOf("/studio", sp(`reel=${R}`))).toEqual({ kind: "reel", reel: R });
    expect(subjectOf("/reports/players/OTSI-NGA-2026-000012", sp())).toEqual({ kind: "player", player: "OTSI-NGA-2026-000012" });
    expect(subjectOf("/analysis", sp("video=not-an-id"))).toEqual({ kind: "video", video: undefined });
    expect(subjectOf("/dashboard", sp())).toEqual({ kind: null });
    expect([showsBar("/analysis"), showsBar("/exports"), showsBar("/dashboard"), showsBar("/library"), showsBar("/upload")]).toEqual([true, true, false, false, false]);
  });

  it("another match drops a reel of the old one; the same match keeps it", () => {
    const c = { ...EMPTY_CTX, video: V, reel: R, reelVideo: V, player: "P" };
    expect(merge(c, { kind: "video", video: V })).toEqual(c);
    expect(merge(c, { kind: "video", video: W })).toEqual({ video: W, reel: null, reelVideo: null, player: "P" });
  });

  it("the navigation opens each page on the context, else its own entry", () => {
    const c = { ...EMPTY_CTX, video: V, reel: R, reelVideo: V, player: "OTSI-NGA-2026-000012" };
    expect(navHref("Analysis", "/analysis", c)).toBe(`/analysis?video=${V}`);
    expect(navHref("Tactical", "/tactics", c)).toBe(`/tactics?video=${V}`);
    expect(navHref("Reel Builder", "/reels", c)).toBe(`/reels/${R}`);
    expect(navHref("Clip Studio", "/studio", c)).toBe(`/studio?reel=${R}`);
    expect(navHref("Export", "/exports", c)).toBe(`/exports?reel=${R}`);
    expect(navHref("Player Report", "/reports", c)).toBe("/reports/players/OTSI-NGA-2026-000012");
    expect(navHref("Home", "/dashboard", c)).toBe("/dashboard");
    expect(navHref("Clip Studio", "/studio", EMPTY_CTX)).toBe("/studio");
    expect(navHref("Analysis", "/analysis", EMPTY_CTX)).toBe("/analysis");
  });

  it("the same page about another match or reel", () => {
    expect(samePageFor("/tactics", { video: W })).toBe(`/tactics?video=${W}`);
    expect(samePageFor(`/videos/${V}/processing`, { video: W })).toBe(`/videos/${W}/processing`);
    expect(samePageFor("/studio", { reel: R })).toBe(`/studio?reel=${R}`);
    expect(samePageFor(`/reels/${V}`, { reel: R })).toBe(`/reels/${R}`);
    expect(samePageFor("/reports/players/x", { video: W })).toBeNull();
  });
});
