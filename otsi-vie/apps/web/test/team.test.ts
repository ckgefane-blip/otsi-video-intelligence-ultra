/** Scoreboard team codes: any script, the club's short name first, never a made-up code */
import { describe, expect, it } from "vitest";
import { teamCode } from "@/lib/team";

describe("team codes", () => {
  it("works for names in any script and drops short words like FC", () => {
    expect(teamCode("ЕРЦАХУ")).toBe("ЕРЦ");
    expect(teamCode('ФК "Динамо"')).toBe("ДИН");
    expect(teamCode("Manchester United")).toBe("MU");
    expect(teamCode("FC Barcelona")).toBe("BAR");
    expect(teamCode("AC")).toBe("AC");
  });
  it("uses the recorded short name first, and shows — without a name", () => {
    expect(teamCode("Manchester United", "mun")).toBe("MUN");
    expect(teamCode(null)).toBe("—");
    expect(teamCode('"  "')).toBe("—");
  });
});
