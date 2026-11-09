/** B.22 (ADR-097): which files a preset makes, at what loudness, and the preflight's order and wording rules */
import { describe, expect, it } from "vitest";
import { BUILTIN_PRESETS, outputLabel, outputLufs, preflightChecks, uniqueOutputs } from "@otsi-vie/contracts";
import { describeOutputs } from "@/components/exportstage/PresetLibrary";

describe("outputs", () => {
  it("a profile keeps its own frame; the reel takes the chosen one or its own; the same file once", () => {
    expect(uniqueOutputs([{ profile: "REEL", aspect: null }, { profile: "REEL", aspect: "9:16" }, { profile: "SOCIAL", aspect: null }, { profile: "SCOUT", aspect: null }], "9:16"))
      .toEqual([{ profile: "REEL", aspect: "9:16" }, { profile: "SOCIAL", aspect: "9:16" }, { profile: "SCOUT", aspect: "16:9" }]);
    expect(outputLabel({ profile: "ARCHIVE", aspect: null }, "1:1")).toBe("Archive master 16:9");
    expect(outputLufs({ profile: "SOCIAL", aspect: null }, null, null)).toBe(-14);
    expect(outputLufs({ profile: "SOCIAL", aspect: null }, null, -23)).toBe(-23);
    expect(outputLufs({ profile: "SOCIAL", aspect: null }, -16, -23)).toBe(-16);
    expect(BUILTIN_PRESETS.find((p) => p.id === "builtin-all-frames")!.spec.outputs).toHaveLength(4);
    expect(describeOutputs([{ profile: "REEL", aspect: "1:1" }, { profile: "ARCHIVE", aspect: null }])).toBe("Reel 1:1, Archive master");
  });
});

describe("preflight", () => {
  const ok = { clips: 3, length_us: 30e6, stale: false, player: true, rights_problem: null, music: false, lower_third: false, on_team_sheet: false,
    match_card: false, match_linked: false, score_bug: false, clock_confirmed: false };
  it("blocks first, then warnings, then what is fine", () => {
    const c = preflightChecks({ ...ok, clips: 0, stale: true, rights_problem: "The logo's rights are not in force.", lower_third: true, music: true });
    expect(c.map((x) => x.level)).toEqual(["BLOCK", "BLOCK", "BLOCK", "WARN", "WARN"].concat(c.slice(5).map(() => "OK")));
    expect(c.find((x) => x.key === "rights")!.text).toBe("The logo's rights are not in force.");
    expect(c.find((x) => x.key === "strap")!.level).toBe("WARN");
  });
  it("nothing blocks a ready reel; a missing match link warns only when the card or clock is on", () => {
    expect(preflightChecks(ok).every((x) => x.level !== "BLOCK")).toBe(true);
    expect(preflightChecks(ok).map((x) => x.key)).not.toContain("card");
    expect(preflightChecks({ ...ok, match_card: true, score_bug: true }).filter((x) => x.level === "WARN").map((x) => x.key)).toEqual(["card", "clock"]);
  });
});
