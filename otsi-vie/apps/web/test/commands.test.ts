import { hitHref } from "@otsi-vie/contracts";
import { describe, expect, it } from "vitest";
import { commands, matchCommands } from "../src/lib/commands";
import { EMPTY_CTX } from "../src/lib/workContext";

/** v3 Phase A.8 (ADR-070): the palette's commands and where a search hit opens */
describe("command palette", () => {
  it("offers only what the role may do", () => {
    const ids = (role: string | null) => matchCommands(commands(EMPTY_CTX), role, "").map((c) => c.id);
    expect(ids("OWNER")).toEqual(["upload", "players", "matches", "admin", "wallet", "billing", "team", "keys", "security"]);
    expect(ids("EDITOR")).toEqual(["upload", "players", "matches", "wallet", "keys", "security"]);
    expect(ids("VIEWER")).toEqual(["players", "matches", "wallet", "keys", "security"]);
    expect(ids(null)).toEqual(["players", "matches", "wallet", "keys", "security"]);
  });

  it("puts the open reel and match first", () => {
    const c = commands({ ...EMPTY_CTX, video: "v1", reel: "r1" });
    expect(c.slice(0, 2).map((x) => [x.id, x.href])).toEqual([["studio", "/studio?reel=r1"], ["continue", "/analysis?video=v1"]]);
  });

  it("matches the words, the label's start first", () => {
    const m = (q: string) => matchCommands(commands(EMPTY_CTX), "OWNER", q).map((c) => c.id);
    expect(m("up")).toEqual(["upload", "billing"]);   // "top up" is in Billing's words
    expect(m("invite")).toEqual(["team"]);
    expect(m("2fa")).toEqual(["security"]);
    expect(m("  MATCH ")).toEqual(["matches", "upload"]);   // "a match" is in Upload's hint
    expect(m("zzz")).toEqual([]);
    expect(matchCommands(commands(EMPTY_CTX), "VIEWER", "invite")).toEqual([]);
  });

  it("opens each hit on its page", () => {
    const id = "01a199aa-08fd-740d-93a3-a27fec2d7a8b";
    expect(hitHref({ kind: "MATCH", id, title: "x", detail: null, ref: null })).toBe(`/analysis?video=${id}`);
    expect(hitHref({ kind: "PLAYER", id, title: "x", detail: null, ref: "OTSI-NGA-2026-000001" })).toBe("/reports/players/OTSI-NGA-2026-000001");
    expect(hitHref({ kind: "PLAYER", id, title: "x", detail: null, ref: null })).toBe(`/reports/players/${id}`);
    expect(hitHref({ kind: "REEL", id, title: "x", detail: null, ref: null })).toBe(`/reels/${id}`);
    expect(hitHref({ kind: "PROJECT", id, title: "U17 & U19", detail: null, ref: null })).toBe("/library?q=U17%20%26%20U19");
  });
});
