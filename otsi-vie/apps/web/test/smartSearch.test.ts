/** v3 Phase B.10 (ADR-086): the Smart Search rules shared by the API and the palette */
import { describe, expect, it } from "vitest";
import { hasCriteria, hitHref, parseSmartQuery, searchTerms } from "@otsi-vie/contracts";

describe("Smart Search rules", () => {
  it("keeps words as the index does: lower case, accents removed, any script", () => {
    expect(searchTerms("José Núñez — OTSI-NGA-2026-000001")).toEqual(["jose", "nunez", "otsi", "nga", "2026", "000001"]);
    expect(searchTerms("Ерцаху Ёлка")).toEqual(["ерцаху", "елка"]);
    expect(searchTerms("%_%")).toEqual([]);
  });
  it("splits filters from words; a filter not understood is reported, never guessed", () => {
    expect(parseSmartQuery("event:goals Godwin is:confirmed")).toEqual({ words: ["godwin"], kinds: ["MOMENT"], events: ["GOAL"], period: null, player: null, role: null, role_confirmed_only: null, analysed: null, confirmed: true, unknown: [] });
    expect(parseSmartQuery("type:players type:reel is:not-analysed event:set-piece")).toMatchObject({ kinds: ["PLAYER", "REEL", "MOMENT"], analysed: false, events: ["SET_PIECE"] });
    expect(parseSmartQuery("type:nonsense is:great x")).toMatchObject({ words: ["x"], unknown: ["type:nonsense", "is:great"] });
    expect(hasCriteria(parseSmartQuery("%%"))).toBe(false);
    expect(hasCriteria(parseSmartQuery("type:moment"))).toBe(true);
    // E.5: period and player filters
    expect(parseSmartQuery("period:h1 event:shot")).toMatchObject({ period: "H1", events: ["SHOT"], kinds: ["MOMENT"] });
    expect(parseSmartQuery("half:2 event:goal")).toMatchObject({ period: "H2", events: ["GOAL"], kinds: ["MOMENT"] });
    expect(parseSmartQuery("player:Rashford event:goal period:h2")).toMatchObject({ player: "Rashford", words: ["rashford"], events: ["GOAL"], period: "H2", kinds: ["MOMENT"] });
    expect(parseSmartQuery('player:"Marcus Rashford" period:first_half')).toMatchObject({ player: "Marcus Rashford", words: ["marcus", "rashford"], period: "H1", kinds: ["MOMENT"] });
    expect(hasCriteria(parseSmartQuery("period:h2"))).toBe(true);
    // E.8: role and confirmed_role filters (ADR-122)
    expect(parseSmartQuery("role:am is:confirmed_role")).toMatchObject({ role: "AM", role_confirmed_only: true, kinds: ["PLAYER"] });
    expect(parseSmartQuery("position:cb")).toMatchObject({ role: "CB", role_confirmed_only: true, kinds: ["PLAYER"] });
    expect(hasCriteria(parseSmartQuery("role:cm"))).toBe(true);
  });
  it("a moment or marker opens Analysis at its time", () => {
    const v = "01a18837-dbfd-719b-93e0-2916132bac92";
    expect(hitHref({ kind: "MOMENT", id: v, title: "Goal", detail: null, ref: null, video_id: v, at_us: 125_040_000 })).toBe(`/analysis?video=${v}&t=125`);
    expect(hitHref({ kind: "MARKER", id: v, title: "x", detail: null, ref: null, video_id: v, at_us: 0 })).toBe(`/analysis?video=${v}`);
  });
});

describe("Smart Bins in the Media Bin (B.11)", () => {
  it("keeps the suggested moments that hold one of the bin's moments or markers on this video", async () => {
    const { binMoments } = await import("@otsi-vie/contracts");
    const v = "01a18837-dbfd-719b-93e0-2916132bac92", w = "01a18837-dbfd-719b-93e0-2916132bac93";
    const ms = [{ in_pts_us: 0, out_pts_us: 10e6 }, { in_pts_us: 20e6, out_pts_us: 30e6 }, { in_pts_us: 40e6, out_pts_us: 50e6 }];
    const hit = (kind: "MOMENT" | "MARKER" | "MATCH", video: string, at: number | null) => ({ kind, id: v, title: "x", detail: null, ref: null, video_id: video, at_us: at });
    expect(binMoments(ms, [hit("MOMENT", v, 25e6), hit("MARKER", v, 50e6), hit("MOMENT", w, 5e6), hit("MATCH", v, null)], v)).toEqual([ms[1], ms[2]]);
    expect(binMoments(ms, [], v)).toEqual([]);
  });
});
